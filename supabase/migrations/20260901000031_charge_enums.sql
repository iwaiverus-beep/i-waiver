-- Money between the two parties — the enum values, on their own.
--
-- Same reason 20260901000022 is its own file: a new value on an existing enum
-- cannot be used in the transaction that adds it. These are used by
-- 20260901000033 and afterwards.
--
-- --- On `commercial_use` -----------------------------------------------------
--
-- The gate that stops an individual lender charging for use.
--
-- Lending a jet ski to a friend is a gratuitous bailment. Charging them for the
-- use of it is a bailment for hire, and that is not a billing difference — it is a
-- different insurable risk. Personal watercraft, boat and auto policies exclude
-- use for a fee, so the moment an individual charges a usage fee their own policy
-- stops responding, and anything we bound alongside it was priced against a risk
-- that no longer exists.
--
-- Which means the fee schedule is a rating input, not decoration. Worse: if we
-- print it on the instrument, we have manufactured the document that proves the
-- exclusion applies. So this is a blocking check like every other one in
-- `lib/compliance.ts`, and 20260901000033 also enforces it in the database, where
-- it cannot be forgotten by a new caller.
--
-- The reimbursement line items — fuel, cleaning, the ramp fee — do not trip it.
-- Splitting the cost of a tank of gas is not consideration for the use of the
-- thing, and treating it as though it were would refuse the ordinary case the P2P
-- product exists to serve.

alter type compliance_check_kind add value if not exists 'commercial_use';

-- --- On the audit values -----------------------------------------------------
--
-- `paid` already exists and means we saw the money: a processor told us. It must
-- keep meaning exactly that.
--
-- When two people settle between themselves over Venmo we see nothing. The lender
-- ticking "they paid me" is that lender's assertion, and a trail that records it
-- as `paid` would read, two years later, as though the platform had verified a
-- payment it never touched. So it gets its own value and its own word.

alter type audit_event_type add value if not exists 'charge_stated';
alter type audit_event_type add value if not exists 'settlement_asserted';
