import type { AsyncDuckDB } from "@duckdb/duckdb-wasm";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { STATES_PARQUET_URL } from "../../config";
import { windowBounds, type GeoZarrAttrs, type GridWindow } from "../source/aoi";

// Area analysis with DuckDB's `spatial` extension, adapted from awii-app's
// hydrology-stats.ts: boundary polygons live in a `states` table, every grid
// cell of the loaded window is a rectangle in `cells`, and a click joins the
// two to get each cell's overlap fraction with the state. The per-lead-time
// stats then run against the same `(t, r, c, v)` variable tables the map
// draws from.

export type StateProperties = { id: number; abbrev: string; name: string };
export type StatesGeoJson = FeatureCollection<Polygon | MultiPolygon, StateProperties>;

let spatialPromise: Promise<void> | null = null;

function ensureSpatial(db: AsyncDuckDB): Promise<void> {
  if (!spatialPromise) {
    spatialPromise = (async () => {
      const conn = await db.connect();
      try {
        await conn.query(`INSTALL spatial`);
        await conn.query(`LOAD spatial`);
      } finally {
        await conn.close();
      }
    })();
    spatialPromise.catch(() => {
      spatialPromise = null;
    });
  }
  return spatialPromise;
}

let statesPromise: Promise<void> | null = null;

/** Loads the state polygons into a persistent `states` table, once. */
function ensureStatesTable(db: AsyncDuckDB): Promise<void> {
  if (!statesPromise) {
    statesPromise = (async () => {
      await ensureSpatial(db);
      const resp = await fetch(STATES_PARQUET_URL);
      if (!resp.ok) throw new Error(`Failed to fetch ${STATES_PARQUET_URL}: ${resp.status}`);
      await db.registerFileBuffer("us_states_src.parquet", new Uint8Array(await resp.arrayBuffer()));
      const conn = await db.connect();
      try {
        await conn.query(`
          CREATE OR REPLACE TABLE states AS
          SELECT id, abbrev, name, ST_GeomFromWKB(geom_wkb) AS geom
          FROM read_parquet('us_states_src.parquet')
        `);
      } finally {
        await conn.close();
        await db.dropFile("us_states_src.parquet");
      }
    })();
    statesPromise.catch(() => {
      statesPromise = null;
    });
  }
  return statesPromise;
}

/** Every state as GeoJSON, straight out of the `states` table (for the map layer). */
export async function fetchStatesGeoJson(db: AsyncDuckDB): Promise<StatesGeoJson> {
  await ensureStatesTable(db);
  const conn = await db.connect();
  try {
    const result = await conn.query(`SELECT id, abbrev, name, ST_AsGeoJSON(geom) AS geojson FROM states`);
    const id = result.getChild("id")!;
    const abbrev = result.getChild("abbrev")!;
    const name = result.getChild("name")!;
    const geojson = result.getChild("geojson")!;
    return {
      type: "FeatureCollection",
      features: Array.from({ length: result.numRows }, (_, i) => ({
        type: "Feature" as const,
        id: Number(id.get(i)),
        properties: { id: Number(id.get(i)), abbrev: String(abbrev.get(i)), name: String(name.get(i)) },
        geometry: JSON.parse(geojson.get(i) as string) as Polygon | MultiPolygon,
      })),
    };
  } finally {
    await conn.close();
  }
}

// The catalog persists across connections, so `cells` is built once per window.
let cellsKey: string | null = null;

/**
 * One rectangle per grid cell of the loaded window, keyed by the same `r`/`c`
 * the variable tables use. Half a grid step around each cell centre — the
 * raster pixel's real footprint.
 */
async function ensureCellsTable(db: AsyncDuckDB, attrs: GeoZarrAttrs): Promise<void> {
  const [lonStep, , lonOrigin, , latStep, latOrigin] = attrs["spatial:transform"] as number[];
  const [height, width] = attrs["spatial:shape"];
  const key = JSON.stringify(attrs["spatial:transform"]) + attrs["spatial:shape"].join("x");
  if (cellsKey === key) return;
  const halfLon = Math.abs(lonStep!) / 2;
  const halfLat = Math.abs(latStep!) / 2;
  const conn = await db.connect();
  try {
    await conn.query(`
      CREATE OR REPLACE TABLE cells AS
      SELECT r::USMALLINT AS r, c::USMALLINT AS c,
             ST_MakeEnvelope(lon - ${halfLon}, lat - ${halfLat}, lon + ${halfLon}, lat + ${halfLat}) AS geom
      FROM (
        SELECT r, c, ${latOrigin} + r * ${latStep} AS lat, ${lonOrigin} + c * ${lonStep} AS lon
        FROM range(${height}) AS rows(r), range(${width}) AS cols(c)
      )
    `);
    cellsKey = key;
  } finally {
    await conn.close();
  }
}

