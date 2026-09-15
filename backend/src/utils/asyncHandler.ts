import type { RequestHandler } from "express";

/** 让 controller 中抛错（含异步）统一转交 errorHandlerMiddleware，service/controller 各自包装异常。 */
export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
