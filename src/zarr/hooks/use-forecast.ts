import { useQuery } from "@tanstack/react-query";
import { AOI_BBOX, DEFAULT_VARIABLE, ENSEMBLE_MEMBER, VARIABLES, type VariableSpec } from "../../config";
import useStore from "../../store";
import { getDb } from "../duckdb/client";
import {
  latestCompleteInit,
  loadVariableTable,
  queryGrid,
  queryRange,
  readCoordinate,
} from "../duckdb/zarr-table";
import type { GridValues } from "../layers/table-raster-layer";
import { snapBbox, windowGeoZarrAttrs, type GeoZarrAttrs, type GridWindow } from "../source/aoi";
import { arrayMeta, fetchStoreMetadata } from "../source/metadata";
import { shardLayout } from "../source/shards";

/** The forecast run on screen: which init, and its lead-time axis. */
export type ForecastRun = {
  initIdx: number;
  /** ISO init time. */
  initTime: string;
  /** Lead time of each step, in hours. */
  leadHours: number[];
  window: GridWindow;
  geoZarrAttrs: GeoZarrAttrs;
};

/** The AOI snapped to the store's inner-chunk grid. */
async function aoiWindow(): Promise<GridWindow> {
  const metadata = await fetchStoreMetadata();
  const layout = shardLayout(arrayMeta(metadata, DEFAULT_VARIABLE));
  const [, , , latChunk, lonChunk] = layout.innerShape;
  if (latChunk !== lonChunk) throw new Error("Expected square inner chunks");
  return snapBbox(AOI_BBOX, latChunk!);
}

async function fetchForecastRun(): Promise<ForecastRun> {
  const [db, metadata, window] = await Promise.all([getDb(), fetchStoreMetadata(), aoiWindow()]);
  const [initIdx, initTimes, leadSeconds] = await Promise.all([
    latestCompleteInit(metadata, DEFAULT_VARIABLE, window),
    readCoordinate(db, metadata, "init_time"),
    readCoordinate(db, metadata, "lead_time"),
  ]);
  // Both are "seconds" (since 1970-01-01, and timedelta).
  return {
    initIdx,
    initTime: new Date(initTimes[initIdx]! * 1000).toISOString(),
    leadHours: leadSeconds.map((s) => s / 3600),
    window,
    geoZarrAttrs: windowGeoZarrAttrs(window),
  };
}

/** The latest complete run over the AOI. Shared by every variable. */
export function useForecastRun() {
  return useQuery({
    queryKey: ["forecastRun"],
    queryFn: fetchForecastRun,
    staleTime: Infinity,
  });
}

export function variableSpec(name: string): VariableSpec {
  const spec = VARIABLES.find((v) => v.name === name);
  if (!spec) throw new Error(`Unknown variable ${name}`);
  return spec;
}

export type VariableGrid = {
  values: GridValues;
  /** The DuckDB table the values came from — the area stats query it too. */
  table: string;
  /** Colour range in display units: the configured one, else SQL percentiles. */
  range: [number, number];
};

async function fetchVariableGrid(
  run: ForecastRun,
  spec: VariableSpec,
  setProgress: ReturnType<typeof useStore.getState>["setProgress"],
): Promise<VariableGrid> {
  const [db, metadata] = await Promise.all([getDb(), fetchStoreMetadata()]);
  const t0 = performance.now();
  const table = await loadVariableTable(db, metadata, {
    variable: spec.name,
    initIdx: run.initIdx,
    member: ENSEMBLE_MEMBER,
    window: run.window,
    scale: spec.scale,
    onProgress: (done, total) =>
      setProgress({ variable: spec.name, stage: done < total ? "chunks" : "duckdb", done, total }),
  });
  const [height, width] = run.geoZarrAttrs["spatial:shape"];
  const depth = run.leadHours.length;
  const [data, autoRange] = await Promise.all([
    queryGrid(db, table, { depth, height, width }),
    spec.range ? Promise.resolve(spec.range) : queryRange(db, table),
  ]);
  console.info(
    `[${spec.name}] ${depth}×${height}×${width} = ${data.length} cells from DuckDB table ${table} in ${Math.round(performance.now() - t0)} ms`,
  );
  setProgress({ variable: spec.name, stage: "done", done: 1, total: 1 });
  return { values: { data, depth, height, width }, table, range: autoRange };
}

/**
 * The selected variable over the AOI, every lead time, read through DuckDB.
 * Kept for the session, so switching back to a variable is instant.
 */
export function useVariableGrid(run: ForecastRun | undefined, variable: string) {
  const setProgress = useStore((state) => state.setProgress);
  return useQuery({
    queryKey: ["variableGrid", variable, run?.initIdx],
    queryFn: () => fetchVariableGrid(run!, variableSpec(variable), setProgress),
    enabled: !!run,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
