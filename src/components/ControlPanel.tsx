import { useEffect, useRef } from "react";
import { VARIABLES } from "../config";
import useStore from "../store";
import { useColormapImage } from "../zarr/hooks/use-colormap-image";
import { useForecastRun, useVariableGrid, variableSpec } from "../zarr/hooks/use-forecast";
import { COLORMAP_INDEX, colormapGradientCss } from "../zarr/layers/colormap";

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
  hourCycle: "h23",
});
const NUM_FMT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/**
 * Advances the lead time while playing. Each step dwells in proportion to
 * its length in hours, so the 3 h → 6 h switch at +144 h keeps a constant
 * pace (as in deck.gl-raster's dynamical-zarr-ecmwf example).
 */
function usePlayback(leadHours: readonly number[] | undefined) {
  const playing = useStore((s) => s.playing);
  const frameMs = useStore((s) => s.frameMs);
  const setLeadIdx = useStore((s) => s.setLeadIdx);
  const hoursRef = useRef(leadHours);
  hoursRef.current = leadHours;

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const hours = hoursRef.current;
      const idx = useStore.getState().leadIdx;
      if (hours && hours.length > 1) {
        const step = (hours[idx + 1] ?? hours[1]!) - (hours[idx] ?? 0);
        if (now - last >= frameMs * (step / 3)) {
          setLeadIdx((i) => (i + 1) % hours.length);
          last = now;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, frameMs, setLeadIdx]);
}

export default function ControlPanel() {
  const variable = useStore((s) => s.variable);
  const setVariable = useStore((s) => s.setVariable);
  const leadIdx = useStore((s) => s.leadIdx);
  const setLeadIdx = useStore((s) => s.setLeadIdx);
  const playing = useStore((s) => s.playing);
  const setPlaying = useStore((s) => s.setPlaying);
  const progress = useStore((s) => s.progress);

  const run = useForecastRun();
  const grid = useVariableGrid(run.data, variable);
  const { data: colormapImage } = useColormapImage();
  usePlayback(run.data?.leadHours);

  const spec = variableSpec(variable);
  const leadHours = run.data?.leadHours;
  const lead = leadHours?.[leadIdx] ?? 0;
  const initMs = run.data ? Date.parse(run.data.initTime) : undefined;
  const range = grid.data?.range;

  const error = run.error ?? grid.error;
  let status: string | null = null;
  if (error) status = `Error: ${error.message}`;
  else if (run.isPending) status = "Finding the latest run…";
  else if (grid.isPending) {
    status =
      progress?.variable === variable && progress.stage === "chunks"
        ? `Fetching chunks ${progress.done}/${progress.total}…`
        : progress?.variable === variable && progress.stage === "duckdb"
          ? "Decoding in DuckDB…"
          : "Loading DuckDB…";
  }

  return (
    <div className="panel">
      <div className="panel-title">
        ECMWF IFS ENS <span className="muted">· control member · 0.25°</span>
      </div>

      <label className="field">
        <span className="field-label">Variable</span>
        <select value={variable} onChange={(e) => setVariable(e.target.value)}>
          {VARIABLES.map((v) => (
            <option key={v.name} value={v.name}>
              {v.label}
            </option>
          ))}
        </select>
      </label>

      <div className="times">
        <div>
          <span className="field-label">Init</span>
          <span>{initMs !== undefined ? DATE_FMT.format(initMs) : "—"}</span>
        </div>
        <div>
          <span className="field-label">Valid</span>
          <span>
            {initMs !== undefined ? DATE_FMT.format(initMs + lead * 3_600_000) : "—"}{" "}
            <span className="muted">(+{lead} h)</span>
          </span>
        </div>
      </div>

      <div className="scrubber">
        <button
          type="button"
          onClick={() => setPlaying(!playing)}
          disabled={!leadHours}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <input
          type="range"
          min={0}
          max={(leadHours?.length ?? 1) - 1}
          value={leadIdx}
          disabled={!leadHours}
          onChange={(e) => {
            setPlaying(false);
            setLeadIdx(Number(e.target.value));
          }}
          aria-label="Lead time"
        />
      </div>

      <div className="legend">
        <div
          className="legend-ramp"
          style={{
            background: colormapImage
              ? colormapGradientCss(colormapImage, COLORMAP_INDEX[spec.colormap], spec.reversed, 16)
              : undefined,
          }}
        />
        <div className="legend-ticks">
          <span>{range ? NUM_FMT.format(range[0]) : "–"}</span>
          <span className="muted">{spec.units}</span>
          <span>{range ? NUM_FMT.format(range[1]) : "–"}</span>
        </div>
      </div>

      {status ? (
        <div className={error ? "status error" : "status"}>{status}</div>
      ) : (
        <div className="hint">Click a state for its time series and statistics.</div>
      )}
    </div>
  );
}
