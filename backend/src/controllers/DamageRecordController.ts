import type { Request, Response } from "express";
import { damageRecordService } from "../services/DamageRecordService";
import { transferLoopService } from "../services/TransferLoopService";
import { asyncHandler } from "../utils/asyncHandler";
import type { TransferToPlanPayload } from "../types/TransferPayload";

interface AuthedRequest extends Request {
  user?: { id: number | string; role: string };
}

export const damageRecordController = {
  list: (_req: Request, res: Response) => res.json(damageRecordService.list()),

  create: asyncHandler((req: Request, res: Response) =>
    res.status(201).json(damageRecordService.create(req.body)),
  ),

  /**
   * 唯一提交入口：把某条病害转办为修复方案。
   * POST /api/damage-record/:id/transfer
   * 存在在途方案时不新建，回读原方案（HTTP 200，created=false）。
   */
  transfer: asyncHandler((req: AuthedRequest, res: Response) => {
    const actor = req.user ?? { id: 0, role: "anonymous" };
    const body = (req.body ?? {}) as Partial<TransferToPlanPayload>;
    const payload: TransferToPlanPayload = {
      damageId: req.params.id,
      plan_title: body.plan_title,
      method: body.method,
      risk_assessment: body.risk_assessment,
      owner_id: body.owner_id,
      idempotency_key: body.idempotency_key,
    };
    const result = transferLoopService.transferToPlanIdempotent(payload, actor);
    res.status(result.created ? 201 : 200).json({
      created: result.created,
      plan: result.plan,
      damage: { id: result.damage.id, status: result.damage.status },
    });
  }),

  /**
   * 唯一状态回读入口：GET /api/damage-record/:id/transfer
   * 返回病害状态、在途方案与全部方案历史（含已驳回记录）。
   */
  transferStatus: asyncHandler((req: Request, res: Response) => {
    res.json(transferLoopService.getTransferStatus(req.params.id));
  }),
};
