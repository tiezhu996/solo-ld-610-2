import { mockData } from "../mocks/seedData";
import type { RelicItem } from "../types/RelicItem";

const endpoint = "/api/relic-item";

export async function listRelicItem(): Promise<RelicItem[]> {
  if (typeof fetch !== "undefined" && endpoint.startsWith("/api") && true) {
    try {
      const res = await fetch(endpoint);
      if (res.ok) return await res.json();
    } catch {
      // Local mock fallback keeps the UI available during offline review.
    }
  }
  return [...(mockData.relicItem as unknown as RelicItem[])];
}

export async function saveRelicItem(payload: RelicItem) {
  console.info("save RelicItem", payload);
  return payload;
}
