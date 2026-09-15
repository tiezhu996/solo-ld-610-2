import { create } from "zustand";
import { listRestorationPlan } from "../api/RestorationPlan";
import type { RestorationPlan } from "../types/RestorationPlan";

type State = { rows: RestorationPlan[]; loading: boolean; load: () => Promise<void> };

export const useRestorationPlanStore = create<State>((set) => ({
  rows: [],
  loading: false,
  async load() {
    set({ loading: true });
    set({ rows: await listRestorationPlan(), loading: false });
  }
}));
