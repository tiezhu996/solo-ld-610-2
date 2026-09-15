import { seed } from "../seed"; export const damageRecordRepository = { findAll: () => seed.damageRecord, save: (row: unknown) => row };
