-- The participant release — specimen wording for Florida personal watercraft.
--
-- Same treatment as 20260830000006 in every respect that matters, and for the same
-- reasons. Every clause version here is seeded with `published_at` NULL and every
-- body opens with the specimen marker, so a production database built from these
-- files CANNOT render this instrument. That is CLAUDE.md constraint 5 made
-- physical, not an oversight to tidy up later. Publishing is counsel's act, in a
-- migration of its own, alongside `state_availability.clause_set_reviewed_at`.
--
-- To exercise the flow on a development database, the existing non-migration
-- script `supabase/seed/dev_publish_specimen_clauses.sql` picks this set up
-- automatically: it publishes every unpublished version whose body carries the
-- specimen marker, and then every template version whose whole set is published.
--
-- WHAT IS DIFFERENT FROM THE RENTER'S SET, AND WHY
--
-- Four instruments, not five. `damage_responsibility` is absent, and its absence is
-- the entire point of the instrument. That clause makes the signer answerable for
-- returning the thing in the condition they received it and for its declared value
-- if they do not. It can only be given by somebody who took custody. A passenger
-- never had the boat, so putting it to them would be asking them to promise
-- something about a thing that was never theirs to return — and, in a claim,
-- inviting the argument that the whole document was boilerplate nobody meant.
--
-- The renter still signs it. One person took the boat, and that one owes for the
-- hull. That is the `rental` agreement in the booking; this is everybody else.
--
-- The ESIGN consent is SHARED with the renter's set — the same clause version id
-- appears in both clause sets. It is a disclosure about signing electronically, not
-- about who is on the boat, and a second copy of it would be one more thing to keep
-- in step.

do $seed$
declare
  v_clause_id  uuid;
  v_version_id uuid;
  v_ids        uuid[] := '{}';
  v_esign      uuid;
  v_template   uuid;
  v_marker     text := '**SPECIMEN LANGUAGE — DRAFTED AS A STRUCTURAL PLACEHOLDER AND NOT REVIEWED BY COUNSEL. NOT LEGAL ADVICE. NOT FOR USE WITH A REAL SIGNER.**' || E'\n\n';
  v_spec       record;
