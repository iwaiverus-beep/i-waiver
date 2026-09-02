import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container, PAGE_PADDING } from "@/components/ui";
import { Note } from "@/components/app-ui";
import { GroupBoard } from "@/components/GroupBoard";
import { NotAuthorised, requireActor } from "@/lib/agreements/access";
import { groupBoard, groupForActor } from "@/lib/agreements/groups";

export const metadata: Metadata = { title: "Booking" };
export const dynamic = "force-dynamic";

/**
 * One booking: the loan, and everybody else aboard.
 *
 * Assembled on the server from the agreements themselves. There is no counter of
 * signatures kept on the booking to read instead, on purpose — see
 * `groupBoard` — because this is the screen where somebody decides whether to let
 * a family onto a boat, and a stale number is worse there than anywhere else in
 * the product.
 */
export default async function GroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let board;
  try {
    const { db, originatorIds } = await requireActor();
    const group = await groupForActor(db, originatorIds, id);
    board = await groupBoard(db, group);
  } catch (error) {
    if (error instanceof NotAuthorised) notFound();
    throw error;
  }

  const rental = board.members.find((m) => m.role === "rental");

  return (
    <Container className={PAGE_PADDING}>
      <Link href="/dashboard" className="text-sm text-ink-muted hover:text-ink">
        ← All agreements
      </Link>

      <h1 className="mt-4 font-serif text-3xl tracking-tight">{board.group.label}</h1>
      <p className="mt-2 text-sm text-ink-soft">
        {rental
          ? `${rental.displayName} took it. Everybody else signs their own release.`
          : "This booking has no loan on it."}
      </p>

      <div className="mt-8 space-y-4">
        <Note>
          <strong className="font-semibold">Why one waiver is not enough.</strong> A
          release only covers the person who signed it — an adult cannot give one on
          another adult's behalf. So each person aboard gets their own, running
          between them and you, over the same boat and the same hours. One of them
          being torn up does not touch the rest.
        </Note>
      </div>

      <div className="mt-8">
        <GroupBoard
          groupId={board.group.id}
          label={board.group.label}
          closed={Boolean(board.group.closed_at)}
          members={board.members}
          link={board.link}
        />
      </div>
    </Container>
  );
}
