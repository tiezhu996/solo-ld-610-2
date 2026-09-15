import type { PlanApprovalStatus } from "../constants/PlanApprovalStatus";

export interface RestorationPlan {
  id: number;
  relic_id: number;
  damage_record_id: number;
  plan_title: string;
  method: string | null;
  risk_assessment: string | null;
  approval_status: PlanApprovalStatus | string;
  owner_id: number | null;
  reject_reason: string | null;
  plan_version: number;
  created_at: string;
  updated_at: string;
}
