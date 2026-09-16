import { damageRecordRepository } from "../repositories/DamageRecordRepository";
import { isAllowedInitialStatus, INITIAL_DAMAGE_STATUS } from "../constants/DamageStatus";
import { AppError, ERROR_CODES } from "../utils/AppError";

export const damageRecordService = {
  list: () => damageRecordRepository.findAll(),

  /**
   * 新建病害：只能落在可转办初始状态 OPEN。
   * 任何携带 IN_PLAN/REJECTED/CLOSED（或其它非 OPEN）状态的请求一律拒绝，
   * 不产生任何记录——这些状态只能由转办闭环流转得到，禁止新建时直接写入。
   */
  create: (row: unknown) => {
    const data = (row ?? {}) as Record<string, unknown>;
    if (!isAllowedInitialStatus(data.status)) {
      throw new AppError(
        ERROR_CODES.DAMAGE_INVALID_INITIAL_STATUS,
        { status: String(data.status) },
        400,
      );
    }
    // 规范化：缺省/空串也统一落为 OPEN
    return damageRecordRepository.save({ ...data, status: INITIAL_DAMAGE_STATUS });
  },
};
