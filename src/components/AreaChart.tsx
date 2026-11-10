import { useEffect, useMemo, useRef, useState } from "react";
import type { AreaPoint } from "../zarr/duckdb/area-stats";

const HEIGHT = 190;
const MARGIN = { top: 10, right: 10, bottom: 24, left: 44 };
const SERIES = "var(--series-1)";

const TICK_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const TIP_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  hourCycle: "h23",
});

/** Up to `count` round tick values spanning [lo, hi]. */
function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

/** Splits a series at nulls so gaps (lead times without data) stay gaps. */
function segments<T>(items: readonly T[], ok: (item: T) => boolean): T[][] {
  const out: T[][] = [];
  let run: T[] = [];
  for (const item of items) {
    if (ok(item)) run.push(item);
    else if (run.length) (out.push(run), (run = []));
  }
  if (run.length) out.push(run);
  return out;
}

/**
 * The selected area's forecast over every lead time: area-weighted mean as a
 * line over the min–max band across its cells. Hover reads out a lead time;
 * click jumps the map to it.
 */
export default function AreaChart(props: {
  points: readonly AreaPoint[];
  leadHours: readonly number[];
  initMs: number;
  leadIdx: number;
  onSelectLead: (idx: number) => void;
  format: (v: number) => string;
}) {
  const { points, leadHours, initMs, leadIdx, onSelectLead, format } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scales = useMemo(() => {
    const valid = points.filter((p) => p.min !== null && p.max !== null);
    const lo = Math.min(...valid.map((p) => p.min!));
    const hi = Math.max(...valid.map((p) => p.max!));
    const pad = (hi - lo) * 0.05 || 1;
    const yTicks = niceTicks(lo - pad, hi + pad);
    const y0 = Math.min(lo - pad, yTicks[0]!);
    const y1 = Math.max(hi + pad, yTicks[yTicks.length - 1]!);
    const xMax = leadHours[leadHours.length - 1] ?? 1;
    const plotW = Math.max(10, width - MARGIN.left - MARGIN.right);
    const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
    const x = (h: number) => MARGIN.left + (h / xMax) * plotW;
    const y = (v: number) => MARGIN.top + (1 - (v - y0) / (y1 - y0)) * plotH;
    // Day ticks at 00 UTC valid time, every other day.
    const initDayOffsetH = (initMs % 86_400_000) / 3_600_000;
    const xTicks: number[] = [];
    for (let h = (24 - initDayOffsetH) % 24; h <= xMax; h += 48) xTicks.push(h);
    return { x, y, yTicks, xTicks, plotW, plotH };
  }, [points, leadHours, width, initMs]);

  const { x, y, yTicks, xTicks } = scales;
  const hourOf = (p: AreaPoint) => leadHours[p.t] ?? 0;
  const bandPaths = segments(points, (p) => p.min !== null && p.max !== null).map(
    (seg) =>
      `M${seg.map((p) => `${x(hourOf(p))},${y(p.max!)}`).join("L")}` +
      `L${[...seg]
        .reverse()
        .map((p) => `${x(hourOf(p))},${y(p.min!)}`)
        .join("L")}Z`,
  );
  const linePaths = segments(points, (p) => p.mean !== null).map(
    (seg) => `M${seg.map((p) => `${x(hourOf(p))},${y(p.mean!)}`).join("L")}`,
  );

  /** The lead index nearest the pointer's x. */
  const nearest = (clientX: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const px = clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(x(hourOf(p)) - px);
      if (d < bestD) ((bestD = d), (best = i));
    });
    return best;
  };

  const hovered = hover !== null ? points[hover] : undefined;
  const current = points.find((p) => p.t === leadIdx);
  const tipLeft = hovered ? x(hourOf(hovered)) : 0;

  return (
    <div className="chart" ref={wrapRef}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label="Area mean with min–max range over lead time"
        onPointerMove={(e) => setHover(nearest(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => onSelectLead(points[nearest(e.clientX)]!.t)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line className="grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(v)} y2={y(v)} />
            <text className="tick" x={MARGIN.left - 6} y={y(v)} dy="0.32em" textAnchor="end">
              {format(v)}
            </text>
          </g>
        ))}
        {xTicks.map((h) => (
          <text key={h} className="tick" x={x(h)} y={HEIGHT - 6} textAnchor="middle">
            {TICK_FMT.format(initMs + h * 3_600_000)}
          </text>
        ))}
        {bandPaths.map((d, i) => (
          <path key={`b${i}`} d={d} fill={SERIES} fillOpacity={0.22} />
        ))}
        {linePaths.map((d, i) => (
          <path key={`l${i}`} d={d} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" />
        ))}
        {current && (
          <line
            className="current"
            x1={x(hourOf(current))}
            x2={x(hourOf(current))}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
          />
        )}
        {hovered && (
          <g pointerEvents="none">
            <line
              className="crosshair"
              x1={tipLeft}
              x2={tipLeft}
              y1={MARGIN.top}
              y2={HEIGHT - MARGIN.bottom}
            />
            {hovered.mean !== null && (
              <circle
                cx={tipLeft}
                cy={y(hovered.mean)}
                r={4}
                fill={SERIES}
                stroke="var(--panel-solid)"
                strokeWidth={2}
              />
            )}
          </g>
        )}
      </svg>
      {hovered && (
        <div
          className="tooltip"
          // Beside the crosshair, flipping to its left past mid-plot, so it
          // never covers the line it's reading out or the tiles above.
          style={
            tipLeft > width / 2
              ? { right: width - tipLeft + 10, top: MARGIN.top }
              : { left: tipLeft + 10, top: MARGIN.top }
          }
          role="status"
        >
          <div className="tooltip-time">
            {TIP_FMT.format(initMs + hourOf(hovered) * 3_600_000)} UTC · +{hourOf(hovered)} h
          </div>
          {hovered.mean === null ? (
            <div className="muted">No data</div>
          ) : (
            <>
              <div className="tooltip-row">
                <span className="key-line" />
                <strong>{format(hovered.mean)}</strong> <span className="muted">mean</span>
              </div>
              <div className="tooltip-row">
                <span className="key-band" />
                <strong>
                  {format(hovered.min!)} – {format(hovered.max!)}
                </strong>{" "}
                <span className="muted">range</span>
              </div>
            </>
          )}
        </div>
      )}
      <div className="chart-legend">
        <span>
          <span className="key-line" /> Area-weighted mean
        </span>
        <span>
          <span className="key-band" /> Min–max across cells
        </span>
      </div>
    </div>
  );
}
