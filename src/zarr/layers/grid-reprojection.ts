import type { RasterLayerProps } from "@developmentseed/deck.gl-raster";
import type { GeoZarrAttrs } from "../source/aoi";

// The math `ZarrLayer`/`RasterTileLayer` do per tile, for one whole-grid
// image: pixel <-> lon/lat from the grid's affine transform, then lon/lat
// <-> deck.gl's Web Mercator common space (a 512-unit world). Only
// EPSG:4326 grids, which is all the forecast stores are.

/** deck.gl's common-space world size, in units (`TILE_SIZE` upstream). */
const WORLD_SIZE = 512;
const DEG = Math.PI / 180;

/**
 * lon/lat -> Web Mercator common space. Latitude is clamped to the Mercator
 * band (±85.051°) like upstream's `rescaleEPSG3857ToCommonSpace`.
 */
function lngLatToCommon(lon: number, lat: number): [number, number] {
  const clampedLat = Math.max(-85.05112877980659, Math.min(85.05112877980659, lat));
  const x = (lon / 360 + 0.5) * WORLD_SIZE;
  const mercator = Math.log(Math.tan(Math.PI / 4 + (clampedLat * DEG) / 2));
  const y = (mercator / (2 * Math.PI) + 0.5) * WORLD_SIZE;
  return [x, y];
}

/** Web Mercator common space -> lon/lat. */
function commonToLngLat(x: number, y: number): [number, number] {
  const lon = (x / WORLD_SIZE - 0.5) * 360;
  const mercator = (y / WORLD_SIZE - 0.5) * 2 * Math.PI;
  const lat = (2 * Math.atan(Math.exp(mercator)) - Math.PI / 2) / DEG;
  return [lon, lat];
}

const identity = (x: number, y: number): [number, number] => [x, y];

/** `@developmentseed/raster-reproject`'s type, via the one package we depend on directly. */
type ReprojectionFns = RasterLayerProps["reprojectionFns"];

/** `RasterLayer` reprojection functions for both view kinds. */
export type GridReprojection = {
  /** Web Mercator map: mesh in common space, `coordinateSystem: "cartesian"`. */
  readonly mercator: ReprojectionFns;
  /** Globe view: mesh in lon/lat, `coordinateSystem: "lnglat"`. */
  readonly globe: ReprojectionFns;
};

/**
 * Reprojection for a whole `spatial:shape` grid drawn as one image. Pixel
 * coordinates run over `[0, width] x [0, height]` with pixel (i, j) covering
 * `[i, i+1] x [j, j+1]`; `"node"` registration puts the transform's origin
 * at the *center* of pixel (0, 0), so its corner sits half a step before.
 * @param attrs The grid's georeferencing (must be EPSG:4326).
 * @returns Reference-stable functions per view kind — build once per grid,
 * since `RasterLayer` regenerates its mesh whenever they change.
 */
export function gridReprojection(attrs: GeoZarrAttrs): GridReprojection {
  if (attrs["proj:code"] !== "EPSG:4326") {
    throw new Error(`Only EPSG:4326 grids are supported, got ${attrs["proj:code"]}`);
  }
  const [lonStep, , lonOrigin, , latStep, latOrigin] = attrs["spatial:transform"] as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const half = attrs["spatial:registration"] === "node" ? 0.5 : 0;
  const forwardTransform = (px: number, py: number): [number, number] => [
    lonOrigin + (px - half) * lonStep,
    latOrigin + (py - half) * latStep,
  ];
  const inverseTransform = (lon: number, lat: number): [number, number] => [
    (lon - lonOrigin) / lonStep + half,
    (lat - latOrigin) / latStep + half,
  ];
  return {
    mercator: {
      forwardTransform,
      inverseTransform,
      forwardReproject: lngLatToCommon,
      inverseReproject: commonToLngLat,
    },
    globe: {
      forwardTransform,
      inverseTransform,
      forwardReproject: identity,
      inverseReproject: identity,
    },
  };
}
