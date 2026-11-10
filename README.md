# RoadFit

RoadFit is a free, source-transparent U.S. vehicle discovery app built around a
simple question: **what cars realistically fit this budget?** It combines a
large, reproducible static catalog with optional private Supabase accounts. The
site itself is a Vite static build and can be hosted on GitHub Pages without a
server, paid API, or subscription.

The current generated catalog contains:

- **49,704** distinct EPA vehicle configurations across model years 1984–2027
- **146** makes and **5,820** make/model combinations
- **15,279** configurations joined to a licensed model-year asking-price
  aggregate
- **34,425** deliberately unpriced configurations rather than fabricated
  estimates
- **13,496** records with a make/model name match in NHTSA vPIC
- Sourced horsepower on **15,251** configurations, doors on **11,555**, seats on
  **8,534**, and generation labels on **3,106**
- **1,280** licensed cover photos across **4,025** configurations
- EPA fuel-cost estimates on **49,659** configurations, with tailpipe CO₂ and
  plug-in range and charging data where applicable
- 23 year-and-price shards, loaded only when a search needs them

These figures describe the checked-in catalog build and will change when the
scheduled refresh publishes a new validated version.

## What works

- Budget-first discovery with minimum/maximum price and model-year controls
- Combined, URL-persistent filters for make, model, configuration, body style,
  category, fuel, transmission, drivetrain, cylinders, horsepower, MPG/MPGe,
  doors, seats, price availability, and listing sample size
- Dependent make/model/configuration choices, debounced search, multiple sort
  modes, result sizing, pagination, grid/list layouts, and shareable searches
- One discovery card per model year with a configuration picker. Numeric sorts
  place records without a value after populated records.
- Vehicle details with configuration data, market-price evidence, provenance,
  budget fit, alternative configurations, similar vehicles, and clearly
  labeled external web searches
- Side-by-side comparison of up to four vehicles, persisted locally for guests
- Licensed vehicle cover photos with a model-year or same-generation label,
  photographer credits, and links to the original and its license
- Optional Supabase email/password authentication, verification, password
  reset, cloud favorites, collections, notes, profile budget, and self-service
  account deletion
- Responsive dark automotive UI, accessible controls, skeletons, empty states,
  toasts, keyboard focus, reduced-motion handling, and branded placeholders
- Automated static deployment, scheduled source refreshes, catalog validation,
  frontend tests, and isolated Supabase RLS tests

RoadFit is a discovery catalog, not a dealership or live marketplace. It never
claims that a catalog vehicle is currently for sale.

## Data sources and price semantics

