import {
  COLORMAP_INDEX,
  createColormapTexture,
  decodeColormapSprite,
  type ColormapName,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import type { Device, Texture } from "@luma.gl/core";

export { COLORMAP_INDEX };
export type { ColormapName };

/** The colormap every zarr raster layer renders with today — no per-layer picker yet. */
export const DEFAULT_COLORMAP: ColormapName = "viridis";

/**
 * Fetches and decodes the colormap sprite shipped by `deck.gl-raster`. No
 * GPU device needed — safe to call before one exists.
 * @param url Sprite URL. Defaults to the bundled `deck.gl-raster` colormap sprite.
 * @returns Decoded sprite pixels, ready for `buildColormapTexture`.
 */
export async function loadColormapImage(url: string = colormapsPngUrl): Promise<ImageData> {
  const resp = await fetch(url);
  const bytes = await resp.arrayBuffer();
  return decodeColormapSprite(bytes);
}

/**
 * Uploads a decoded colormap sprite as a GPU texture.
 * @param device luma.gl GPU device.
 * @param image Decoded sprite from `loadColormapImage`.
 * @returns Texture to pass as `buildRasterLayer`'s `colormapTexture` arg.
 */
export function buildColormapTexture(device: Device, image: ImageData): Texture {
  return createColormapTexture(device, image);
}

/**
 * Samples one row of the decoded colormap sprite into a CSS gradient string,
 * for drawing the real colormap in the legend rather than a generic
 * two-stop placeholder.
 * @param image Decoded sprite from `loadColormapImage`.
 * @param colormapIndex Which sprite row (colormap) to sample — a `COLORMAP_INDEX` value.
 * @param reversed Sample the row back-to-front, matching a reversed render.
 * @param stops How many colors to sample across the row.
 * @returns A `linear-gradient(to right, ...)` CSS value.
 */
export function colormapGradientCss(
  image: ImageData,
  colormapIndex: number,
  reversed = false,
  stops = 8,
): string {
  const { data, width } = image;
  const colors = Array.from({ length: stops }, (_, i) => {
    const t = stops === 1 ? 0 : i / (stops - 1);
    const x = Math.round((reversed ? 1 - t : t) * (width - 1));
    const offset = (colormapIndex * width + x) * 4;
    return `rgb(${data[offset]} ${data[offset + 1]} ${data[offset + 2]})`;
  });
  return `linear-gradient(to right, ${colors.join(", ")})`;
}

/**
 * Samples one color from the decoded colormap sprite as an RGBA byte tuple —
 * the CPU-side counterpart to the raster layer's GPU sampling, for coloring
 * vector features by value (a choropleth's `getFillColor` accessor).
 * @param image Decoded sprite from `loadColormapImage`.
 * @param colormapIndex Which sprite row (colormap) to sample — a `COLORMAP_INDEX` value.
 * @param t Position along the ramp, 0-1 (clamped if outside).
 * @param reversed Sample the row back-to-front, matching a reversed render.
 */
export function sampleColormapColor(
  image: ImageData,
  colormapIndex: number,
  t: number,
  reversed = false,
): [number, number, number, number] {
  const { data, width } = image;
  const clamped = Math.min(1, Math.max(0, t));
  const x = Math.round((reversed ? 1 - clamped : clamped) * (width - 1));
  const offset = (colormapIndex * width + x) * 4;
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!, 255];
}
