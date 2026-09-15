/**
 * 并发 worker：被 verify-loop.ts 以多进程方式拉起。
 * 所有进程对同一病害同时调用唯一转办入口，最终应只产生 1 条在途方案。
 * 用法：tsx verify-loop-worker.ts <dbPath> <damageId>
 */
import { getDb } from "./../backend/src/db/sqlite";
import { transferLoopService } from "./../backend/src/services/TransferLoopService";

const dbPath = process.argv[2];
const damageId = Number(process.argv[3]);
getDb(dbPath);
try {
  const r = transferLoopService.transferToPlanIdempotent(
    { damageId, plan_title: "并发转办方案", method: "M", risk_assessment: "R", owner_id: 9 },
    { id: process.pid, role: "RESTORER" },
  );
  console.log(JSON.stringify({ ok: true, created: r.created, planId: r.plan.id }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, message: (err as Error).message }));
}
