import type { Texture } from "@luma.gl/core";
import type { GeoZarrAttrs } from "../source/aoi";
import { makeRenderTile } from "./render-tile";
import { type GridValues, TableRasterLayer } from "./table-raster-layer";

/** Arguments for {@link buildRasterLayer}. */
export type BuildRasterLayerArgs = {
  /** The whole variable over the AOI, every lead time, read from its DuckDB table. */
  values: GridValues;
  geoZarrAttrs: GeoZarrAttrs;
  /** Keys the layer's `id`, so switching variables discards the previous GPU data. */
  layerKey: string;
  leadIdx: number;
  rescaleRange: [number, number];
  colormapTexture: Texture;
  colormapIndex: number;
  colormapReversed: boolean;
  hideBelow?: number;
};

/** The deck.gl raster layer for one variable's animated grid. */
export function buildRasterLayer(args: BuildRasterLayerArgs): TableRasterLayer {
  const {
    values,
    geoZarrAttrs,
    layerKey,
    leadIdx,
    rescaleRange: [rescaleMin, rescaleMax],
    colormapTexture,
    colormapIndex,
    colormapReversed,
    hideBelow,
  } = args;
  return new TableRasterLayer({
    id: `forecast-${layerKey}`,
    values,
    geoZarrAttrs,
    opacity: 0.8,
    renderTile: makeRenderTile({
      leadIdx,
      colormapTexture,
      colormapIndex,
      colormapReversed,
      rescaleMin,
      rescaleMax,
      hideBelow,
    }),
    updateTriggers: {
      renderTile: [leadIdx, rescaleMin, rescaleMax, colormapIndex, colormapReversed, hideBelow],
    },
  });
}
