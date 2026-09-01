-- Two audit values, on their own, for the same reason as 20260901000022 and
-- 20260901000031: a new value on an existing enum cannot be used in the
-- transaction that adds it. Used by 20260901000035 and the code alongside it.
--
-- --- On `bounced` ------------------------------------------------------------
--
-- `delivered` has always meant "the provider accepted it" — see the note on
-- `signing_links.delivered_at` and the comment at the top of lib/email.ts, which
-- is careful to call that a claim that something left the building. It has never
-- meant the message arrived.
--
-- Nothing recorded the other outcome. A full mailbox, a typo, a dead domain: the
-- send succeeded, the row said `delivered`, and the lender found out because the
-- borrower never signed. That is the failure this pair of migrations exists to
-- make visible, so it gets its own audit value rather than an absence.
--
-- --- On `contact_updated` ----------------------------------------------------
--
-- Correcting a bounced address is not a neutral edit. The signer's email is
-- inside the canonical text — `borrower: Jane <jane@example.com> [id]` — so
-- changing it re-renders the document and changes its hash. That is only safe
-- while nobody has signed, and the application enforces it; the audit trail is
-- what makes it reviewable afterwards.
--
-- It records the old value as well as the new one. "The address was changed" is
-- half a fact, and the half that matters in a dispute is what it was changed
-- from — that is the record of where a capability to sign was originally sent.

alter type audit_event_type add value if not exists 'bounced';
alter type audit_event_type add value if not exists 'contact_updated';
