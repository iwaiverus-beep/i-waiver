# Auth emails

The six emails Supabase Auth sends on our behalf: confirmation, password reset,
magic link, invitation, email change, and the reauthentication code.

They are not sent by the application. Supabase Auth mints the token and sends the
message itself, so unlike everything in `lib/email.ts` these live as templates in
the project's auth config rather than as code. That is why they are here as flat
HTML and pushed by a script, instead of being functions somewhere in `lib/`.

`[[BRAND_NAME]]`, `[[BRAND_DOMAIN]]` and `[[SITE_URL]]` are substituted by
`scripts/setup-auth-emails.mjs` from `lib/brand.ts` and `NEXT_PUBLIC_SITE_URL`,
so renaming the product stays a one-line change in `lib/brand.ts`. Everything in
`{{ .DoubleBrace }}` form is Go template syntax belonging to Supabase — leave it
alone. The variables available are `.ConfirmationURL`, `.Token`, `.TokenHash`,
`.SiteURL`, `.Email`, `.NewEmail` and `.RedirectTo`.

Edit a file here, then:

    node scripts/setup-auth-emails.mjs            # shows the diff, sends nothing
    node scripts/setup-auth-emails.mjs --apply

## Why the markup is so plain

Tables, inline styles, no images, no web fonts, no tracking pixel. Not
conservatism for its own sake: these messages carry a link that grants access to
an account, and mail that arrives looking like a marketing campaign is mail that
lands in spam. The same reasoning is written down at the top of `lib/email.ts`,
which is why the product's own emails are plain text.