begin
  for v_spec in
    select * from (values
      ('assumption_of_risk'::clause_kind, 'FL'::text, 'Assumption of Risk — Participant on a Personal Watercraft (Florida)', 1,
       'You are voluntarily choosing to ride on, or otherwise take part in an activity involving, a personal watercraft that {{lender_name}} has made available. Being aboard a personal watercraft is a hazardous recreational activity, and it is hazardous whether or not you are the person operating it. Risks include, without limitation, collision with other vessels, fixed objects, or persons; ejection from the vessel; capsizing; drowning; propulsion and jet-thrust injuries; sudden manoeuvres and sudden loss of steering; changing weather, wave, wake, current and visibility conditions; the acts or omissions of the operator and of other persons on the water; and the failure, malfunction or misuse of equipment.

You confirm that you understand these risks, that you are physically able to take part, and that you accept the risks knowingly and voluntarily. You are accepting them whether they arise from the nature of the activity itself or from the ordinary negligence of {{lender_name}}.

Specific facts: the watercraft is described as {{asset_description}}, the activity takes place in {{jurisdiction}}, and the period runs from {{starts_at}} to {{ends_at}}. You are signing as a participant, not as the person who has taken the watercraft.'),

      ('release'::clause_kind, 'FL', 'Release of Liability — Participant (Florida)', 1,
       'IN EXCHANGE FOR BEING PERMITTED TO TAKE PART IN THIS ACTIVITY, YOU, {{participant_name}}, RELEASE AND DISCHARGE {{lender_name}}, AND THEIR HEIRS, EXECUTORS, ADMINISTRATORS AND ASSIGNS, FROM ANY AND ALL CLAIMS, DEMANDS, ACTIONS AND CAUSES OF ACTION FOR PERSONAL INJURY, DEATH OR PROPERTY DAMAGE ARISING OUT OF YOUR PARTICIPATION DURING THE PERIOD DESCRIBED ABOVE, INCLUDING CLAIMS ARISING FROM THE ORDINARY NEGLIGENCE OF {{lender_name}}.

THIS RELEASE DOES NOT APPLY TO GROSS NEGLIGENCE, TO INTENTIONAL OR RECKLESS MISCONDUCT, OR TO ANY LIABILITY THAT APPLICABLE LAW DOES NOT PERMIT TO BE RELEASED.

YOU ARE RELEASING ONLY YOUR OWN CLAIMS. NOBODY ELSE ABOARD IS RELEASING ANYTHING BY YOUR SIGNATURE, AND YOUR SIGNATURE DOES NOT BIND ANY OTHER PERSON.

YOU ARE GIVING UP LEGAL RIGHTS BY AGREEING TO THIS PARAGRAPH. READ IT BEFORE YOU SIGN.'),

      ('covenant_not_to_sue'::clause_kind, 'FL', 'Covenant Not to Sue — Participant (Florida)', 1,
       'You agree that you will not commence or maintain any lawsuit, arbitration or other proceeding against {{lender_name}} for any claim released in this agreement. If you do, and the claim is one that was released, you agree that this agreement may be pleaded as a complete defence.

Nothing in this paragraph prevents you from bringing a claim that this agreement does not release, or from making a claim under any policy of insurance issued in connection with this activity.'),

      ('indemnity'::clause_kind, 'FL', 'Indemnity — Participant (Florida)', 1,
       'You agree to indemnify and hold {{lender_name}} harmless from any claim brought by a third party arising out of your own acts or omissions while taking part, including reasonable legal fees actually incurred.

This obligation does not extend to any claim arising from the gross negligence or intentional misconduct of {{lender_name}}, does not make you responsible for the acts of any other person aboard, and applies only to the extent permitted by the law of {{jurisdiction}}.

You are not responsible under this agreement for damage to the watercraft itself. That responsibility sits with the person who took it, under their own agreement.')
    ) as t(kind, jurisdiction, label, version, body)
  loop
    -- Looked up on all three parts of the new key. Before 20260901000023 the
    -- lookup in 20260830000006 could assume (kind, jurisdiction) named one row;
    -- it cannot now, and a lookup that still assumed it would find the renter's
    -- release and version the wrong instrument.
    select c.id into v_clause_id
    from clauses c
    where c.kind = v_spec.kind
      and c.jurisdiction = v_spec.jurisdiction
      and c.instrument_kind = 'participant';

    if v_clause_id is null then
      insert into clauses (kind, jurisdiction, instrument_kind, label)
      values (v_spec.kind, v_spec.jurisdiction, 'participant', v_spec.label)
      returning id into v_clause_id;
    end if;

    select cv.id into v_version_id
    from clause_versions cv
    where cv.clause_id = v_clause_id and cv.version = v_spec.version;

    if v_version_id is null then
      insert into clause_versions (
        clause_id, version, body_md, body_hash,
        requires_separate_signature, conspicuous_formatting, published_at
      )
      values (
        v_clause_id,
        v_spec.version,
        v_marker || v_spec.body,
        encode(extensions.digest(v_marker || v_spec.body, 'sha256'), 'hex'),
        v_spec.kind in ('release', 'indemnity'),
        case
          when v_spec.kind in ('release', 'indemnity')
            then jsonb_build_object('uppercase', true, 'bold', true, 'min_font_pt', 10)
          else '{}'::jsonb
        end,
        -- Deliberately null. Publishing is counsel's act, not a migration's.
        null
      )
      returning id into v_version_id;
    end if;

    v_ids := v_ids || v_version_id;
  end loop;

  -- The shared ESIGN consent, last in the set exactly as it is for the renter.
  select cv.id into v_esign
  from clause_versions cv
  join clauses c on c.id = cv.clause_id
  where c.kind = 'esign_consent' and c.jurisdiction = 'US' and cv.version = 1;

  if v_esign is null then
    raise exception 'the shared ESIGN consent clause version is missing; 20260830000006 must run first';
  end if;

  v_ids := v_ids || v_esign;

  -- -------------------------------------------------------------------------
  -- Template
  -- -------------------------------------------------------------------------
  --
  -- originator_kind is 'individual', which is the only kind that can create an
  -- agreement at all today: 20260901000016 deliberately seeded no organisation
  -- wording, and this migration does not invent any either. The organisation
  -- participant set arrives when the organisation rental set does — drafted by
  -- counsel, published in its own migration. Until then a rental shop is refused
  -- in plain words on both instruments, which is the honest state rather than an
  -- omission.

  select t.id into v_template from templates t where t.slug = 'pwc-participant-fl';

  if v_template is null then
    insert into templates (slug, name, description)
    values (
      'pwc-participant-fl',
      'Personal Watercraft Participant Release — Florida',
      'Release by an adult who takes part in the activity without taking custody of the watercraft. Signed alongside, and never instead of, the loan agreement held by the person who took it.'
    )
    returning id into v_template;
  end if;

  if not exists (select 1 from template_versions tv where tv.template_id = v_template and tv.version = 1) then
    insert into template_versions (
      template_id, version, jurisdiction, activity_class,
      originator_kind, instrument_kind, clause_set, body_hash, published_at
    )
    values (
      v_template, 1, 'FL', 'personal_watercraft',
      'individual', 'participant',
      to_jsonb(v_ids::text[]),
      encode(
        extensions.digest(
          (select string_agg(cv.body_hash, '|' order by o.ord)
             from unnest(v_ids) with ordinality as o(cid, ord)
             join clause_versions cv on cv.id = o.cid),
          'sha256'
        ),
        'hex'
      ),
      -- Also deliberately null, and for the same reason.
      null
    );
  end if;
end;
$seed$;
