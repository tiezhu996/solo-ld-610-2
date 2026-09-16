import { immediate, snapshotRead } from "../db/sqlite";
import { damageRecordRepository } from "../repositories/DamageRecordRepository";
import { restorationPlanRepository } from "../repositories/RestorationPlanRepository";
import { auditLogRepository } from "../repositories/AuditLogRepository";
import { AppError, conflict, notFound, isUniqueViolation, ERROR_CODES } from "../utils/AppError";
import { LOOP_LOG_TEMPLATES, formatLog } from "../constants/logTemplates";
import { crashAt, type CrashPoint } from "../utils/crashInjection";
import { toPlanResponse } from "../constructors/RestorationPlanDtoFactory";
import type { DamageRecord } from "../models/DamageRecord";
import type { RestorationPlan } from "../models/RestorationPlan";
import type { TransferStatus, TransferToPlanPayload, RejectPlanPayload } from "../types/TransferPayload";

interface Actor {
  id: number | string;
  role: string;
}

interface TransferResult {
  created: boolean;
  plan: RestorationPlan;
  damage: DamageRecord;
}

/** 测试专用故障注入点（生产代码路径不会触发）。 */
let crashAfterLock = false;
export const __transferLoopHooks = {
  /** 锁定病害成功后、写入方案前抛错，用于验证事务回滚不留半边状态。 */
  setCrashAfterLock(v: boolean) {
    crashAfterLock = v;
  },
};

const toPositiveInt = (v: unknown, field: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, { field }, 400);
  }
  return n;
};

/**
 * 构造提交点崩溃钩子（仅 CRASH_INJECTION_ENABLED=true 时生效）。
 * op 仅用于日志标注，区分 transfer/reject/archive 的中断阶段。
 */
const crashHooks = (op: string, phase: CrashPoint | undefined) => ({
  beforeCommit: () => crashAt(phase, "beforeCommit", `${op}.beforeCommit`),
  afterCommit: () => crashAt(phase, "afterCommit", `${op}.afterCommit`),
});

const buildStatus = (damage: DamageRecord, history: RestorationPlan[]): TransferStatus => {
  const active = history.find((p) => p.approval_status === "SUBMITTED" || p.approval_status === "APPROVED") ?? null;
  return {
    damage: { id: damage.id, relic_id: damage.relic_id, status: damage.status },
    activePlan: active ? toPlanResponse(active) : null,
    history: history.map(toPlanResponse),
    transferred: active !== null,
  };
};

