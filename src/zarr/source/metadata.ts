import { SOURCE_URL } from "../../config";

// Reads the store's consolidated Zarr v3 metadata: the root `zarr.json`
// inlines every array's `zarr.json` under `consolidated_metadata.metadata`.

export type Codec = { name: string; configuration?: Record<string, unknown> };

export type ArrayMeta = {
  node_type: "array";
  shape: number[];
  data_type: string;
  chunk_grid: { name: "regular"; configuration: { chunk_shape: number[] } };
  chunk_key_encoding: { name: string; configuration?: { separator?: string } };
  fill_value: unknown;
  codecs: Codec[];
  dimension_names?: string[];
  attributes: Record<string, unknown>;
};

export type StoreMetadata = {
  attributes: Record<string, unknown>;
  arrays: Record<string, ArrayMeta>;
};

let storeMetadata: Promise<StoreMetadata> | null = null;

/** The store's root attributes and every array's metadata, fetched once per page. */
export function fetchStoreMetadata(): Promise<StoreMetadata> {
  if (!storeMetadata) {
    storeMetadata = (async () => {
      const resp = await fetch(new URL("zarr.json", SOURCE_URL));
      if (!resp.ok) throw new Error(`Failed to fetch zarr.json: ${resp.status} ${resp.statusText}`);
      const root = (await resp.json()) as {
        attributes?: Record<string, unknown>;
        consolidated_metadata?: { metadata: Record<string, { node_type: string }> };
      };
      const nodes = root.consolidated_metadata?.metadata;
      if (!nodes) throw new Error("The store has no consolidated metadata");
      const arrays = Object.fromEntries(
        Object.entries(nodes).filter(([, node]) => node.node_type === "array"),
      ) as Record<string, ArrayMeta>;
      return { attributes: root.attributes ?? {}, arrays };
    })();
    storeMetadata.catch(() => {
      storeMetadata = null;
    });
  }
  return storeMetadata;
}

/** One array's metadata, or throws if the store doesn't have it. */
export function arrayMeta(metadata: StoreMetadata, name: string): ArrayMeta {
  const meta = metadata.arrays[name];
  if (!meta) throw new Error(`No array "${name}" in the store`);
  return meta;
}
