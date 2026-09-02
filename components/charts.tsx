"use client";

import { useId, useMemo, useRef, useState } from "react";

/**
 * The chart pieces, drawn by hand in SVG.
 *
 * No charting library, and not for want of one: every dependency added to this
 * app is something that renders a legal document, and a 200KB bundle for four
 * line charts on a staff-only screen is a bad trade. These are a few hundred
 * lines of arithmetic.
 *
 * THE PALETTE. Four hues, in fixed order, never cycled. They are validated for
 * colour-vision deficiency against this app's paper surface (#FAF9F6) rather than
 * chosen by eye — worst adjacent pair separates by ΔE 8.7 under protanopia, and
 * every hue clears 3:1 contrast against the surface. The brand green (#1B5E4F) is
 * deliberately NOT slot one: it is a beautiful interface colour and too
 * desaturated to survive as a 2px line, where it reads as grey.
 *
 * Slot one is the accent-adjacent teal, so the first series of any chart sits in
 * the family of the rest of the product. Colour follows the SERIES, never its
 * rank — filtering a chart must never repaint the survivors, because a reader who
 * has learned that executed agreements are amber should not have to learn it
 * again.
 */
export const SERIES_COLORS = ["#0A8A6C", "#A96A10", "#3A5FB0", "#96407A"] as const;

const SURFACE = "#FAF9F6";
const GRID = "#E2DDD3";
const AXIS_TEXT = "#64748B";

export type Series = {
  key: string;
  label: string;
  /** Index into SERIES_COLORS. Pinned by the caller so it survives a filter. */
  color?: number;
};

/**
 * `compact` and `money` are NOT defined here, and must not be.
 *
 * This module is `"use client"`, so everything it exports becomes a client
 * reference. A server component can pass one of those to a client component as a
 * prop, but the moment it CALLS one — to fill in a stat tile, say — React throws
 * "Attempted to call compact() from the server". They live in lib/format.ts,
 * which belongs to neither side, and are imported by both.
 */
import { compact, money } from "@/lib/format";

/**
 * How a chart writes its numbers — NAMED, never supplied.
 *
 * These are client components and the pages using them are server components, so
 * a `format` prop taking a function cannot cross that boundary: React has no way
 * to serialise a function, and the render dies at request time with "Application
 * error: a server-side exception has occurred". `next build` does not catch it,
 * because every admin page is `force-dynamic` and so is never rendered during the
 * build — which is exactly how this shipped. A string is data, and data crosses.
 */
export type Format = "count" | "money";

const FORMATTERS: Record<Format, (n: number) => string> = {
  count: compact,
  money,
};

/** Clean axis ticks — 0 / 500 / 1,000, never 0 / 437 / 874. */
function niceMax(value: number): number {
  if (value <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = magnitude * step;
    if (candidate >= value) return candidate;
  }
  return magnitude * 10;
}

