/**
 * 多进程读写竞速：验证并发"驳回/再次转办"提交期间，每一次回读都来自同一次快照、
 * 响应内部自洽。修复前的"两次独立读"会在此竞速下偶发自相矛盾；快照读应 0 违例。
 *
 * 运行：cd backend && npx tsx ../scripts/verify-read-race.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { getDb, openDatabase } from "../backend/src/db/sqlite";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relic-race-"));
const FILE = path.join(dir, "race.db");

const setup = openDatabase(FILE);
setup.prepare(`INSERT INTO relic_item (relic_code,name,current_condition) VALUES ('R-1','碗','DAMAGED')`).run();
const now = new Date().toISOString();
const dmgId = Number(
  (
    setup
      .prepare(
        `INSERT INTO damage_record (relic_id,damage_type,severity,discovered_by,discovered_at,status)
         VALUES (1,'CRACK','HIGH','t',?,'OPEN')`,
      )
      .run(now) as { lastInsertRowid: bigint }
  ).lastInsertRowid,
);
setup.close();

const TSX = path.join(__dirname, "..", "backend", "node_modules", ".bin", "tsx");
const WORKER = path.join(__dirname, "race-worker.ts");

const run = (mode: string, n: number) =>
  new Promise<{ mode: string; reads?: number; rounds?: number; violations: Record<string, number> }>((resolve) => {
    const child = spawn(TSX, [WORKER, mode, FILE, String(dmgId), String(n)], {
      cwd: path.join(__dirname, "..", "backend"),
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("close", () => {
      const line = out.trim().split("\n").pop() ?? "{}";
      try {
        const j = JSON.parse(line);
        resolve({ mode, reads: j.reads, rounds: j.rounds, violations: j.violations ?? {} });
      } catch {
        resolve({ mode, violations: { PARSE_ERROR: 1 } });
      }
    });
  });

async function main() {
  // 1 个写者做 200 轮 转办+驳回，3 个读者各做 2000 次回读，全部同时进行
  const procs = [
    run("writer", 200),
    run("reader", 2000),
    run("reader", 2000),
    run("reader", 2000),
  ];
  const [writer, ...readers] = await Promise.all(procs);

  let totalReads = 0;
  const totalViolations: Record<string, number> = {};
  for (const r of readers) {
    totalReads += r.reads ?? 0;
    for (const [k, v] of Object.entries(r.violations)) totalViolations[k] = (totalViolations[k] ?? 0) + v;
  }

  console.log("写者完成翻转轮数:", writer.rounds);
  console.log("读者总回读次数:", totalReads);
  console.log("回读内部一致性违例:", JSON.stringify(totalViolations));

  // 终态稳定收口：写者结束后多次回读结果必须稳定且自洽
  const svcDb = getDb(FILE);
  const last = svcDb
    .prepare(`SELECT status FROM damage_record WHERE id=?`)
    .get(dmgId) as { status: string };
  const activeCount = (
    svcDb
      .prepare(
        `SELECT COUNT(*) n FROM restoration_plan WHERE damage_record_id=? AND approval_status IN ('SUBMITTED','APPROVED')`,
      )
      .get(dmgId) as { n: number }
  ).n;
  const totalPlans = (
    svcDb
      .prepare(`SELECT COUNT(*) n FROM restoration_plan WHERE damage_record_id=?`)
      .get(dmgId) as { n: number }
  ).n;
  console.log("终态: damage=", last.status, "activePlans=", activeCount, "totalPlans=", totalPlans);

  const fail =
    totalReads < 3000 ||
    Object.values(totalViolations).some((v) => v > 0) ||
    activeCount !== 0 ||
    last.status !== "REJECTED";

  if (fail) {
    console.error("❌ 竞速校验失败");
    process.exit(1);
  }
  svcDb.close();
  console.log(`✓ ${totalReads} 次并发回读全部自洽（0 违例）；终态稳定：${totalPlans} 条历史均已驳回，病害解锁。`);
}

main();
