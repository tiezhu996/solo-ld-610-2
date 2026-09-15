export const PlanApprovalStatus = ["DRAFT","SUBMITTED","APPROVED","REJECTED","ARCHIVED"] as const;
export type PlanApprovalStatus = (typeof PlanApprovalStatus)[number];
export const PlanApprovalStatusText: Record<PlanApprovalStatus, string> = Object.fromEntries(PlanApprovalStatus.map((value) => [value, value.replace(/_/g, " ")])) as Record<PlanApprovalStatus, string>;
