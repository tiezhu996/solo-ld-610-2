export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbHost: process.env.DB_HOST ?? "localhost",
  // 本地持久化文件（SQLite）。生产容器使用 Postgres，由 database/init.sql 初始化。
  // 允许显式指定 ":memory:" 以便测试。
  dbPath: process.env.DB_PATH ?? `${process.cwd()}/data/relic-restore.db`,
  // 启动时若库为空是否灌入幂等种子数据
  seedOnBoot: (process.env.SEED_ON_BOOT ?? "true") !== "false",
};
