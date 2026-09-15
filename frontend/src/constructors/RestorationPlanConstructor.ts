import type { RestorationPlan } from "../types/RestorationPlan";

export const createDefaultRestorationPlan = (overrides: Partial<RestorationPlan> = {}): RestorationPlan => ({
  id: 1 as never,
  relic_id: 1 as never,
  damage_record_id: 1 as never,
  plan_title: "plan title 1" as never,
  method: "method 1" as never,
  risk_assessment: "risk assessment 1" as never,
  approval_status: "SUBMITTED" as never,
  owner_id: 1 as never,
  ...overrides
});

export const createRestorationPlanForm = createDefaultRestorationPlan;
export const createRestorationPlanResponse = createDefaultRestorationPlan;
