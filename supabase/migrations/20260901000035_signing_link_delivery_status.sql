-- What actually became of the message.
--
-- `signing_links` has carried `delivered_at` and `delivery_ref` since the initial
-- schema, and both are honest about what they are: the moment the provider
-- ACCEPTED the message, and the provider's id for it. Neither says whether it
-- arrived, and until now nothing did.
--
-- So a bounce was invisible. The lender pressed "Email a link", Resend took it,
-- the row said delivered, and the mailbox was full. The page went on reading
-- `sent` and the only signal was silence — the borrower never signing, days
-- later, for a reason nobody could see from this screen.
--
-- The fix is a webhook and somewhere to put what it says. `delivery_ref` is
-- already the join key: it holds `resend:<message id>`, which is exactly what the
-- provider sends back.

create type delivery_status as enum
  ('pending', 'sent', 'delivered', 'bounced', 'complained', 'delayed');

comment on type delivery_status is
  'What became of one message. pending = the link exists but was never sent, which is the ordinary case for the lender''s own link. sent = the provider accepted it. Everything after that is the provider telling us what happened next.';

alter table signing_links
  add column delivery_status    delivery_status not null default 'pending',
  add column delivery_status_at timestamptz,
  add column delivery_detail    text;

comment on column signing_links.delivery_status is
  'The outcome, as far as we have been told. Distinct from delivered_at, which is only ever the moment the provider took the message off our hands.';
comment on column signing_links.delivery_status_at is
  'When the status last moved. From the provider''s own event timestamp where it gives one, so a replayed webhook does not re-date an old bounce to now.';
comment on column signing_links.delivery_detail is
  'The provider''s reason, verbatim and truncated. "Mailbox full" and "domain does not exist" need different actions from a lender, and collapsing both to "bounced" throws away the half that says what to do.';

-- Existing rows: `sent`, never `delivered`.
--
-- We know the provider accepted these, because that is the only thing
-- `delivered_at` was ever set from. We do not know that any of them arrived, and
-- backfilling them as delivered would manufacture evidence for every message sent
-- before this migration existed.
update signing_links
   set delivery_status = 'sent',
       delivery_status_at = delivered_at
 where delivered_at is not null;

-- The webhook's whole query. It arrives holding a provider message id and nothing
-- else, and has to find one row by it.
create index signing_links_delivery_ref_idx
  on signing_links (delivery_ref)
  where delivery_ref is not null;

-- The lender's screen — the newest link for a signer and what became of it — is
-- already served by signing_links_signer_idx (signer_id, created_at desc) from
-- the initial schema. No second index for it.
