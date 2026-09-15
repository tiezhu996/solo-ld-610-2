import { mockData } from "../mocks/seedData";
import type { RestorationPlan } from "../types/RestorationPlan";

const endpoint = "/api/restoration-plan";

export async function listRestorationPlan(): Promise<RestorationPlan[]> {
  if (typeof fetch !== "undefined" && endpoint.startsWith("/api") && true) {
    try {
      const res = await fetch(endpoint);
      if (res.ok) return await res.json();
    } catch {
      // Local mock fallback keeps the UI available during offline review.
    }
  }
  return [...(mockData.restorationPlan as unknown as RestorationPlan[])];
}

export async function saveRestorationPlan(payload: RestorationPlan) {
  console.info("save RestorationPlan", payload);
  return payload;
}