function LegendRow({
  series,
  colorOf,
}: {
  series: Series[];
  colorOf: (s: Series, i: number) => string;
}) {
  // Always present for two or more series. Identity must never be carried by
  // colour alone — the swatch sits BESIDE the name, and the name is in ink.
  if (series.length < 2) return null;
  return (
    <ul className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1.5">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2 text-xs text-ink-soft">
          <span
            aria-hidden
            className="inline-block h-0.5 w-4 rounded-full"
            style={{ background: colorOf(s, i) }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function ChartFrame({
  title,
  description,
  children,
  table,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  table?: React.ReactNode;
}) {
  const [showing, setShowing] = useState(false);
  return (
    <figure className="rounded-2xl border border-line bg-paper p-5 sm:p-6">
      <figcaption>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">{description}</p>
        )}
      </figcaption>
      {children}
      {table && (
        <>
          {/* The numbers, for anyone the picture does not serve — a screen
              reader, a printout, or somebody who wants to copy a figure out. */}
          <button
            type="button"
            onClick={() => setShowing((v) => !v)}
            className="mt-4 text-xs font-semibold text-accent underline"
          >
            {showing ? "Hide the numbers" : "Show the numbers"}
          </button>
          {showing && <div className="mt-3 overflow-x-auto">{table}</div>}
        </>
      )}
    </figure>
  );
}

/**
 * Change over time. Up to three series; past that the lines converge and the end
 * labels stop being attachable to anything.
 */
export function LineChart({
  title,
  description,
  points,
  series,
  format: formatName = "count",
}: {
  title: string;
  description?: string;
  /** Dense: one entry per day, zeros included. A gap drawn as a line lies. */
  points: { label: string; values: Record<string, number> }[];
  series: Series[];
  format?: Format;
}) {
  const format = FORMATTERS[formatName] ?? compact;
  const clipId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 760;
  const H = 240;
  const PAD = { top: 14, right: 58, bottom: 26, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const colorOf = (s: Series, i: number) =>
    SERIES_COLORS[s.color ?? i % SERIES_COLORS.length];

  const max = useMemo(() => {
    let found = 0;
    for (const p of points) {
      for (const s of series) found = Math.max(found, p.values[s.key] ?? 0);
    }
    return niceMax(found);
  }, [points, series]);

  const x = (i: number) =>
    PAD.left + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  const ticks = [0, max / 2, max];

  // Every value is zero: draw the frame and say so rather than a flat line at the
  // bottom of an axis that runs to 4, which reads as data.
  const empty = points.every((p) => series.every((s) => !(p.values[s.key] ?? 0)));

  function onMove(event: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const ratio = (px - PAD.left) / plotW;
    const index = Math.round(ratio * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, index)));
  }

  return (
    <ChartFrame
      title={title}
      description={description}
      table={
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left text-ink-muted">
              <th className="py-1 pr-4 font-medium">Day</th>
              {series.map((s) => (
                <th key={s.key} className="py-1 pr-4 font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.label} className="border-t border-line/60">
                <td className="py-1 pr-4 text-ink-soft">{p.label}</td>
                {series.map((s) => (
                  <td key={s.key} className="py-1 pr-4 text-ink">
                    {format(p.values[s.key] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <LegendRow series={series} colorOf={colorOf} />

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 w-full"
        style={{ height: "auto" }}
        role="img"
        aria-label={`${title}. ${series.map((s) => s.label).join(", ")} over ${points.length} days.`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        {/* Hairline, solid, one step off the surface. Recessive on purpose. */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke={GRID}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(t) + 3.5}
              textAnchor="end"
              fontSize={10}
              fill={AXIS_TEXT}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {format(t)}
            </text>
          </g>
        ))}

        {points.length > 1 && (
          <>
            <text x={PAD.left} y={H - 8} fontSize={10} fill={AXIS_TEXT}>
              {points[0].label}
            </text>
            <text
              x={W - PAD.right}
              y={H - 8}
              textAnchor="end"
              fontSize={10}
              fill={AXIS_TEXT}
            >
              {points[points.length - 1].label}
            </text>
          </>
        )}

        {empty ? (
          <text
            x={PAD.left + plotW / 2}
            y={PAD.top + plotH / 2}
            textAnchor="middle"
            fontSize={12}
            fill={AXIS_TEXT}
          >
            Nothing yet in this window.
          </text>
        ) : (
          <g clipPath={`url(#${clipId})`}>
            {series.map((s, si) => {
              const color = colorOf(s, si);
              const d = points
                .map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.values[s.key] ?? 0)}`)
                .join(" ");
              return (
                <g key={s.key}>
                  {/* A wash, never a saturated block. */}
                  <path
                    d={`${d} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
                    fill={color}
                    opacity={0.1}
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}
          </g>
        )}

        {/* End markers, ringed in the surface colour so they stay legible where
            two series cross. r=4.5 keeps the mark over the 8px floor. */}
        {!empty &&
          points.length > 0 &&
          series.map((s, si) => {
            const value = points[points.length - 1].values[s.key] ?? 0;
            return (
              <circle
                key={s.key}
                cx={x(points.length - 1)}
                cy={y(value)}
                r={4.5}
                fill={colorOf(s, si)}
                stroke={SURFACE}
                strokeWidth={2}
              />
            );
          })}

        {hover !== null && !empty && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke={AXIS_TEXT}
              strokeWidth={1}
              opacity={0.35}
            />
            {series.map((s, si) => (
              <circle
                key={s.key}
                cx={x(hover)}
                cy={y(points[hover].values[s.key] ?? 0)}
                r={4.5}
                fill={colorOf(s, si)}
                stroke={SURFACE}
                strokeWidth={2}
              />
            ))}
          </g>
        )}
      </svg>

      {/* The tooltip is HTML rather than SVG text: it has to wrap, and it has to
          be readable by anything that reads the page. */}
      <div className="mt-2 min-h-[1.5rem] text-xs text-ink-soft">
        {hover !== null && !empty ? (
          <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-semibold text-ink">{points[hover].label}</span>
            {series.map((s, si) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: colorOf(s, si) }}
                />
                {s.label}{" "}
                <span className="font-semibold tabular-nums text-ink">
                  {format(points[hover].values[s.key] ?? 0)}
                </span>
              </span>
            ))}
          </span>
        ) : (
          <span className="text-ink-muted">Point at the chart for a day.</span>
        )}
      </div>
    </ChartFrame>
  );
}

/**
 * Magnitude across named things. Horizontal, because the names are words and
 * words read along a row.
 */
export function BarChart({
  title,
  description,
  rows,
  format: formatName = "count",
  colorIndex = 0,
}: {
  title: string;
  description?: string;
  rows: { label: string; value: number; note?: string }[];
  format?: Format;
  /** One colour for every bar. Length already encodes size; hue must not repeat it. */
  colorIndex?: number;
}) {
  const format = FORMATTERS[formatName] ?? compact;
  const color = SERIES_COLORS[colorIndex % SERIES_COLORS.length];
  const max = Math.max(1, ...rows.map((r) => r.value));

  if (rows.length === 0) {
    return (
      <ChartFrame title={title} description={description}>
        <p className="mt-4 text-sm text-ink-muted">Nothing to show yet.</p>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame title={title} description={description}>
      <ul className="mt-4 space-y-3">
        {rows.map((row) => (
          <li key={row.label}>
            <div className="flex items-baseline justify-between gap-4 text-xs">
              <span className="truncate text-ink-soft" title={row.label}>
                {row.label}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-ink">
                {format(row.value)}
                {row.note && (
                  <span className="ml-2 font-normal text-ink-muted">{row.note}</span>
                )}
              </span>
            </div>
            {/* Track in the surface, fill in the series hue. 10px tall — well
                under the 24px cap, and the leftover is deliberate air. */}
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-r-[4px] bg-surface">
              <div
                className="h-full rounded-r-[4px]"
                style={{
                  width: `${Math.max(row.value > 0 ? 1.5 : 0, (row.value / max) * 100)}%`,
                  background: color,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </ChartFrame>
  );
}

/**
 * A number that does not need a chart.
 *
 * Most of what a dashboard has to say is one figure. `delta` is signed and names
 * its period, because "+12" against nothing is not information.
 */
export function StatTile({
  label,
  value,
  delta,
  hint,
  tone = "plain",
}: {
  label: string;
  value: string;
  delta?: { value: number; period: string; upIsGood?: boolean };
  hint?: string;
  tone?: "plain" | "flag";
}) {
  const good = delta ? (delta.upIsGood ?? true) === delta.value >= 0 : true;

  return (
    <div className="rounded-2xl border border-line bg-paper px-5 py-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p
        className={`mt-1.5 text-2xl font-semibold ${
          tone === "flag" ? "text-flag" : "text-ink"
        }`}
      >
        {value}
      </p>
      {delta && delta.value !== 0 && (
        <p className={`mt-1 text-xs ${good ? "text-accent" : "text-flag"}`}>
          {delta.value > 0 ? "+" : ""}
          {compact(delta.value)} {delta.period}
        </p>
      )}
      {hint && <p className="mt-1 text-xs leading-relaxed text-ink-muted">{hint}</p>}
    </div>
  );
}
