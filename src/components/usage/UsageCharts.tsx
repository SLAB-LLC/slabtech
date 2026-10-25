'use client';

import { useEffect, useRef, useState } from 'react';

export interface BarDatum {
  key: string;
  label: string; // axis label
  value: number;
  tooltip: string;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

// Bar with a 4px rounded top anchored flat to the baseline
function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function BarChart({
  data,
  height = 180,
  formatValue = (v: number) => String(v),
  labelEvery,
  ariaLabel,
}: {
  data: BarDatum[];
  height?: number;
  formatValue?: (v: number) => string;
  labelEvery?: number;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(640);
  const boxRef = useRef<HTMLDivElement>(null);

  // Draw at the container's real width so text stays the same size at any width
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const pad = { top: 12, right: 8, bottom: 22, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...data.map(d => d.value)));
  const slot = innerW / Math.max(data.length, 1);
  const gap = Math.max(2, Math.min(slot * 0.25, 8));
  const barW = Math.max(1, slot - gap);
  const every = labelEvery ?? Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(innerW / 64))));
  const ticks = [0, max / 2, max];

  const hovered = hover !== null ? data[hover] : null;
  const hoverX = hover !== null ? pad.left + hover * slot + slot / 2 : 0;

  return (
    <div className="relative" ref={boxRef}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block" role="img" aria-label={ariaLabel}>
        {ticks.map(t => {
          const y = pad.top + innerH - (t / max) * innerH;
          return (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} className="stroke-gray-200" strokeWidth={1} />
              <text x={pad.left - 6} y={y + 3} textAnchor="end" className="fill-gray-500" fontSize={10}>
                {formatValue(t)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.value / max) * innerH;
          const x = pad.left + i * slot + gap / 2;
          const y = pad.top + innerH - h;
          return (
            <g key={d.key}>
              <path
                d={barPath(x, y, barW, h)}
                className={hover === null || hover === i ? 'fill-midnight-blue' : 'fill-midnight-blue/30'}
              />
              {i % every === 0 && (
                <text x={x + barW / 2} y={height - 6} textAnchor="middle" className="fill-gray-500" fontSize={10}>
                  {d.label}
                </text>
              )}
              {/* Hit target wider and taller than the bar */}
              <rect
                x={pad.left + i * slot}
                y={pad.top}
                width={slot}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={d.tooltip}
              />
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{ left: `${(hoverX / width) * 100}%` }}
        >
          {hovered.tooltip}
        </div>
      )}
    </div>
  );
}

/** Horizontal bars for ranked lists (top pages) */
export function RankedBars({ rows }: { rows: { label: string; value: number; display: string; tag?: string }[] }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  if (rows.length === 0) return <p className="text-sm text-gray-500">No activity in this range.</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map(r => (
        <li key={`${r.label}-${r.tag}`}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-gray-700" title={r.label}>
              {r.label}
              {r.tag && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-500">{r.tag}</span>}
            </span>
            <span className="shrink-0 font-medium tabular-nums text-gray-900">{r.display}</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100">
            <div className="h-1.5 rounded-full bg-midnight-blue" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Two-part share bar (web vs app) */
export function SplitBar({ web, app }: { web: number; app: number }) {
  const total = web + app;
  if (total === 0) return <span className="text-xs text-gray-400">—</span>;
  const webPct = Math.round((web / total) * 100);
  return (
    <div className="w-24" title={`Web ${webPct}% · App ${100 - webPct}%`}>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        {webPct > 0 && <div className="bg-midnight-blue" style={{ width: `${webPct}%` }} />}
        {webPct < 100 && <div className="bg-success-gold" style={{ width: `${100 - webPct}%` }} />}
      </div>
      <div className="mt-1 text-[10px] text-gray-500">
        {webPct}% web · {100 - webPct}% app
      </div>
    </div>
  );
}
