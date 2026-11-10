import type { PickingInfo } from "@deck.gl/core";
import { GeoJsonLayer } from "@deck.gl/layers";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { StateProperties, StatesGeoJson } from "../duckdb/area-stats";

type StateFeature = Feature<Polygon | MultiPolygon, StateProperties>;

/**
 * US state outlines drawn above the forecast raster. The near-transparent
 * fill makes the whole polygon a click/hover target, not just its outline.
 * The selected state gets its own layer with a heavier accent outline.
 */
export function buildStateLayers(args: {
  states: StatesGeoJson;
  selectedId: number | undefined;
  onSelect: (state: StateProperties) => void;
}) {
  const { states, selectedId, onSelect } = args;
  const selected = states.features.filter((f) => f.properties.id === selectedId);
  return [
    new GeoJsonLayer<StateProperties>({
      id: "us-states",
      data: states,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 36],
      stroked: true,
      filled: true,
      getFillColor: [255, 255, 255, 1],
      getLineColor: [255, 255, 255, 150],
      lineWidthUnits: "pixels",
      getLineWidth: 1,
      onClick: (info: PickingInfo<StateFeature>) => {
        if (info.object) onSelect(info.object.properties);
      },
    }),
    new GeoJsonLayer<StateProperties>({
      id: "us-states-selected",
      data: { type: "FeatureCollection", features: selected },
      stroked: true,
      filled: false,
      getLineColor: [90, 169, 255, 255],
      lineWidthUnits: "pixels",
      getLineWidth: 2.5,
    }),
  ];
}
