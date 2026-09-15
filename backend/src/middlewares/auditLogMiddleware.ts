import type { RequestHandler } from "express"; export const auditLogMiddleware: RequestHandler = (req, _res, next) => { console.info("audit", req.method, req.path); next(); };
