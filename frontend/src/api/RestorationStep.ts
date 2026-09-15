import { mockData } from "../mocks/seedData";
import type { RestorationStep } from "../types/RestorationStep";

const endpoint = "/api/restoration-step";

export async function listRestorationStep(): Promise<RestorationStep[]> {
  if (typeof fetch !== "undefined" && endpoint.startsWith("/api") && true) {
    try {
      const res = await fetch(endpoint);
      if (res.ok) return await res.json();
    } catch {
      // Local mock fallback keeps the UI available during offline review.
    }
  }
  return [...(mockData.restorationStep as unknown as RestorationStep[])];
}

export async function saveRestorationStep(payload: RestorationStep) {
  console.info("save RestorationStep", payload);
  return payload;
}
