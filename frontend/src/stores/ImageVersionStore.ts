import { create } from "zustand";
import { listImageVersion } from "../api/ImageVersion";
import type { ImageVersion } from "../types/ImageVersion";

type State = { rows: ImageVersion[]; loading: boolean; load: () => Promise<void> };

export const useImageVersionStore = create<State>((set) => ({
  rows: [],
  loading: false,
  async load() {
    set({ loading: true });
    set({ rows: await listImageVersion(), loading: false });
  }
}));
