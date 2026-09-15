export const PlanApprovalStatus = ["DRAFT","SUBMITTED","APPROVED","REJECTED","ARCHIVED"] as const;
export type PlanApprovalStatus = (typeof PlanApprovalStatus)[number];

export const PLAN_APPROVAL_LABEL: Record<PlanApprovalStatus, string> = {
  DRAFT: "草稿",
  SUBMITTED: "待审批",
  APPROVED: "已批准",
  REJECTED: "已驳回",
  ARCHIVED: "已归档",
};

/**
 * "在途"方案：占用病害、阻止再次转办。
 * - SUBMITTED / APPROVED 仍在流程中，病害保持锁定
 * - REJECTED / ARCHIVED 为终态，不再占用病害（驳回记录仍保留）
 * - DRAFT 不参与本闭环（转办直接生成 SUBMITTED）
 */
export const ACTIVE_PLAN_STATUSES: ReadonlySet<PlanApprovalStatus> = new Set<PlanApprovalStatus>([
  "SUBMITTED",
  "APPROVED",
]);

export const isActivePlanStatus = (s: string): s is PlanApprovalStatus =>
  ACTIVE_PLAN_STATUSES.has(s as PlanApprovalStatus);
