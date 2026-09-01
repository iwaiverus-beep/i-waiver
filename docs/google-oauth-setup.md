# Google sign-in — setup

Roughly ten minutes, spread across two consoles. Nothing here touches code.

## What you are actually doing

Three parties, in this order:

```
  the borrower's browser
        │
        ▼
   Google  ──────►  Supabase  ──────►  i-waiver.com
  (asks who        (turns Google's    (gets a session,
   they are)        answer into a      shows the app)
                    session)
```

Google needs to be told that Supabase is allowed to ask it questions. That is the
whole exercise: create a *client* at Google, and hand its two secrets to Supabase.

The step everyone gets wrong is that **Google asks for a redirect address, and the
correct answer is Supabase's address — not i-waiver.com.** It feels wrong. It is
right. Google returns the answer to Supabase, and Supabase sends the person on to
us. (Wanting it to say i-waiver.com is a fair instinct — see *Can that URL
say i-waiver.com?* below for what that would take.)

---

## Part 1 — Google Cloud Console

Start at **<https://console.cloud.google.com/auth/clients>**

Sign in with whichever Google account should own this. It does not have to be
`iwaiver.us@gmail.com`, but use something you will still control in two years —
losing this account means redoing sign-in for every user.

### 1.1 Create a project

A Google Cloud "project" is just a container. It costs nothing and this one will
do nothing except hold the sign-in client.

1. Top-left, click the project dropdown (it may say "Select a project")
2. **New Project**
3. Project name: `i-waiver`
4. **Create**, then select it in that same dropdown once it finishes

### 1.2 Set up the consent screen

This is the screen users see saying "I-Waiver wants to know your email address".
Google will not let you create a client until it exists.

> **Note on names.** Google reorganised this in 2025. Older guides say
> *APIs & Services → OAuth consent screen*; it is now **Google Auth Platform**,
> with sections called Overview, Branding, Audience, Clients and Data Access.
> Both routes end in the same place.

Go to **Google Auth Platform → Get started** and fill in:

| Field | Value |
|---|---|
| App name | `I-Waiver` |
| User support email | your address |
| Audience | **External** |
| Contact information | your address |

**External** is correct. "Internal" is only for Google Workspace organisations
signing in their own staff, and would lock out every ordinary Gmail user.

Agree to the policy and continue.

### 1.3 Create the OAuth client

**Clients → Create client**

| Field | Value |
|---|---|
| Application type | **Web application** |
| Name | `i-waiver web` |

Under **Authorized redirect URIs**, click **Add URI** and paste exactly:

```
https://ivlsyqkilzsjwijfymvp.supabase.co/auth/v1/callback
```

Check it character by character. No trailing slash. `https`, not `http`.

Leave **Authorized JavaScript origins** empty — it is not used by this flow.

Click **Create**.

### 1.4 Copy the two values

A panel appears with:

- **Client ID** — long, ends in `.apps.googleusercontent.com`
- **Client secret** — starts with `GOCSPX-`

Unlike most secrets, these can be viewed again later: reopen the client from the
Clients list. So a lost tab is an inconvenience, not a restart.

### 1.5 Decide who is allowed in

**Google Auth Platform → Audience.** You will be in **Testing**.

| Mode | Who can sign in | Use when |
|---|---|---|
| **Testing** | Only addresses you add under *Test users* | Showing it to a known handful |
| **Published** | Anyone with a Google account | The link is going around freely |

In Testing, anyone not on the list gets a Google error page. It reads as though
the app is broken, when Google is simply refusing an address it was not told
about. If you are unsure, publish it — this app only ever asks for name and email,
which does not require Google's verification review.

---

## Part 2 — hand them over

Paste both values into `.env.local` (lines 65–66):

```
GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
```

`.env.local` is gitignored, so this does not reach the public repo. **Do not paste
the secret into a chat or an issue** — a file on your machine is the right place
for it.

Then the remaining wiring is one command's worth of work:

1. Enable the Google provider in Supabase (`external_google_enabled`,
   `external_google_client_id`, `external_google_secret`)
2. Set `NEXT_PUBLIC_OAUTH_PROVIDERS=google` locally and in Vercel
3. Redeploy

That last variable is what makes the button appear. Until it is set the login page
shows password sign-in only — deliberately, so a button never exists for a
provider nobody configured.

---

## When it goes wrong

**`redirect_uri_mismatch`** — the redirect URI in 1.3 does not match what Supabase
sent. Almost always a typo, a trailing slash, or `i-waiver.com` used instead of the
`supabase.co` address. Fix it in Google; changes take effect within a minute or so.

**"Access blocked: app has not completed verification"** — you are in Testing and
signing in with an address that is not a test user. Add it, or publish.

**Signs in, then bounces back to `/login`** — the callback could not exchange the
code. Check the site's own allow-list still contains
`https://www.i-waiver.com/auth/callback` under Supabase → Authentication → URL
Configuration.

**Nothing happens when the button is pressed** — usually a popup blocker, or
`NEXT_PUBLIC_OAUTH_PROVIDERS` naming a provider that is not actually enabled in
Supabase.

---

## Can that URL say i-waiver.com?

Not as things stand, and the reason is worth writing down because it comes up
every time someone looks at that field.

The redirect URI names the machine that **receives** Google's answer. That
machine is Supabase. Type `i-waiver.com` in there and Google will refuse the
sign-in with `redirect_uri_mismatch`, because nothing at i-waiver.com is
listening for it.

The proper fix is to make Supabase itself answer on our domain, so its login
server lives at `auth.i-waiver.com` and the field reads:

```
https://auth.i-waiver.com/auth/v1/callback
```

That is Supabase's **Custom Domain add-on**: the Pro plan (~$25/mo) plus the
add-on (~$10/mo). As of 2026-09-01 this project's Supabase organisation is on
Free, and the API turns down both that and the cheaper vanity subdomain:

> Custom domains require the Custom Domain add-on, available on the Pro plan and
> above.

So it is a billing decision, not an engineering one.

### If we buy it

Four things move together. Miss one and sign-in breaks for everybody.

1. Enable the add-on in the Supabase dashboard
2. Add the verification DNS records — **`i-waiver.com` is registered in the
   LeadLynk Cloudflare account**, not the iWaiver one, so that is where they go
3. Swap `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` **and in Vercel** to the new
   host
4. Update the redirect URI in 1.3 above, and Supabase's own redirect allow-list

### Free in the meantime

The **Branding** page, in the same left-hand menu as Clients, carries the app
name, logo and home-page link. That is what a user actually reads on the consent
screen. Set it to `I-Waiver`, our logo and `https://i-waiver.com` and the screen
reads as our product. The `supabase.co` host stays in the plumbing — visible for
a moment in the address bar mid-redirect — but stops being the headline.

---

## Other providers

`components/OAuthButtons.tsx` already supports Microsoft (`azure`) and Apple
(`apple`). Enable either in Supabase and add it to the comma-separated list.

Apple requires a paid Apple Developer account ($99/year) and a more involved key
setup. Worth it only if iPhone sign-in friction becomes a real complaint —
Google sign-in works perfectly well on an iPhone.
