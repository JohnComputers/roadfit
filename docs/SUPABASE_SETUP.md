# Supabase setup (free tier)

RoadFit works as a complete guest catalog without Supabase. Connecting a free
Supabase project enables email/password accounts, cloud favorites, collections,
notes, saved searches, profile preferences, and account deletion.

## 1. Create and migrate the project

1. Create a project at [Supabase](https://supabase.com/dashboard). Keep its
   database password in a password manager.
2. Install the CLI (`npm install --global supabase`, or prefix the commands below
   with `npx`).
3. From this repository run:

   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

The migration creates only private, user-owned tables. The public vehicle
catalog remains in versioned static shards on GitHub Pages. Row-level security
is enabled on every application table, and anonymous visitors receive no table
grants. Never copy the service-role key into this repository or a `VITE_*`
variable: Vite variables are public by design.

## 2. Configure authentication URLs

In **Authentication → URL Configuration**, set:

- Site URL: `https://YOUR_GITHUB_USER.github.io/YOUR_REPOSITORY/`
- Redirect URL: `https://YOUR_GITHUB_USER.github.io/YOUR_REPOSITORY/**`
- Local redirect URL: `http://localhost:5173/**`

In **Authentication → Providers → Email**, keep email confirmation enabled.
Supabase's free default mailer is suitable for development but is rate-limited;
production projects can use any free-quota SMTP provider later. Password-reset
and verification links use the redirect URL supplied by RoadFit.

## 3. Account deletion

The migration includes the authenticated `request_account_deletion()` RPC used
by the app. It is a narrowly scoped `security definer` function: it derives the
target exclusively from the verified JWT's `auth.uid()` and cannot accept an ID
from the browser. Cascading foreign keys delete all RoadFit rows immediately.

An equivalent Edge Function is included for teams that prefer routing this
operation through the Auth Admin API. It is optional; the static app does not
need it for account deletion. To deploy it:

Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` into deployed functions automatically; none are
exposed to the browser.

```bash
supabase secrets set ALLOWED_ORIGINS=https://YOUR_GITHUB_USER.github.io,http://localhost:5173
supabase functions deploy delete-account
```

The function verifies the caller's access token before hard-deleting exactly
that caller. Do not disable JWT verification for this function.

## 4. Connect the GitHub Pages build

Copy **Project Settings → API → Project URL** and the public **anon/publishable
key** into GitHub repository **Settings → Secrets and variables → Actions →
Variables** (not secrets are required for these public client values):

| Repository variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://YOUR_PROJECT_REF.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/publishable key |

The service-role key must not be added to GitHub. The Pages workflow determines
the correct `/repository/` base path automatically and builds the credentials
into the static client. RLS, not key secrecy, protects user data.

If the repository uses a custom domain rooted at `/`, optionally add
`VITE_BASE_PATH` with value `/`; otherwise leave it unset.

## 5. Enable Pages

In **GitHub Settings → Pages**, choose **GitHub Actions** as the source. Push to
`main` or run **Deploy RoadFit to GitHub Pages** manually. The workflow tests,
builds, adds the SPA refresh fallback, and deploys `dist/`.

For the scheduled catalog updater, also set **Settings → Actions → General →
Workflow permissions** to **Read and write permissions**. Its built-in
`GITHUB_TOKEN` can then commit validated `public/data` changes; no personal
access token is required. Repositories that protect `main` should allow the
GitHub Actions bot to push or adapt the workflow to open a data-refresh PR.

## Verify security locally

Docker is required for the isolated Supabase test stack:

```bash
supabase start
supabase db reset
supabase test db
```

The pgTAP suite creates two temporary users, tests cross-account reads/writes,
tests the composite ownership foreign keys, checks anonymous access, and rolls
the transaction back. CI runs the same test whenever `supabase/**` changes.

## Operational notes

- `vehicle_id` is a stable ID from the static catalog, not a live marketplace
  listing. `vehicle_snapshot` is only a display fallback after catalog changes.
- Default collections are created transactionally for every new auth user.
- Deleting an auth user cascades through all RoadFit private tables.
- To rotate the public key, update the GitHub variable and redeploy. Rotate a
  service-role key only in Supabase; it is never used by the Pages build.
