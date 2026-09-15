import type { RequestHandler } from "express";
import { AppError, ERROR_CODES } from "../utils/AppError";

interface AuthedRequest {
  user?: { id: number | string; role: string };
}

/**
 * 基于角色的访问控制。authMiddleware 已将 {id, role} 注入 req.user。
 * 空角色列表放行；ADMIN 默认放行；其余需命中 roles 之一。
 */
export const rbacMiddleware =
  (roles: string[] = []): RequestHandler =>
  (req, _res, next) => {
    if (roles.length === 0) {
      next();
      return;
    }
    const role = (req as AuthedRequest).user?.role ?? "GUEST";
    if (role === "ADMIN" || roles.includes(role)) {
      next();
      return;
    }
    next(new AppError(ERROR_CODES.RBAC_DENIED, { role }, 403));
  };
