-- iWaiver — reference data for the first milestone.
--
-- One state (FL), one activity class (personal_watercraft), adults only.
--
-- THE IMPORTANT PART: every clause version and template version seeded here has
-- `published_at` NULL, and every clause body opens with a specimen marker. That is
-- not an oversight to tidy up later — it is CLAUDE.md constraint 5 made physical.
-- `assert_clause_set_reviewed` refuses unpublished wording, `render_clause_set` is
-- the only way to obtain clause text, and nothing in the migration chain publishes
-- anything. A production database built from these files therefore CANNOT render a
-- document, which is the correct behaviour until counsel has reviewed the set.
--
-- To exercise the flow on a development database, run the separate, non-migration
-- script `supabase/seed/dev_publish_specimen_clauses.sql`. It is deliberately not a
-- migration so that it cannot be applied by `supabase db push`.

-- ---------------------------------------------------------------------------
-- State availability — all 51 jurisdictions, gated individually
--
-- carrier_admitted is false everywhere but FL: it records where the carrier is
-- actually admitted and filed, which is a fact about them, not an aspiration.
-- clause_set_reviewed_at is null everywhere, so FL computes to `cover_only` and
-- the product must present honestly until that changes.
-- ---------------------------------------------------------------------------

insert into state_availability (state, carrier_admitted, product_codes, waiver_efficacy, notes)
values
  ('AL', false, '{}', 'standard', null),
  ('AK', false, '{}', 'standard', null),
  ('AZ', false, '{}', 'standard', null),
  ('AR', false, '{}', 'standard', null),
  ('CA', false, '{}', 'standard', null),
  ('CO', false, '{}', 'standard', null),
  ('CT', false, '{}', 'limited',  'Hostile to pre-injury releases; treat as limited until counsel advises otherwise.'),
  ('DE', false, '{}', 'standard', null),
  ('DC', false, '{}', 'standard', null),
  ('FL', true,  '{PWC-DAY-01}', 'standard',
     'First launch state. Carrier admitted and filed for the day-rate PWC product. Clause set still pending counsel review, so status computes to cover_only.'),
  ('GA', false, '{}', 'standard', null),
  ('HI', false, '{}', 'standard', null),
  ('ID', false, '{}', 'standard', null),
  ('IL', false, '{}', 'standard', null),
  ('IN', false, '{}', 'standard', null),
  ('IA', false, '{}', 'standard', null),
  ('KS', false, '{}', 'standard', null),
  ('KY', false, '{}', 'standard', null),
  ('LA', false, '{}', 'void',     'Pre-injury release of negligence is void by statute. Cover-only market.'),
  ('ME', false, '{}', 'standard', null),
  ('MD', false, '{}', 'standard', null),
  ('MA', false, '{}', 'standard', null),
  ('MI', false, '{}', 'standard', null),
  ('MN', false, '{}', 'standard', null),
  ('MS', false, '{}', 'standard', null),
  ('MO', false, '{}', 'standard', null),
  ('MT', false, '{}', 'void',     'Pre-injury release of negligence is void by statute. Cover-only market.'),
  ('NE', false, '{}', 'standard', null),
  ('NV', false, '{}', 'standard', null),
  ('NH', false, '{}', 'standard', null),
  ('NJ', false, '{}', 'standard', null),
  ('NM', false, '{}', 'standard', null),
  ('NY', false, '{}', 'limited',  'General Obligations Law limits releases for places of amusement or recreation charging a fee. Scope needs counsel.'),
  ('NC', false, '{}', 'standard', null),
  ('ND', false, '{}', 'standard', null),
  ('OH', false, '{}', 'standard', null),
  ('OK', false, '{}', 'standard', null),
  ('OR', false, '{}', 'standard', null),
  ('PA', false, '{}', 'standard', null),
  ('RI', false, '{}', 'standard', null),
  ('SC', false, '{}', 'standard', null),
  ('SD', false, '{}', 'standard', null),
  ('TN', false, '{}', 'standard', null),
  ('TX', false, '{}', 'standard', 'Express-negligence doctrine and the fair-notice conspicuousness rules apply to the release wording.'),
  ('UT', false, '{}', 'standard', null),
  ('VT', false, '{}', 'limited',  'Hostile to pre-injury releases; treat as limited until counsel advises otherwise.'),
  ('VA', false, '{}', 'void',     'Pre-injury release of personal injury claims is void as against public policy. Cover-only market.'),
  ('WA', false, '{}', 'standard', null),
  ('WV', false, '{}', 'standard', null),
  ('WI', false, '{}', 'limited',  'Hostile to pre-injury releases; treat as limited until counsel advises otherwise.'),
  ('WY', false, '{}', 'standard', null)
