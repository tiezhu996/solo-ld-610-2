import type { DamageRecord } from "../types/DamageRecord";

export const createDefaultDamageRecord = (overrides: Partial<DamageRecord> = {}): DamageRecord => ({
  id: 1 as never,
  relic_id: 1 as never,
  damage_type: "FRAGILE" as never,
  position_desc: "position desc 1" as never,
  severity: "severity 1" as never,
  discovered_by: "discovered by 1" as never,
  discovered_at: "2026-06-11T09:00:00Z" as never,
  image_url: "/mock/image_url-1.png" as never,
  status: "SUBMITTED" as never,
  ...overrides
});

export const createDamageRecordForm = createDefaultDamageRecord;
export const createDamageRecordResponse = createDefaultDamageRecord;
