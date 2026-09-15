import type { RelicItem } from "../types/RelicItem";

export const createDefaultRelicItem = (overrides: Partial<RelicItem> = {}): RelicItem => ({
  id: 1 as never,
  relic_code: "relic code 1" as never,
  name: "name 1" as never,
  era: "era 1" as never,
  material: "material 1" as never,
  collection_level: "LOW" as never,
  storage_location: "storage location 1" as never,
  current_condition: "current condition 1" as never,
  ...overrides
});

export const createRelicItemForm = createDefaultRelicItem;
export const createRelicItemResponse = createDefaultRelicItem;