on conflict (state) do nothing;

-- ---------------------------------------------------------------------------
-- Jurisdiction rule set — FL, personal watercraft
--
-- A versioned dataset, not code: this row records the rules as understood on the
-- date it was written, so that a compliance check taken two years from now can
-- still say which rules it applied. `review_status` inside required_language is
-- how the application knows counsel has not yet confirmed these values.
-- ---------------------------------------------------------------------------

insert into jurisdiction_rule_sets (
  version, state, activity_class,
  min_operator_age, education_required, education_authority,
  waiver_enforceable_adult, parental_waiver_enforceable, indemnity_enforceable,
  required_language
)
values (
  1, 'FL', 'personal_watercraft',
  14, true, 'Florida Fish and Wildlife Conservation Commission',
  'yes', 'no', 'limited',
  jsonb_build_object(
    'review_status', 'pending_counsel',
    'conspicuousness', 'Release and indemnity language must be conspicuous and separately acknowledged.',
    'notes', 'Statutory minimum operator age and the boating safety education card requirement are recorded here as facts about the law. The product floor of 18 is a separate product decision enforced by the compliance gate, not by this row.'
  )
)
on conflict (state, activity_class, version) do nothing;

-- ---------------------------------------------------------------------------
-- Clauses and specimen versions
--
-- Six instruments, kept as separate records so a court can strike one without
-- taking the rest with it. Bodies carry merge fields in {{double_brace}} form and
-- are hashed on the way in; the hash is what proves, later, which words were used.
-- ---------------------------------------------------------------------------

do $seed$
declare
  v_clause_id  uuid;
  v_version_id uuid;
  v_ids        uuid[] := '{}';
  v_template   uuid;
  v_marker     text := '**SPECIMEN LANGUAGE — DRAFTED AS A STRUCTURAL PLACEHOLDER AND NOT REVIEWED BY COUNSEL. NOT LEGAL ADVICE. NOT FOR USE WITH A REAL SIGNER.**' || E'\n\n';
  v_spec       record;
