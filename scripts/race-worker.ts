/**
 * 读写竞速 worker：由 verify-read-race.ts 以多进程拉起。
 *   mode=writer：在同一病害上反复 转办 -> 驳回，制造大量状态翻转提交。
 *   mode=reader：并发反复回读，校验"每次回读内部自洽"，统计违例。
 * 用法：tsx race-worker.ts <writer|reader> <dbPath> <damageId> <n>
 */
import { getDb } from "./../backend/src/db/sqlite";
import { transferLoopService } from "./../backend/src/services/TransferLoopService";
import type { TransferStatus } from "./../backend/src/types/TransferPayload";

const [mode, file, damageIdRaw, nRaw] = process.argv.slice(2);
const damageId = Number(damageIdRaw);
const n = Number(nRaw);
getDb(file);

const ACTIVE = new Set(["SUBMITTED", "APPROVED"]);

/** 回读响应内部必须自洽：病害状态、在途方案、历史来自同一次快照。 */
const checkInvariants = (s: TransferStatus): string[] => {
  const v: string[] = [];
  const activeInHistory = s.history.filter((p) => ACTIVE.has(String(p.approval_status)));
  if (s.damage.status === "IN_PLAN" && s.activePlan === null) {
    v.push("LOCKED_BUT_NO_ACTIVE_PLAN");
  }
  if ((s.damage.status === "REJECTED" || s.damage.status === "CLOSED" || s.damage.status === "OPEN")
      && s.activePlan !== null) {
    v.push(`UNLOCKED_BUT_HAS_ACTIVE_PLAN:${s.damage.status}`);
  }
  if (s.transferred !== (s.activePlan !== null)) {
    v.push("TRANSFERRED_FLAG_MISMATCH");
  }
  if (activeInHistory.length > 1) {
    v.push("MULTIPLE_ACTIVE_PLANS");
  }
  if (s.activePlan !== null && !s.history.some((p) => p.id === s.activePlan!.id)) {
    v.push("ACTIVE_PLAN_NOT_IN_HISTORY");
  }
  return v;
};

const sleep = (ms: number) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* busy micro-wait to widen the interleave window */
  }
};

if (mode === "writer") {
  let rounds = 0;
  for (let i = 0; i < n; i++) {
    try {
      const r = transferLoopService.transferToPlan(
        { damageId, plan_title: `race-round-${i}`, owner_id: 7 },
        { id: process.pid, role: "RESTORER" },
      );
      // 仅当本轮确实新锁了病害才驳回；回读（created=false）说明状态尚未到下一轮
      if (r.created) {
        transferLoopService.rejectPlan(r.plan.id, { reason: `race reject ${i}` }, { id: process.pid, role: "EXPERT" });
        rounds++;
      }
      sleep(0);
    } catch (e) {
      // 竞速下个别状态冲突可忽略，继续翻转
    }
  }
  console.log(JSON.stringify({ mode, rounds }));
} else {
  const tally: Record<string, number> = {};
  let reads = 0;
  for (let i = 0; i < n; i++) {
    try {
      const s = transferLoopService.getTransferStatus(damageId);
      reads++;
      for (const viol of checkInvariants(s)) tally[viol] = (tally[viol] ?? 0) + 1;
    } catch {
      /* 读冲突忽略 */
    }
  }
  console.log(JSON.stringify({ mode, reads, violations: tally }));
}
