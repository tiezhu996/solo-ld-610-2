/**
 * 病害记录状态机
 *
 * OPEN               已登记，可转办（可再次转办）
 * IN_PLAN            已锁定：存在"在途"修复方案（SUBMITTED / APPROVED），禁止再次转办
 * REJECTED           最近一次方案被驳回：病害解锁、可再次转办（驳回记录仍保留）
 * CLOSED             已归档结案：方案 ARCHIVED 后病害终态
 *
 * 闭环：OPEN --转办--> IN_PLAN --归档--> CLOSED
 *                    IN_PLAN --驳回--> REJECTED --再次转办--> IN_PLAN
 */
export const DamageStatus = ["OPEN", "IN_PLAN", "REJECTED", "CLOSED"] as const;
export type DamageStatus = (typeof DamageStatus)[number];

export const DAMAGE_STATUS_LABEL: Record<DamageStatus, string> = {
  OPEN: "待转办",
  IN_PLAN: "修复方案在途",
  REJECTED: "方案已驳回",
  CLOSED: "已归档",
};
