import type { ImageVersion } from "../types/ImageVersion";

export const createDefaultImageVersion = (overrides: Partial<ImageVersion> = {}): ImageVersion => ({
  id: 1 as never,
  relic_id: 1 as never,
  plan_id: 1 as never,
  version_no: "version no 1" as never,
  image_type: "FRAGILE" as never,
  file_path: "file path 1" as never,
  capture_at: "2026-06-11T09:00:00Z" as never,
  note: "note 1" as never,
  ...overrides
});

export const createImageVersionForm = createDefaultImageVersion;
export const createImageVersionResponse = createDefaultImageVersion;
