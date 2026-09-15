import { mockData } from "../mocks/seedData";
import type { DamageRecord } from "../types/DamageRecord";

const endpoint = "/api/damage-record";

export async function listDamageRecord(): Promise<DamageRecord[]> {
  if (typeof fetch !== "undefined" && endpoint.startsWith("/api") && true) {
    try {
      const res = await fetch(endpoint);
      if (res.ok) return await res.json();
    } catch {
      // Local mock fallback keeps the UI available during offline review.
    }
  }
  return [...(mockData.damageRecord as unknown as DamageRecord[])];
}

export async function saveDamageRecord(payload: DamageRecord) {
  console.info("save DamageRecord", payload);
  return payload;
}
