import { useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { EmptyState } from './ui';

export interface LineChartPoint {
  label: string;
  value: number;
  tooltip?: string;
}

export interface LineChartProps {
  points: LineChartPoint[];
  formatValue(v: number): string;
  title: string;
  height?: number;
}

// Internal coordinate system the SVG is drawn in; the element itself scales
// to the container's actual width via `preserveAspectRatio="none"`, so these
// are just convenient round numbers, not pixels.
const VIEW_W = 640;
const MARGIN = { top: 16, right: 16, bottom: 28, left: 56 };
const MAX_X_LABELS = 5;
const MARKER_R = 5;
const Y_TICKS = 4;

/** Evenly spaced indices into [0, n), always including the first and last. */
function evenIndices(n: number, max: number): Set<number> {
  if (n <= max) return new Set(Array.from({ length: n }, (_, i) => i));
  const picked = new Set<number>();
  for (let k = 0; k < max; k++) picked.add(Math.round((k * (n - 1)) / (max - 1)));
  return picked;
}

export function LineChart({ points, formatValue, title, height = 220 }: LineChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const activeIndex = hoverIndex ?? focusIndex;

  if (points.length === 0) {
    return (
      <figure className="w-full">
        <figcaption className="mb-2">
          <h3 className="brand-title text-sm font-semibold text-fg">{title}</h3>
        </figcaption>
        <EmptyState title="Sem dados para exibir" />
      </figure>
    );
  }

  const values = points.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = rawMax > rawMin ? (rawMax - rawMin) * 0.1 : Math.max(1, Math.abs(rawMax) * 0.1);
  const domainMin = rawMin - pad;
  const domainMax = rawMax + pad;

  const plotW = VIEW_W - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;

  const xAt = (i: number) =>
    points.length === 1 ? MARGIN.left + plotW / 2 : MARGIN.left + (plotW * i) / (points.length - 1);
  const yAt = (v: number) => MARGIN.top + plotH - ((v - domainMin) / (domainMax - domainMin)) * plotH;

  const coords = points.map((p, i) => ({ x: xAt(i), y: yAt(p.value), point: p }));
  const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(' ');

  const yTicks = Array.from({ length: Y_TICKS + 1 }, (_, i) => domainMin + ((domainMax - domainMin) * i) / Y_TICKS);
  const xLabelIdx = evenIndices(points.length, MAX_X_LABELS);

  const first = points[0];
  const last = points[points.length - 1];
  const summary =
    points.length > 1
      ? `${title}. De ${formatValue(first.value)} em ${first.label} para ${formatValue(last.value)} em ${last.label}.`
      : `${title}. ${formatValue(last.value)} em ${last.label}.`;

  function nearestIndex(clientX: number, rect: DOMRect): number {
    const fraction = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    const vx = fraction * VIEW_W;
    let best = 0;
    let bestDist = Infinity;
    coords.forEach((c, i) => {
      const d = Math.abs(c.x - vx);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    setHoverIndex(nearestIndex(e.clientX, e.currentTarget.getBoundingClientRect()));
  }

  function handlePointerLeave() {
    setHoverIndex(null);
  }

  function handleFocus() {
    setFocusIndex((current) => current ?? points.length - 1);
  }

  function handleBlur() {
    setFocusIndex(null);
  }

  function handleKeyDown(e: ReactKeyboardEvent<SVGSVGElement>) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setFocusIndex((current) => Math.min(points.length - 1, (current ?? -1) + 1));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setFocusIndex((current) => Math.max(0, (current ?? points.length) - 1));
    }
  }

  const active = activeIndex !== null ? coords[activeIndex] : null;
  const lastCoord = coords[coords.length - 1];

  return (
    <figure className="w-full">
      <figcaption className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="brand-title text-sm font-semibold text-fg">{title}</h3>
        <span className="text-xs text-muted">menor é melhor</span>
      </figcaption>

      <div className="relative w-full" style={{ height }}>
        <svg
          role="img"
          aria-label={summary}
          viewBox={`0 0 ${VIEW_W} ${height}`}
          preserveAspectRatio="none"
          width="100%"
          height={height}
          pointerEvents="all"
          tabIndex={0}
          className="block cursor-crosshair select-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        >
          {yTicks.map((t, i) => {
            const y = yAt(t);
            return (
              <g key={i}>
                <line
                  x1={MARGIN.left}
                  x2={VIEW_W - MARGIN.right}
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={MARGIN.left - 8}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={11}
                  fill="var(--muted)"
                  className="tabular"
                >
                  {formatValue(t)}
                </text>
              </g>
            );
          })}

          {points.map(
            (p, i) =>
              xLabelIdx.has(i) && (
                <text key={i} x={xAt(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                  {p.label}
                </text>
              ),
          )}

          {active && (
            <line
              x1={active.x}
              x2={active.x}
              y1={MARGIN.top}
              y2={height - MARGIN.bottom}
              stroke="var(--muted)"
              strokeWidth={1}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}

          <path
            d={path}
            fill="none"
            stroke="var(--fg)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {coords.map((c, i) => (
            <circle
              key={i}
              cx={c.x}
              cy={c.y}
              r={activeIndex === i ? MARKER_R + 1.5 : MARKER_R}
              fill="var(--fg)"
              stroke="var(--surface)"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <text
            x={lastCoord.x}
            y={lastCoord.y - 12}
            textAnchor="end"
            fontSize={12}
            fontWeight={600}
            fill="var(--fg)"
            className="tabular"
          >
            {formatValue(last.value)}
          </text>
        </svg>

        {active && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: `${(active.x / VIEW_W) * 100}%`, top: `${Math.max(0, (active.y / height) * 100 - 4)}%` }}
          >
            <div className="tabular font-semibold text-fg">{formatValue(active.point.value)}</div>
            <div className="text-muted">
              {active.point.label}
              {active.point.tooltip ? ` · ${active.point.tooltip}` : ''}
            </div>
          </div>
        )}
      </div>

      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Rótulo</th>
            <th scope="col">Valor</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td>{p.label}</td>
              <td>
                {formatValue(p.value)}
                {p.tooltip ? ` (${p.tooltip})` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
