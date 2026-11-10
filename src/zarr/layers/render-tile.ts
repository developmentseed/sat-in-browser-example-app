import type { MinimalTileData, RasterModule, RenderTileResult } from "@developmentseed/deck.gl-raster";
import { Colormap, LinearRescale } from "@developmentseed/deck.gl-raster/gpu-modules";
import type { Device, Texture } from "@luma.gl/core";
import { FilterRange } from "./gpu/filter-range";
import { SampleTexture2DArray } from "./gpu/sample-texture-2d-array";

/** One uploaded grid: what the render pipeline samples. */
export type RasterTileData = MinimalTileData & {
  /** r32float Texture2DArray, depth = number of lead times. */
  texture: Texture;
  device: Device;
  latStart: number;
  latEnd: number;
  lonStart: number;
  lonEnd: number;
};

/** Arguments for {@link makeRenderTile}. */
export type MakeRenderTileArgs = {
  /** Current lead-time index (animation frame). */
  leadIdx: number;
  /** Colormap sprite texture (2d-array). */
  colormapTexture: Texture;
  /** Which layer of the sprite to sample. */
  colormapIndex: number;
  colormapReversed: boolean;
  /** Value mapped to the bottom of the colormap (display units). */
  rescaleMin: number;
  /** Value mapped to the top of the colormap. */
  rescaleMax: number;
  /** Discard cells below this value (before rescaling clamps it). */
  hideBelow?: number;
};

/**
 * Builds a renderTile callback that samples the grid's Texture2DArray at the
 * current lead time, rescales to [0, 1] and applies a colormap — all on the
 * GPU, so scrubbing lead time re-renders without re-querying. A trimmed-down
 * awii `makeRenderTile`: no AOI mask, adaptive rescale or viewport stats.
 */
export function makeRenderTile(args: MakeRenderTileArgs) {
  const { leadIdx, colormapTexture, colormapIndex, colormapReversed, rescaleMin, rescaleMax, hideBelow } =
    args;
  return function renderTile(data: RasterTileData): RenderTileResult {
    const pipeline: RasterModule[] = [
      // Discards NaN cells (e.g. lead times the run hasn't reached yet).
      { module: SampleTexture2DArray, props: { dataTex: data.texture, layerIndex: leadIdx } },
      ...(hideBelow !== undefined
        ? [{ module: FilterRange, props: { filterMin: hideBelow, filterMax: 3.4e38 } }]
        : []),
      { module: LinearRescale, props: { rescaleMin, rescaleMax } },
      { module: Colormap, props: { colormapTexture, colormapIndex, reversed: colormapReversed } },
    ];
    return { renderPipeline: pipeline };
  };
}
