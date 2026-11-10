# Vehicle catalog pipeline

RoadFit's public catalog is a reproducible static artifact assembled entirely
from free, legally reusable data. Raw source downloads are cached locally;
normalized browser assets are written to `public/data`. The application reads a
small manifest first and fetches only the year-and-price shards that can satisfy
the current search.

## Source inventory

### EPA / DOE FuelEconomy.gov

- Official page: <https://www.fueleconomy.gov/feg/download.shtml>
- Pipeline download: <https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip>
- Reuse basis: U.S. federal government public data
- RoadFit use: stable EPA vehicle ID, year, make, model/configuration text,
  cylinders, displacement, transmission, drivetrain, fuel, city/highway/
  combined MPG or MPGe, electric range, and EPA vehicle class where present
- Coverage: model year 1984 onward in the source; the upper bound changes as EPA
  adds future model years

EPA rows are tested configurations. Several rows for one make/model/year are
expected when engines, transmissions, drivetrains, or fuels differ. The pipeline
keeps those variants under stable IDs. The search interface groups matching
configurations in one model-year card and lets users choose the exact record.
FuelEconomy.gov often omits marketing trims and does not carry horsepower.

### Rated horsepower, body specifications, and generations

The [EPA Fuel Economy Test Car List](https://www.epa.gov/compliance-and-fuel-economy-data/data-cars-used-testing-fuel-economy)
provides engine ratings. RoadFit joins by make, model year, model, cylinders,
displacement, transmission, drivetrain, and fuel. The join requires agreeing
ratings and a unique guide engine signature. Hybrid and electric system power
requires separate evidence. Selected manufacturer documents supply those
ratings for matched hybrid and EV configurations. For model years 1984–1997,
archived test records also require the EPA basic engine index, when the guide
retains it. Model years 1998–1999 require an unambiguous guide configuration and
agreement among the test records. The oldest ZIP archives require Info-ZIP
`unzip` to refresh the horsepower snapshot.
EPA ratings describe test cars and can differ from factory-advertised output.
RoadFit labels EPA test-car horsepower and prefers a verified factory rating
for explicitly identified configurations.

The [NHTSA SaferCar dataset](https://www.nhtsa.gov/nhtsa-datasets-and-apis#safercar-data)
provides reported seat counts and door information. Compatible year, model,
body, and drivetrain entries must agree before a single value is added. Vehicle
records retain links to these sources. The [generation rules](../pipeline/vehicle-generations.json)
record U.S. year ranges and manufacturer citations, including Corvette C4–C8.
The [standalone vPIC database](https://vpic.nhtsa.dot.gov/Downloads) fills more
body styles, doors, and seats when applicable model-year patterns agree.

FuelEconomy.gov also supplies estimated annual fuel cost, tailpipe CO₂,
electricity use, charging time, and plug-in range. The catalog uses the
alternative-fuel range for plug-in hybrids and labels blended charge-depleting
range separately. See the [EPA field definitions](https://www.fueleconomy.gov/feg/ws/index.shtml).

The weekly catalog build uses checked-in enrichment snapshots. To refresh them
deliberately before rebuilding, run these commands from the repository root.

```bash
python scripts/data/epa_horsepower.py
python scripts/data/generation_specs.py --refresh-ncap
python scripts/data/vpic_body_specs.py --download
python scripts/data/build_catalog.py
python scripts/data/validate_catalog.py
```

### NHTSA vPIC

- API: <https://vpic.nhtsa.dot.gov/api/>
- Makes endpoint: `GetAllMakes?format=json`
- Per-make endpoint used by this build: `GetModelsForMake/{make}?format=json`
- Reuse basis: free U.S. government open data
- RoadFit use: conservative manufacturer/make/model corroboration for the makes
  already present in EPA data

The pipeline does not treat all vPIC manufacturers as consumer-car makes;
`GetAllMakes` includes many fabricators and non-passenger manufacturers. vPIC's
historic model coverage is also weaker than its modern VIN-era coverage, so a
missing vPIC match does not delete an otherwise valid EPA record. The record
stores whether it was corroborated.

### ForCar Open Data

- Official page: <https://forcar.org/open-data/>
- Pipeline CSV: <https://forcar.org/datasets/used-car-prices-by-model-year.csv>
- License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
- RoadFit use: listing count, average asking price, observed minimum/maximum
  asking price, and average mileage by make/model/model year

ForCar publishes model-year aggregates backed by at least five listings. These
are **advertised asking prices**, not completed transactions, appraisals, offers,
or proof of current inventory. ForCar has no trim or powertrain dimension. A
joined price therefore carries `scope: "model-year"`; the same aggregate can
appear on several legitimate EPA configurations. The UI must disclose that
scope wherever it presents the price.

## Prerequisites and commands

The tools use the Python standard library and require Python 3.10 or newer.
Run them from the repository root.

```bash
# Fetch sources, build all outputs, then validate them
python scripts/data/refresh.py

# Rebuild without network access from the last-good cache
python scripts/data/refresh.py --offline

# Faster EPA/ForCar build; skips per-make vPIC model expansion
python scripts/data/refresh.py --skip-vpic-models

# Validate the currently generated output without fetching or rebuilding
python scripts/data/validate_catalog.py
```

Custom paths are supported:

```bash
python scripts/data/refresh.py \
  --cache-dir /absolute/cache/path \
  --output-dir /absolute/output/path

python scripts/data/validate_catalog.py \
  --output-dir /absolute/output/path
```

`--offline` requires an existing cache. A first-time import must run online.

## Processing sequence

### 1. Fetch and cache

`scripts/data/fetch_sources.py` downloads the EPA archive, ForCar CSV, vPIC make
response, and (unless skipped) per-make vPIC model responses. The make expansion
is restricted to makes found in EPA data and uses four workers.

`download_with_cache` in `scripts/data/common.py` provides:

- conditional HTTP requests using saved ETag and Last-Modified values;
- bounded timeouts and exponential retry/backoff;
- atomic `.part` download replacement;
- SHA-256, source URL, retrieval time, and response metadata;
- reuse of the last-good file after a temporary source failure; and
- explicit failure when an offline run lacks the required cached file.

Basic size guards reject obviously empty or truncated source responses. Raw
downloads and their metadata live under `pipeline/cache/`, which is ignored by
Git. The cache is restored by the scheduled GitHub Actions job but is never
shipped to site visitors.

### 2. Parse and normalize

`scripts/data/build_catalog.py` reads the EPA archive with UTF-8 BOM handling,
parses ForCar's CSV, and reads cached vPIC JSON. Names are normalized by case,
spacing, punctuation, and a small reviewed alias table in
`pipeline/aliases.json`.

The alias table is deliberately explicit. It is the extension point for known
equivalences such as `Mercedes Benz` → `Mercedes-Benz` and `F-150` ↔ `F150`.
The pipeline does not use edit-distance or unrestricted fuzzy matching because
an apparently close model name can describe a different vehicle.

EPA configuration identity is preserved. Exact duplicate configurations are
removed deterministically, while differences in engine, transmission,
drivetrain, fuel, or efficiency remain separate records. Each stable ID is the
EPA row key prefixed with `epa-`.

### 3. Join market prices

Price matching requires the same model year and one of two recorded rules:

1. `exact-normalized`: normalized make and model names match exactly.
2. `explicit-descriptor-stripped`: a reviewed set of explicit EPA configuration
   descriptors (such as a body or drivetrain suffix) is removed before an exact
   comparison.

No generic model-level average is spread across unrelated model names, and no
trim price is invented. An unmatched or ambiguous record keeps `price: null`.
The frontend displays it as “Price unavailable.”

A joined price object records, at minimum:

```json
{
  "average": 15000,
  "min": 10900,
  "max": 21900,
  "sampleSize": 42,
  "averageMileage": 78400,
  "currency": "USD",
  "methodology": "…asking listings aggregated by ForCar…",
  "source": "ForCar",
  "updatedAt": "2026-11-08T19:39:50Z",
  "scope": "model-year",
  "matchRule": "exact-normalized"
}
```

Every priced vehicle also retains ForCar provenance and its CC BY 4.0 license.

### 4. Classify and shard

Reliable broad categories and body styles are derived from EPA vehicle class
and explicit configuration text. The pipeline does not publish subjective
performance, reliability, safety, or prestige scores.

Records are partitioned by configurable model-year and asking-price bands from
`pipeline/config.json`. Unpriced rows use dedicated `price-unavailable` shards.
This lets a `$15,000` search skip expensive, exotic, and unpriced shards rather
than downloading the full catalog.

Generated files are compact JSON. Each write uses a same-directory temporary
file followed by an atomic filesystem replacement. Refresh currently writes
and then validates the requested output directory; CI only commits the result
when the whole command exits successfully. For experimentation, point
`--output-dir` at a temporary directory so the checked-in output is untouched.

### 5. Validate

`scripts/data/validate_catalog.py` fails the build on:

- missing manifest fields or shard files;
- a shard SHA-256 or count mismatch;
- malformed or duplicate stable IDs;
- missing make/model/year, specification objects, or EPA provenance;
- unsupported price currency/source;
- a non-positive average or invalid price range;
- any priced record whose scope is not `model-year`;
- any priced record represented as trim-specific;
- missing ForCar CC BY provenance on a priced record;
- incorrect shard year/price bounds;
- mismatched manifest, facets, and stats totals; or
- a major coverage regression below the configured record/make/year floors.

The validator reports unusual average-vs-range relationships as warnings and
includes them in its JSON result instead of silently rewriting source values.

## Published artifact contract

`public/data/catalog-manifest.json` is the browser entry point. It contains the
catalog version, generation time, overall priced/unpriced counts, source
attribution, and each shard's URL, record count, year bounds, price bounds,
byte size, and SHA-256.

Other top-level files:

- `catalog-stats.json`: coverage and normalization counters;
- `facets.json`: makes, dependent models/years, categories, body styles, fuel,
  transmission, and drivetrain values;
- `attribution.json`: human- and machine-readable licenses and limitations; and
- `catalog/*.json`: the vehicle record arrays loaded by the app.

Each vehicle record includes:

- stable `id`, `year`, `make`, `model`, and nullable `trim`;
- broad category and nullable body style;
- nullable market-price aggregate;
- source-backed specifications with missing values left `null`;
- per-source identifiers, URLs, retrieval times, and license labels; and
- raw/source detail needed to explain EPA class, fuel/efficiency units, and
  vPIC corroboration.

New sources should be added as adapters that populate this contract, preserve
their license and provenance, and add validation for every new claim. A new
source must not weaken the price-scope rule or overwrite a higher-confidence
source silently.

## Automation and failure behavior

`.github/workflows/data-refresh.yml` runs at 06:17 UTC every Sunday and can also
be started manually. It restores the ignored download cache, runs the complete
refresh, and commits `public/data` only when Git sees a validated change.

If an upstream service is temporarily unavailable, the fetcher reuses a cached
last-good file when one exists. If the source is corrupt, a required cache is
missing, or validation fails, the workflow exits before committing. The
currently deployed GitHub Pages artifact therefore remains available; browsing
never calls these upstream services at runtime.

For protected `main` branches, change the workflow to open a pull request or
grant the Actions bot a permitted update path. Do not bypass catalog validation
to make a refresh green.

## Current checked-in snapshot

The build represented by `public/data/catalog-stats.json` at the time of this
documentation contains 49,704 configurations, 146 makes, 5,820 make/model
combinations, and model years 1984–2027. It has 15,279 priced and 34,425
unpriced records. Those numbers are descriptive, not hard-coded acceptance
caps; future validated source coverage may grow.
