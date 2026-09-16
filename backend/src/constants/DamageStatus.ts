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

/**
 * 新建病害唯一合法初始状态。
 * IN_PLAN/REJECTED/CLOSED 都只能由转办闭环（转办/驳回/归档）流转产生，
 * 绝不允许在"新建"请求中直接写入，否则会绕过闭环、污染状态。
 */
export const INITIAL_DAMAGE_STATUS: DamageStatus = "OPEN";

/** 仅当 status 缺省或显式为 OPEN 时才允许作为新建入参。 */
export const isAllowedInitialStatus = (s: unknown): boolean =>
  s === undefined || s === null || s === "" || s === INITIAL_DAMAGE_STATUS;

export const DAMAGE_STATUS_LABEL: Record<DamageStatus, string> = {
  OPEN: "待转办",
  IN_PLAN: "修复方案在途",
  REJECTED: "方案已驳回",
  CLOSED: "已归档",
};
