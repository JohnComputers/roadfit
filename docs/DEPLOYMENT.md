# GitHub Pages deployment

RoadFit is a static Vite application. GitHub Pages serves the React bundle and
versioned catalog shards; optional account operations go directly from the
browser to Supabase under row-level security.

No live deployment or Supabase project is assumed by this repository. Complete
the owner steps below after pushing the code to GitHub.

## 1. Create the GitHub repository

Create an empty repository, then add it as the local remote and push `main`:

```bash
git remote add origin https://github.com/YOUR_GITHUB_USER/YOUR_REPOSITORY.git
git push -u origin main
```

Avoid committing `.env.local`, raw pipeline caches, Supabase service-role keys,
or database passwords. They are not required for a Pages build.

## 2. Enable GitHub Pages

Open repository **Settings → Pages** and choose **GitHub Actions** as the source.
The workflow at `.github/workflows/deploy-pages.yml` runs on every push to
`main`, on manual dispatch, and after a successful scheduled catalog refresh. It:

1. checks out the repository;
2. selects Node.js 22 and installs the lockfile with `npm ci`;
3. runs the frontend test suite;
4. calculates the correct Vite base path;
5. produces the static build in `dist/`;
6. copies the SPA fallback to `dist/404.html`; and
7. deploys the official Pages artifact.

The deployment URL appears in the workflow's `github-pages` environment after
the job succeeds. Do not advertise a URL until that result exists.

## 3. Base paths and SPA refreshes

For ordinary project Pages at:

```text
https://USER.github.io/REPOSITORY/
```

the workflow automatically sets `VITE_BASE_PATH=/REPOSITORY/`. For a user or
organization repository named `USER.github.io`, it uses `/`.

For a custom domain served at its root, add an Actions repository **Variable**:

| Variable | Value |
| --- | --- |
| `VITE_BASE_PATH` | `/` |

If a custom domain serves the app below a path, set the variable to that path,
including its leading slash. Do not hard-code a repository name in source.

Vite writes all catalog and asset URLs relative to `import.meta.env.BASE_URL`.
The generated `404.html` is a copy of the built app shell. GitHub Pages serves
that shell at an otherwise missing deep URL, so React Router mounts against the
original path and query without a redirect. This makes direct refreshes of
vehicle, comparison, garage, account, and source pages work on Pages.

## 4. Optional Supabase configuration

The unconfigured build is a complete guest catalog. To enable real accounts,
first follow [Supabase setup](SUPABASE_SETUP.md), including migrations, email
redirect URLs, and RLS verification.

Then open **Settings → Secrets and variables → Actions → Variables** and add:

| Repository variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://YOUR_PROJECT_REF.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the public anon/publishable key |

These values are public browser configuration and are read only during the
build. Security comes from the migration's RLS policies. Never put the
`service_role` key in a repository variable, secret consumed by Vite, source
file, or Pages artifact.

In Supabase **Authentication → URL Configuration**, use the final Pages URL:

```text
Site URL:     https://USER.github.io/REPOSITORY/
Redirect URL: https://USER.github.io/REPOSITORY/**
Local URL:    http://localhost:5173/**
```

After changing repository variables, rerun **Deploy RoadFit to GitHub Pages** or
push a commit so the public configuration is included in a new bundle.

## 5. Scheduled data refresh permissions

`.github/workflows/data-refresh.yml` runs every Sunday and can be dispatched
manually. It needs permission to commit a successful catalog update.

In **Settings → Actions → General → Workflow permissions**, select **Read and
write permissions**. The workflow uses only the repository `GITHUB_TOKEN`; no
personal access token or source API key is needed.

If `main` is protected, either:

- allow the `github-actions[bot]` update under the branch rules; or
- modify the workflow to create a pull request containing `public/data`.

The data job restores `pipeline/cache`, refreshes from the official sources,
validates the result, and commits only changed generated files. A failed source
fetch or validator run does not modify the published site.

## 6. Pre-deployment verification

Run the equivalent local checks before the first push:

```bash
npm install
npm run typecheck
npm test
npm run build
npm run preview
```

The build is deployable when `dist/index.html`, `dist/404.html`, `.nojekyll`,
compiled assets, and `dist/data/catalog-manifest.json` are present.

Validate the checked-in catalog independently:

```bash
python scripts/data/validate_catalog.py
```

For account-enabled deployments, run the database security suite with Docker:

```bash
supabase start
supabase db reset
supabase test db
```

The `Test Supabase RLS` workflow runs the same isolated pgTAP checks whenever
Supabase files change.

## 7. Custom domain

Add and verify the domain through **Settings → Pages**, configure the DNS records
shown by GitHub, enforce HTTPS after the certificate is ready, and set
`VITE_BASE_PATH=/` unless the site is intentionally mounted below a path.

Update Supabase's Site URL, redirect allowlist, and the optional account-deletion
Edge Function `ALLOWED_ORIGINS` value to include the final HTTPS origin. A DNS
change alone does not update authentication redirects.

## Troubleshooting

### The site is blank or assets return 404

- Inspect the workflow's calculated `VITE_BASE_PATH`.
- Do not set `/REPOSITORY/` manually for a custom root domain.
- Confirm the build was produced by the workflow rather than uploading the
  source tree directly.
- In browser developer tools, verify the manifest is requested from
  `/BASE/data/catalog-manifest.json`.

### Direct route refresh returns GitHub's 404 page

- Confirm the artifact contains `dist/404.html`.
- Confirm Pages is using **GitHub Actions** as its source.
- Confirm `dist/404.html` is the same base-path-aware app shell as `dist/index.html`.
- Clear a stale service-worker or browser cache from an older unrelated site if
  the repository previously hosted another application.

### Accounts remain disabled

- Both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must be present in the
  build job.
- Values added after a deployment require a new deployment.
- Placeholder values from `.env.example` are intentionally treated as
  unconfigured.

### Verification or password-reset links return to the wrong page

- Update the Supabase Site URL and redirect allowlist to the exact Pages base.
- Keep the trailing slash on the project Pages Site URL.
- Include both production and `http://localhost:5173/**` during development.

### The catalog refresh cannot push

- Grant Actions read/write workflow permission.
- Review branch protection and required pull-request rules.
- Prefer a refresh pull request over bypassing protection.

### The Pages artifact is too large or slow

- Ensure the raw `pipeline/cache` directory is ignored and absent from `dist`.
- Keep the catalog in its generated shards; do not bundle all records into the
  JavaScript entry point.
- Inspect `catalog-manifest.json` byte sizes and refine the configured bands if
  source growth makes an individual shard too large.
