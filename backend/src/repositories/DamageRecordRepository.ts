import type { Database } from "better-sqlite3";
import { getDb } from "../db/sqlite";
import type { DamageRecord } from "../models/DamageRecord";
import { INITIAL_DAMAGE_STATUS } from "../constants/DamageStatus";

const COLUMNS =
  "id, relic_id, damage_type, position_desc, severity, discovered_by, discovered_at, image_url, status";

/**
 * 病害数据访问。锁定 / 解锁 / 结案都只接受外层事务连接，
 * 保证与方案写入处于同一事务（要么都成功，要么都回滚）。
 */
export const damageRecordRepository = {
  findAll(): DamageRecord[] {
    return getDb().prepare(`SELECT ${COLUMNS} FROM damage_record ORDER BY id`).all() as DamageRecord[];
  },

  findById(id: number): DamageRecord | undefined {
    return getDb().prepare(`SELECT ${COLUMNS} FROM damage_record WHERE id = ?`).get(id) as
      | DamageRecord
      | undefined;
  },

  /** 事务内按 id 读取（与后续条件更新处于同一事务，避免读后写竞态）。 */
  findByIdTx(tx: Database, id: number): DamageRecord | undefined {
    return tx.prepare(`SELECT ${COLUMNS} FROM damage_record WHERE id = ?`).get(id) as
      | DamageRecord
      | undefined;
  },

  /**
   * 条件锁定：仅当病害当前不是 CLOSED、也未被在途方案占用（IN_PLAN）时生效。
   * 受影响行数 = 0 表示状态不允许（已锁定/已结案）或并发下已被他人先锁。
   */
  lockForPlanTx(tx: Database, id: number): boolean {
    const res = tx
      .prepare(
        `UPDATE damage_record
            SET status = 'IN_PLAN'
          WHERE id = ? AND status IN ('OPEN','REJECTED')`,
      )
      .run(id);
    return res.changes === 1;
  },

  unlockAfterRejectTx(tx: Database, id: number): boolean {
    const res = tx
      .prepare(`UPDATE damage_record SET status = 'REJECTED' WHERE id = ? AND status = 'IN_PLAN'`)
      .run(id);
    return res.changes === 1;
  },

  closeTx(tx: Database, id: number): boolean {
    const res = tx
      .prepare(`UPDATE damage_record SET status = 'CLOSED' WHERE id = ? AND status = 'IN_PLAN'`)
      .run(id);
    return res.changes === 1;
  },

  /**
   * 登记新病害。注意：这里忽略入参 status，强制落初始态 OPEN——
   * IN_PLAN/REJECTED/CLOSED 只能由本文件中的闭环事务方法（lockForPlanTx /
   * unlockAfterRejectTx / closeTx）改写。纵深防御，避免任何调用方绕过闭环。
   */
  save(row: Record<string, unknown>): DamageRecord {
    const now = String(row.discovered_at ?? new Date().toISOString());
    const res = getDb()
      .prepare(
        `INSERT INTO damage_record
           (relic_id, damage_type, position_desc, severity, discovered_by, discovered_at, image_url, status)
         VALUES
           (@relic_id, @damage_type, @position_desc, @severity, @discovered_by, @discovered_at, @image_url, @status)`,
      )
      .run({
        relic_id: Number(row.relic_id ?? 0),
        damage_type: String(row.damage_type ?? "UNSPECIFIED"),
        position_desc: row.position_desc == null ? null : String(row.position_desc),
        severity: String(row.severity ?? "MEDIUM"),
        discovered_by: row.discovered_by == null ? null : String(row.discovered_by),
        discovered_at: now,
        image_url: row.image_url == null ? null : String(row.image_url),
        status: INITIAL_DAMAGE_STATUS,
      });
    return this.findById(Number(res.lastInsertRowid))!;
  },
};
