import type { AsyncDuckDB } from "@duckdb/duckdb-wasm";
import type { Table } from "apache-arrow";
import type { GridWindow } from "../source/aoi";
import { arrayMeta, type StoreMetadata } from "../source/metadata";
import {
  fetchChunk,
  fetchInnerChunk,
  hasInnerChunk,
  shardLayout,
  singleChunkShard,
  singleChunkShardArrayJson,
  type ShardLayout,
} from "../source/shards";

// Data path, adapted from awii-app's frontend/src/zarr/duckdb/zarr-table.ts:
// JS fetches still-encoded bytes and registers them in DuckDB's in-memory
// filesystem as a small *synthetic* Zarr v3 store, and the `duckdb_zarr`
// community extension decodes it with `zarr_cells`. Registering buffers
// (rather than letting the extension read over HTTP) sidesteps its remote
// reads, which corrupt larger chunks in DuckDB-Wasm. The synthetic store
// exists because the source shards are ~250 MB: we range-read only the
// inner chunks the AOI needs, and give each one its own one-chunk shard.

let extensionPromise: Promise<void> | null = null;

/**
 * Installs and loads `duckdb_zarr` once per page. `INSTALL … FROM community`
 * has to run each session: without it, `LOAD` looks in the core extension
 * repository, which doesn't carry it.
 */
export function ensureZarrExtension(db: AsyncDuckDB): Promise<void> {
  if (!extensionPromise) {
    extensionPromise = (async () => {
      const conn = await db.connect();
      try {
        await conn.query(`INSTALL duckdb_zarr FROM community`);
        await conn.query(`LOAD duckdb_zarr`);
      } finally {
        await conn.close();
      }
    })();
    // Don't cache a failure (e.g. offline), so a later attempt can retry.
    extensionPromise.catch(() => {
      extensionPromise = null;
    });
  }
  return extensionPromise;
}

const sqlString = (s: string) => `'${s.replaceAll("'", "''")}'`;
const encodeJson = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

// Each synthetic store *is* one array: its `zarr.json` sits at the store
// root and `zarr_cells` is called with array path ''. For a local v3 store
// whose root is a group, the extension walks subdirectories with
// `ListFiles`, which DuckDB-Wasm's virtual filesystem of registered buffers
// can't do; an array root is read straight from its `zarr.json`.

/**
 * Registers `files` under `root` in DuckDB's virtual filesystem, runs `use`,
 * then drops them again — the tables hold decoded values, so the encoded
 * copies only need to live for the scan.
 */
async function withRegisteredStore<T>(
  db: AsyncDuckDB,
  root: string,
  files: ReadonlyMap<string, Uint8Array>,
  use: () => Promise<T>,
): Promise<T> {
  const names: string[] = [];
  try {
    for (const [key, bytes] of files) {
      const name = `${root}/${key}`;
      // registerFileBuffer transfers the buffer to the worker.
      await db.registerFileBuffer(name, bytes);
      names.push(name);
    }
    return await use();
  } finally {
    await Promise.all(names.map((name) => db.dropFile(name)));
  }
}

// ---------------------------------------------------------------- coordinates

/**
 * Reads a whole 1-D coordinate array (e.g. `init_time`, `lead_time`) through
 * DuckDB. These arrays are unsharded blosc, which `duckdb_zarr` only decodes
 * inside a shard — so each source chunk is wrapped as a one-chunk shard.
 * @returns The values in index order.
 */
