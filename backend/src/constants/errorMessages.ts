import { ERROR_CODES } from "./errorCodes";

/**
 * 错误消息模板集中处。占位符使用 {name} 形式，由 AppError / 调用处填充。
 * service 与 controller 各自包装异常，禁止在单一全局位置吞掉。
 */
export const ERROR_MESSAGES: Record<string, string> = {
  [ERROR_CODES.AUTH_REQUIRED]: "missing bearer token",
  [ERROR_CODES.RBAC_DENIED]: "role denied",
  [ERROR_CODES.VALIDATION_FAILED]: "invalid payload",
  [ERROR_CODES.RATE_LIMITED]: "too many requests",
  [ERROR_CODES.DAMAGE_NOT_FOUND]: "病害记录不存在：damageId={damageId}",
  [ERROR_CODES.DAMAGE_LOCKED]: "病害已被在途方案锁定，不能重复转办：damageId={damageId}, planId={planId}",
  [ERROR_CODES.DAMAGE_CLOSED]: "病害已归档结案，不能再次转办：damageId={damageId}",
  [ERROR_CODES.ACTIVE_PLAN_EXISTS]: "该病害已存在未归档方案，重复提交只能回读原方案：damageId={damageId}, planId={planId}",
  [ERROR_CODES.PLAN_NOT_FOUND]: "修复方案不存在：planId={planId}",
  [ERROR_CODES.PLAN_STATUS_CONFLICT]: "方案当前状态 {status} 不允许执行 {action}",
  [ERROR_CODES.CONCURRENT_TRANSFER]: "并发转办冲突，病害已有在途方案：damageId={damageId}",
  [ERROR_CODES.DAMAGE_INVALID_INITIAL_STATUS]:
    "新建病害只能进入可转办初始状态 OPEN，禁止直接写入锁定/结案状态：status={status}（请通过转办闭环流转）",
};

export const renderMessage = (code: string, vars: Record<string, string | number> = {}): string => {
  const tpl = ERROR_MESSAGES[code] ?? code;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
};
