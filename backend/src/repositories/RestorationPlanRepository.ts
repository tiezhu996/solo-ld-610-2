import type { Database } from "better-sqlite3";
import { getDb } from "../db/sqlite";
import type { RestorationPlan } from "../models/RestorationPlan";
import { buildPlanInsertRow, type PlanInsertInput } from "../constructors/RestorationPlanDtoFactory";

const COLUMNS =
  "id, relic_id, damage_record_id, plan_title, method, risk_assessment, approval_status, owner_id, reject_reason, plan_version, created_at, updated_at";

export const restorationPlanRepository = {
  findAll(): RestorationPlan[] {
    return getDb().prepare(`SELECT ${COLUMNS} FROM restoration_plan ORDER BY id`).all() as RestorationPlan[];
  },

  findById(id: number): RestorationPlan | undefined {
    return getDb().prepare(`SELECT ${COLUMNS} FROM restoration_plan WHERE id = ?`).get(id) as
      | RestorationPlan
      | undefined;
  },

  findByIdTx(tx: Database, id: number): RestorationPlan | undefined {
    return tx.prepare(`SELECT ${COLUMNS} FROM restoration_plan WHERE id = ?`).get(id) as
      | RestorationPlan
      | undefined;
  },

  /** 该病害当前"在途"（SUBMITTED/APPROVED）方案；至多一条，由部分唯一索引兜底。 */
  findActiveByDamageTx(tx: Database, damageId: number): RestorationPlan | undefined {
    return tx
      .prepare(
        `SELECT ${COLUMNS} FROM restoration_plan
          WHERE damage_record_id = ? AND approval_status IN ('SUBMITTED','APPROVED')
          ORDER BY id DESC LIMIT 1`,
      )
      .get(damageId) as RestorationPlan | undefined;
  },

  findActiveByDamage(damageId: number): RestorationPlan | undefined {
    return this.findActiveByDamageTx(getDb(), damageId);
  },

  /** 该病害全部方案历史（最新在前），驳回记录在此保留。 */
  findHistoryByDamageTx(tx: Database, damageId: number): RestorationPlan[] {
    return tx
      .prepare(
        `SELECT ${COLUMNS} FROM restoration_plan
          WHERE damage_record_id = ? ORDER BY id DESC`,
      )
      .all(damageId) as RestorationPlan[];
  },

  /** 事务内插入方案行。 */
  insertTx(tx: Database, input: PlanInsertInput): RestorationPlan {
    const row = buildPlanInsertRow(input);
    const res = tx
      .prepare(
        `INSERT INTO restoration_plan
           (relic_id, damage_record_id, plan_title, method, risk_assessment,
            approval_status, owner_id, reject_reason, plan_version, created_at, updated_at)
         VALUES
           (@relic_id, @damage_record_id, @plan_title, @method, @risk_assessment,
            @approval_status, @owner_id, NULL, @plan_version, @created_at, @updated_at)`,
      )
      .run(row);
    return this.findByIdTx(tx, Number(res.lastInsertRowid))!;
  },

  /** 仅当方案处于期望状态时流转，返回是否成功（乐观条件，防重复审批/驳回）。 */
  transitionTx(
    tx: Database,
    id: number,
    toStatus: string,
    fromStatuses: readonly string[],
    now: string,
    extra: { reject_reason?: string | null } = {},
  ): boolean {
    const placeholders = fromStatuses.map(() => "?").join(",");
    const res = tx
      .prepare(
        `UPDATE restoration_plan
            SET approval_status = ?, updated_at = ?, reject_reason = COALESCE(?, reject_reason)
          WHERE id = ? AND approval_status IN (${placeholders})`,
      )
      .run(
        toStatus,
        now,
        extra.reject_reason === undefined ? null : extra.reject_reason,
        id,
        ...fromStatuses,
      );
    return res.changes === 1;
  },

  save(row: Record<string, unknown>): RestorationPlan {
    const now = new Date().toISOString();
    const input: PlanInsertInput = {
      relic_id: Number(row.relic_id ?? 0),
      damage_record_id: Number(row.damage_record_id ?? 0),
      plan_title: String(row.plan_title ?? "未命名修复方案"),
      method: row.method == null ? null : String(row.method),
      risk_assessment: row.risk_assessment == null ? null : String(row.risk_assessment),
      owner_id: row.owner_id == null ? null : Number(row.owner_id),
      now,
    };
    return getDb()
      .transaction((): RestorationPlan => this.insertTx(getDb(), input))();
  },
};
