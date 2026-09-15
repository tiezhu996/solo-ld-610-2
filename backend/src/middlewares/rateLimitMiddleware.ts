import type { RequestHandler } from "express"; export const rateLimitMiddleware: RequestHandler = (_req, _res, next) => next();
