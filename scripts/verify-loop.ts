/**
 * 病害 -> 修复方案 闭环验证（服务级 + 多进程并发）。
 * 运行：cd backend && npm run test:loop
 * 使用独立临时库，不污染开发数据。
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { getDb, resetDb } from "../backend/src/db/sqlite";
import { runSeed } from "../backend/src/db/seedData";
import { transferLoopService, __transferLoopHooks } from "../backend/src/services/TransferLoopService";
import { damageRecordRepository } from "../backend/src/repositories/DamageRecordRepository";

const DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "relic-loop-")), "loop.db");
process.env.DB_PATH = DB_PATH;
process.env.SEED_ON_BOOT = "false";

const ACTOR = { id: 1, role: "ADMIN" };

async function main() {
  let pass = 0;
  const ok = (name: string, cond: boolean) => {
    assert.ok(cond, name);
    pass++;
    console.log(`  ✓ ${name}`);
  };

  const conn = getDb(DB_PATH);
  runSeed(conn);

  const byStatus = () => {
    const map: Record<string, number> = {};
    for (const r of damageRecordRepository.findAll()) map[r.status] = r.id;
    return map;
  };
  const newOpenDamage = () =>
    damageRecordRepository.save({
      relic_id: 1,
      damage_type: "CRACK",
      position_desc: "测试用新病害",
      severity: "HIGH",
      discovered_by: "tester",
      status: "OPEN",
    }).id;

  console.log("1) 幂等：存在未归档方案时重复提交只回读原方案");
  {
    const id = byStatus()["IN_PLAN"];
    const s0 = transferLoopService.getTransferStatus(id);
    const before = s0.history.length;
    const r1 = transferLoopService.transferToPlanIdempotent({ damageId: id, plan_title: "重复提交A" }, ACTOR);
    const r2 = transferLoopService.transferToPlanIdempotent({ damageId: id, plan_title: "重复提交B" }, ACTOR);
    const s1 = transferLoopService.getTransferStatus(id);
    ok("两次重复提交均未新建（created=false）", r1.created === false && r2.created === false);
    ok("回读到的是同一条原方案", r1.plan.id === r2.plan.id && r1.plan.id === s0.activePlan!.id);
    ok("方案总数不增加", s1.history.length === before);
    ok("回读 transferred=true 且病害仍锁定", s1.transferred === true && s1.damage.status === "IN_PLAN");
  }

  console.log("2) 正常闭环：OPEN 转办 -> 批准 -> 归档结案");
  {
    const id = byStatus()["OPEN"];
    const r = transferLoopService.transferToPlan(
      { damageId: id, plan_title: "口沿冲裂修复", method: "黏合", risk_assessment: "低", owner_id: 7 },
      ACTOR,
    );
    ok("首次转办创建方案 created=true", r.created === true);
    ok("方案初始 SUBMITTED", r.plan.approval_status === "SUBMITTED");
    ok("病害被锁定 IN_PLAN", r.damage.status === "IN_PLAN");

    const a = transferLoopService.approvePlan(r.plan.id, ACTOR);
    ok("批准后方案 APPROVED、病害仍锁定",
      (a.activePlan as { approval_status?: string })?.approval_status === "APPROVED" &&
      a.damage.status === "IN_PLAN");

    const arc = transferLoopService.archivePlan(r.plan.id, ACTOR);
    ok("归档后方案 ARCHIVED", arc.history[0].approval_status === "ARCHIVED");
    ok("归档后无在途方案", arc.activePlan === null);
    ok("病害结案 CLOSED", arc.damage.status === "CLOSED");

    let closedRejected = false;
    try {
      transferLoopService.transferToPlan({ damageId: id, plan_title: "结案后再转" }, ACTOR);
    } catch (e) {
      closedRejected = (e as { code?: string }).code === "DAMAGE_CLOSED";
    }
    ok("已结案病害不能再次转办", closedRejected);
  }

  console.log("3) 驳回：病害恢复可转办，原驳回记录保留，再转办产生新方案");
  {
    const id = byStatus()["REJECTED"];
    const before = transferLoopService.getTransferStatus(id).history.length;
    const r = transferLoopService.transferToPlan(
      { damageId: id, plan_title: "可逆材料重做", method: "可逆树脂", owner_id: 7 },
      ACTOR,
    );
    ok("被驳回过的病害可再次转办并新建", r.created === true);
    const rej = transferLoopService.rejectPlan(r.plan.id, { reason: "仍需评估" }, ACTOR);
    ok("新方案驳回后病害解锁为 REJECTED", rej.damage.status === "REJECTED");
    ok("驳回后无在途方案", rej.activePlan === null);
    ok("原驳回记录仍保留（历史条数+1 且均为 REJECTED）",
      rej.history.length === before + 1 && rej.history.every((p) => p.approval_status === "REJECTED"));

    const r2 = transferLoopService.transferToPlan({ damageId: id, plan_title: "第三次提交", owner_id: 7 }, ACTOR);
    ok("解锁后再次转办成功且是新方案", r2.created === true && r2.plan.id !== r.plan.id);
    ok("再次转办后历史含 2 条驳回",
      transferLoopService.getTransferStatus(id).history.filter((p) => p.approval_status === "REJECTED").length === 2);
  }

  console.log("4) 原子性：锁定后注入失败 -> 回滚，无半边状态");
  {
    const id = newOpenDamage();
    __transferLoopHooks.setCrashAfterLock(true);
    let threw = false;
    try {
      transferLoopService.transferToPlan({ damageId: id, plan_title: "应当回滚" }, ACTOR);
    } catch (e) {
      threw = (e as Error).message.includes("INJECTED_FAILURE_AFTER_LOCK");
    }
    __transferLoopHooks.setCrashAfterLock(false);
    ok("注入故障被抛出", threw);
    ok("病害状态回滚为 OPEN（未留下 IN_PLAN 半边）", damageRecordRepository.findById(id)!.status === "OPEN");
    const s = transferLoopService.getTransferStatus(id);
    ok("没有任何方案残留", s.history.length === 0 && s.activePlan === null);
    const r = transferLoopService.transferToPlan({ damageId: id, plan_title: "回滚后重提" }, ACTOR);
    ok("回滚后可正常转办", r.created === true);
  }

  console.log("5) 数据库层兜底：部分唯一索引拒绝第二条在途方案");
  {
    const id = newOpenDamage();
    const r = transferLoopService.transferToPlan({ damageId: id, plan_title: "唯一索引测试" }, ACTOR);
    let blocked = false;
    try {
      conn
        .prepare(
          `INSERT INTO restoration_plan
            (relic_id, damage_record_id, plan_title, method, risk_assessment, approval_status, owner_id, reject_reason, plan_version, created_at, updated_at)
           VALUES (?, ?, ?, 'x', 'x', 'SUBMITTED', 1, NULL, 1, ?, ?)`,
        )
        .run(r.plan.relic_id, id, "绕过服务的第二条", new Date().toISOString(), new Date().toISOString());
    } catch (e) {
      blocked = (e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE";
    }
    ok("直接插入第二条在途方案被唯一索引拒绝", blocked);
    conn
      .prepare(
        `INSERT INTO restoration_plan
          (relic_id, damage_record_id, plan_title, method, risk_assessment, approval_status, owner_id, reject_reason, plan_version, created_at, updated_at)
         VALUES (?, ?, ?, 'x', 'x', 'REJECTED', 1, 'r', 1, ?, ?)`,
      )
      .run(r.plan.relic_id, id, "驳回历史可共存", new Date().toISOString(), new Date().toISOString());
    ok("驳回历史与在途方案可共存", transferLoopService.getTransferStatus(id).history.length === 2);
  }

  console.log("6) 多进程并发：N 个进程同时转办同一病害，只产生 1 条在途方案");
  {
    const id = newOpenDamage();
    const N = 8;
    const runWorker = () =>
      new Promise<{ ok: boolean; created: boolean; planId: number }>((resolve) => {
        const child = spawn(
          "npx",
          ["tsx", path.join(__dirname, "verify-loop-worker.ts"), DB_PATH, String(id)],
          { cwd: path.join(__dirname, "..", "backend"), stdio: ["ignore", "pipe", "inherit"] },
        );
        let out = "";
        child.stdout.on("data", (d) => (out += d.toString()));
        child.on("close", () => {
          const line = out.trim().split("\n").pop() ?? "{}";
          try {
            resolve(JSON.parse(line));
          } catch {
            resolve({ ok: false, created: false, planId: -1 });
          }
        });
      });

    const workers = await Promise.all(Array.from({ length: N }, () => runWorker()));
    const allOk = workers.every((w) => w.ok);
    const createdCount = workers.filter((w) => w.created).length;
    const planIds = new Set(workers.map((w) => w.planId));
    const s = transferLoopService.getTransferStatus(id);
    const activeCount = s.history.filter(
      (p) => p.approval_status === "SUBMITTED" || p.approval_status === "APPROVED",
    ).length;
    ok("8 个进程全部成功返回（无未处理冲突）", allOk);
    ok("恰有 1 个进程真正创建，其余回读", createdCount === 1);
    ok("所有进程回读到同一 planId", planIds.size === 1);
    ok("数据库中该病害只有 1 条在途方案", activeCount === 1 && s.history.length === 1);
    ok("并发后病害保持锁定", s.damage.status === "IN_PLAN");
  }

  console.log("7) 重启一致性：关闭连接重开（模拟进程重启）后回读不变");
  {
    const id = newOpenDamage();
    const r = transferLoopService.transferToPlan({ damageId: id, plan_title: "重启前" }, ACTOR);
    resetDb();
    getDb(DB_PATH);
    const s = transferLoopService.getTransferStatus(id);
    ok("重启后仍能回读到在途方案且 id 一致", (s.activePlan as { id?: number })?.id === r.plan.id);
    ok("重启后病害仍 IN_PLAN", s.damage.status === "IN_PLAN");
  }

  console.log(`\n全部通过：${pass} 项断言 ✓`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
