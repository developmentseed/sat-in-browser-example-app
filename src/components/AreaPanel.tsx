import useStore from "../store";
import type { AreaPoint } from "../zarr/duckdb/area-stats";
import { useAreaStats } from "../zarr/hooks/use-area-stats";
import { useForecastRun, useVariableGrid, variableSpec } from "../zarr/hooks/use-forecast";
import AreaChart from "./AreaChart";

const NUM_FMT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const SMALL_FMT = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 2 });
/** One decimal, but two significant digits below 1 (precipitation rates are mostly < 0.1 mm/h). */
const formatValue = (v: number) => (v !== 0 && Math.abs(v) < 1 ? SMALL_FMT : NUM_FMT).format(v);
const PCT_FMT = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
const WHEN_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  hourCycle: "h23",
});

/** 15-day extremes and the mean of the per-lead means. */
function summarize(points: readonly AreaPoint[]) {
  let min: AreaPoint | undefined;
  let max: AreaPoint | undefined;
  let sum = 0;
  let n = 0;
  for (const p of points) {
    if (p.min !== null && (!min || p.min < min.min!)) min = p;
    if (p.max !== null && (!max || p.max > max.max!)) max = p;
    if (p.mean !== null) ((sum += p.mean), n++);
  }
  return { min, max, mean: n ? sum / n : null };
}

/** Analysis of the clicked state: stats tiles, time series and a table, for the shown variable. */
export default function AreaPanel() {
  const selected = useStore((s) => s.selectedState);
  const setSelected = useStore((s) => s.setSelectedState);
  const variable = useStore((s) => s.variable);
  const leadIdx = useStore((s) => s.leadIdx);
  const setLeadIdx = useStore((s) => s.setLeadIdx);
  const setPlaying = useStore((s) => s.setPlaying);

  const { data: run } = useForecastRun();
  const { data: grid } = useVariableGrid(run, variable);
  const stats = useAreaStats(run, variable, grid, selected?.id);

  if (!selected) return null;
  const spec = variableSpec(variable);
  const initMs = run ? Date.parse(run.initTime) : 0;
  const leadHours = run?.leadHours ?? [];
  const when = (p: AreaPoint | undefined) =>
    p ? `${WHEN_FMT.format(initMs + (leadHours[p.t] ?? 0) * 3_600_000)} UTC` : "";
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "–" : formatValue(v));

  const data = stats.data;
  const summary = data ? summarize(data.points) : null;
  const now = data?.points.find((p) => p.t === leadIdx);

  return (
    <aside className="panel area-panel" aria-label={`${selected.name} analysis`}>
      <div className="area-head">
        <div>
          <div className="panel-title">{selected.name}</div>
          <div className="muted small">
            {spec.label} ({spec.units})
            {data && data.nCells > 0 && (
              <>
                {" "}
                · {data.nCells} cells · {PCT_FMT.format(data.coverage)} of state in loaded area
              </>
            )}
          </div>
        </div>
        <button type="button" className="icon-button" onClick={() => setSelected(null)} aria-label="Close">
          ×
        </button>
      </div>

      {stats.error ? (
        <div className="status error">Error: {stats.error.message}</div>
      ) : !data ? (
        <div className="status">
          {grid ? "Intersecting cells in DuckDB…" : "Waiting for the variable to load…"}
        </div>
      ) : data.nCells === 0 ? (
        <div className="status">
          {selected.name} is outside the loaded area. Widen <code>AOI_BBOX</code> in src/config.ts to include
          it.
        </div>
      ) : (
        <>
          <div className="tiles">
            <div className="tile">
              <div className="field-label">Min</div>
              <div className="tile-value">{fmt(summary?.min?.min)}</div>
              <div className="muted small">{when(summary?.min)}</div>
            </div>
            <div className="tile">
              <div className="field-label">Mean</div>
              <div className="tile-value">{fmt(summary?.mean)}</div>
              <div className="muted small">15-day average</div>
            </div>
            <div className="tile">
              <div className="field-label">Max</div>
              <div className="tile-value">{fmt(summary?.max?.max)}</div>
              <div className="muted small">{when(summary?.max)}</div>
            </div>
          </div>

          <div className="small now">
            <span className="field-label">+{leadHours[leadIdx] ?? 0} h</span>
            mean <strong>{fmt(now?.mean)}</strong> · min <strong>{fmt(now?.min)}</strong> · max{" "}
            <strong>{fmt(now?.max)}</strong>
          </div>

          <AreaChart
            points={data.points}
            leadHours={leadHours}
            initMs={initMs}
            leadIdx={leadIdx}
            onSelectLead={(idx) => {
              setPlaying(false);
              setLeadIdx(idx);
            }}
            format={formatValue}
          />

          <details className="table-view">
            <summary>Table</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Valid (UTC)</th>
                    <th>Lead</th>
                    <th>Mean</th>
                    <th>Min</th>
                    <th>Max</th>
                  </tr>
                </thead>
                <tbody>
                  {data.points.map((p) => (
                    <tr key={p.t} className={p.t === leadIdx ? "current-row" : undefined}>
                      <td>{WHEN_FMT.format(initMs + (leadHours[p.t] ?? 0) * 3_600_000)}</td>
                      <td>+{leadHours[p.t]} h</td>
                      <td>{fmt(p.mean)}</td>
                      <td>{fmt(p.min)}</td>
                      <td>{fmt(p.max)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </aside>
  );
}
