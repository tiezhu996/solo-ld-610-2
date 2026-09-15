import type { RequestHandler } from "express"; export const authMiddleware: RequestHandler = (req, _res, next) => { (req as any).user = { id: 1, role: req.header("x-role") ?? "admin" }; next(); };