/** Per-state cell overlaps, built once per state + window. */
const overlapTables = new Map<string, Promise<{ table: string; nCells: number; coverage: number }>>();

/**
 * The cells a state touches, with each one's overlap fraction (`w`), and how
 * much of the state lies inside the loaded window at all.
 */
function stateOverlap(db: AsyncDuckDB, stateId: number, window: GridWindow, attrs: GeoZarrAttrs) {
  const key = `${stateId}:${window.r0}:${window.r1}:${window.c0}:${window.c1}`;
  let promise = overlapTables.get(key);
  if (!promise) {
    promise = (async () => {
      await Promise.all([ensureStatesTable(db), ensureCellsTable(db, attrs)]);
      const table = `state_cells_${stateId}_${window.r0}_${window.c0}`;
      const [west, south, east, north] = windowBounds(window);
      const conn = await db.connect();
      try {
        await conn.query(`
          CREATE OR REPLACE TABLE "${table}" AS
          SELECT c.r, c.c, ST_Area(ST_Intersection(c.geom, s.geom)) / ST_Area(c.geom) AS w
          FROM cells c JOIN states s ON ST_Intersects(c.geom, s.geom)
          WHERE s.id = ${Number(stateId)}
        `);
        const result = await conn.query(`
          SELECT (SELECT count(*) FROM "${table}") AS n_cells,
                 ST_Area(ST_Intersection(geom, ST_MakeEnvelope(${west}, ${south}, ${east}, ${north})))
                   / ST_Area(geom) AS coverage
          FROM states WHERE id = ${Number(stateId)}
        `);
        return {
          table,
          nCells: Number(result.getChild("n_cells")!.get(0)),
          coverage: Number(result.getChild("coverage")!.get(0) ?? 0),
        };
      } finally {
        await conn.close();
      }
    })();
    promise.catch(() => overlapTables.delete(key));
    overlapTables.set(key, promise);
  }
  return promise;
}

export type AreaPoint = {
  /** Lead-time index. */
  t: number;
  /** Area-weighted mean (by each cell's overlap fraction). */
  mean: number | null;
  min: number | null;
  max: number | null;
  /** Cells with a value at this lead time. */
  nValid: number;
};

export type AreaStats = {
  points: AreaPoint[];
  /** Grid cells touching the state inside the loaded window. */
  nCells: number;
  /** Fraction (0–1) of the state's area inside the loaded window. */
  coverage: number;
};

/**
 * Per-lead-time mean/min/max of one variable over one state. Min/max take
 * every cell the state touches; the mean weights each by its overlap.
 * @param table A variable table from `loadVariableTable`.
 */
export async function computeAreaStats(args: {
  db: AsyncDuckDB;
  table: string;
  stateId: number;
  window: GridWindow;
  attrs: GeoZarrAttrs;
}): Promise<AreaStats> {
  const { db, table, stateId, window, attrs } = args;
  const overlap = await stateOverlap(db, stateId, window, attrs);
  if (overlap.nCells === 0) return { points: [], nCells: 0, coverage: overlap.coverage };
  const conn = await db.connect();
  try {
    // Widened to DOUBLE so the weighted sums run in double precision.
    const result = await conn.query(`
      SELECT z.t::INTEGER AS t,
             sum(z.v::DOUBLE * o.w) FILTER (WHERE NOT isnan(z.v))
               / sum(o.w) FILTER (WHERE NOT isnan(z.v)) AS mean,
             min(z.v::DOUBLE) FILTER (WHERE NOT isnan(z.v)) AS min,
             max(z.v::DOUBLE) FILTER (WHERE NOT isnan(z.v)) AS max,
             count(*) FILTER (WHERE NOT isnan(z.v))::INTEGER AS n_valid
      FROM "${table}" z JOIN "${overlap.table}" o USING (r, c)
      GROUP BY z.t ORDER BY z.t
    `);
    const col = (name: string) => result.getChild(name)!;
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const points = Array.from({ length: result.numRows }, (_, i) => ({
      t: Number(col("t").get(i)),
      mean: num(col("mean").get(i)),
      min: num(col("min").get(i)),
      max: num(col("max").get(i)),
      nValid: Number(col("n_valid").get(i)),
    }));
    return { points, nCells: overlap.nCells, coverage: overlap.coverage };
  } finally {
    await conn.close();
  }
}
