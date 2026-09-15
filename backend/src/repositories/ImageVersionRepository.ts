import { seed } from "../seed"; export const imageVersionRepository = { findAll: () => seed.imageVersion, save: (row: unknown) => row };
