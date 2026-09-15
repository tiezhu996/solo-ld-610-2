import type { RequestHandler } from "express"; export const rbacMiddleware = (_roles: string[] = []): RequestHandler => (_req, _res, next) => next();
