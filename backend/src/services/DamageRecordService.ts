import { damageRecordRepository } from "../repositories/DamageRecordRepository";

export const damageRecordService = {
  list: () => damageRecordRepository.findAll(),
  create: (row: unknown) => damageRecordRepository.save((row ?? {}) as Record<string, unknown>),
};
