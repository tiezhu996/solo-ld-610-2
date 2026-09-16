/**
 * 回读快照一致性：确定性复现 + 修复后免疫 + 读中失败不留事务/锁。
 *
 * 背景：better-sqlite3 同步执行，单连接内两条读之间不会被自身打断；缺陷只可能被
 * 另一个连接/进程的提交切中。因此这里在同一数据库文件上开两个独立连接（模拟
 * 回读事务与并发的驳回/归档/再次转办），用"先开读事务、再提交写、再继续读"的
 * 确定性交错来精确卡住旧窗口。
 *
 * 运行：cd backend && npx tsx ../scripts/verify-read-snapshot.ts
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, openDatabase, snapshotRead } from "../backend/src/db/sqlite";
import { transferLoopService } from "../backend/src/services/TransferLoopService";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relic-snap-"));
const FILE = path.join(dir, "snap.db");

let pass = 0;
const ok = (n: string, c: boolean) => {
  assert.ok(c, n);
  pass++;
  console.log("  ✓ " + n);
};

// —— 两个指向同一文件的独立连接：A 搭数据/模拟并发，S 是 service 与快照的全局单例 ——
const A = openDatabase(FILE); // openDatabase 已应用 schema 与 WAL/FK pragma
const S = getDb(FILE);
void S;
const now = new Date().toISOString();
A.prepare(
  `INSERT INTO relic_item (relic_code,name,current_condition) VALUES ('RLC-1','碗','DAMAGED')`,
).run();
const relicId = (A.prepare(`SELECT id FROM relic_item`).get() as { id: number }).id;
const mkDamage = (status: string) =>
  (
    A.prepare(
      `INSERT INTO damage_record (relic_id,damage_type,severity,discovered_by,discovered_at,status)
       VALUES (?,'CRACK','HIGH','t',?,?)`,
    ).run(relicId, now, status) as { lastInsertRowid: bigint }
  ).lastInsertRowid;
const mkPlan = (damageId: number | bigint, status: string, reason: string | null = null) =>
  (
    A.prepare(
      `INSERT INTO restoration_plan
        (relic_id,damage_record_id,plan_title,approval_status,owner_id,reject_reason,plan_version,created_at,updated_at)
       VALUES (?,?,'p',?,1,?,1,?,?)`,
    ).run(relicId, damageId, status, reason, now, now) as { lastInsertRowid: bigint }
  ).lastInsertRowid;

console.log("A) 确定性复现旧缺陷：两次独立读 + 中间插入提交 -> 跨时间点拼接");
{
  const dmg = mkDamage("IN_PLAN");
  const plan = mkPlan(dmg, "SUBMITTED");

  // 旧实现等价物：第一次读病害（autocommit，拿到 IN_PLAN）
  const damageAtT1 = A.prepare(`SELECT id,status FROM damage_record WHERE id=?`).get(dmg) as {
    status: string;
  };
  // —— 并发连接 B 在两次读之间完成"驳回"提交 ——
  const B = openDatabase(FILE);
  B.exec("BEGIN IMMEDIATE");
  B.prepare(`UPDATE restoration_plan SET approval_status='REJECTED' WHERE id=?`).run(plan);
  B.prepare(`UPDATE damage_record SET status='REJECTED' WHERE id=?`).run(dmg);
  B.exec("COMMIT");
  B.close();
  // 旧实现第二次读：另起事务读历史（此刻已无在途方案）
  const historyAtT2 = A.prepare(
    `SELECT approval_status FROM restoration_plan WHERE damage_record_id=? ORDER BY id DESC`,
  ).all(dmg) as Array<{ approval_status: string }>;
  const activeAtT2 = historyAtT2.find(
    (p) => p.approval_status === "SUBMITTED" || p.approval_status === "APPROVED",
  );

  ok("旧路径：病害仍是 IN_PLAN（T1）", damageAtT1.status === "IN_PLAN");
  ok("旧路径：历史已无在途方案（T2）", activeAtT2 === undefined);
  const inconsistent = damageAtT1.status === "IN_PLAN" && activeAtT2 === undefined;
  ok("旧路径复现出『锁定却无在途方案』的非法组合", inconsistent);
}

console.log("B) 修复后：快照事务对读中提交免疫（钉住 T1 旧快照）");
{
  // 另一条病害，走真正的 service 回读路径，但用"读事务已打开后再提交写"来交错
  const dmg = mkDamage("IN_PLAN");
  const plan = mkPlan(dmg, "SUBMITTED");

  // 直接驱动 snapshotRead：第一条 SELECT 建立快照后，在回调内用连接 B 提交驳回，
  // 回调内继续在同一事务读到的仍是驳回前的旧快照。
  const result = snapshotRead((tx) => {
    const before = tx.prepare(`SELECT status FROM damage_record WHERE id=?`).get(dmg) as {
      status: string;
    };
    const histBefore = tx
      .prepare(`SELECT approval_status FROM restoration_plan WHERE damage_record_id=?`)
      .all(dmg) as Array<{ approval_status: string }>;

    // 并发连接 B 在该读事务进行中提交驳回
    const B = openDatabase(FILE);
    B.exec("BEGIN IMMEDIATE");
    B.prepare(`UPDATE restoration_plan SET approval_status='REJECTED' WHERE id=?`).run(plan);
    B.prepare(`UPDATE damage_record SET status='REJECTED' WHERE id=?`).run(dmg);
    B.exec("COMMIT");
    B.close();

    // 同一快照事务内再次读取：必须仍是提交前的一致旧视图
    const after = tx.prepare(`SELECT status FROM damage_record WHERE id=?`).get(dmg) as {
      status: string;
    };
    const histAfter = tx
      .prepare(`SELECT approval_status FROM restoration_plan WHERE damage_record_id=?`)
      .all(dmg) as Array<{ approval_status: string }>;
    return { before, histBefore, after, histAfter };
  });

  ok("快照内第一次读 IN_PLAN/有 SUBMITTED",
    result.before.status === "IN_PLAN" && result.histBefore.some((p) => p.approval_status === "SUBMITTED"));
  ok("并发提交后，快照内病害仍读 IN_PLAN", result.after.status === "IN_PLAN");
  const stillActive = result.histAfter.some(
    (p) => p.approval_status === "SUBMITTED" || p.approval_status === "APPROVED",
  );
  ok("并发提交后，快照内仍读到同一在途方案（不自相矛盾）", stillActive);

  // 快照外的新读必须看到已提交的新状态（非脏读、可重复读到新值）
  const fresh = transferLoopService.getTransferStatus(Number(dmg));
  ok("快照提交后新读看到 REJECTED 且无在途方案",
    fresh.damage.status === "REJECTED" && fresh.activePlan === null);
}

console.log("C) 读取过程抛错：回滚且不残留事务/锁，库仍可写");
{
  const dmg = mkDamage("OPEN");
  let threw = false;
  try {
    snapshotRead((tx) => {
      tx.prepare(`SELECT status FROM damage_record WHERE id=?`).get(dmg);
      throw new Error("READ_FAILED_INJECTED");
    });
  } catch (e) {
    threw = (e as Error).message === "READ_FAILED_INJECTED";
  }
  ok("快照内异常向上抛出", threw);
  // 事务已回滚：snapshotRead 使用的同一连接可立即开启新写事务，
  // 不被 "cannot start a transaction within a transaction" 挡住，也无残留写锁。
  let writable = false;
  try {
    S.exec("BEGIN IMMEDIATE");
    S.prepare(`UPDATE damage_record SET status='IN_PLAN' WHERE id=?`).run(dmg);
    S.exec("COMMIT");
    writable = true;
  } catch (e) {
    try {
      S.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
  ok("失败后同连接无残留事务/写锁，可立即写入", writable);
}

A.close();
S.close();
console.log(`\n全部通过：${pass} 项断言 ✓`);
