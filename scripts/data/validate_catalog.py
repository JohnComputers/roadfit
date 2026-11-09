#!/usr/bin/env python3
"""Validate generated RoadFit shards, joins, coverage, and manifest integrity."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from common import PUBLIC_DATA_DIR, load_config, load_json, sha256_file


ID_PATTERN = re.compile(r"^epa-[0-9]+$")
SPEC_KEYS = {
    "fuelType", "transmission", "drivetrain", "engine", "cylinders",
    "displacementL", "horsepower", "mpgCity", "mpgHighway", "mpgCombined", "doors", "seats",
}


def validate_catalog(output_dir: Path = PUBLIC_DATA_DIR) -> dict[str, Any]:
    config = load_config()
    manifest_path = output_dir / "catalog-manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Catalog manifest is missing: {manifest_path}")
    manifest = load_json(manifest_path)
    errors: list[str] = []
    warnings: list[str] = []
    seen_ids: set[str] = set()
    counts = Counter()
    actual_total = 0

    required_manifest = {"schemaVersion", "catalogVersion", "generatedAt", "total", "shards", "sources", "idIndexUrl"}
    missing_manifest = sorted(required_manifest - set(manifest))
    if missing_manifest:
        errors.append(f"manifest missing keys: {', '.join(missing_manifest)}")

    for shard in manifest.get("shards", []):
        relative = shard.get("url", "")
        relative = relative[5:] if relative.startswith("data/") else relative
        path = output_dir / relative
        if not path.exists():
            errors.append(f"missing shard: {relative}")
            continue
        if shard.get("sha256") and sha256_file(path) != shard["sha256"]:
            errors.append(f"sha256 mismatch: {relative}")
        try:
            records = load_json(path)
        except (OSError, json.JSONDecodeError) as error:
            errors.append(f"invalid JSON in {relative}: {error}")
            continue
        if not isinstance(records, list):
            errors.append(f"shard is not an array: {relative}")
            continue
        if len(records) != shard.get("count"):
            errors.append(f"count mismatch in {relative}: manifest={shard.get('count')} actual={len(records)}")
        actual_total += len(records)

        years, prices = [], []
        for index, record in enumerate(records):
            label = f"{relative}[{index}]"
            vehicle_id = record.get("id")
            if not isinstance(vehicle_id, str) or not ID_PATTERN.fullmatch(vehicle_id):
                errors.append(f"{label}: invalid stable id {vehicle_id!r}")
            elif vehicle_id in seen_ids:
                errors.append(f"{label}: duplicate id {vehicle_id}")
            else:
                seen_ids.add(vehicle_id)
            if not isinstance(record.get("year"), int) or not 1886 <= record["year"] <= 2100:
                errors.append(f"{label}: invalid year")
            else:
                years.append(record["year"])
            if not record.get("make") or not record.get("model"):
                errors.append(f"{label}: make/model missing")
            specs = record.get("specs")
            if not isinstance(specs, dict) or not SPEC_KEYS.issubset(specs):
                errors.append(f"{label}: incomplete specs object")
            else:
                for field, maximum in (("horsepower", 2500), ("doors", 8), ("seats", 30)):
                    value = specs[field]
                    if value is not None:
                        if type(value) is not int or not 1 <= value <= maximum:
                            errors.append(f"{label}: invalid {field}")
                        else:
                            counts[field] += 1
            generation = record.get("generation")
            if generation:
                start, end = generation.get("startYear"), generation.get("endYear")
                if (type(start) is not int or type(end) is not int or type(record.get("year")) is not int
                        or not start <= record["year"] <= end or not generation.get("name")
                        or not str(generation.get("sourceUrl", "")).startswith("https://")):
                    errors.append(f"{label}: invalid generation range or source")
                else:
                    counts["generation"] += 1
            provenance = record.get("provenance")
            if not isinstance(provenance, list) or not provenance:
                errors.append(f"{label}: provenance missing")
            elif not any(item.get("source") == "EPA/DOE FuelEconomy.gov" for item in provenance if isinstance(item, dict)):
                errors.append(f"{label}: EPA provenance missing")

            price = record.get("price")
            if price is None:
                counts["unpriced"] += 1
                continue
            counts["priced"] += 1
            required_price = {"average", "min", "max", "sampleSize", "averageMileage", "currency", "methodology", "source", "updatedAt"}
            if not required_price.issubset(price):
                errors.append(f"{label}: incomplete price object")
                continue
            average, minimum, maximum = price.get("average"), price.get("min"), price.get("max")
            if not isinstance(average, int) or average <= 0:
                errors.append(f"{label}: invalid average price")
            else:
                prices.append(average)
            if minimum is not None and maximum is not None and minimum > maximum:
                errors.append(f"{label}: min price exceeds max")
            if minimum is not None and average is not None and average < minimum:
                warnings.append(f"{label}: average is below min")
            if maximum is not None and average is not None and average > maximum:
                warnings.append(f"{label}: average is above max")
            if price.get("currency") != "USD" or price.get("source") != "ForCar":
                errors.append(f"{label}: unsupported price source/currency")
            if price.get("scope") != "model-year":
                errors.append(f"{label}: price scope must be model-year")
            if record.get("trim") is not None:
                errors.append(f"{label}: model-year price must not be represented as trim-specific")
            if not any(item.get("source") == "ForCar" and item.get("license") == "CC BY 4.0" for item in provenance if isinstance(item, dict)):
                errors.append(f"{label}: priced record lacks ForCar CC BY provenance")

        if years and (min(years) != shard.get("minYear") or max(years) != shard.get("maxYear")):
            errors.append(f"year bounds mismatch in {relative}")
        expected_min, expected_max = (min(prices), max(prices)) if prices else (None, None)
        if expected_min != shard.get("minPrice") or expected_max != shard.get("maxPrice"):
            errors.append(f"price bounds mismatch in {relative}")

    if actual_total != manifest.get("total"):
        errors.append(f"manifest total mismatch: manifest={manifest.get('total')} actual={actual_total}")
    spec_coverage = {field: counts[field] for field in ("horsepower", "doors", "seats", "generation")}
    if "specCoverage" in manifest and manifest["specCoverage"] != spec_coverage:
        errors.append("specification coverage does not match manifest")
    index_relative = str(manifest.get("idIndexUrl") or "")
    index_relative = index_relative[5:] if index_relative.startswith("data/") else index_relative
    index_path = output_dir / index_relative
    if not index_relative or not index_path.exists():
        errors.append("stable ID shard index is missing")
    else:
        id_index = load_json(index_path)
        valid_shards = {str(shard.get("id")) for shard in manifest.get("shards", [])}
        if not isinstance(id_index, dict) or set(id_index) != seen_ids:
            errors.append("stable ID shard index does not cover the catalog exactly")
        elif any(value not in valid_shards for value in id_index.values()):
            errors.append("stable ID shard index references an unknown shard")
    quality = config["quality"]
    if actual_total < quality["minimumRecords"]:
        errors.append(f"coverage regression: {actual_total} records is below {quality['minimumRecords']}")
    stats_path, facets_path = output_dir / "catalog-stats.json", output_dir / "facets.json"
    if not stats_path.exists() or not facets_path.exists():
        errors.append("stats or facets output is missing")
    else:
        stats, facets = load_json(stats_path), load_json(facets_path)
        if stats.get("total") != actual_total or facets.get("total") != actual_total:
            errors.append("stats/facets totals do not match manifest")
        if stats.get("makes", 0) < quality["minimumMakes"]:
            errors.append(f"make coverage below {quality['minimumMakes']}")
        if stats.get("years", {}).get("count", 0) < quality["minimumYears"]:
            errors.append(f"year coverage below {quality['minimumYears']}")

    report = {
        "ok": not errors, "total": actual_total, "uniqueIds": len(seen_ids),
        "priced": counts["priced"], "unpriced": counts["unpriced"],
        "specCoverage": spec_coverage,
        "shards": len(manifest.get("shards", [])), "errors": errors,
        "warnings": warnings[:100], "warningCount": len(warnings),
    }
    if errors:
        raise ValueError(json.dumps(report, indent=2))
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=PUBLIC_DATA_DIR)
    args = parser.parse_args()
    try:
        report = validate_catalog(args.output_dir.resolve())
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
