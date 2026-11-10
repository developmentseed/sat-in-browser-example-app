import { describe, expect, it } from "vitest";
import { AOI_BBOX } from "../../config";
import { snapBbox, windowBounds, windowGeoZarrAttrs } from "./aoi";

describe("snapBbox", () => {
  it("snaps the default contiguous-US AOI to 9 x 4 inner chunks", () => {
    const w = snapBbox(AOI_BBOX, 32);
    expect(w).toEqual({ r0: 160, r1: 288, c0: 192, c1: 480 });
    expect(((w.r1 - w.r0) / 32) * ((w.c1 - w.c0) / 32)).toBe(36);
  });

  it("snaps a central-US box to 3 x 3 inner chunks covering Missouri", () => {
    const w = snapBbox([-104, 30, -85, 46], 32);
    expect(w).toEqual({ r0: 160, r1: 256, c0: 288, c1: 384 });
    const [west, south, east, north] = windowBounds(w);
    // Cell edges: lon −108.125…−84.125, lat 26.125…50.125.
    expect([west, south, east, north]).toEqual([-108.125, 26.125, -84.125, 50.125]);
    // Missouri: ~36–40.6°N, 95.8–89.1°W.
    expect(west < -95.8 && east > -89.1 && south < 36 && north > 40.6).toBe(true);
  });

  it("includes a cell whose centre sits exactly on the bbox edge", () => {
    // −84 is the centre of col 384, the first col of the next inner chunk.
    expect(snapBbox([-104, 30, -84, 46], 32).c1).toBe(416);
  });

  it("clips to the grid at the south pole and the antimeridian", () => {
    expect(snapBbox([170, -90, 179.75, -80], 32)).toEqual({ r0: 672, r1: 721, c0: 1376, c1: 1440 });
  });

  it("rejects an inverted bbox", () => {
    expect(() => snapBbox([10, 0, 0, 10], 32)).toThrow();
  });
});

describe("windowGeoZarrAttrs", () => {
  it("puts row 0 at the window's northern edge with a negative lat step", () => {
    const attrs = windowGeoZarrAttrs({ r0: 160, r1: 256, c0: 288, c1: 384 });
    expect(attrs["spatial:transform"]).toEqual([0.25, 0, -108, 0, -0.25, 50]);
    expect(attrs["spatial:shape"]).toEqual([96, 96]);
  });
});
