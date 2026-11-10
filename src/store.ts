import { create } from "zustand";
import { DEFAULT_VARIABLE } from "./config";
import type { StateProperties } from "./zarr/duckdb/area-stats";

/** Where a variable's load is, for the status line. */
export type LoadProgress = {
  variable: string;
  stage: "chunks" | "duckdb" | "done";
  done: number;
  total: number;
};

type State = {
  variable: string;
  /** Index into the run's lead times. */
  leadIdx: number;
  playing: boolean;
  /** Base dwell per 3-hour step, in ms; 6-hour steps dwell twice as long. */
  frameMs: number;
  progress: LoadProgress | null;
  /** The clicked state, whose analysis the area panel shows. */
  selectedState: StateProperties | null;
  setVariable: (variable: string) => void;
  setLeadIdx: (leadIdx: number | ((prev: number) => number)) => void;
  setPlaying: (playing: boolean) => void;
  setProgress: (progress: LoadProgress | null) => void;
  setSelectedState: (state: StateProperties | null) => void;
};

const useStore = create<State>((set) => ({
  variable: DEFAULT_VARIABLE,
  leadIdx: 0,
  playing: false,
  frameMs: 150,
  progress: null,
  selectedState: null,
  setVariable: (variable) => set({ variable }),
  setLeadIdx: (leadIdx) =>
    set((state) => ({ leadIdx: typeof leadIdx === "function" ? leadIdx(state.leadIdx) : leadIdx })),
  setPlaying: (playing) => set({ playing }),
  setProgress: (progress) => set({ progress }),
  setSelectedState: (selectedState) => set({ selectedState }),
}));

export default useStore;
