--
-- relic-restore PostgreSQL 15 schema（与 backend/src/db/schema.ts 的 SQLite DDL 同构）
-- 由 docker-compose 挂载到 /docker-entrypoint-initdb.d/，仅在数据卷首次初始化时执行。
--
-- 闭环核心约束：
--   uq_active_plan_per_damage 是"同一病害至多一条在途方案"的数据库最终兜底——
--   部分唯一索引只统计 SUBMITTED/APPROVED；REJECTED/ARCHIVED 不占名额（历史可保留多条）。
--

CREATE TABLE IF NOT EXISTS relic_item (
  id                BIGSERIAL PRIMARY KEY,
  relic_code        TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  era               TEXT,
  material          TEXT,
  collection_level  TEXT,
  storage_location  TEXT,
  current_condition TEXT NOT NULL DEFAULT 'STABLE'
);

CREATE TABLE IF NOT EXISTS damage_record (
  id            BIGSERIAL PRIMARY KEY,
  relic_id      BIGINT NOT NULL REFERENCES relic_item(id),
  damage_type   TEXT NOT NULL,
  position_desc TEXT,
  severity      TEXT NOT NULL DEFAULT 'MEDIUM',
  discovered_by TEXT,
  discovered_at TIMESTAMPTZ NOT NULL,
  image_url     TEXT,
  status        TEXT NOT NULL DEFAULT 'OPEN'
                  CHECK (status IN ('OPEN','IN_PLAN','REJECTED','CLOSED'))
);
CREATE INDEX IF NOT EXISTS idx_damage_relic  ON damage_record(relic_id);
CREATE INDEX IF NOT EXISTS idx_damage_status ON damage_record(status);

CREATE TABLE IF NOT EXISTS restoration_plan (
  id               BIGSERIAL PRIMARY KEY,
  relic_id         BIGINT NOT NULL REFERENCES relic_item(id),
  damage_record_id BIGINT NOT NULL REFERENCES damage_record(id),
  plan_title       TEXT NOT NULL,
  method           TEXT,
  risk_assessment  TEXT,
  approval_status  TEXT NOT NULL DEFAULT 'SUBMITTED'
                     CHECK (approval_status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','ARCHIVED')),
  owner_id         BIGINT,
  reject_reason    TEXT,
  plan_version     INTEGER NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_damage ON restoration_plan(damage_record_id);

-- ★ 闭环唯一性兜底：每个病害最多一条在途方案（驳回/归档记录不占名额，继续保留）
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_plan_per_damage
  ON restoration_plan(damage_record_id)
  WHERE approval_status IN ('SUBMITTED','APPROVED');

CREATE TABLE IF NOT EXISTS restoration_step (
  id            BIGSERIAL PRIMARY KEY,
  plan_id       BIGINT NOT NULL REFERENCES restoration_plan(id),
  step_order    INTEGER NOT NULL DEFAULT 0,
  technique     TEXT,
  material_used TEXT,
  operator_id   BIGINT,
  step_status   TEXT NOT NULL DEFAULT 'PENDING',
  finished_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_step_plan ON restoration_step(plan_id);

CREATE TABLE IF NOT EXISTS image_version (
  id         BIGSERIAL PRIMARY KEY,
  relic_id   BIGINT NOT NULL REFERENCES relic_item(id),
  plan_id    BIGINT REFERENCES restoration_plan(id),
  version_no INTEGER NOT NULL DEFAULT 1,
  image_type TEXT,
  file_path  TEXT,
  capture_at TIMESTAMPTZ NOT NULL,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_image_relic ON image_version(relic_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor       TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  detail      TEXT,
  created_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_type, target_id);
