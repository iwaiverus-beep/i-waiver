"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "./app-ui";
import { formatDate } from "@/lib/format";

export type ContactAgreement = {
  id: string;
  status: string;
  jurisdiction: string;
  activity_class: string;
  starts_at: string;
  ends_at: string;
  created_at: string;
  executed_at: string | null;
  archived_at: string | null;
  item_count: number;
};

/**
 * What this person has borrowed before.
 *
 * Loaded when it is opened rather than with the page: a lender with forty people
 * saved would otherwise pay forty history queries to look at a list of names.
 * Fetched once and kept, so opening and closing the same person again is free.
 *
 * The line at the bottom about matching is not an apology, it is the truth of the
 * design — contacts are deliberately never joined to the agreement graph, so this
 * list is found by name and email rather than looked up. Somebody who renamed a
 * contact should know why an old loan is not showing.
 */
export function ContactHistory({ contactId }: { contactId: string }) {
  const [rows, setRows] = useState<ContactAgreement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);

    fetch(`/api/contacts/${contactId}/history`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!live) return;
        if (!response.ok) {
          setError(body.error ?? "Could not load their history.");
          return;
        }
        setRows((body.agreements ?? []) as ContactAgreement[]);
      })
      .catch(() => {
        if (live) setError("Could not load their history.");
      });

    return () => {
      live = false;
    };
  }, [contactId]);

  if (error) {
    return <p className="mt-4 text-sm text-flag">{error}</p>;
  }

  if (rows === null) {
    return <p className="mt-4 text-sm text-ink-muted">Looking…</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="mt-4 text-sm text-ink-muted">
        Nothing yet — you have not written an agreement with them.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      {rows.map((row) => (
        <Link
          key={row.id}
          href={`/agreements/${row.id}`}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface/40 px-4 py-3 transition-colors hover:border-ink/25"
        >
          <span className="min-w-0">
            <span className="block text-sm text-ink">
              {row.item_count > 1
                ? `${row.item_count} items`
                : row.activity_class.replace(/_/g, " ")}{" "}
              in {row.jurisdiction}
            </span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              {formatDate(row.starts_at)} to {formatDate(row.ends_at)}
              {row.archived_at ? " · filed away" : ""}
            </span>
          </span>
          <StatusBadge status={row.status} />
        </Link>
      ))}

      <p className="pt-1 text-xs leading-relaxed text-ink-muted">
        Found by matching their name and email, because an agreement keeps its own
        copy of who signed it rather than pointing back at this list. Renaming
        someone here does not change an agreement they have already signed.
      </p>
    </div>
  );
}
