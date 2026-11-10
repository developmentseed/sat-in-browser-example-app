import { SOURCE_URL } from "../../config";
import type { ArrayMeta, Codec } from "./metadata";

// Range-reads single inner chunks out of the store's sharded arrays, and
// repacks raw chunk bytes as tiny one-chunk shards that DuckDB's
// `duckdb_zarr` can decode. Nothing here decodes data: the inner chunks stay
// blosc-compressed until DuckDB reads them.

/** An index entry (offset and nbytes both) set to this means "chunk absent". */
const MISSING = 0xffff_ffff_ffff_ffffn;

// ---------------------------------------------------------------- crc32c

const CRC32C_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32C (Castagnoli), as the zarr `crc32c` codec computes it. */
export function crc32c(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC32C_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- layout

/** What reading one sharded array needs from its metadata. */
export type ShardLayout = {
  /** Outer chunk (shard) shape. */
  shardShape: number[];
  /** Inner chunk shape. */
  innerShape: number[];
  /** Inner chunks per shard, per dimension. */
  chunksPerShard: number[];
  /** The inner chunks' own codecs (e.g. bytes + blosc). */
  innerCodecs: Codec[];
  /** Index byte length at the shard's end: 16 bytes per inner chunk (+4 with crc32c). */
  indexBytes: number;
  separator: string;
};

/** Reads the `sharding_indexed` layout off an array's metadata; throws for anything else. */
export function shardLayout(meta: ArrayMeta): ShardLayout {
  const sharding = meta.codecs[0];
  if (meta.codecs.length !== 1 || sharding?.name !== "sharding_indexed") {
    throw new Error("Expected an array with a single sharding_indexed codec");
  }
  const config = sharding.configuration as {
    chunk_shape: number[];
    codecs: Codec[];
    index_codecs: Codec[];
    index_location?: "start" | "end";
  };
  if ((config.index_location ?? "end") !== "end") throw new Error("Only end-of-shard indexes are supported");
  const shardShape = meta.chunk_grid.configuration.chunk_shape;
  const innerShape = config.chunk_shape;
  const chunksPerShard = shardShape.map((s, i) => s / innerShape[i]!);
  const count = chunksPerShard.reduce((a, b) => a * b, 1);
  const hasCrc = config.index_codecs.some((c) => c.name === "crc32c");
  return {
    shardShape,
    innerShape,
    chunksPerShard,
    innerCodecs: config.codecs,
    indexBytes: count * 16 + (hasCrc ? 4 : 0),
    separator: meta.chunk_key_encoding.configuration?.separator ?? "/",
  };
}

/** Where an inner chunk lives: its shard's key, and its slot in that shard's index. */
export function locateInnerChunk(
  variable: string,
  layout: ShardLayout,
  innerCoords: readonly number[],
): { shardKey: string; slot: number } {
  const shardCoords = innerCoords.map((c, i) => Math.floor(c / layout.chunksPerShard[i]!));
  let slot = 0;
  innerCoords.forEach((c, i) => {
    slot = slot * layout.chunksPerShard[i]! + (c % layout.chunksPerShard[i]!);
  });
  return { shardKey: `${variable}/c${layout.separator}${shardCoords.join(layout.separator)}`, slot };
}

// ---------------------------------------------------------------- fetching

async function fetchRange(key: string, range: string): Promise<Uint8Array | null> {
  const resp = await fetch(new URL(key, SOURCE_URL), { headers: { Range: `bytes=${range}` } });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Failed to fetch ${key} (${range}): ${resp.status} ${resp.statusText}`);
  return new Uint8Array(await resp.arrayBuffer());
}

/** Per shard: `[offset, nbytes]` pairs, one per inner chunk slot, or null if the shard is missing. */
type ShardIndex = BigUint64Array | null;

const shardIndexCache = new Map<string, Promise<ShardIndex>>();

/** The shard's index (its last `indexBytes` bytes), fetched once per shard. */
export function readShardIndex(shardKey: string, layout: ShardLayout): Promise<ShardIndex> {
  let promise = shardIndexCache.get(shardKey);
  if (!promise) {
    promise = (async () => {
      const bytes = await fetchRange(shardKey, `-${layout.indexBytes}`);
      if (!bytes) return null;
      const entries = (layout.indexBytes - (layout.indexBytes % 16)) / 8;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const out = new BigUint64Array(entries);
      for (let i = 0; i < entries; i++) out[i] = view.getBigUint64(i * 8, true);
      return out;
    })();
    promise.catch(() => shardIndexCache.delete(shardKey));
    shardIndexCache.set(shardKey, promise);
  }
  return promise;
}

/** Whether an inner chunk is present, from its shard index alone (no chunk download). */
export async function hasInnerChunk(
  variable: string,
  layout: ShardLayout,
  innerCoords: readonly number[],
): Promise<boolean> {
  const { shardKey, slot } = locateInnerChunk(variable, layout, innerCoords);
  const index = await readShardIndex(shardKey, layout);
  return !!index && index[slot * 2] !== MISSING;
}

/** One inner chunk's still-encoded bytes, via its shard's index, or null if absent. */
export async function fetchInnerChunk(
  variable: string,
  layout: ShardLayout,
  innerCoords: readonly number[],
): Promise<Uint8Array | null> {
  const { shardKey, slot } = locateInnerChunk(variable, layout, innerCoords);
  const index = await readShardIndex(shardKey, layout);
  if (!index) return null;
  const offset = index[slot * 2]!;
  const nbytes = index[slot * 2 + 1]!;
  if (offset === MISSING) return null;
  return fetchRange(shardKey, `${offset}-${offset + nbytes - 1n}`);
}

/** A whole unsharded chunk (e.g. a coordinate array's only chunk). */
export async function fetchChunk(key: string): Promise<Uint8Array> {
  const resp = await fetch(new URL(key, SOURCE_URL));
  if (!resp.ok) throw new Error(`Failed to fetch ${key}: ${resp.status} ${resp.statusText}`);
  return new Uint8Array(await resp.arrayBuffer());
}

// ---------------------------------------------------------------- repacking

/**
 * Wraps one encoded chunk as a shard holding just that chunk: the bytes,
 * then a one-entry index `(offset 0, nbytes)`, then the index's crc32c.
 * `duckdb_zarr` decodes blosc only inside `sharding_indexed`, so this is how
 * blosc chunks (sharded or not in the source) get into DuckDB.
 */
export function singleChunkShard(chunk: Uint8Array): Uint8Array {
  const out = new Uint8Array(chunk.length + 20);
  out.set(chunk, 0);
  const index = new DataView(out.buffer, chunk.length, 16);
  index.setBigUint64(0, 0n, true);
  index.setBigUint64(8, BigInt(chunk.length), true);
  const crc = crc32c(out.subarray(chunk.length, chunk.length + 16));
  new DataView(out.buffer).setUint32(chunk.length + 16, crc, true);
  return out;
}

/**
 * A local array's `zarr.json` whose every chunk is a {@link singleChunkShard}.
 * `fill_value` is numeric because `duckdb_zarr` rejects `"NaN"`; callers only
 * register stores whose chunks are all present, so it's never used.
 */
export function singleChunkShardArrayJson(args: {
  shape: number[];
  chunkShape: number[];
  dataType: string;
  innerCodecs: Codec[];
  dimensionNames?: string[];
}): Record<string, unknown> {
  return {
    zarr_format: 3,
    node_type: "array",
    shape: args.shape,
    data_type: args.dataType,
    chunk_grid: { name: "regular", configuration: { chunk_shape: args.chunkShape } },
    chunk_key_encoding: { name: "default", configuration: { separator: "/" } },
    fill_value: 0,
    codecs: [
      {
        name: "sharding_indexed",
        configuration: {
          chunk_shape: args.chunkShape,
          codecs: args.innerCodecs,
          index_codecs: [{ name: "bytes", configuration: { endian: "little" } }, { name: "crc32c" }],
          index_location: "end",
        },
      },
    ],
    ...(args.dimensionNames ? { dimension_names: args.dimensionNames } : {}),
    attributes: {},
  };
}
