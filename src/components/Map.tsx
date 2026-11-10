import type { LayersList } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Device } from "@luma.gl/core";
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo, useState } from "react";
import { Layer, Map as MaplibreMap, Source, useControl } from "react-map-gl/maplibre";
import { AOI_BBOX } from "../config";
import useStore from "../store";
import { useStatesGeoJson } from "../zarr/hooks/use-area-stats";
import { useColormapTexture } from "../zarr/hooks/use-colormap-texture";
import { useForecastRun, useVariableGrid, variableSpec } from "../zarr/hooks/use-forecast";
import { COLORMAP_INDEX } from "../zarr/layers/colormap";
import { buildRasterLayer } from "../zarr/layers/raster-layer";
import { buildStateLayers } from "../zarr/layers/state-layers";
import { windowBounds } from "../zarr/source/aoi";

// Pairs with the `?worker&url` import so the maplibre worker resolves under
// Vite (same as awii-app's Map.tsx). Keep it above the component.
setWorkerUrl(workerUrl);

const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/**
 * Hosts deck.gl's layers on top of the MapLibre map (awii-app's pattern) and
 * reports the GPU device once deck.gl creates it — the colormap texture
 * needs it. Not `interleaved`: sharing MapLibre's GL context breaks when
 * StrictMode mounts the control twice ("WebGL context already attached").
 */
function DeckOverlay({
  layers,
  onDeviceInitialized,
}: {
  layers: LayersList;
  onDeviceInitialized: (device: Device) => void;
}) {
  const overlay = useControl(
    () =>
      new MapboxOverlay({
        layers: [],
        onDeviceInitialized,
        getCursor: ({ isDragging, isHovering }) =>
          isDragging ? "grabbing" : isHovering ? "pointer" : "grab",
      }),
  );
  overlay.setProps({ layers });
  return null;
}

export default function Map() {
  const [device, setDevice] = useState<Device>();
  const { data: colormapTexture } = useColormapTexture(device);

  const variable = useStore((state) => state.variable);
  const leadIdx = useStore((state) => state.leadIdx);
  const { data: run } = useForecastRun();
  const { data: grid } = useVariableGrid(run, variable);
  const { data: states } = useStatesGeoJson();
  const selectedState = useStore((state) => state.selectedState);
  const setSelectedState = useStore((state) => state.setSelectedState);

  const rasterLayers = useMemo(() => {
    if (!run || !grid || !colormapTexture) return [];
    const spec = variableSpec(variable);
    return [
      buildRasterLayer({
        values: grid.values,
        geoZarrAttrs: run.geoZarrAttrs,
        layerKey: `${variable}-${run.initIdx}`,
        leadIdx,
        rescaleRange: grid.range,
        colormapTexture,
        colormapIndex: COLORMAP_INDEX[spec.colormap],
        colormapReversed: spec.reversed ?? false,
        hideBelow: spec.hideBelow,
      }),
    ];
  }, [run, grid, colormapTexture, variable, leadIdx]);

  // States go last, so they draw above the raster.
  const stateLayers = useMemo(
    () =>
      states ? buildStateLayers({ states, selectedId: selectedState?.id, onSelect: setSelectedState }) : [],
    [states, selectedState, setSelectedState],
  );
  const layers = useMemo(() => [...rasterLayers, ...stateLayers], [rasterLayers, stateLayers]);

  const [west, south, east, north] = AOI_BBOX;
  return (
    <MaplibreMap
      initialViewState={{
        bounds: [
          [west, south],
          [east, north],
        ],
        fitBoundsOptions: { padding: 48 },
      }}
      mapStyle={BASEMAP_STYLE}
      onLoad={(e) => {
        // Dev-only handle for browser tests (e.g. projecting a lon/lat to click).
        if (import.meta.env.DEV) (window as unknown as { __map: unknown }).__map = e.target;
      }}
      attributionControl={{
        customAttribution:
          'Forecast: <a href="https://dynamical.org/catalog/ecmwf-ifs-ens-forecast-15-day-0-25-degree/">ECMWF IFS ENS via dynamical.org</a> (CC-BY-4.0)',
      }}
      style={{ position: "absolute", inset: 0 }}
    >
      <DeckOverlay layers={layers} onDeviceInitialized={setDevice} />
      {run && <AoiOutline bounds={windowBounds(run.window)} />}
    </MaplibreMap>
  );
}

/** Thin outline of the loaded (snapped) area, so its edges read as intentional. */
function AoiOutline({ bounds: [w, s, e, n] }: { bounds: [number, number, number, number] }) {
  const data = useMemo(
    () => ({
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      },
    }),
    [w, s, e, n],
  );
  return (
    <Source id="aoi-outline" type="geojson" data={data}>
      <Layer
        id="aoi-outline"
        type="line"
        paint={{ "line-color": "#ffffff", "line-opacity": 0.35, "line-width": 1, "line-dasharray": [2, 2] }}
      />
    </Source>
  );
}
