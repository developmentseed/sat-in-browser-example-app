import { tableFromArrays } from "apache-arrow";
import { describe, expect, it } from "vitest";
import { gridFromArrow } from "./zarr-table";

describe("gridFromArrow", () => {
  const size = { depth: 2, height: 1, width: 2 };

  it("copies a complete, ordered result straight through", () => {
    const table = tableFromArrays({
      t: new Uint16Array([0, 0, 1, 1]),
      r: new Uint16Array([0, 0, 0, 0]),
      c: new Uint16Array([0, 1, 0, 1]),
      v: new Float32Array([1, 2, 3, 4]),
    });
    expect(Array.from(gridFromArrow(table, size))).toEqual([1, 2, 3, 4]);
  });

  it("places sparse rows by index and leaves the rest NaN", () => {
    const table = tableFromArrays({
      t: new Uint16Array([1]),
      r: new Uint16Array([0]),
      c: new Uint16Array([0]),
      v: new Float32Array([7]),
    });
    const out = Array.from(gridFromArrow(table, size));
    expect(out[2]).toBe(7);
    expect(out.filter(Number.isNaN)).toHaveLength(3);
  });
});
