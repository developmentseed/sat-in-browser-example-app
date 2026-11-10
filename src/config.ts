import type { ColormapName } from "./zarr/layers/colormap";

/**
 * dynamical.org's ECMWF IFS ENS 15-day 0.25° store: Zarr v3, consolidated,
 * sharded. See https://dynamical.org/catalog/ecmwf-ifs-ens-forecast-15-day-0-25-degree/
 */
export const SOURCE_URL = "https://data.dynamical.org/ecmwf/ifs-ens/forecast-15-day-0-25-degree/latest.zarr/";

/**
 * Area of interest as [west, south, east, north] degrees. It's snapped
 * outwards to the store's 8° inner-chunk grid (lon −180 + 8k, lat 90 − 8k).
 * The default covers the contiguous US (WA coast to eastern Maine, southern
 * Florida Keys to the Canadian border) and loads lon −132…−60, lat 18…50:
 * 9 × 4 = 36 inner chunks. Alaska and Hawaii are not included.
 *
 * Every inner chunk carries all 85 lead times × 51 members and is ~2.5–4 MB
 * compressed, so download cost grows with the snapped area (~3.5 MB per
 * 8° × 8° box, per variable — ~125 MB for the default). For a lighter
 * regional view, e.g. the central US around Missouri: [-104, 30, -85, 46]
 * (3 × 3 chunks).
 */
export const AOI_BBOX: readonly [number, number, number, number] = [-124.8, 24.5, -66.9, 49.4];

/** US state boundaries (Census cartographic 1:20M), written by scripts/make_states_parquet.py. */
export const STATES_PARQUET_URL = "/us-states.parquet";

/** Which ensemble member to show; 0 is the control run. */
export const ENSEMBLE_MEMBER = 0;

export type VariableSpec = {
  /** Array name in the store. */
  name: string;
  /** Short label for the picker. */
  label: string;
  /** Display units after `scale` is applied. */
  units: string;
  /** Multiplier applied in SQL when the DuckDB table is built (unit conversion). */
  scale?: number;
  /** Fixed colour range in display units; omitted → 2nd–98th percentile from SQL. */
  range?: [number, number];
  colormap: ColormapName;
  reversed?: boolean;
  /** Cells below this (display units) are left transparent, e.g. dry cells for precipitation. */
  hideBelow?: number;
};

export const VARIABLES: readonly VariableSpec[] = [
  { name: "temperature_2m", label: "2 m temperature", units: "°C", range: [-30, 40], colormap: "turbo" },
  {
    name: "dew_point_temperature_2m",
    label: "2 m dew point",
    units: "°C",
    range: [-30, 30],
    colormap: "turbo",
  },
  {
    name: "precipitation_surface",
    label: "Precipitation rate",
    units: "mm/h",
    scale: 3600,
    range: [0, 5],
    colormap: "rain",
    hideBelow: 0.05,
  },
  {
    name: "total_cloud_cover_atmosphere",
    label: "Total cloud cover",
    units: "%",
    range: [0, 100],
    colormap: "gray",
  },
  { name: "wind_gust_10m", label: "10 m wind gust", units: "m/s", range: [0, 30], colormap: "speed" },
  {
    name: "wind_u_10m",
    label: "10 m U wind",
    units: "m/s",
    range: [-20, 20],
    colormap: "rdbu",
    reversed: true,
  },
  {
    name: "wind_v_10m",
    label: "10 m V wind",
    units: "m/s",
    range: [-20, 20],
    colormap: "rdbu",
    reversed: true,
  },
  {
    name: "pressure_reduced_to_mean_sea_level",
    label: "MSL pressure",
    units: "hPa",
    scale: 0.01,
    colormap: "viridis",
  },
  { name: "geopotential_height_500hpa", label: "500 hPa height", units: "m", colormap: "viridis" },
];

export const DEFAULT_VARIABLE = "temperature_2m";
