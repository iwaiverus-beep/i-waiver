-- Several households, one boat.
--
-- Until now an agreement had exactly two sides: a lender and a borrower. That is
-- the right shape for the loan itself, and it stays the shape of the loan. What it
-- cannot describe is the other nine people who get on the boat — a charter taken
-- by three families, a corporate day out, four couples on one pontoon. Every adult
-- aboard is exposed to the same risk, and not one of them can be released by
-- somebody else's signature: an adult cannot waive another adult's claims, so a
-- single document naming one borrower protects the lender against one person.
--
-- The answer is NOT more borrowers on one agreement. It is a third role, on its
-- own instrument:
--
--   * a `borrower` takes custody. Damage, return condition, deposit, the bailment.
--     Exactly one, exactly as before.
--   * a `participant` takes part. Assumption of risk, release, covenant not to sue.
--     They never had the thing, so nothing that speaks about returning it in good
--     order can honestly be put in front of them.
--
-- Each participant signs their own release, against the same lender, the same
-- schedule of items and the same window. One release struck down takes only itself,
-- which is the same reasoning that keeps the four instruments as separate clause
-- records rather than one document.
--
-- This migration only adds the enum values. They are used by 20260901000023 and
-- afterwards, and a new enum value cannot be used in the transaction that adds it —
-- which is the entire reason this is its own file and not the top of that one.

alter type signer_role add value if not exists 'participant';

-- The audit chain records which side acted. A participant is not the borrower and
-- flattening them into one would make the trail for a twelve-person booking read as
-- twelve borrowers on a boat that was lent to one.
alter type audit_actor add value if not exists 'participant';
