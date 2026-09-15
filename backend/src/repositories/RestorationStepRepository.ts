import { seed } from "../seed"; export const restorationStepRepository = { findAll: () => seed.restorationStep, save: (row: unknown) => row };