export async function readCoordinate(
  db: AsyncDuckDB,
  metadata: StoreMetadata,
  name: string,
): Promise<number[]> {
  const meta = arrayMeta(metadata, name);
  if (meta.shape.length !== 1) throw new Error(`"${name}" is not 1-D`);
  const [size] = meta.shape as [number];
  const [chunk] = meta.chunk_grid.configuration.chunk_shape as [number];
  const sep = meta.chunk_key_encoding.configuration?.separator ?? "/";
  const count = Math.ceil(size / chunk);
  const chunks = await Promise.all(
    Array.from({ length: count }, (_, i) => fetchChunk(`${name}/c${sep}${i}`)),
  );
  const coordJson = singleChunkShardArrayJson({
    shape: meta.shape,
    chunkShape: [chunk],
    dataType: meta.data_type,
    innerCodecs: meta.codecs,
  });
  const files = new Map<string, Uint8Array>([
    ["zarr.json", encodeJson(coordJson)],
    ...chunks.map((bytes, i) => [`c/${i}`, singleChunkShard(bytes)] as const),
  ]);
  const root = `coord_${name}`;
  await ensureZarrExtension(db);
  return withRegisteredStore(db, root, files, async () => {
    const conn = await db.connect();
    try {
      // No ORDER BY/LIMIT here: `zarr_cells` rejects the top-N filter that
      // pushes down. Sort the (small) result in JS instead.
      const result = await conn.query(
        `SELECT dim_0::BIGINT AS i, value::DOUBLE AS v FROM zarr_cells(${sqlString(root)}, '', 'v3')`,
      );
      const out = new Array<number>(size).fill(NaN);
      const i = result.getChild("i")!;
      const v = result.getChild("v")!;
      for (let row = 0; row < result.numRows; row++) {
        out[Number(i.get(row))] = Number(v.get(row));
      }
      return out;
    } finally {
      await conn.close();
    }
  });
}

// ---------------------------------------------------------------- variables

/** The inner-chunk coordinates (5-D) covering a window at one init time. */
function innerChunksFor(layout: ShardLayout, initIdx: number, w: GridWindow): number[][] {
  const [, , , latChunk, lonChunk] = layout.innerShape as [number, number, number, number, number];
  if (w.r0 % latChunk || w.c0 % lonChunk) throw new Error("Window must start on an inner-chunk boundary");
  const coords: number[][] = [];
  for (let ir = w.r0 / latChunk; ir < Math.ceil(w.r1 / latChunk); ir++) {
    for (let ic = w.c0 / lonChunk; ic < Math.ceil(w.c1 / lonChunk); ic++) {
      coords.push([initIdx, 0, 0, ir, ic]);
    }
  }
  return coords;
}

/**
 * The newest init time whose every inner chunk over `window` exists, judged
 * from shard indexes alone. The newest run is often still being written.
 * @returns An index into the `init_time` dimension.
 */
export async function latestCompleteInit(
  metadata: StoreMetadata,
  variable: string,
  window: GridWindow,
  lookback = 3,
): Promise<number> {
  const meta = arrayMeta(metadata, variable);
  const layout = shardLayout(meta);
  const newest = meta.shape[0]! - 1;
  for (let init = newest; init >= Math.max(0, newest - lookback); init--) {
    const present = await Promise.all(
      innerChunksFor(layout, init, window).map((c) => hasInnerChunk(variable, layout, c)),
    );
    if (present.every(Boolean)) return init;
  }
  throw new Error(`No complete ${variable} run over the AOI in the last ${lookback + 1} init times`);
}

/** DuckDB table holding one variable at one init time. */
export function variableTableName(variable: string, initIdx: number): string {
  return `ecmwf_${variable.replace(/[^a-zA-Z0-9]+/g, "_")}_${initIdx}`;
}

export type LoadVariableArgs = {
  variable: string;
  initIdx: number;
  member: number;
  window: GridWindow;
  /** Multiplier applied while building the table (unit conversion). */
  scale?: number;
  onProgress?: (done: number, total: number) => void;
};

const tablePromises = new Map<string, Promise<string>>();

/**
 * Loads one variable over `window` into DuckDB as `(t, r, c, v)` rows — `t`
 * is the lead-time index, `r`/`c` the row/column inside the window — for a
 * single ensemble member. Built once per variable + init.
 * @returns The table name, once the table exists.
 */
