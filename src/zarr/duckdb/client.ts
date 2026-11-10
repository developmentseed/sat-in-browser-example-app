import * as duckdb from "@duckdb/duckdb-wasm";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import mvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import duckdbWasmEh from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import duckdbWasmMvp from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";

// Local bundle files, not duckdb.getJsDelivrBundles() — no CDN dependency.
// mvp/eh only (single-threaded), so no SharedArrayBuffer/COOP+COEP headers needed.
const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: duckdbWasmMvp, mainWorker: mvpWorker },
  eh: { mainModule: duckdbWasmEh, mainWorker: ehWorker },
};

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

/**
 * Boots a shared, memoized DuckDB-wasm instance. Defaults to Vite-resolved
 * bundle files (see `MANUAL_BUNDLES`) — pass your own `bundles` (e.g.
 * `duckdb.getJsDelivrBundles()`) on a different bundler.
 * @param bundles DuckDB-wasm module/worker bundle URLs.
 * @returns A ready-to-use `AsyncDuckDB`, shared across all callers.
 */
export function getDb(bundles: duckdb.DuckDBBundles = MANUAL_BUNDLES): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const bundle = await duckdb.selectBundle(bundles);
      const worker = new Worker(bundle.mainWorker!);
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      return db;
    })();
  }
  return dbPromise;
}