| Source | Used for | Reuse basis |
| --- | --- | --- |
| [EPA/DOE FuelEconomy.gov](https://www.fueleconomy.gov/feg/download.shtml) | 1984–current configurations, engine, fuel, transmission, drive, MPG/MPGe, and related specifications | U.S. federal government public data |
| [EPA Test Car List](https://www.epa.gov/compliance-and-fuel-economy-data/data-cars-used-testing-fuel-economy) | Rated horsepower where the powertrain match is unambiguous | U.S. federal government public data |
| [NHTSA vPIC](https://vpic.nhtsa.dot.gov/api/) | All-years make/model name matching (not model-year validation) | Free U.S. government open data |
| [NHTSA SaferCar](https://www.nhtsa.gov/nhtsa-datasets-and-apis#safercar-data) | Door and seat counts where applicable safety records agree | U.S. federal government public data |
| Manufacturer technical specifications and model histories | Selected numeric facts and U.S. generation labels with links on the vehicle page | Published facts |
| [ForCar Open Data](https://forcar.org/open-data/) | U.S. used-vehicle average asking price, observed range, average mileage, and sample size by make/model/model year | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [CarImages rights index](https://carimages.org/data/) and [Wikimedia Commons](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia) | Photo identification, attribution, and reusable cover images | CarImages metadata is CC0. Each photo retains its individual Commons license. |

ForCar values are **asking-price aggregates**, not completed-sale prices,
appraisals, offers, or verified live inventory. ForCar publishes aggregates
backed by at least five listings. Its records are model-year level, so RoadFit
does not represent them as exact trim or powertrain prices. RoadFit adds
horsepower, doors, seats, and generation labels where the supporting sources
identify the configuration. Missing data remains `null` and is shown as unavailable.

See [Data pipeline](docs/DATA_PIPELINE.md) for the full ingestion, normalization,
joining, validation, licensing, caching, and sharding design.
See [Vehicle photos](docs/VEHICLE_PHOTOS.md) for photo matching and refresh commands.

## Architecture

```text
Official/open datasets
        │
        ▼
Python fetch + cache + normalize + validate
        │
        ▼
public/data/catalog-manifest.json
        │
        ├── price/year JSON shards ──► React catalog loader
        └── facets, stats, attribution ─► UI and source disclosures

React + TypeScript + Vite + Tailwind
        │
        ├── static browsing/filtering/comparison ─► GitHub Pages
        └── optional authenticated user data ──────► Supabase + RLS
```

The public catalog never needs Supabase. Supabase stores only private,
user-owned data keyed by stable catalog vehicle IDs. Browsing, filtering,
details, URL sharing, and guest comparison continue to work if Supabase is not
configured or unavailable.

Cover photos use a separate index keyed by vehicle ID and locally hosted WebP
files. The app loads the index when it renders vehicle artwork and lazy loads
photos in result cards, compare, and garage views.

## Local development

### Requirements

- Node.js 20.19 or newer (the deployment workflow uses Node 22)
- npm
- Python 3.10 or newer for catalog work (the refresh workflow uses Python 3.12)
- Pillow only when rebuilding vehicle photo thumbnails
- Docker only when running the local Supabase RLS suite

### Start the frontend

```bash
git clone YOUR_REPOSITORY_URL
cd roadfit
npm install
npm run dev
```

Open `http://localhost:5173`. The checked-in static catalog works immediately;
no account credentials are required.

To enable accounts locally:

```bash
cp .env.example .env.local
```

Set the two public values in `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
```

Every `VITE_*` value is embedded into browser JavaScript. The anon/publishable
key is designed for this use with RLS; a service-role key must never appear in a
Vite variable, repository file, or Pages configuration. Follow the complete
[Supabase setup guide](docs/SUPABASE_SETUP.md) before enabling accounts.

## Commands

```bash
npm run dev             # Vite development server
npm run typecheck       # strict TypeScript project check
npm test                # Vitest suite, once
npm run test:watch      # Vitest watch mode
npm run lint            # ESLint
npm run build           # production build plus Pages SPA fallback
npm run preview         # serve the production build locally
npm run check           # typecheck, tests, and production build
```

Catalog commands:

```bash
python scripts/data/refresh.py
python scripts/data/refresh.py --offline
python scripts/data/refresh.py --skip-vpic-models
python scripts/data/validate_catalog.py
```

The online refresh downloads or conditionally reuses official sources and
writes each generated JSON file atomically before validating the complete
output. CI commits `public/data` only when that validation succeeds, so a failed
workflow never replaces the published catalog. The offline command rebuilds
from the ignored last-known-good cache. Details and custom path flags are in
[Data pipeline](docs/DATA_PIPELINE.md).

Run `npm run data:photos -- --plan` to see candidate photo coverage, or
`npm run data:photos` to build the index and WebP files. See the
[photo build guide](docs/VEHICLE_PHOTOS.md) for dependencies and optional sources.

## Supabase accounts

The migration in `supabase/migrations` creates profiles, collections, saved
vehicles, collection membership, and saved searches. It also creates default
collections and a no-argument account-deletion RPC scoped to the authenticated
JWT subject. Every application table has row-level security and explicit
owner-only policies. Composite foreign keys prevent a user from linking their
record to another user's collection or favorite.

Setup and security verification are documented in
[docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md). The guest catalog remains
fully usable until that setup is complete.

## GitHub Pages deployment

The `Deploy RoadFit to GitHub Pages` workflow tests and builds every push to
`main` and every successful scheduled data refresh, infers `/repository-name/`
for project Pages, emits an SPA refresh fallback, and uploads `dist/` through
the official Pages actions.

Required owner actions are intentionally minimal:

1. In repository **Settings → Pages**, select **GitHub Actions** as the source.
2. Optionally configure Supabase public values as Actions **Variables**.
3. For scheduled catalog commits, allow the repository `GITHUB_TOKEN` read and
   write permissions or adapt the refresh workflow to open a pull request.

Custom domains rooted at `/` can set the repository variable
`VITE_BASE_PATH=/`. Full setup and failure recovery are in
[Deployment](docs/DEPLOYMENT.md).

## Repository layout

```text
.github/workflows/       Pages deploy, catalog refresh, RLS CI
docs/                    Setup, deployment, and pipeline documentation
pipeline/                Source declarations, reviewed aliases, ignored cache
public/data/             Versioned manifest, facets, stats, and catalog shards
public/assets/vehicles/  Optimized vehicle cover photos with per-file licenses
scripts/data/            Python fetch, build, refresh, and validation tools
src/components/          Reusable UI and catalog controls
src/contexts/            Auth, saves, comparison, and toast state
src/lib/                 Pure filtering, sorting, URL, and formatting logic
src/pages/               Discovery, detail, compare, account, garage, sources
src/services/            Static catalog loader and optional Supabase client
supabase/migrations/     Relational schema, triggers, RPC, grants, and RLS
supabase/tests/          pgTAP cross-user security tests
```

## Known limits

- EPA coverage begins in 1984. vPIC is substantially stronger for 1996 and
  newer vehicles; historic coverage must not be described as exhaustive.
- An EPA row is a tested configuration, not necessarily a distinct retail trim.
  Several records can legitimately share a model-year price aggregate.
- Market data can be absent, stale, or affected by unusual listings. RoadFit
  exposes sample size, observed range, mileage, update time, and methodology so
  users can judge the evidence.
- MPG and MPGe are retained with their source meaning and should not be treated
  as interchangeable energy measurements.
- Photos represent the stated model year or a year within a documented U.S.
  generation. Trim, body details, and regional styling can vary. Vehicles without
  a supported match use a branded placeholder.
- Supabase's free default email sender is rate-limited and intended mainly for
  development. A production owner may attach a free-quota SMTP provider without
  changing the application architecture.

## Troubleshooting

- **A deep link is a 404 on Pages:** confirm the deployed artifact contains
  `404.html` and that Pages is using GitHub Actions, not the legacy branch
  publisher.
- **Assets or routes point at `/` instead of the repository:** leave
  `VITE_BASE_PATH` unset for ordinary project Pages; the workflow sets it. For a
  custom domain, set it explicitly to `/`.
- **Accounts show “setup pending”:** configure both public Supabase variables
  and redeploy. Check the authentication Site URL and redirect allowlist.
- **A refresh fails:** keep the last published `public/data`; inspect the source
  cache and validation report, then retry with `--offline` if the upstream data
  is temporarily unavailable.
- **RLS tests cannot start:** ensure Docker is running, then run `supabase start`,
  `supabase db reset`, and `supabase test db`.

## License and attribution

Application code is available under the [MIT License](LICENSE). Source datasets
retain their own terms. In particular, redistributed ForCar-derived aggregates
require ForCar attribution under CC BY 4.0. `public/data/attribution.json` and
each catalog record preserve source metadata; do not remove those disclosures
when redistributing the generated catalog.
Vehicle photos follow the individual licenses in
[`public/data/vehicle-images.json`](public/data/vehicle-images.json). Preserve
the photographer, original file, license, and modification disclosure when
redistributing those assets. The MIT license covers application code.
