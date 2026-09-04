-- Where an imported contact says it came from.
--
-- `contacts.source` already distinguished manual typing from the device picker,
-- and migration 9 says why that distinction is worth keeping: rows from the
-- picker "arrive unverified and often partial", so knowing which they are tells
-- you how much to trust what is in them before you send somebody an agreement.
--
-- A spreadsheet is the same bargain and more so. A CSV exported from whatever
-- system somebody used before this one carries addresses nobody has checked in
-- years, phone numbers Excel has helpfully reformatted, and a proportion of rows
-- that are not people at all. Recording them as 'manual' would assert that a
-- human typed each one and looked at it, which is the opposite of what happened.
--
-- The constraint is replaced rather than dropped. An unconstrained text column
-- would accept a typo forever and the value only ever gets read by code that
-- switches on it.
alter table contacts drop constraint contacts_source_check;

alter table contacts add constraint contacts_source_check
  check (source in ('manual', 'device', 'agreement', 'import'));

comment on column contacts.source is
  'How the row got here. ''import'' and ''device'' both mean nobody typed it and nobody has checked it — see the note in migration 47.';
