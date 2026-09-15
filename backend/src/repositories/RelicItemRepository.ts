import { seed } from "../seed"; export const relicItemRepository = { findAll: () => seed.relicItem, save: (row: unknown) => row };
