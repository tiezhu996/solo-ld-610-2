# 文物修复档案协作平台

面向博物馆修复团队的文物病害记录、修复方案、影像版本和审批归档平台。本次实现了**「病害 → 修复方案」转办闭环**：唯一提交入口、唯一状态回读入口、方案写入与病害锁定原子提交、重复提交只回读、驳回解锁但留痕、服务重启后回读一致。

## 快速启动

```bash
cp .env.example .env && docker compose up -d
```

- 前端：<http://localhost:20110>
- 后端健康检查：<http://localhost:21110/health>

## 病害转修复方案：闭环规则（本次核心）

整个闭环只对外暴露**一条提交入口**和**一条状态回读入口**：

| 入口 | 方法与路径 | 说明 |
|---|---|---|
| 提交（唯一） | `POST /api/damage-record/:id/transfer` | 把病害转办为修复方案。首次 `201 created=true`；已存在在途方案时 `200 created=false`，**只回读原方案，绝不生成第二条**。 |
| 回读（唯一） | `GET /api/damage-record/:id/transfer` | 返回病害状态、当前在途方案 `activePlan`（无则 `null`）与全部历史 `history`（**驳回记录永久保留**）。 |

> 没有 `POST /api/restoration-plan/`：修复方案只能由「转办」入口产生，直接创建返回 405，避免旁路。

审批动作（不是转办入口，只改既有方案）：
`POST /api/restoration-plan/:id/approve` · `.../reject`（需 EXPERT/ADMIN）· `.../archive`（需 ARCHIVIST/ADMIN）。

### 状态机

```text
            转办(唯一入口)            归档
 OPEN ───────────────────▶ IN_PLAN ─────────▶ CLOSED（结案，不可再转办）
  ▲                          │  ▲
  │(驳回解锁)                │  │(再次转办)
  └────── REJECTED ◀─────────┘  └────────────┘
                   驳回：方案→REJECTED（记录保留），病害解锁回 REJECTED，可再次转办
```

- 病害 `DamageStatus`：`OPEN / IN_PLAN / REJECTED / CLOSED`
- 在途方案 `approval_status`：`SUBMITTED / APPROVED`（占用病害）
- 终态方案：`REJECTED / ARCHIVED`（不占用病害；记录仍保留，可累积多条）

### 一致性是怎么保证的

1. **原子提交**：`方案写入 + 病害锁定 + 审计日志` 在同一个 `BEGIN IMMEDIATE` 事务里，一起提交或一起回滚。任一步失败（含故障注入）都不会留下「病害已 `IN_PLAN` 但没有方案」的半边状态。
2. **幂等回读**：事务内先查在途方案，存在则直接返回，不插入。
3. **数据库最终兜底**：`restoration_plan` 上建有**部分唯一索引**
   `uq_active_plan_per_damage ON (damage_record_id) WHERE approval_status IN ('SUBMITTED','APPROVED')`，
   即使绕过应用层也无法为同一病害插入第二条在途方案；`REJECTED/ARCHIVED` 不受限，历史可保留。
4. **并发安全**：立即事务串行化写操作 + 条件更新 `... WHERE status IN ('OPEN','REJECTED')` + 唯一索引三重保障；多进程同时转办同一病害，恰有 1 个创建，其余回读到同一条。
5. **回读快照一致**：唯一回读入口在**单个只读快照事务**（`BEGIN` deferred，WAL 下首条 SELECT 钉住快照）内同时读取病害、在途方案与历史。即便驳回/归档/再次转办恰在回读期间提交，三者也来自同一次快照，不会拼出「病害仍 `IN_PLAN` 却无在途方案」或「已 `REJECTED` 却读到旧锁定」；读事务不持写锁、不阻塞写，读中抛错即 `ROLLBACK`，不残留事务/锁。
6. **重启一致**：WAL 模式 + 落盘提交，数据持久化到命名卷；重启后回读到同一在途方案，驳回历史仍在。

### 持久化说明

- 本地与容器内闭环数据使用 **SQLite（better-sqlite3）**，文件落在容器命名卷 `/data`（`backend_data`），不绑定宿主任意/中文路径。
- `database/init.sql` 提供与 SQLite DDL **同构的 PostgreSQL 15 schema**（含同一个部分唯一索引），供 db 服务初始化与未来切换。

### 验证（无需 Docker，本机即可复跑）

```bash
cd backend && npm install
npm run test:loop       # 31 项断言：幂等/驳回留痕/失败回滚/唯一索引/8 进程并发/重启一致
npm run test:snapshot   # 确定性复现旧回读缺陷 + 快照免疫 + 读失败不留锁
npm run test:race       # 1 写者 200 轮翻转 + 3 读者 6000 次回读，0 内部矛盾
npm run test:errors     # 异常/约束回归：独立进程+独立连接指纹，21 阶段连跑两遍
```

