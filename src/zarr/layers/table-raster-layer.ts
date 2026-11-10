import {
  CompositeLayer,
  type CompositeLayerProps,
  type DefaultProps,
  type UpdateParameters,
} from "@deck.gl/core";
import { RasterLayer, type RenderTileResult } from "@developmentseed/deck.gl-raster";
import type { GeoZarrAttrs } from "../source/aoi";
import { type GridReprojection, gridReprojection } from "./grid-reprojection";
import type { RasterTileData } from "./render-tile";

/** A whole variable, every datetime: `depth * height * width` values in `[t, row, col]` order. */
export type GridValues = {
  readonly data: Float32Array;
  readonly depth: number;
  readonly height: number;
  readonly width: number;
};

export type TableRasterLayerProps = CompositeLayerProps & {
  /** The variable's values, e.g. from a DuckDB table via `queryTile`. */
  values: GridValues;
  /** Georeferencing of the grid `values` covers. */
  geoZarrAttrs: GeoZarrAttrs;
  /** Builds the GPU pipeline from the grid texture — `makeRenderTile`'s output. */
  renderTile: (data: RasterTileData) => RenderTileResult;
};

const defaultProps: DefaultProps<TableRasterLayerProps> = {
  // Required props; `null` placeholders keep deck.gl's prop diffing typed.
  values: { type: "object", value: null as unknown as GridValues, compare: false },
  geoZarrAttrs: { type: "object", value: null as unknown as GeoZarrAttrs, compare: false },
  renderTile: {
    type: "function",
    value: null as unknown as TableRasterLayerProps["renderTile"],
    compare: false,
  },
};

type State = {
  /** One Texture2DArray for the whole grid, shaped like a single raster tile. */
  grid?: RasterTileData;
  reprojection?: GridReprojection;
};

/**
 * Draws a whole grid that's already in memory (no tiling) with
 * deck.gl-raster's `RasterLayer`: one r32float Texture2DArray holds every
 * datetime, and the same render pipeline the tiled `ZarrLayer` uses
 * (`makeRenderTile`) samples it, so scrubbing time, the colormap, the
 * valid-range filter and rescale all
 * run on the GPU without re-querying. Meant for small grids such as the AOI
 * store DuckDB reads (275 x 188 x 49 ≈ 10 MB).
 */
export class TableRasterLayer extends CompositeLayer<TableRasterLayerProps> {
  static layerName = "TableRasterLayer";
  static defaultProps = defaultProps;

  declare state: State;

  override initializeState(): void {
    this.setState({});
  }

  override updateState({ props, oldProps }: UpdateParameters<this>): void {
    if (props.values !== oldProps.values) {
      this.destroyGrid();
      const { data, depth, height, width } = props.values;
      const device = this.context.device;
      const texture = device.createTexture({
        dimension: "2d-array",
        format: "r32float",
        width,
        height,
        depth,
        mipLevels: 1,
        data,
        sampler: {
          minFilter: "nearest",
          magFilter: "nearest",
          addressModeU: "clamp-to-edge",
          addressModeV: "clamp-to-edge",
        },
      });
      // The whole grid is one "tile" spanning every row and column, so
      // `makeRenderTile`'s AOI-mask slicing takes the full mask as-is.
      const grid: RasterTileData = {
        texture,
        device,
        latStart: 0,
        latEnd: height,
        lonStart: 0,
        lonEnd: width,
        width,
        height,
        byteLength: data.byteLength,
      };
      this.setState({ grid });
    }
    if (props.geoZarrAttrs !== oldProps.geoZarrAttrs) {
      // Reference-stable per grid: RasterLayer rebuilds its mesh whenever
      // the reprojection functions change.
      this.setState({ reprojection: gridReprojection(props.geoZarrAttrs) });
    }
  }

  override finalizeState(): void {
    this.destroyGrid();
  }

  private destroyGrid(): void {
    const grid = this.state.grid;
    grid?.texture.destroy();
    this.state.grid = undefined;
  }

  override renderLayers() {
    const { grid, reprojection } = this.state;
    if (!grid || !reprojection) return null;
    const { renderPipeline } = this.props.renderTile(grid);
    // Same switch `RasterTileLayer` makes per tile: a globe viewport has a
    // `resolution`, and wants the mesh in lon/lat instead of common space.
    const isGlobe = (this.context.viewport as { resolution?: number }).resolution !== undefined;
    return new RasterLayer(
      this.getSubLayerProps({
        id: "raster",
        width: grid.width,
        height: grid.height,
        renderPipeline,
        reprojectionFns: isGlobe ? reprojection.globe : reprojection.mercator,
        coordinateSystem: isGlobe ? "lnglat" : "cartesian",
      }),
    );
  }
}
