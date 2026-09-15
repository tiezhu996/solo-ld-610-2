import { create } from "zustand";
import { listDamageRecord } from "../api/DamageRecord";
import type { DamageRecord } from "../types/DamageRecord";

type State = { rows: DamageRecord[]; loading: boolean; load: () => Promise<void> };

export const useDamageRecordStore = create<State>((set) => ({
  rows: [],
  loading: false,
  async load() {
    set({ loading: true });
    set({ rows: await listDamageRecord(), loading: false });
  }
}));
