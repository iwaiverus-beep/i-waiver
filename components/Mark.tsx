/** Where the accent dot sits: on the perforation radius, above the left tick. */
const DOT = { x: 19, y: 17.1, r: 4.2 };

const PERF_RADIUS = 19.8;
const PERF_COUNT = 20;
const BEAD_RADIUS = 1.2;

/**
 * The perforation, generated rather than hand-placed so this and the same
 * numbers in `scripts/make-icons.mjs` cannot drift apart.
 *
 * Beads that fall under the accent dot are dropped, so the dot reads as one
 * enlarged bead standing in for them rather than a blob covering them — left
 * in, they poke out from underneath as white slivers.
 */
const PERFORATION = Array.from({ length: PERF_COUNT }, (_, i) => {
  const angle = (i / PERF_COUNT) * Math.PI * 2 - Math.PI / 2;
  return {
    x: 32 + PERF_RADIUS * Math.cos(angle),
    y: 32 + PERF_RADIUS * Math.sin(angle),
  };
}).filter(
  ({ x, y }) => Math.hypot(x - DOT.x, y - DOT.y) > DOT.r + BEAD_RADIUS + 0.6,
);

/**
 * The seal: a perforated stamp around two ticks, with a dot on the perforation
 * that doubles as the tittle over an i — so the mark spells iW.
 *
 * Lives in its own file because two headers now draw it: the marketing masthead
 * and the signed-in one. Bigger than the old rounded square on purpose. The
 * beads are 2.4 units across in a 64-unit box, so below roughly 30px they stop
 * resolving and turn into a grey haze. `scripts/make-icons.mjs` draws a
 * simplified version — no ring, no perforation — for anything smaller, which is
 * why the favicon and this are deliberately not the same artwork.
 */
export function Mark() {
  return (
    <svg width="32" height="32" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="26.5" className="stroke-ink" strokeWidth="3.6" />
      {PERFORATION.map((bead) => (
        <circle
          key={`${bead.x}-${bead.y}`}
          cx={bead.x}
          cy={bead.y}
          r={BEAD_RADIUS}
          className="fill-ink"
        />
      ))}
      <g
        className="stroke-ink"
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 33l5 9 9-16" />
        <path d="M29 29l5 9 10-15" />
      </g>
      {/*
        Not `accent` (#1B5E4F). The dot has to contrast with the ink strokes, not
        with the paper behind them, and against ink the brand green reads as an
        off-colour smudge rather than a separate mark. Lifted for legibility.
      */}
      <circle cx={DOT.x} cy={DOT.y} r={DOT.r} fill="#1B8A72" />
    </svg>
  );
}
