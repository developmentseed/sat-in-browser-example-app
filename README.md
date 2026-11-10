# zarr-browser

This is an example app developed for SatSummit talk 'Satellite Imagery in Browser'/.

This app visualizes dynamical.org's [ECMWF IFS ENS 15-day 0.25°](https://dynamical.org/catalog/ecmwf-ifs-ens-forecast-15-day-0-25-degree/)
forecast over a fixed area of interest. It shows only the ensemble's control run (member 0), not the
full 51-member ensemble; `ENSEMBLE_MEMBER` in `src/config.ts` picks the member. The architecture follows awii-app's frontend: DuckDB-Wasm loads the zarr data, and deck.gl draws it.

```sh
pnpm install
pnpm dev      # http://localhost:5173
pnpm test
```

## How data gets on screen

1. `src/zarr/source/metadata.ts` fetches the root `zarr.json` of the remote store at `SOURCE_URL` (`src/config.ts`).
   The store uses consolidated Zarr v3 metadata, so this one file describes every array.
2. `src/zarr/source/aoi.ts` snaps `AOI_BBOX` (`src/config.ts`) out to the store's 8° inner-chunk grid.
3. `src/zarr/source/shards.ts` range-reads each needed shard's index (the last 1604 bytes), then just the
   inner chunks the AOI needs. A source shard is about 250 MB; one inner chunk is about 2.5–4 MB. Nothing is decoded in JS.
4. `src/zarr/duckdb/zarr-table.ts` wraps each chunk as a one-chunk shard and registers it in DuckDB-Wasm's virtual
   filesystem as a tiny synthetic v3 store. It then builds a `(t, r, c, v)` table with
   `duckdb_zarr`'s `zarr_cells(...) WHERE dim_2 = <member>`, applying unit scaling in SQL. Auto colour ranges are
   `quantile_cont` queries.
5. The whole table is read back as one `[lead, row, col]` Float32Array and uploaded as a single r32float
   Texture2DArray (`TableRasterLayer`, from awii). Scrubbing and playing lead time only change a shader uniform.

## State analysis

US state outlines (`public/us-states.parquet`, from the Census 1:20M cartographic file via
`uv run scripts/make_states_parquet.py`) are loaded into a DuckDB `spatial` table and drawn as a deck.gl layer above the
raster. Clicking a state runs `src/zarr/duckdb/area-stats.ts`:
- every grid cell of the loaded window is a rectangle in `cells`;
- `ST_Intersection` with the state gives each cell an overlap weight (cached per state);
- then one `GROUP BY t` query over the variable's `(t, r, c, v)` table returns the per-lead-time area-weighted mean,
  min and max.

The panel shows 15-day min/mean/max tiles, a time series (click it to jump the map to that lead time) and a table.

### duckdb_zarr quirks this works around

- Its remote HTTP reads are unreliable in wasm, so bytes are fetched in JS and registered as buffers (as in awii).
- It decodes blosc only inside `sharding_indexed`, hence the one-chunk-shard wrapping, even for 1-D coordinates.
- It can't list the wasm virtual filesystem, so each synthetic store has the array at its root and is queried with array path `''`.
- It rejects `fill_value: "NaN"`, so the synthetic stores use `0`. Only runs whose AOI chunks all exist are loaded.
- `ORDER BY … LIMIT` on `zarr_cells` fails (top-N filter pushdown), so coordinates are sorted in JS.

## Config

`src/config.ts` holds the AOI bbox, the ensemble member (0 = control) and the variable list (colormap, fixed range,
unit scale, `hideBelow`). Download cost is about 3.5 MB per 8°×8° box per variable. The default AOI is the contiguous
US: 36 boxes, about 120 MB and about 25 s per variable. Alaska, Hawaii and Puerto Rico are outside it.