begin
  for v_spec in
    select * from (values
      ('assumption_of_risk'::clause_kind, 'FL'::text, 'Assumption of Risk — Personal Watercraft (Florida)', 1,
       'You are voluntarily choosing to operate or ride on a personal watercraft. Operating a personal watercraft is a hazardous recreational activity. Risks include, without limitation, collision with other vessels, fixed objects, or persons; ejection from the vessel; capsizing; drowning; propulsion and jet-thrust injuries; sudden loss of steering when the throttle is released; changing weather, wave, wake, current and visibility conditions; the acts or omissions of other persons on the water; and the failure, malfunction or misuse of equipment.

You confirm that you understand these risks, that you are physically able to undertake the activity, and that you accept the risks knowingly and voluntarily. You are accepting them whether they arise from the nature of the activity itself or from the ordinary negligence of {{lender_name}}.

Specific facts of this loan: the watercraft is described as {{asset_description}}, the activity takes place in {{jurisdiction}}, and the loan period runs from {{starts_at}} to {{ends_at}}.'),

      ('release'::clause_kind, 'FL', 'Release of Liability (Florida)', 1,
       'IN EXCHANGE FOR BEING PERMITTED TO USE THE WATERCRAFT DESCRIBED IN THIS AGREEMENT, YOU, {{borrower_name}}, RELEASE AND DISCHARGE {{lender_name}}, AND THEIR HEIRS, EXECUTORS, ADMINISTRATORS AND ASSIGNS, FROM ANY AND ALL CLAIMS, DEMANDS, ACTIONS AND CAUSES OF ACTION FOR PERSONAL INJURY, DEATH OR PROPERTY DAMAGE ARISING OUT OF YOUR USE OF THE WATERCRAFT DURING THE LOAN PERIOD, INCLUDING CLAIMS ARISING FROM THE ORDINARY NEGLIGENCE OF {{lender_name}}.

THIS RELEASE DOES NOT APPLY TO GROSS NEGLIGENCE, TO INTENTIONAL OR RECKLESS MISCONDUCT, OR TO ANY LIABILITY THAT APPLICABLE LAW DOES NOT PERMIT TO BE RELEASED.

YOU ARE GIVING UP LEGAL RIGHTS BY AGREEING TO THIS PARAGRAPH. READ IT BEFORE YOU SIGN.'),

      ('covenant_not_to_sue'::clause_kind, 'FL', 'Covenant Not to Sue (Florida)', 1,
       'You agree that you will not commence or maintain any lawsuit, arbitration or other proceeding against {{lender_name}} for any claim released in this agreement. If you do, and the claim is one that was released, you agree that this agreement may be pleaded as a complete defence.

Nothing in this paragraph prevents you from bringing a claim that this agreement does not release, or from making a claim under any policy of insurance issued in connection with this loan.'),

      ('indemnity'::clause_kind, 'FL', 'Indemnity (Florida)', 1,
       'You agree to indemnify and hold {{lender_name}} harmless from any claim brought by a third party arising out of your use of the watercraft during the loan period, including reasonable legal fees actually incurred.

This obligation does not extend to any claim arising from the gross negligence or intentional misconduct of {{lender_name}}, and applies only to the extent permitted by the law of {{jurisdiction}}.'),

      ('damage_responsibility'::clause_kind, 'FL', 'Responsibility for Damage to the Watercraft', 1,
       'You are responsible for returning the watercraft, described as {{asset_description}}, in the condition in which you received it, ordinary wear excepted, by {{ends_at}}.

If the watercraft is damaged, lost or destroyed during the loan period, you are responsible for the reasonable cost of repair or, where it cannot economically be repaired, for its declared value of {{declared_value}}. Any amount recovered under a policy of insurance covering this loan reduces what you owe under this paragraph, dollar for dollar. You are not required to pay twice for the same loss.'),

      ('esign_consent'::clause_kind, 'US', 'Consent to Do Business Electronically (ESIGN / UETA)', 1,
       'You are being asked to sign this agreement electronically. You do not have to. If you would rather sign on paper, tell {{lender_name}} and they will arrange it.

By continuing, you confirm that: you can read this document on the device you are using; you can keep a copy, by downloading the PDF you will be sent or by printing this page; you consent to receive this agreement, and records relating to it, electronically; and you understand that your electronic signature has the same legal effect as a signature in ink.

You may withdraw this consent at any time before you sign. Withdrawing it after you have signed does not undo the agreement you signed. To request a paper copy or withdraw consent, contact {{lender_name}}.')
    ) as t(kind, jurisdiction, label, version, body)
  loop
    -- The clause is the instrument; the version is the wording. Same instrument
    -- across the years, new version whenever the words change.
    select c.id into v_clause_id
    from clauses c
    where c.kind = v_spec.kind and c.jurisdiction = v_spec.jurisdiction;

    if v_clause_id is null then
      insert into clauses (kind, jurisdiction, label)
      values (v_spec.kind, v_spec.jurisdiction, v_spec.label)
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
        -- Florida practice is to have the release initialled on its own line.
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

  -- -------------------------------------------------------------------------
  -- Template — the ordered assembly of those clauses
  -- -------------------------------------------------------------------------

  select t.id into v_template from templates t where t.slug = 'pwc-loan-fl';

  if v_template is null then
    insert into templates (slug, name, description)
    values (
      'pwc-loan-fl',
      'Personal Watercraft Loan — Florida',
      'Individual-to-individual loan of a personal watercraft for a fixed period, with embedded cover for that period.'
    )
    returning id into v_template;
  end if;

  if not exists (select 1 from template_versions tv where tv.template_id = v_template and tv.version = 1) then
    insert into template_versions (
      template_id, version, jurisdiction, activity_class,
      clause_set, body_hash, published_at
    )
    values (
      v_template, 1, 'FL', 'personal_watercraft',
      to_jsonb(v_ids::text[]),
      -- The canonical hash of the assembly: the ordered clause body hashes, joined.
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
