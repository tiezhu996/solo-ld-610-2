/**
 * 日志模板集中处。所有写操作都要落审计日志，字段变更时必须同步改模板与调用处。
 * 每个核心实体至少 4 条模板（保留原数组形态）。
 */
export const LOG_TEMPLATES = {
  RelicItem: ["RelicItem.create", "RelicItem.update", "RelicItem.status", "RelicItem.export"],
  DamageRecord: ["DamageRecord.create", "DamageRecord.update", "DamageRecord.status", "DamageRecord.export"],
  RestorationPlan: ["RestorationPlan.create", "RestorationPlan.update", "RestorationPlan.status", "RestorationPlan.export"],
  RestorationStep: ["RestorationStep.create", "RestorationStep.update", "RestorationStep.status", "RestorationStep.export"],
  ImageVersion: ["ImageVersion.create", "ImageVersion.update", "ImageVersion.status", "ImageVersion.export"],
} as const;

/**
 * 病害 -> 修复方案闭环专用模板（结构化）。
 * 占位符 {damageId}/{planId}/{actor} 由 formatLog 填充。
 */
export const LOOP_LOG_TEMPLATES = {
  DAMAGE_TRANSFERRED:
    "damage.transferred damageId={damageId} relicId={relicId} planId={planId} ownerId={ownerId}",
  TRANSFER_DEDUPED:
    "damage.transfer.deduped damageId={damageId} returnedPlanId={planId}",
  PLAN_REJECTED:
    "plan.rejected planId={planId} damageId={damageId} damageUnlocked=true actor={actor}",
  PLAN_ARCHIVED:
    "plan.archived planId={planId} damageId={damageId} damageClosed=true actor={actor}",
  DAMAGE_REREFERRABLE:
    "damage.re-referrable damageId={damageId} rejectedPlanId={planId}",
} as const;

export type LoopLogAction = keyof typeof LOOP_LOG_TEMPLATES;

export const formatLog = (
  tpl: string,
  vars: Record<string, string | number | undefined> = {},
): string =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ""));
