import { restorationPlanRepository } from "../repositories/RestorationPlanRepository";
import { AppError, ERROR_CODES } from "../utils/AppError";

export const restorationPlanService = {
  list: () => restorationPlanRepository.findAll(),
  /**
   * 修复方案不允许直接创建：只能经唯一提交入口
   * POST /api/damage-record/:id/transfer 由"病害转办"原子产生。
   */
  create: (_row: unknown): never => {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      { entry: "POST /api/damage-record/:id/transfer" },
      405,
    );
  },
};
