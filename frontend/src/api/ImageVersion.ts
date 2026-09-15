import { mockData } from "../mocks/seedData";
import type { ImageVersion } from "../types/ImageVersion";

const endpoint = "/api/image-version";

export async function listImageVersion(): Promise<ImageVersion[]> {
  if (typeof fetch !== "undefined" && endpoint.startsWith("/api") && true) {
    try {
      const res = await fetch(endpoint);
      if (res.ok) return await res.json();
    } catch {
      // Local mock fallback keeps the UI available during offline review.
    }
  }
  return [...(mockData.imageVersion as unknown as ImageVersion[])];
}

export async function saveImageVersion(payload: ImageVersion) {
  console.info("save ImageVersion", payload);
  return payload;
}
