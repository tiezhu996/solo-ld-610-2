/** 唯一的"病害 -> 修复方案"提交入口入参。 */
export interface TransferToPlanPayload {
  damageId?: number | string;
  plan_title?: string;
  method?: string;
  risk_assessment?: string;
  owner_id?: number | string | null;
  /** 客户端幂等键（可选）。同一键重复提交返回同一方案。 */
  idempotency_key?: string;
}

export interface RejectPlanPayload {
  reason?: string;
}

/** 单条状态回读响应：病害 + 其关联方案（含历史，最新在前）。 */
export interface TransferStatus {
  damage: {
    id: number;
    relic_id: number;
    status: string;
  };
  /** 当前占用病害的在途方案；无在途方案时为 null（驳回后/归档后均为 null）。 */
  activePlan: Record<string, unknown> | null;
  /** 该病害全部方案历史，最新在前；驳回记录在此永久保留。 */
  history: Array<Record<string, unknown>>;
  transferred: boolean;
}
