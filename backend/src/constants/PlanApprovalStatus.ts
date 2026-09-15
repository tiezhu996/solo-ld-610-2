export const PlanApprovalStatus = ["DRAFT","SUBMITTED","APPROVED","REJECTED","ARCHIVED"] as const;
export type PlanApprovalStatus = (typeof PlanApprovalStatus)[number];
