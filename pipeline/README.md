# RoadFit catalog pipeline

This directory documents the reproducible, zero-cost build for the public
vehicle catalog. Generated site data is written to `public/data`; raw downloads
stay in the ignored `pipeline/cache` directory.

## Sources and legal basis

| Source | Use | Reuse / attribution |
| --- | --- | --- |
| [EPA/DOE FuelEconomy.gov](https://www.fueleconomy.gov/feg/download.shtml) | 1984-current U.S. fuel-economy vehicle configurations, engines, fuel, transmission, drive and MPG | U.S. federal-government public data. RoadFit links to the source and preserves row IDs and retrieval dates. |
| [NHTSA vPIC](https://vpic.nhtsa.dot.gov/api/) | Manufacturer/make/model name verification | Free U.S. federal open-data API. Requests are cached and throttled. |
| [ForCar Open Data](https://forcar.org/open-data/) | U.S. used-vehicle asking-price aggregates by make/model/model year | CC BY 4.0. Attribution is required. Data represents asking prices, not completed sales or live inventory. |

ForCar publishes only aggregates backed by at least five listings. RoadFit never
republishes individual listings and never describes these rows as cars currently
for sale. Its price is attached at **model-year scope**. EPA does not publish trim
names, so generated records keep `trim: null`; the pipeline never labels the
model-year price as a trim price.

## Commands

From the repository root, with Python 3.10+:

```bash
python scripts/data/refresh.py
python scripts/data/refresh.py --offline
python scripts/data/validate_catalog.py
```

The online refresh uses conditional requests, retries, atomic replacements and
the last good cache when a source is temporarily unavailable. vPIC model calls
are made only for makes present in EPA data, at low concurrency, and each response
is separately cached. Use `--skip-vpic-models` for a faster EPA/ForCar-only build;
the vPIC make catalog is still fetched unless the whole run is offline.

The generated manifest divides data by year and price bands. A browser can skip
unrelated shards, so a `$15,000` search does not download records priced above
that budget or records without price data.

## Normalization and joins

Names are compared through case/spacing/punctuation normalization plus the small,
reviewed alias table in `aliases.json`. Pricing uses exact normalized names or a
conservative removal of explicit EPA body/drivetrain suffixes. It does not use
edit-distance fuzzy matching. Every match records its rule and model-year scope.
Missing or ambiguous prices stay `null` and must be displayed as “Price unavailable.”

Each record has a stable EPA-derived ID, source provenance, and the raw EPA model
name. Shards are deterministic apart from retrieval timestamps. Validation rejects
duplicate IDs, invalid price ranges, invented trim pricing, malformed provenance,
or suspicious coverage loss.
