import { useQuery } from "@tanstack/react-query";
import { loadColormapImage } from "../layers/colormap";

/**
 * Fetches and decodes the colormap sprite. No GPU device needed, so this can
 * start immediately — pair with `useColormapTexture` once a device exists.
 * @returns React Query result wrapping the decoded sprite `ImageData`.
 */
export function useColormapImage() {
  return useQuery({
    queryKey: ["colormapImage"],
    queryFn: () => loadColormapImage(),
    staleTime: Infinity, // the bundled sprite never changes
  });
}
