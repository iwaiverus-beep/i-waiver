import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Container } from "@/components/ui";
import { Empty, Mono, Note, Panel } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import { SupportNav } from "@/components/SupportNav";
import { AdminInbox, HandledList } from "@/components/AdminInbox";
import { currentStaff } from "@/lib/platform/access";
import { staffCan } from "@/lib/platform/roles";
import { handledMail, listenerWired, triageQueue } from "@/lib/support/inbound";
import { siteOrigin, supportEmail } from "@/lib/env";

export const metadata: Metadata = { title: "Email listener" };
export const dynamic = "force-dynamic";

/**
 * The email listener console.
 *
 * A STATIC SEGMENT UNDER A DYNAMIC ONE. This sits at /admin/support/inbox while
 * /admin/support/[id] is a ticket. Next resolves a literal segment before a
 * dynamic one, so `inbox` reaches this file and never the ticket page — that is
 * defined behaviour and not a coincidence. It is worth knowing before adding a
 * third child here: any new literal name is permanently unavailable as a ticket
 * id, which is free while ids are uuids and would not be if they ever became
 * references like IW-1001.
 *
 * Two panels, and the order is the point. What is waiting comes first. What was
 * already dealt with comes second, and it is on the same screen because "did the
 * listener get the thing I sent it" is the first question anybody asks of a
 * mailbox integration — and a queue that empties into nowhere visible cannot
 * answer it.
 */
export default async function AdminInboxPage() {
  const staff = await currentStaff();
  if (!staff) notFound();

  const [queue, handled] = await Promise.all([
    triageQueue(staff.db),
    handledMail(staff.db),
  ]);

  const wired = listenerWired();
  const canTriage = staffCan(staff.role, "support.triage");

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">
        Email listener
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">
        Mail arriving at {supportEmail()}. A reply carrying a reference we issued
        joins its own thread by itself; everything else waits here for somebody to
        say whether it is support.
      </p>

      <div className="mt-8">
        <SupportNav untriaged={queue.length} />
      </div>

      <div className="space-y-8">
        {/*
          The unwired state is a statement, not an empty list.

          Every @i-waiver.com address is a forward into a Gmail inbox, and nothing
          in this repository can change that — the relay is a route in a mail
          account. So until one is pointed at the endpoint below, this screen says
          so. An empty queue and a working-but-quiet queue look identical, and the
          difference between them is two weeks of unanswered mail.
        */}
        {!wired && (
          <Note tone="warn">
            <p className="font-semibold">The listener is not wired up yet.</p>
            <p className="mt-2">
              Nothing can reach it while <Mono>INBOUND_EMAIL_SECRET</Mono> is
              unset — the endpoint refuses every request rather than accepting
              unsigned ones. Set it, then point a relay in front of{" "}
              {supportEmail()} at:
            </p>
            <p className="mt-2">
              <Mono>POST {siteOrigin()}/api/webhooks/inbound-email</Mono>
            </p>
            <p className="mt-2">
              It wants JSON — <Mono>to</Mono>, <Mono>from</Mono>,{" "}
              <Mono>subject</Mono>, <Mono>text</Mono>, <Mono>message_id</Mono> —
              and the secret in an <Mono>X-Inbound-Secret</Mono> header. A
              Cloudflare Email Worker on the route that already exists is the
              shortest path; a provider&rsquo;s inbound webhook works the same way.
            </p>
          </Note>
        )}

        <Panel
          title="Waiting to be triaged"
          description="Oldest first. Read it, then either open a ticket or say it is not support."
        >
          {queue.length === 0 ? (
            <Empty>
              {wired
                ? "Nothing waiting."
                : "Nothing here — and nothing can arrive until the listener is wired up."}
            </Empty>
          ) : (
            <AdminInbox messages={queue} canTriage={canTriage} />
          )}
        </Panel>

        <Panel
          title="Already dealt with"
          description="The last 60 messages, and what became of each. Nothing here is deleted."
        >
          {handled.length === 0 ? (
            <Empty>Nothing yet.</Empty>
          ) : (
            <HandledList rows={handled} />
          )}
        </Panel>
      </div>
    </Container>
  );
}
