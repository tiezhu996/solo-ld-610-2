import type { Database } from "better-sqlite3";
import { getDb } from "../db/sqlite";

export interface AuditLogRow {
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: string | null;
  created_at: string;
}

/**
 * 审计日志写入。insert 接收一个连接，使其可加入外层事务：
 * 方案写入、病害锁定、审计日志在同一事务内原子提交。
 */
export const auditLogRepository = {
  insert(tx: Database, row: AuditLogRow): void {
    tx.prepare(
      `INSERT INTO audit_log (actor, action, target_type, target_id, detail, created_at)
       VALUES (@actor, @action, @target_type, @target_id, @detail, @created_at)`,
    ).run(row);
  },
  findByTarget(targetType: string, targetId: string | number) {
    return getDb()
      .prepare(
        `SELECT * FROM audit_log WHERE target_type = ? AND target_id = ? ORDER BY id DESC`,
      )
      .all(targetType, String(targetId));
  },
  findAll() {
    return getDb().prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT 500`).all();
  },
};
