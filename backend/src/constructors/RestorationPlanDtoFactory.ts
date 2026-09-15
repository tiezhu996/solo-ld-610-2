import type { RestorationPlan } from "../models/RestorationPlan";
import { PlanApprovalStatus } from "../constants/PlanApprovalStatus";

export const createRestorationPlanDto = (overrides = {}) => ({
  id: 1,
  relic_id: 1,
  damage_record_id: 1,
  plan_title: "plan title 1",
  method: "method 1",
  risk_assessment: "risk assessment 1",
  approval_status: PlanApprovalStatus[1], // SUBMITTED
  owner_id: 1,
  ...overrides,
});

/** 转办提交 -> 待插入的修复方案行（不含自增 id，由数据库生成）。 */
export interface PlanInsertInput {
  relic_id: number;
  damage_record_id: number;
  plan_title: string;
  method: string | null;
  risk_assessment: string | null;
  owner_id: number | null;
  now: string;
}

export const buildPlanInsertRow = (input: PlanInsertInput): Omit<RestorationPlan, "id" | "reject_reason"> => ({
  relic_id: input.relic_id,
  damage_record_id: input.damage_record_id,
  plan_title: input.plan_title,
  method: input.method,
  risk_assessment: input.risk_assessment,
  approval_status: "SUBMITTED",
  owner_id: input.owner_id ?? null,
  plan_version: 1,
  created_at: input.now,
  updated_at: input.now,
});

export const toPlanResponse = (row: RestorationPlan): Record<string, unknown> => ({
  id: row.id,
  relic_id: row.relic_id,
  damage_record_id: row.damage_record_id,
  plan_title: row.plan_title,
  method: row.method,
  risk_assessment: row.risk_assessment,
  approval_status: row.approval_status,
  owner_id: row.owner_id,
  reject_reason: row.reject_reason,
  plan_version: row.plan_version,
  created_at: row.created_at,
  updated_at: row.updated_at,
});
