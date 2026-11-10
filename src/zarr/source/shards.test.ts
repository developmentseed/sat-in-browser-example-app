import { describe, expect, it } from "vitest";
import type { ArrayMeta } from "./metadata";
import { crc32c, locateInnerChunk, shardLayout, singleChunkShard } from "./shards";

// The live store's temperature_2m metadata (trimmed).
const META: ArrayMeta = {
  node_type: "array",
  shape: [950, 85, 51, 721, 1440],
  data_type: "float32",
  chunk_grid: { name: "regular", configuration: { chunk_shape: [1, 85, 51, 320, 320] } },
  chunk_key_encoding: { name: "default", configuration: { separator: "/" } },
  fill_value: "NaN",
  codecs: [
    {
      name: "sharding_indexed",
      configuration: {
        chunk_shape: [1, 85, 51, 32, 32],
        codecs: [
          { name: "bytes", configuration: { endian: "little" } },
          {
            name: "blosc",
            configuration: { typesize: 4, cname: "zstd", clevel: 3, shuffle: "shuffle", blocksize: 0 },
          },
        ],
        index_codecs: [{ name: "bytes", configuration: { endian: "little" } }, { name: "crc32c" }],
        index_location: "end",
      },
    },
  ],
  attributes: {},
};

describe("crc32c", () => {
  it("matches the standard check value", () => {
    expect(crc32c(new TextEncoder().encode("123456789"))).toBe(0xe3069283);
  });
});

describe("shardLayout", () => {
  it("reads 10 x 10 inner chunks per shard and a 1604-byte index", () => {
    const layout = shardLayout(META);
    expect(layout.chunksPerShard).toEqual([1, 1, 1, 10, 10]);
    expect(layout.indexBytes).toBe(100 * 16 + 4);
  });
});

describe("locateInnerChunk", () => {
  it("finds the inner chunk over Missouri (38°N, 88°W) in shard 0/1", () => {
    // Verified against the live store: row 208, col 368 → inner (6, 11).
    const { shardKey, slot } = locateInnerChunk("temperature_2m", shardLayout(META), [949, 0, 0, 6, 11]);
    expect(shardKey).toBe("temperature_2m/c/949/0/0/0/1");
    expect(slot).toBe(6 * 10 + 1);
  });
});

describe("singleChunkShard", () => {
  it("appends a one-entry index and its crc32c", () => {
    const chunk = new Uint8Array([1, 2, 3, 4, 5]);
    const shard = singleChunkShard(chunk);
    expect(shard.length).toBe(5 + 20);
    const view = new DataView(shard.buffer);
    expect(view.getBigUint64(5, true)).toBe(0n);
    expect(view.getBigUint64(13, true)).toBe(5n);
    expect(view.getUint32(21, true)).toBe(crc32c(shard.subarray(5, 21)));
  });
});
