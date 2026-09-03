import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { PageIntro } from "@/components/PageIntro";
import { Note, Panel } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import { currentStaff } from "@/lib/platform/access";
import { staffCan } from "@/lib/platform/roles";
import {
  BRAND_COLOURS,
  BRAND_KIT,
  BRAND_TYPE,
  describeFile,
  printWidth,
  type BrandAsset,
} from "@/lib/marketing/brand-kit";

export const metadata: Metadata = { title: "Marketing" };
export const dynamic = "force-dynamic";

/**
 * Where the logo lives, so that asking for it is not a conversation.
 *
 * Until this screen existed the mark was only ever drawn — components/Mark.tsx
 * on the site, scripts/make-icons.mjs for the app icons — and there was no file
 * anybody could be handed. Every request for it therefore became a small piece
 * of work for whoever could run a build, and what came back was whatever that
 * person happened to export that day. Two people asking twice got two logos.
 *
 * The files themselves are static, sitting in public/brand/ and served from the
 * CDN; this page is only the index over them, and the downloads never touch a
 * server route. The page is still rendered per request, because reading who is
 * asking is what decides whether it renders at all.
 *
 * Gated on `marketing.read`, which today only a super admin has. Not because the
 * artwork is a secret — it is on every page of the site — but because a brand
 * kit is a thing you hand out, and who may hand it out should be a decision
 * somebody made rather than a side effect of being able to see the console.
 */
export default async function MarketingPage() {
  const staff = await currentStaff();
  if (!staff) notFound();
  // Presentation hides the tab; this is the authorisation. A person who guesses
  // the URL gets the same 404 as a person who is not staff at all.
  if (!staffCan(staff.role, "marketing.read")) notFound();

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <PageIntro title="Marketing" defaultOpen>
        The logo, in every format anybody has asked for. All of it is the same
        drawing — the one in the masthead above — rendered out rather than
        redrawn, so a shirt and a browser tab cannot end up disagreeing about
        what the mark looks like.
      </PageIntro>

      <div className="mt-10 space-y-8">
        {BRAND_KIT.map((group) => (
          <Panel key={group.heading} title={group.heading} description={group.blurb}>
            <div className="space-y-8">
              {group.assets.map((asset) => (
                <AssetBlock key={asset.id} asset={asset} />
              ))}
            </div>
          </Panel>
        ))}

        <Panel
          title="Which file to take"
          description="The formats are not interchangeable, and picking the wrong one is the usual way a logo ends up looking cheap."
        >
          <dl className="space-y-4 text-sm">
            <Guidance term="Going to a printer, an embroiderer, or a sign maker">
              The <strong>PDF</strong>. It is vector, so it is drawn at whatever
              size the press runs at, and the typeface travels inside the file
              rather than being substituted at the other end.
            </Guidance>
            <Guidance term="Going on a website, in an email, or into a deck">
              The <strong>PNG</strong>. It is transparent, so it sits on whatever
              is behind it. The <strong>SVG</strong> is better still on a web page
              you control.
            </Guidance>
            <Guidance term="Going somewhere that will not take transparency">
              The <strong>JPG</strong>. Advertising portals and older tools often
              refuse anything else. The background is baked in, so take the light
              or the dark one to match where it lands.
            </Guidance>
            <Guidance term="A profile picture">
              The square <strong>JPG</strong>. It is already the shape and the
              proportion these services want.
            </Guidance>
          </dl>
        </Panel>

        <Panel title="Colour" description="From tailwind.config.ts — the same values the site renders.">
          <ul className="grid gap-3 sm:grid-cols-2">
            {BRAND_COLOURS.map((colour) => (
              <li key={colour.hex} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 h-9 w-9 shrink-0 rounded-lg border border-line"
                  style={{ background: colour.hex }}
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {colour.name}{" "}
                    <span className="font-mono text-xs font-normal text-ink-muted">
                      {colour.hex}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                    {colour.use}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="Type"
          description="Both are open-licensed, so they can go to a designer or a print shop without anybody buying anything."
        >
          <dl className="space-y-4 text-sm">
            {BRAND_TYPE.map((face) => (
              <Guidance key={face.name} term={face.name}>
                {face.use} <span className="text-ink-muted">{face.licence}</span>
              </Guidance>
            ))}
          </dl>
        </Panel>

        <Panel title="Before you send it anywhere">
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
            <li>
              The clear space is already in the file. Every one of these has empty
              room built into its edges, so the logo can be placed flush against
              its container and still have air around it. Do not crop it off.
            </li>
            <li>
              Do not recolour the mark, redraw it, stretch one axis, or set the
              name in a different typeface. If a format is missing, it is faster to
              generate it than to approximate it.
            </li>
            <li>
              The reversed artwork is drawn in the pale colour, not filtered. Put
              the reversed files on dark and the standard files on light — swapping
              them produces something that looks nearly right and prints badly.
            </li>
            <li>
              The favicon and the app icons are a deliberately simpler drawing —
              no ring, no perforation. Below about 30 pixels the beads stop
              resolving and turn into a grey haze, so those sizes drop them. That
              is optical sizing, not a second logo.
            </li>
          </ul>
        </Panel>

        <Note>
          Everything here is written by{" "}
          <code className="font-mono text-xs">scripts/make-brand-assets.mjs</code>{" "}
          and committed. Re-run it if the mark or the name ever changes; nothing
          in the build regenerates it, so what is on this page is exactly what was
          last committed.
        </Note>
      </div>
    </Container>
  );
}

function Guidance({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-semibold text-ink">{term}</dt>
      <dd className="mt-1 leading-relaxed text-ink-soft">{children}</dd>
    </div>
  );
}

function AssetBlock({ asset }: { asset: BrandAsset }) {
  const dark = asset.plate === "dark";
  return (
    <div className="grid gap-5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:items-start">
      <div>
        {/*
          The preview is the shipped PNG at a small size rather than a re-drawn
          SVG, so what somebody approves on this page is the file they get. The
          plate behind it is the one the artwork is drawn for — showing reversed
          artwork on cream would be showing nothing at all.
        */}
        <div
          className={`flex aspect-[16/9] items-center justify-center rounded-xl border p-5 ${
            dark ? "border-ink bg-ink" : "border-line bg-surface"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a static file
              in public/, already at its final size; the optimiser has nothing to
              do here and would only put a transform in front of the CDN. */}
          <img
            src={`/brand/${asset.preview}`}
            alt={`${asset.title} — i-Waiver`}
            className="max-h-full max-w-full object-contain"
          />
        </div>
        <p className="mt-2.5 text-sm font-semibold text-ink">{asset.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          {asset.description}
        </p>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {asset.downloads.map((download) => {
          const print = printWidth(download.file, download.format);
          return (
            <li key={download.file}>
              <a
                href={`/brand/${download.file}`}
                download
                className="flex h-full flex-col rounded-xl border border-line bg-surface/50 px-4 py-3 transition-colors hover:border-ink/30 hover:bg-surface"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  {download.format}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                    className="text-ink-muted"
                  >
                    <path
                      d="M8 2v9m0 0l3.5-3.5M8 11L4.5 7.5M2.5 13.5h11"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="mt-1 font-mono text-[11px] text-ink-muted">
                  {describeFile(download.file, download.format)}
                  {print && ` · ${print}`}
                </span>
                <span className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                  {download.note}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
