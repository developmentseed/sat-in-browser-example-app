import type { Device } from "@luma.gl/core";
import { useQuery } from "@tanstack/react-query";
import { buildColormapTexture } from "../layers/colormap";
import { useColormapImage } from "./use-colormap-image";

/**
 * Uploads the colormap sprite as a GPU texture once both the sprite and a
 * device are ready. The sprite fetch (via `useColormapImage`) starts
 * regardless of whether `device` is ready yet, so it's not blocked waiting
 * on GPU initialization.
 * @param device GPU device, or undefined before deck.gl's `onDeviceInitialized` fires.
 * @returns React Query result wrapping the built `Texture`.
 */
export function useColormapTexture(device: Device | undefined) {
  const { data: image } = useColormapImage();
  return useQuery({
    queryKey: ["colormapTexture"],
    enabled: !!device && !!image,
    queryFn: () => buildColormapTexture(device!, image!),
  });
}
