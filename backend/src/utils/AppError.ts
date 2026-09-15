import { ERROR_CODES } from "../constants/errorCodes";
import { renderMessage } from "../constants/errorMessages";

/**
 * 统一业务异常。service 抛出、controller 包装、errorHandlerMiddleware 兜底，
 * 不在单一位置吞掉全部异常。
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, vars: Record<string, string | number> = {}, status = 400) {
    super(renderMessage(code, vars));
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export const notFound = (code: string, vars: Record<string, string | number>) =>
  new AppError(code, vars, 404);

export const conflict = (code: string, vars: Record<string, string | number>) =>
  new AppError(code, vars, 409);

export const badRequest = (code: string, vars: Record<string, string | number> = {}) =>
  new AppError(code, vars, 400);

/** SQLite 唯一约束 / 主键冲突错误码 */
export const isUniqueViolation = (err: unknown): boolean => {
  const code = (err as { code?: string } | null)?.code;
  return code === "SQLITE_CONSTRAINT_PRIMARYKEY" || code === "SQLITE_CONSTRAINT_UNIQUE";
};

export { ERROR_CODES };
