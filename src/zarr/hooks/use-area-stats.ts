import { useQuery } from "@tanstack/react-query";
import { computeAreaStats, fetchStatesGeoJson } from "../duckdb/area-stats";
import { getDb } from "../duckdb/client";
import type { ForecastRun, VariableGrid } from "./use-forecast";

/** Every US state polygon, read out of DuckDB's `states` table. */
export function useStatesGeoJson() {
  return useQuery({
    queryKey: ["statesGeoJson"],
    queryFn: async () => fetchStatesGeoJson(await getDb()),
    staleTime: Infinity,
  });
}

/**
 * Per-lead-time mean/min/max of the shown variable over the selected state.
 * Waits for the variable's table (the map loads it), then runs in DuckDB.
 */
export function useAreaStats(
  run: ForecastRun | undefined,
  variable: string,
  grid: VariableGrid | undefined,
  stateId: number | undefined,
) {
  return useQuery({
    queryKey: ["areaStats", variable, run?.initIdx, stateId],
    queryFn: async () =>
      computeAreaStats({
        db: await getDb(),
        table: grid!.table,
        stateId: stateId!,
        window: run!.window,
        attrs: run!.geoZarrAttrs,
      }),
    enabled: !!run && !!grid && stateId !== undefined,
    staleTime: Infinity,
  });
}
