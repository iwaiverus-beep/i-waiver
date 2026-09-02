-- Permission to text a borrower, recorded where they gave it.
--
-- Two facts and not one. `sms_consent_at` is when they ticked the box;
-- `sms_consent_text` is the exact sentence they were ticking. The second is not
-- redundant: the wording will be edited over the life of the product, and a
-- consent record that says only "yes, at 14:02" cannot answer the question a
-- TCPA complaint actually asks, which is what the person was agreeing to. This
-- is the same snapshot rule the templates follow — freeze the words onto the
-- record, never re-derive them from whatever the file says today.
--
-- WHAT THIS ROW IS NOT.
--
-- `agreement_requests` is deliberately disposable: it expires after fourteen
-- days and is purged without ceremony, because an unverified stranger's ask is
-- not evidence. That makes it the right place to record consent given AT the
-- form, and the wrong place to keep it. The permission has to be carried onto
-- the signer when a lender accepts the request, into the append-only side of the
-- schema where the rest of the evidence lives. Until that is built, this column
-- is a working flag with a fourteen-day life, not a durable consent record, and
-- nothing should treat it as one.
--
-- The lender's own copy of a borrower's number, typed in on their behalf in
-- components/SignerContact.tsx, gets no column here on purpose. One person
-- cannot consent for another, and a field the lender fills would look exactly
-- like one that says they did.

alter table agreement_requests
  add column sms_consent_at   timestamptz,
  add column sms_consent_text text;

comment on column agreement_requests.sms_consent_at is
  'When the borrower agreed, on this form, to be texted about this request. Null means they did not, and we may not text them.';

comment on column agreement_requests.sms_consent_text is
  'The exact wording shown beside the tick box, frozen at the moment it was ticked. Never re-read from application code.';

-- Consent to text is meaningless without a number to text, and a timestamp is
-- meaningless without the words it attaches to. Both halves or neither.
alter table agreement_requests
  add constraint sms_consent_is_complete
    check (
      (sms_consent_at is null and sms_consent_text is null)
      or (sms_consent_at is not null and sms_consent_text is not null and borrower_phone is not null)
    );
