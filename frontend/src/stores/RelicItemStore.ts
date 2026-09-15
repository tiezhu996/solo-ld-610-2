import { create } from "zustand";
import { listRelicItem } from "../api/RelicItem";
import type { RelicItem } from "../types/RelicItem";

type State = { rows: RelicItem[]; loading: boolean; load: () => Promise<void> };

export const useRelicItemStore = create<State>((set) => ({
  rows: [],
  loading: false,
  async load() {
    set({ loading: true });
    set({ rows: await listRelicItem(), loading: false });
  }
}));
