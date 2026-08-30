"use client";

import { useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/format";

/**
 * The borrower's half of the signing moment.
 *
 * Cover is offered here, before the signature, because that is the whole product
 * thesis: the coverage is part of what they sign, not an upsell afterwards. It is
 * never a precondition — the buttons work with nothing selected.
 */

type QuoteOption = {
  quote_id: string;
  coverage_kind: string;
  limit_cents: number | null;
  deductible_cents: number | null;
  premium_cents: number;
  summary: string;
};

type Outcome = {
  executed: boolean;
  documentHash: string;
  policies: { number: string; kind: string; premiumCents: number }[];
};

export function SigningFlow({
  token,
  signerName,
  consentText,
  coverRequested,
  documentHash,
  educationRequired = false,
  educationAuthority = null,
}: {
  token: string;
  signerName: string;
  consentText: string;
  coverRequested: boolean;
  documentHash: string;
  educationRequired?: boolean;
  educationAuthority?: string | null;
}) {
  const [quotes, setQuotes] = useState<QuoteOption[] | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [isAdult, setIsAdult] = useState(false);
  const [holdsCard, setHoldsCard] = useState(false);
  const [consented, setConsented] = useState(false);

  const [method, setMethod] = useState<"typed" | "drawn">("typed");
  const [typedName, setTypedName] = useState(signerName);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const padRef = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    if (!coverRequested) {
      setQuotes([]);
      return;
    }

    let cancelled = false;
    fetch(`/api/sign/${token}/quote`, { method: "POST" })
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.unavailable) setQuoteError(body.unavailable);
        setQuotes(body.options ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          // Cover that cannot be priced must never stand between someone and the
          // agreement they came to sign.
          setQuoteError("Cover could not be priced right now.");
          setQuotes([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token, coverRequested]);

  const selectedTotal = (quotes ?? [])
    .filter((q) => selected.has(q.quote_id))
    .reduce((sum, q) => sum + q.premium_cents, 0);

  function toggle(quoteId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(quoteId)) next.delete(quoteId);
      else next.add(quoteId);
      return next;
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setReasons([]);

    const drawnPng = method === "drawn" ? padRef.current?.toDataUrl() ?? null : null;

    if (method === "drawn" && (!drawnPng || padRef.current?.isEmpty())) {
      setError("Draw your signature in the box first.");
      setBusy(false);
      return;
    }

    const response = await fetch(`/api/sign/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method,
        typed_name: typedName,
        drawn_png: drawnPng,
        consented,
        is_adult: isAdult,
        holds_education_card: holdsCard,
        quote_ids: [...selected],
      }),
    });

    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? "Could not record your signature.");
      setReasons(body.reasons ?? []);
      return;
    }

    setOutcome(body);
  }

  if (outcome) {
    return (
      <div className="rounded-2xl border border-accent/25 bg-accent-soft px-7 py-8">
        <h2 className="font-serif text-2xl tracking-tight text-accent">
          {outcome.executed ? "Done — everyone has signed." : "Signed. Thank you."}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-accent">
          {outcome.executed
            ? "A PDF is on its way to your inbox. It has the full text, both signatures and the audit trail in it."
            : "We are waiting on the other party. You will get the PDF by email once they have signed."}
        </p>

        {outcome.policies.length > 0 && (
          <div className="mt-6 border-t border-accent/20 pt-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">
              Cover bound
            </p>
            <ul className="mt-2 space-y-1.5">
              {outcome.policies.map((policy) => (
                <li key={policy.number} className="text-sm text-accent">
                  {policy.kind.replace(/_/g, " ")} · {policy.number} ·{" "}
                  {formatCents(policy.premiumCents)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-6 break-all font-mono text-[11px] leading-relaxed text-accent/70">
          You signed this exact wording: {outcome.documentHash}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {coverRequested && (
        <section>
          <h2 className="font-serif text-2xl tracking-tight">Cover for these days</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Optional, and it runs exactly as long as the loan does. Nothing is charged
            until you sign, and you can sign without taking any of it.
          </p>

          <div className="mt-5 space-y-3">
            {quotes === null && (
              <p className="text-sm text-ink-muted">Pricing…</p>
            )}

            {quoteError && (
              <p className="rounded-xl border border-line bg-surface px-5 py-4 text-sm text-ink-soft">
                {quoteError} You can still sign the agreement.
              </p>
            )}

            {quotes?.map((quote) => (
              <label
                key={quote.quote_id}
                className={`flex cursor-pointer gap-4 rounded-xl border px-5 py-4 transition-colors ${
                  selected.has(quote.quote_id)
                    ? "border-accent bg-accent-soft"
                    : "border-line bg-paper hover:border-ink/25"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(quote.quote_id)}
                  onChange={() => toggle(quote.quote_id)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[#1B5E4F]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold capitalize text-ink">
                      {quote.coverage_kind.replace(/_/g, " ")}
                    </span>
                    <span className="text-sm font-semibold text-ink">
                      {formatCents(quote.premium_cents)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                    {quote.summary}
                  </p>
                </div>
              </label>
            ))}

            {quotes?.length === 0 && !quoteError && (
              <p className="rounded-xl border border-line bg-surface px-5 py-4 text-sm text-ink-soft">
                No cover is available for this loan.
              </p>
            )}
          </div>

          {selectedTotal > 0 && (
            <p className="mt-4 text-sm font-semibold text-ink">
              Total {formatCents(selectedTotal)}, collected by the insurer.
            </p>
          )}
        </section>
      )}

      <section>
        <h2 className="font-serif text-2xl tracking-tight">Before you sign</h2>
        <div className="mt-5 space-y-4">
          <Check checked={isAdult} onChange={setIsAdult}>
            I am 18 or older.
          </Check>

          {educationRequired && (
            <Check checked={holdsCard} onChange={setHoldsCard}>
              I hold the boating safety education card required by{" "}
              {educationAuthority ?? "this state"}.
            </Check>
          )}
        </div>
      </section>

      <section>
        <h2 className="font-serif text-2xl tracking-tight">Signing electronically</h2>
        <div className="mt-4 max-h-56 overflow-y-auto rounded-xl border border-line bg-surface px-5 py-4">
          {consentText
            .split(/\n{2,}/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean)
            .map((paragraph, index) => (
              <p
                key={index}
                className={`text-sm leading-relaxed ${
                  /^\*\*[\s\S]*\*\*$/.test(paragraph)
                    ? "font-semibold text-ink"
                    : "mt-3 text-ink-soft first:mt-0"
                }`}
              >
                {paragraph.replace(/\*\*/g, "")}
              </p>
            ))}
        </div>
        <div className="mt-4">
          <Check checked={consented} onChange={setConsented}>
            I agree to sign this electronically, and I can keep a copy.
          </Check>
        </div>
      </section>

      <section>
        <h2 className="font-serif text-2xl tracking-tight">Your signature</h2>

        <div className="mt-4 flex gap-2">
          <Tab active={method === "typed"} onClick={() => setMethod("typed")}>
            Type it
          </Tab>
          <Tab active={method === "drawn"} onClick={() => setMethod("drawn")}>
            Draw it
          </Tab>
        </div>

        {method === "typed" ? (
          <div className="mt-4">
            <input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              className="w-full rounded-xl border border-line bg-paper px-5 py-4 font-serif text-2xl text-ink outline-none focus:border-accent"
            />
          </div>
        ) : (
          <SignaturePad ref={padRef} />
        )}
      </section>

      {error && (
        <div className="rounded-xl border border-flag/30 bg-flag/[0.06] px-5 py-4">
          <p className="text-sm font-semibold text-flag">{error}</p>
          {reasons.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-flag">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <button
          onClick={submit}
          disabled={busy || !consented}
          className="w-full rounded-full bg-accent px-6 py-4 text-base font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {busy ? "Recording…" : selectedTotal > 0 ? `Sign and take the cover — ${formatCents(selectedTotal)}` : "Sign"}
        </button>
        <p className="mt-3 break-all text-center font-mono text-[10px] leading-relaxed text-ink-muted">
          Signing binds you to this exact wording: {documentHash}
        </p>
      </div>
    </div>
  );
}

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[#1B5E4F]"
      />
      <span className="text-sm leading-relaxed text-ink">{children}</span>
    </label>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
        active
          ? "bg-ink text-paper"
          : "border border-line text-ink-soft hover:border-ink/30"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Signature pad
//
// A drawn signature is an image of a mark, not a biometric identifier: no
// template is extracted and nothing is matched against anything. That distinction
// is what keeps this the right side of BIPA and its equivalents, and it is why the
// pad captures a picture and stops there.
// ---------------------------------------------------------------------------

type SignaturePadHandle = {
  toDataUrl: () => string | null;
  isEmpty: () => boolean;
  clear: () => void;
};

function SignaturePad({
  ref,
}: {
  ref: React.RefObject<SignaturePadHandle | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Draw at device resolution so the stored PNG is not a blurry upscale of a
    // CSS-sized canvas.
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0B1622";

    ref.current = {
      toDataUrl: () => (dirty.current ? canvas.toDataURL("image/png") : null),
      isEmpty: () => !dirty.current,
      clear: () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        dirty.current = false;
      },
    };
  }, [ref]);

  function position(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  return (
    <div className="mt-4">
      <canvas
        ref={canvasRef}
        className="h-40 w-full touch-none rounded-xl border border-line bg-paper"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const ctx = canvasRef.current?.getContext("2d");
          if (!ctx) return;
          const { x, y } = position(event);
          ctx.beginPath();
          ctx.moveTo(x, y);
          drawing.current = true;
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const ctx = canvasRef.current?.getContext("2d");
          if (!ctx) return;
          const { x, y } = position(event);
          ctx.lineTo(x, y);
          ctx.stroke();
          dirty.current = true;
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerLeave={() => {
          drawing.current = false;
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.clear()}
        className="mt-2 text-xs font-semibold text-ink-muted hover:text-ink"
      >
        Clear
      </button>
    </div>
  );
}
