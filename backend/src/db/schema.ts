/**
 * SQLite DDL。与 database/init.sql（PostgreSQL）保持同构：
 * 关键约束 uq_active_plan_per_damage 在两边都是"部分唯一索引"，
 * 这是"同一病害至多一条在途方案"的最终兜底，即使应用层判重失效也不会产生第二条。
 */
export const SCHEMA_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS relic_item (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     relic_code TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     era TEXT,
     material TEXT,
     collection_level TEXT,
     storage_location TEXT,
     current_condition TEXT NOT NULL DEFAULT 'STABLE'
   );`,
  `CREATE TABLE IF NOT EXISTS damage_record (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     relic_id INTEGER NOT NULL REFERENCES relic_item(id),
     damage_type TEXT NOT NULL,
     position_desc TEXT,
     severity TEXT NOT NULL DEFAULT 'MEDIUM',
     discovered_by TEXT,
     discovered_at TEXT NOT NULL,
     image_url TEXT,
     status TEXT NOT NULL DEFAULT 'OPEN'
   );
   CREATE INDEX IF NOT EXISTS idx_damage_relic ON damage_record(relic_id);
   CREATE INDEX IF NOT EXISTS idx_damage_status ON damage_record(status);`,
  `CREATE TABLE IF NOT EXISTS restoration_plan (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     relic_id INTEGER NOT NULL REFERENCES relic_item(id),
     damage_record_id INTEGER NOT NULL REFERENCES damage_record(id),
     plan_title TEXT NOT NULL,
     method TEXT,
     risk_assessment TEXT,
     approval_status TEXT NOT NULL DEFAULT 'SUBMITTED',
     owner_id INTEGER,
     reject_reason TEXT,
     plan_version INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_plan_damage ON restoration_plan(damage_record_id);
   CREATE UNIQUE INDEX IF NOT EXISTS uq_active_plan_per_damage
     ON restoration_plan(damage_record_id)
     WHERE approval_status IN ('SUBMITTED','APPROVED');`,
  `CREATE TABLE IF NOT EXISTS restoration_step (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     plan_id INTEGER NOT NULL REFERENCES restoration_plan(id),
     step_order INTEGER NOT NULL DEFAULT 0,
     technique TEXT,
     material_used TEXT,
     operator_id INTEGER,
     step_status TEXT NOT NULL DEFAULT 'PENDING',
     finished_at TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_step_plan ON restoration_step(plan_id);`,
  `CREATE TABLE IF NOT EXISTS image_version (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     relic_id INTEGER NOT NULL REFERENCES relic_item(id),
     plan_id INTEGER REFERENCES restoration_plan(id),
     version_no INTEGER NOT NULL DEFAULT 1,
     image_type TEXT,
     file_path TEXT,
     capture_at TEXT NOT NULL,
     note TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_image_relic ON image_version(relic_id);`,
  `CREATE TABLE IF NOT EXISTS audit_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     actor TEXT,
     action TEXT NOT NULL,
     target_type TEXT,
     target_id TEXT,
     detail TEXT,
     created_at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_type, target_id);`,
];
