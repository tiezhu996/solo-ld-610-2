import { seed } from "../seed"; export const restorationPlanRepository = { findAll: () => seed.restorationPlan, save: (row: unknown) => row };
