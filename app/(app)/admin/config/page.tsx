import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { Panel } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import {
  ActivityManager,
  ReadinessMatrix,
  StateEditor,
} from "@/components/ConfigTools";
import { currentStaff } from "@/lib/platform/access";
import { staffCan } from "@/lib/platform/roles";
import {
  STATE_STATUS_LABELS,
  WAIVER_EFFICACIES,
  configView,
} from "@/lib/platform/config";
import { canOriginate } from "@/lib/readiness";

export const metadata: Metadata = { title: "Configuration" };
export const dynamic = "force-dynamic";

/**
 * Where the product is open, and what is missing where it is not.
 *
 * The screen is organised around a fact that took a long time to be visible:
 * opening a state for an activity needs four things, owned by four different
 * people, and until this page existed the only way to discover which of them was
 * missing was to attempt a document and read the refusal.
 *
 * Almost nothing here is editable, and that is the honest shape of it. A filing
 * is a regulator's decision recorded on the carrier screen. A rule set and a
 * template version are immutable published artefacts — the whole evidence model
 * rests on being able to say, two years later, exactly which version applied. The
 * two things a person decides here are whether counsel has read the wording and
 * how enforceable a release is in that state.
 */
export default async function ConfigPage() {
  const staff = await currentStaff();
  if (!staff) notFound();

  const { states, activities, readiness } = await configView(staff.db);
  const canEdit = staffCan(staff.role, "compliance.states");

  // How many states each activity is actually open in, for the private loan —
  // the only instrument any lender can create today. Context beside the
  // vocabulary, so an activity nobody can use anywhere is visibly that.
  const usage: Record<string, number> = {};
  for (const row of readiness) {
    if (!canOriginate(row, "individual", "rental")) continue;
    usage[row.activity_class] = (usage[row.activity_class] ?? 0) + 1;
  }

  const liveCount = readiness.filter(
    (r) => canOriginate(r, "individual", "rental") && r.clause_set_reviewed_at,
  ).length;
  const writableCount = readiness.filter((r) =>
    canOriginate(r, "individual", "rental"),
  ).length;

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">Configuration</h1>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
        {writableCount === 0 ? (
          <>
            No combination of state and activity can currently produce a document.
            The matrix below says which piece is missing in each.
          </>
        ) : (
          <>
            {writableCount} combination{writableCount === 1 ? "" : "s"} can produce a
            document; {liveCount} of {writableCount === 1 ? "it has" : "them have"}{" "}
            been through counsel and print without the specimen banner. The matrix
            says which piece is missing everywhere else.
          </>
        )}
      </p>

      <div className="mt-10 space-y-8">
        <Panel
          title="Readiness"
          description="Every state against every activity. Click a cell for what is missing."
        >
          <ReadinessMatrix readiness={readiness} activities={activities} />
        </Panel>

        <Panel
          title="Activities"
          description="The vocabulary. Adding one opens nothing — it gives the matrix a column, and the filings, rule sets and wording still have to arrive."
        >
          <ActivityManager
            activities={activities}
            canEdit={canEdit}
            usage={usage}
          />
        </Panel>

        <Panel
          title="States"
          description="Whether a state is open is decided by the carrier filings and shown here read-only. The clause-set review and the enforceability reading are decided here."
        >
          <StateEditor
            states={states}
            canEdit={canEdit}
            efficacies={WAIVER_EFFICACIES}
            statusLabels={STATE_STATUS_LABELS}
          />
        </Panel>

        <Panel title="What this screen cannot do">
          <ul className="space-y-3 text-sm leading-relaxed text-ink-soft">
            <li>
              <strong className="font-semibold text-ink">Open a state.</strong>{" "}
              That is an approved carrier filing, recorded against the product on the
              carrier screen. The column here is a cache of those filings and a value
              written over it would be overwritten by the next filing change.
            </li>
            <li>
              <strong className="font-semibold text-ink">
                Publish a rule set or a template.
              </strong>{" "}
              Both are versioned, immutable once published, and arrive in a
              migration. A compliance check has to be able to name the version it
              applied years later, and an editable one destroys that.
            </li>
            <li>
              <strong className="font-semibold text-ink">
                Review one lender kind without the other.
              </strong>{" "}
              The clause-set review is recorded per state, not per state and lender
              kind. Recording it flips both the private and the business wording out
              of specimen at once. Nothing unreviewed can reach a signer — the render
              guard still refuses unpublished clause versions — but that column needs
              splitting before a second lender kind is published in a state where the
              first already is.
            </li>
          </ul>
        </Panel>
      </div>
    </Container>
  );
}
