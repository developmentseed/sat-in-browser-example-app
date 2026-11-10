// The store's global 0.25° grid and how an AOI bbox maps onto it. Checked
// against the live store: latitude runs 90 → −90 (721 rows), longitude
// −180 → 179.75 (1440 cols), both at cell centres.

export const GRID = {
  lat0: 90,
  lon0: -180,
  step: 0.25,
  rows: 721,
  cols: 1440,
} as const;

/** A half-open window into the global grid: rows `[r0, r1)`, cols `[c0, c1)`. */
export type GridWindow = { r0: number; r1: number; c0: number; c1: number };

/** Synthetic GeoZarr-style attrs — the store itself isn't GeoZarr. */
export type GeoZarrAttrs = {
  "spatial:dimensions": readonly [string, string];
  /** Affine [a, b, c, d, e, f]: lon = c + a·col, lat = f + e·row. */
  "spatial:transform": readonly number[];
  "spatial:shape": readonly [number, number];
  "proj:code": string;
  /**
   * "node": the transform's origin is the *centre* of pixel (0, 0), which is
   * how the store's latitude/longitude coordinates are defined.
   */
  "spatial:registration": "node";
};

/**
 * Snaps a [west, south, east, north] bbox outwards to whole `block`-cell
 * blocks (the store's inner-chunk size), clipped to the grid. Every cell
 * whose centre lies inside the bbox is included.
 */
export function snapBbox(bbox: readonly [number, number, number, number], block: number): GridWindow {
  const [west, south, east, north] = bbox;
  if (!(west < east && south < north)) throw new Error(`Invalid bbox ${bbox.join(",")}`);
  const { lat0, lon0, step, rows, cols } = GRID;
  const rowOf = (lat: number) => (lat0 - lat) / step;
  const colOf = (lon: number) => (lon - lon0) / step;
  const down = (i: number) => Math.max(0, Math.floor(i / block) * block);
  const up = (i: number, max: number) => Math.min(max, Math.ceil(i / block) * block);
  return {
    r0: down(Math.ceil(rowOf(north))),
    r1: up(Math.floor(rowOf(south)) + 1, rows),
    c0: down(Math.ceil(colOf(west))),
    c1: up(Math.floor(colOf(east)) + 1, cols),
  };
}

/** Georeferencing for a window of the global grid (row 0 = northernmost). */
export function windowGeoZarrAttrs(w: GridWindow): GeoZarrAttrs {
  const { lat0, lon0, step } = GRID;
  return {
    "spatial:dimensions": ["latitude", "longitude"],
    "spatial:transform": [step, 0, lon0 + w.c0 * step, 0, -step, lat0 - w.r0 * step],
    "spatial:shape": [w.r1 - w.r0, w.c1 - w.c0],
    "proj:code": "EPSG:4326",
    "spatial:registration": "node",
  };
}

/** The window's outer edges (cell edges, not centres) as [west, south, east, north]. */
export function windowBounds(w: GridWindow): [number, number, number, number] {
  const { lat0, lon0, step } = GRID;
  const half = step / 2;
  return [
    lon0 + w.c0 * step - half,
    lat0 - (w.r1 - 1) * step - half,
    lon0 + (w.c1 - 1) * step + half,
    lat0 - w.r0 * step + half,
  ];
}