export function loadVariableTable(
  db: AsyncDuckDB,
  metadata: StoreMetadata,
  args: LoadVariableArgs,
): Promise<string> {
  const { variable, initIdx, member, window, scale = 1, onProgress } = args;
  const table = variableTableName(variable, initIdx);
  let promise = tablePromises.get(table);
  if (!promise) {
    promise = (async () => {
      const meta = arrayMeta(metadata, variable);
      const layout = shardLayout(meta);
      const coords = innerChunksFor(layout, initIdx, window);
      const ir0 = window.r0 / layout.innerShape[3]!;
      const ic0 = window.c0 / layout.innerShape[4]!;

      let done = 0;
      onProgress?.(0, coords.length);
      const chunks = await Promise.all(
        coords.map(async (c) => {
          const bytes = await fetchInnerChunk(variable, layout, c);
          if (!bytes) throw new Error(`Missing ${variable} chunk ${c.join(".")}`);
          onProgress?.(++done, coords.length);
          return [c, bytes] as const;
        }),
      );

      const [, leads, members] = meta.shape as [number, number, number];
      const variableJson = singleChunkShardArrayJson({
        shape: [1, leads, members, window.r1 - window.r0, window.c1 - window.c0],
        chunkShape: layout.innerShape,
        dataType: meta.data_type,
        innerCodecs: layout.innerCodecs,
        dimensionNames: meta.dimension_names,
      });
      const files = new Map<string, Uint8Array>([
        ["zarr.json", encodeJson(variableJson)],
        ...chunks.map(
          ([[, , , ir, ic], bytes]) =>
            [`c/0/0/0/${ir! - ir0}/${ic! - ic0}`, singleChunkShard(bytes)] as const,
        ),
      ]);

      const root = `${table}_files`;
      await ensureZarrExtension(db);
      await withRegisteredStore(db, root, files, async () => {
        const conn = await db.connect();
        try {
          // The member filter pushes down into the scan. Unsorted: readers
          // order their own results.
          await conn.query(`
            CREATE OR REPLACE TABLE "${table}" AS
            SELECT dim_1::USMALLINT AS t, dim_3::USMALLINT AS r, dim_4::USMALLINT AS c,
                   (value * ${Number(scale)})::FLOAT AS v
            FROM zarr_cells(${sqlString(root)}, '', 'v3')
            WHERE dim_2 = ${Number(member)}
          `);
        } finally {
          await conn.close();
        }
      });
      return table;
    })();
    void promise.catch(() => tablePromises.delete(table));
    tablePromises.set(table, promise);
  }
  return promise;
}

// ---------------------------------------------------------------- reads

/** A grid's extent: `depth` lead times × `height` rows × `width` cols. */
export type GridSize = { depth: number; height: number; width: number };

/**
 * Turns a `(t, r, c, v)` result ordered by `t, r, c` into the `[t, r, c]`
 * row-major array the texture upload expects. Fast path: a complete,
 * null-free result is copied straight out of the Arrow buffer. Otherwise
 * each row is placed by its own indices and every unset or NULL cell is NaN,
 * which the raster's `isnan` discard drops. (From awii's `tileFromArrow`.)
 */
export function gridFromArrow(result: Table, size: GridSize): Float32Array {
  const { depth, height, width } = size;
  const total = depth * height * width;
  const values = result.getChild("v")!;
  if (result.numRows === total && values.nullCount === 0) {
    return Float32Array.from(values.toArray() as ArrayLike<number>);
  }
  const out = new Float32Array(total).fill(NaN);
  const t = result.getChild("t")!;
  const r = result.getChild("r")!;
  const c = result.getChild("c")!;
  for (let i = 0; i < result.numRows; i++) {
    const value = values.get(i) as number | null;
    if (value === null) continue;
    out[(Number(t.get(i)) * height + Number(r.get(i))) * width + Number(c.get(i))] = value;
  }
  return out;
}

/** Every cell and lead time of a variable table, as `[t, r, c]` float32. */
export async function queryGrid(db: AsyncDuckDB, table: string, size: GridSize): Promise<Float32Array> {
  const conn = await db.connect();
  try {
    const result = await conn.query(`SELECT t, r, c, v FROM "${table}" ORDER BY t, r, c`);
    return gridFromArrow(result, size);
  } finally {
    await conn.close();
  }
}

/** The table's 2nd–98th percentile over all lead times, ignoring NaN — an automatic colour range. */
export async function queryRange(db: AsyncDuckDB, table: string): Promise<[number, number]> {
  const conn = await db.connect();
  try {
    const result = await conn.query(`
      SELECT quantile_cont(v, 0.02) AS lo, quantile_cont(v, 0.98) AS hi
      FROM "${table}" WHERE NOT isnan(v)
    `);
    const lo = Number(result.getChild("lo")!.get(0));
    const hi = Number(result.getChild("hi")!.get(0));
    return lo < hi ? [lo, hi] : [lo, lo + 1];
  } finally {
    await conn.close();
  }
}
