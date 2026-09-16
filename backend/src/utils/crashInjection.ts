/**
 * 崩溃注入（仅用于崩溃恢复测试）。
 *
 * 默认完全关闭；只有显式设置环境变量 CRASH_INJECTION_ENABLED=true 时，
 * 携带 x-crash-phase 请求头的写操作才会在 COMMIT 前/后对本进程发起 SIGKILL，
 * 模拟掉电/被 kill -9。生产环境不设置该变量时，任何请求头都不会触发。
 */
export type CrashPoint = "beforeCommit" | "afterCommit";

export const crashInjectionEnabled = (): boolean =>
  process.env.CRASH_INJECTION_ENABLED === "true";

/** beforeCommit：所有行已写入、但 COMMIT 尚未执行；afterCommit：COMMIT 已返回。 */
export const crashAt = (
  requested: CrashPoint | undefined,
  point: CrashPoint,
  label: string,
): void => {
  if (!crashInjectionEnabled() || requested !== point) return;
  // eslint-disable-next-line no-console
  console.error(`[crash-injection] SIGKILL @ ${label}`);
  try {
    // 硬杀：不执行任何回滚/flush，等同掉电。WAL+synchronous=FULL 决定已提交内容是否存活。
    process.kill(process.pid, "SIGKILL");
  } catch {
    /* fall through */
  }
  // 兜底（正常情况下 SIGKILL 已使进程终止，不会到达）
  process.exit(137);
};

export const parseCrashPhase = (value: unknown): CrashPoint | undefined =>
  value === "beforeCommit" || value === "afterCommit" ? value : undefined;