export const transferLoopService = {
  /**
   * 唯一的提交入口：病害 -> 修复方案。
   * 同一病害存在未归档（在途）方案时，重复提交只回读原方案，绝不生成第二条。
   * "方案写入 + 病害锁定"在同一个立即事务内，一起提交或一起回滚。
   */
  transferToPlan(payload: TransferToPlanPayload, actor: Actor, crashPhase?: CrashPoint): TransferResult {
    const damageId = toPositiveInt(payload.damageId, "damageId");
    const planTitle = typeof payload.plan_title === "string" ? payload.plan_title.trim() : "";
    if (!planTitle) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, { field: "plan_title" }, 400);
    }
    const ownerId =
      payload.owner_id == null || payload.owner_id === "" ? null : toPositiveInt(payload.owner_id, "owner_id");
    const now = new Date().toISOString();

    return immediate((tx) => {
      const damage = damageRecordRepository.findByIdTx(tx, damageId);
      if (!damage) {
        throw notFound(ERROR_CODES.DAMAGE_NOT_FOUND, { damageId });
      }
      if (damage.status === "CLOSED") {
        throw conflict(ERROR_CODES.DAMAGE_CLOSED, { damageId });
      }

      // 幂等回读：已存在在途方案 -> 直接返回原方案，不生成第二条。
      const existing = restorationPlanRepository.findActiveByDamageTx(tx, damageId);
      if (existing) {
        auditLogRepository.insert(tx, {
          actor: String(actor.id),
          action: "damage.transfer.deduped",
          target_type: "damage_record",
          target_id: String(damageId),
          detail: formatLog(LOOP_LOG_TEMPLATES.TRANSFER_DEDUPED, {
            damageId,
            planId: existing.id,
          }),
          created_at: now,
        });
        return { created: false, plan: existing, damage };
      }

      // 第一步：条件锁定病害（OPEN/REJECTED -> IN_PLAN）。
      const locked = damageRecordRepository.lockForPlanTx(tx, damageId);
      if (!locked) {
        // 到达这里通常是并发：他人已先锁。回读其方案；若已结案则报结案冲突。
        const raced = restorationPlanRepository.findActiveByDamageTx(tx, damageId);
        if (raced) {
          return { created: false, plan: raced, damage };
        }
        throw conflict(
          damage.status === "CLOSED" ? ERROR_CODES.DAMAGE_CLOSED : ERROR_CODES.DAMAGE_LOCKED,
          { damageId, planId: 0 },
        );
      }

      // 故障注入：证明锁定后若写入失败，锁会随事务回滚，不留 IN_PLAN 半边状态。
      if (crashAfterLock) {
        throw new Error("INJECTED_FAILURE_AFTER_LOCK");
      }

      // 第二步：写入方案。部分唯一索引 uq_active_plan_per_damage 是最终兜底。
      let plan: RestorationPlan;
      try {
        plan = restorationPlanRepository.insertTx(tx, {
          relic_id: damage.relic_id,
          damage_record_id: damageId,
          plan_title: planTitle,
          method: payload.method == null ? null : String(payload.method),
          risk_assessment: payload.risk_assessment == null ? null : String(payload.risk_assessment),
          owner_id: ownerId,
          now,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          // 理论上 BEGIN IMMEDIATE 已串行化；兜底转成并发冲突，事务回滚后由外层回读。
          throw conflict(ERROR_CODES.CONCURRENT_TRANSFER, { damageId });
        }
        throw err;
      }

      auditLogRepository.insert(tx, {
        actor: String(actor.id),
        action: "damage.transferred",
        target_type: "damage_record",
        target_id: String(damageId),
        detail: formatLog(LOOP_LOG_TEMPLATES.DAMAGE_TRANSFERRED, {
          damageId,
          relicId: damage.relic_id,
          planId: plan.id,
          ownerId: ownerId ?? "",
        }),
        created_at: now,
      });

      const lockedDamage = damageRecordRepository.findByIdTx(tx, damageId)!;
      return { created: true, plan, damage: lockedDamage };
    }, crashHooks("transfer", crashPhase));
  },

  /** 对外的并发冲突兜底：捕获 CONCURRENT_TRANSFER 后回读原方案。 */
  transferToPlanIdempotent(payload: TransferToPlanPayload, actor: Actor, crashPhase?: CrashPoint): TransferResult {
    try {
      return this.transferToPlan(payload, actor, crashPhase);
    } catch (err) {
      if (err instanceof AppError && err.code === ERROR_CODES.CONCURRENT_TRANSFER) {
        const damageId = toPositiveInt(payload.damageId, "damageId");
        const plan = restorationPlanRepository.findActiveByDamage(damageId);
        const damage = damageRecordRepository.findById(damageId);
        if (plan && damage) {
          return { created: false, plan, damage };
        }
      }
      throw err;
    }
  },

  /** 唯一的状态回读入口：病害 + 在途方案 + 全部历史（含已驳回记录）。 */
  getTransferStatus(damageIdRaw: unknown): TransferStatus {
    const damageId = toPositiveInt(damageIdRaw, "damageId");
    // 病害行与方案历史必须来自同一次一致性快照：
    // 二者在同一个只读快照事务内读取，避免驳回/归档/再次转办在两次读之间提交，
    // 拼出"病害仍 IN_PLAN 却无在途方案"或"已 REJECTED 却读到旧锁定"的跨时间点结果。
    return snapshotRead((tx) => {
      const damage = damageRecordRepository.findByIdTx(tx, damageId);
      if (!damage) {
        throw notFound(ERROR_CODES.DAMAGE_NOT_FOUND, { damageId });
      }
      const history = restorationPlanRepository.findHistoryByDamageTx(tx, damageId);
      return buildStatus(damage, history);
    });
  },

  /**
   * 驳回方案：在途(SUBMITTED/APPROVED) -> REJECTED，同时病害解锁(IN_PLAN -> REJECTED)。
   * 原驳回方案记录继续保留；病害恢复可再次转办。两步同一事务原子提交。
   */
  rejectPlan(planIdRaw: unknown, payload: RejectPlanPayload, actor: Actor, crashPhase?: CrashPoint): TransferStatus {
    const planId = toPositiveInt(planIdRaw, "planId");
    const reason = payload.reason == null ? null : String(payload.reason);
    const now = new Date().toISOString();

    return immediate((tx) => {
      const plan = restorationPlanRepository.findByIdTx(tx, planId);
      if (!plan) {
        throw notFound(ERROR_CODES.PLAN_NOT_FOUND, { planId });
      }
      const moved = restorationPlanRepository.transitionTx(
        tx,
        planId,
        "REJECTED",
        ["SUBMITTED", "APPROVED"],
        now,
        { reject_reason: reason },
      );
      if (!moved) {
        throw conflict(ERROR_CODES.PLAN_STATUS_CONFLICT, {
          status: plan.approval_status,
          action: "reject",
        });
      }
      damageRecordRepository.unlockAfterRejectTx(tx, plan.damage_record_id);

      auditLogRepository.insert(tx, {
        actor: String(actor.id),
        action: "plan.rejected",
        target_type: "restoration_plan",
        target_id: String(planId),
        detail: formatLog(LOOP_LOG_TEMPLATES.PLAN_REJECTED, {
          planId,
          damageId: plan.damage_record_id,
          actor: actor.id,
        }),
        created_at: now,
      });
      auditLogRepository.insert(tx, {
        actor: String(actor.id),
        action: "damage.re-referrable",
        target_type: "damage_record",
        target_id: String(plan.damage_record_id),
        detail: formatLog(LOOP_LOG_TEMPLATES.DAMAGE_REREFERRABLE, {
          damageId: plan.damage_record_id,
          planId,
        }),
        created_at: now,
      });

      const damage = damageRecordRepository.findByIdTx(tx, plan.damage_record_id)!;
      const history = restorationPlanRepository.findHistoryByDamageTx(tx, plan.damage_record_id);
      return buildStatus(damage, history);
    }, crashHooks("reject", crashPhase));
  },

  /** 归档：已批准(APPROVED) -> ARCHIVED，病害结案(IN_PLAN -> CLOSED)。同一事务。 */
  archivePlan(planIdRaw: unknown, actor: Actor, crashPhase?: CrashPoint): TransferStatus {
    const planId = toPositiveInt(planIdRaw, "planId");
    const now = new Date().toISOString();

    return immediate((tx) => {
      const plan = restorationPlanRepository.findByIdTx(tx, planId);
      if (!plan) {
        throw notFound(ERROR_CODES.PLAN_NOT_FOUND, { planId });
      }
      const moved = restorationPlanRepository.transitionTx(tx, planId, "ARCHIVED", ["APPROVED"], now);
      if (!moved) {
        throw conflict(ERROR_CODES.PLAN_STATUS_CONFLICT, {
          status: plan.approval_status,
          action: "archive",
        });
      }
      damageRecordRepository.closeTx(tx, plan.damage_record_id);

      auditLogRepository.insert(tx, {
        actor: String(actor.id),
        action: "plan.archived",
        target_type: "restoration_plan",
        target_id: String(planId),
        detail: formatLog(LOOP_LOG_TEMPLATES.PLAN_ARCHIVED, {
          planId,
          damageId: plan.damage_record_id,
          actor: actor.id,
        }),
        created_at: now,
      });

      const damage = damageRecordRepository.findByIdTx(tx, plan.damage_record_id)!;
      const history = restorationPlanRepository.findHistoryByDamageTx(tx, plan.damage_record_id);
      return buildStatus(damage, history);
    }, crashHooks("archive", crashPhase));
  },

  /** 批准：SUBMITTED -> APPROVED（仍在途，病害保持锁定）。同一事务。 */
  approvePlan(planIdRaw: unknown, actor: Actor): TransferStatus {
    const planId = toPositiveInt(planIdRaw, "planId");
    const now = new Date().toISOString();

    return immediate((tx) => {
      const plan = restorationPlanRepository.findByIdTx(tx, planId);
      if (!plan) {
        throw notFound(ERROR_CODES.PLAN_NOT_FOUND, { planId });
      }
      const moved = restorationPlanRepository.transitionTx(tx, planId, "APPROVED", ["SUBMITTED"], now);
      if (!moved) {
        throw conflict(ERROR_CODES.PLAN_STATUS_CONFLICT, {
          status: plan.approval_status,
          action: "approve",
        });
      }
      auditLogRepository.insert(tx, {
        actor: String(actor.id),
        action: "plan.approved",
        target_type: "restoration_plan",
        target_id: String(planId),
        detail: `plan.approved planId=${planId} damageId=${plan.damage_record_id}`,
        created_at: now,
      });
      const damage = damageRecordRepository.findByIdTx(tx, plan.damage_record_id)!;
      const history = restorationPlanRepository.findHistoryByDamageTx(tx, plan.damage_record_id);
      return buildStatus(damage, history);
    });
  },
};
