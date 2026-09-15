import type { Request, Response } from "express";
import { transferLoopService } from "../services/TransferLoopService";
import { restorationPlanService } from "../services/RestorationPlanService";
import { asyncHandler } from "../utils/asyncHandler";

interface AuthedRequest extends Request {
  user?: { id: number | string; role: string };
}

export const restorationPlanController = {
  list: (_req: Request, res: Response) => res.json(restorationPlanService.list()),

  /** 批准：SUBMITTED -> APPROVED（病害保持锁定）。 */
  approve: asyncHandler((req: AuthedRequest, res: Response) => {
    const actor = req.user ?? { id: 0, role: "anonymous" };
    res.json(transferLoopService.approvePlan(req.params.id, actor));
  }),

  /** 驳回：方案 -> REJECTED 且病害解锁可再次转办（原记录保留）。 */
  reject: asyncHandler((req: AuthedRequest, res: Response) => {
    const actor = req.user ?? { id: 0, role: "anonymous" };
    const body = (req.body ?? {}) as { reason?: string };
    res.json(transferLoopService.rejectPlan(req.params.id, { reason: body.reason }, actor));
  }),

  /** 归档：APPROVED -> ARCHIVED，病害结案 CLOSED。 */
  archive: asyncHandler((req: AuthedRequest, res: Response) => {
    const actor = req.user ?? { id: 0, role: "anonymous" };
    res.json(transferLoopService.archivePlan(req.params.id, actor));
  }),
};
