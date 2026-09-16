import fs from "node:fs";
import path from "node:path";
import Database, { type Database as DB } from "better-sqlite3";
import { SCHEMA_SQL } from "./schema";

let db: DB | null = null;

/**
 * 打开（并按需初始化）数据库。
 * - WAL：崩溃后重启仍可读到已提交数据
 * - foreign_keys：打开外键约束
 * - busy_timeout：多进程并发写时让后来者等待写锁，而不是立刻 SQLITE_BUSY
 */
export const openDatabase = (file: string): DB => {
  const isMemory = file === ":memory:";
  if (!isMemory) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const conn = new Database(file, { timeout: 10_000 });
  conn.pragma("foreign_keys = ON");
  if (!isMemory) {
    conn.pragma("journal_mode = WAL");
    conn.pragma("synchronous = FULL");
  }
  conn.pragma("busy_timeout = 10000");
  conn.exec(SCHEMA_SQL.join("\n"));
  return conn;
};

export const getDb = (file?: string): DB => {
  if (!db) {
    db = openDatabase(file ?? process.env.DB_PATH ?? `${process.cwd()}/data/relic-restore.db`);
  }
  return db;
};

/** 仅供测试：重置单例（例如切换到独立的临时库）。 */
export const resetDb = (): void => {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
  }
};

/**
 * 在单个立即事务中执行。BEGIN IMMEDIATE 一开始就拿写锁：
 * "方案写入 + 病害锁定"在同一事务内，一起提交或一起回滚，绝不留半边状态。
 */
export const immediate = <T>(fn: (tx: DB) => T): T => {
  const conn = getDb();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(conn);
    conn.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      conn.exec("ROLLBACK");
    } catch {
      /* rollback best-effort */
    }
    throw err;
  }
};

/**
 * 在单个只读快照事务中执行多次读。
 *
 * 用 BEGIN（deferred）而非 BEGIN IMMEDIATE：事务在第一条 SELECT 时才开始，
 * 并在 WAL 下钉住那一刻的一致性快照——事务内对"病害 + 在途方案 + 方案历史"
 * 的所有读取都来自同一次快照，驳回/归档/再次转办在读取期间提交也不会让回读
 * 拼出跨时间点的状态（如"病害仍锁定却无在途方案"）。
 *
 * deferred 读事务不持有写锁，不会阻塞写者；任一步读取抛错都会 ROLLBACK，
 * 不残留事务/锁。
 */
export const snapshotRead = <T>(fn: (tx: DB) => T): T => {
  const conn = getDb();
  conn.exec("BEGIN");
  try {
    const result = fn(conn);
    conn.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      conn.exec("ROLLBACK");
    } catch {
      /* rollback best-effort */
    }
    throw err;
  }
};