`test:errors` 覆盖：无效病害/方案编号、空标题、结案后再转办、非法状态跳转、重复审批、RBAC 越权、独立连接直插第二条在途方案。每个失败用例都断言错误码稳定、**病害与方案历史行级指纹前后逐字节不变**、记录“可回读后果”，并在失败后验证仍可正常转办；整套连续运行两遍结果完全一致。测试强制走真实文件持久化与独立连接，**不使用内存替身/mock/单连接串行化**。

HTTP 冒烟（先以临时库起服务）：

```bash
DB_PATH=/tmp/relic.db PORT=31110 npx tsx src/main.ts
BASE=http://127.0.0.1:31110 node ../scripts/http-smoke.mjs
```

## 本地开发方式

- 前端：`cd frontend && npm install && npm run dev`
- 后端：`cd backend && npm install && npm run dev`（接口统一挂在 `/api`）
- 灌种子：`cd backend && npm run seed`（库为空才写入，幂等）

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Vite + Ant Design + Zustand |
| 后端 | Express + TypeScript（分层 routes/controllers/services/repositories）+ better-sqlite3 |
| 数据库 | SQLite（本地/容器，WAL）+ PostgreSQL 15 同构 schema（`database/init.sql`） |
| 部署 | Docker Compose |

## 项目目录结构（闭环相关）

```text
backend/src/
├── constants/        DamageStatus / PlanApprovalStatus / errorCodes / errorMessages / logTemplates
├── db/               sqlite.ts(立即事务 immediate + 只读快照 snapshotRead) schema.ts(DDL+部分唯一索引) seedData.ts runSeed.ts
├── repositories/     DamageRecord / RestorationPlan / AuditLog …（含 *Tx 事务内方法）
├── services/         TransferLoopService.ts（闭环编排：转办/回读/批准/驳回/归档）
├── controllers/      DamageRecordController / RestorationPlanController
├── routes/           仅 POST /:id/transfer 与 GET /:id/transfer 两条闭环入口
├── models/ types/ constructors/ middlewares/ utils/
scripts/verify-loop.ts · verify-loop-worker.ts · http-smoke.mjs   # 并发与端到端验证
database/init.sql     # PostgreSQL 同构 schema（含同一部分唯一索引）
```

## 环境变量说明

- `COMPOSE_PROJECT_NAME`：默认 `relic-restore`
- `FRONTEND_PORT` / `BACKEND_PORT` / `DB_PORT`：默认 `20110` / `21110` / `54320`
- `DB_USER/DB_PASSWORD/DB_NAME`：Postgres 凭据
- `DB_PATH`：后端 SQLite 文件路径，容器内 `/data/relic-restore.db`；宿主机直跑默认 `backend/data/relic-restore.db`
- `SEED_ON_BOOT`：启动时库为空是否灌种子，默认 `true`
- `JWT_SECRET`：JWT 密钥

## Docker 部署说明

- 根 Compose 不写 `version`，顶层 `name: relic-restore`；容器名均带 `${COMPOSE_PROJECT_NAME:-relic-restore}` 前缀。
- 数据库与后端数据均使用命名卷（`db_data`、`backend_data`），避免绑定中文路径。
- db 配置 healthcheck，backend `depends_on: service_healthy`，frontend 再依赖 backend 健康。
- 后端镜像基于 Alpine，better-sqlite3 在构建阶段原生编译；最终镜像内数据写 `/data` 命名卷。
- 常见问题：端口占用改 `.env`；重置闭环数据执行 `docker compose down -v`。

## 枚举/常量出现位置清单

- **DamageStatus（新增）**：`constants/DamageStatus.ts`、`models/DamageRecord.ts`、`db/schema.ts` 与 `database/init.sql`（CHECK）、`db/seedData.ts`、`repositories/DamageRecordRepository.ts`、`services/TransferLoopService.ts`、回读响应 `types/TransferPayload.ts`。
- **PlanApprovalStatus**：`constants/PlanApprovalStatus.ts`（含 `ACTIVE_PLAN_STATUSES`）、`models/RestorationPlan.ts`、`constructors/RestorationPlanDtoFactory.ts`、`db/schema.ts` 与 `database/init.sql`（部分唯一索引/CHECK）、`services/TransferLoopService.ts`、错误消息与日志模板。
- **RelicCondition**：`constants/RelicCondition.ts`、`models/RelicItem.ts`、`db/schema.ts`、种子与展示层引用。
- **DamageSeverity**：`constants/DamageSeverity.ts`、`models/DamageRecord.ts`、`db/schema.ts`、登记构造器与筛选/展示。

## 为什么会牵一发动全身

状态机、枚举、错误码/消息、日志模板、DTO 构造器、仓储条件更新、控制器与路由被刻意拆分到多层并互相引用；修改一个状态（如新增在途态）需要同步 `DamageStatus`/`PlanApprovalStatus`、部分唯一索引谓词、DDL（SQLite + Postgres 两份）、事务内条件更新、种子、日志模板与 README。

## License

MIT
