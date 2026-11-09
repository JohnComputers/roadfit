#!/usr/bin/env python3
"""Normalize cached EPA/vPIC/ForCar data and emit browser-friendly JSON shards."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import sys
import unicodedata
import urllib.parse
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from common import (
    ALIASES_PATH,
    CACHE_DIR,
    PUBLIC_DATA_DIR,
    atomic_write_json,
    load_config,
    load_json,
    sha256_file,
    source_timestamp,
    utc_now,
)
from epa_horsepower import SOURCE as HORSEPOWER_SOURCE, SOURCE_HOME as HORSEPOWER_HOME, lookup_horsepower, read_snapshot
from generation_specs import enrich_vehicle, load_generation_specs


EPA_SOURCE = "EPA/DOE FuelEconomy.gov"
VPIC_SOURCE = "NHTSA vPIC"
FORCAR_SOURCE = "ForCar"
EPA_HOME = "https://www.fueleconomy.gov/feg/download.shtml"
VPIC_HOME = "https://vpic.nhtsa.dot.gov/api/"
FORCAR_HOME = "https://forcar.org/open-data/"


def text(value: Any) -> str:
    return str(value or "").strip()


def as_int(value: Any) -> int | None:
    try:
        raw = text(value).replace(",", "")
        return int(round(float(raw))) if raw else None
    except (TypeError, ValueError):
        return None


def as_float(value: Any) -> float | None:
    try:
        raw = text(value).replace(",", "")
        number = float(raw) if raw else None
        return number if number is not None and math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def positive_int(value: Any) -> int | None:
    number = as_int(value)
    return number if number is not None and number > 0 else None


def positive_float(value: Any) -> float | None:
    number = as_float(value)
    return number if number is not None and number > 0 else None


def normalize_key(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = value.casefold().replace("&", " and ")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value).split())


class NameNormalizer:
    def __init__(self, aliases: dict[str, Any]):
        self.make_keys: dict[str, str] = {}
        for canonical, variants in aliases.get("makeAliases", {}).items():
            canonical_key = normalize_key(canonical)
            for name in [canonical, *variants]:
                self.make_keys[normalize_key(name)] = canonical_key
        self.model_keys: dict[str, dict[str, str]] = defaultdict(dict)
        for make, models in aliases.get("modelAliases", {}).items():
            make_key = self.make(make)
            for canonical, variants in models.items():
                canonical_key = normalize_key(canonical)
                for name in [canonical, *variants]:
                    self.model_keys[make_key][normalize_key(name)] = canonical_key

    def make(self, name: str) -> str:
        key = normalize_key(name)
        return self.make_keys.get(key, key)

    def model(self, make: str, model: str) -> str:
        make_key = self.make(make)
        key = normalize_key(model)
        return self.model_keys.get(make_key, {}).get(key, key)


def read_metadata(path: Path) -> dict[str, Any]:
    meta_path = path.with_suffix(path.suffix + ".meta.json")
    if meta_path.exists():
        return load_json(meta_path)
    timestamp = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).replace(microsecond=0)
    return {"retrievedAt": timestamp.isoformat().replace("+00:00", "Z"), "sha256": sha256_file(path)}


def iter_epa_rows(path: Path) -> Iterable[dict[str, str]]:
    with zipfile.ZipFile(path) as archive:
        name = next((item for item in archive.namelist() if item.lower().endswith("vehicles.csv")), None)
        if name is None:
            raise ValueError("EPA archive does not contain vehicles.csv")
        with archive.open(name) as raw:
            stream = io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace", newline="")
            yield from csv.DictReader(stream)


def iter_forcar_rows(path: Path) -> Iterable[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", errors="replace", newline="") as handle:
        yield from csv.DictReader(handle)


def load_vpic_index(cache_dir: Path, names: NameNormalizer) -> dict[tuple[str, str], dict[str, Any]]:
    index: dict[tuple[str, str], dict[str, Any]] = {}
    models_dir = cache_dir / "vpic" / "models"
    if not models_dir.exists():
        return index
    for path in sorted(models_dir.glob("*.json")):
        try:
            payload = load_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        for item in payload.get("Results", []) if isinstance(payload, dict) else []:
            make = text(item.get("Make_Name"))
            model = text(item.get("Model_Name"))
            if not make or not model:
                continue
            key = (names.make(make), names.model(make, model))
            index.setdefault(key, {
                "make": make,
                "model": model,
                "modelId": as_int(item.get("Model_ID")),
                "makeId": as_int(item.get("Make_ID")),
            })
    return index


def descriptor_stripped_keys(make: str, model: str, names: NameNormalizer) -> list[str]:
    """Return conservative price-join candidates, never edit-distance guesses."""
    exact = names.model(make, model)
    tokens = exact.split()
    candidates = [exact]
    suffixes = {"2wd", "4wd", "awd", "fwd", "rwd", "pickup", "convertible", "coupe", "sedan", "wagon", "hatchback"}
    changed = False
    while tokens and tokens[-1] in suffixes:
        tokens.pop()
        changed = True
    if changed and tokens:
        candidate = " ".join(tokens)
        if candidate not in candidates:
            candidates.append(candidate)
    return candidates


def load_prices(path: Path, names: NameNormalizer, retrieved_at: str) -> tuple[dict[tuple[str, str, int], dict[str, Any]], dict[str, int]]:
    prices: dict[tuple[str, str, int], dict[str, Any]] = {}
    stats = {"rows": 0, "validRows": 0, "duplicateRows": 0}
    for row in iter_forcar_rows(path):
        stats["rows"] += 1
        make, model = text(row.get("make")), text(row.get("model"))
        year, average, listings = as_int(row.get("model_year")), as_int(row.get("avg_price_usd")), as_int(row.get("listings"))
        if not make or not model or year is None or average is None or listings is None:
            continue
        key = (names.make(make), names.model(make, model), year)
        candidate = {
            "make": make, "model": model, "year": year, "average": average,
            "min": as_int(row.get("min_price_usd")), "max": as_int(row.get("max_price_usd")),
            "sampleSize": listings, "averageMileage": as_int(row.get("avg_mileage")),
            "url": text(row.get("forcar_url")) or FORCAR_HOME, "updatedAt": retrieved_at,
        }
        current = prices.get(key)
        if current is not None:
            stats["duplicateRows"] += 1
        if current is None or candidate["sampleSize"] > current["sampleSize"]:
            prices[key] = candidate
        stats["validRows"] += 1
    return prices, stats


def classify_vehicle(vclass: str, model: str) -> tuple[str | None, str | None]:
    vehicle_class = vclass.casefold()
    model_tokens = set(normalize_key(model).split())
    body: str | None = None
    category: str | None = None
    if "pickup" in vehicle_class:
        category, body = "Truck", "Pickup"
    elif "sport utility" in vehicle_class:
        category, body = "SUV", "SUV"
    elif "minivan" in vehicle_class:
        category, body = "Van", "Minivan"
    elif "van" in vehicle_class:
        category, body = "Van", "Van"
    elif "station wagon" in vehicle_class:
        category, body = "Car", "Wagon"
    elif "car" in vehicle_class or "two seater" in vehicle_class:
        category = "Car"
    for token, label in (
        ("convertible", "Convertible"), ("cabriolet", "Convertible"),
        ("roadster", "Convertible"), ("hatchback", "Hatchback"),
        ("wagon", "Wagon"), ("coupe", "Coupe"), ("sedan", "Sedan"),
    ):
        if token in model_tokens:
            body = label
            break
    return category, body


def fuel_type(row: dict[str, str]) -> str | None:
    primary, secondary, atv = text(row.get("fuelType1")), text(row.get("fuelType2")), text(row.get("atvType"))
    combined = f"{primary} {secondary} {atv}".casefold()
    if "plug-in hybrid" in combined or text(row.get("phevBlended")).casefold() == "true":
        return "PHEV"
    if "hybrid" in combined:
        return "Hybrid"
    if "electricity" in combined or "electric vehicle" in combined:
        return "EV" if not secondary else "PHEV"
    if "diesel" in combined:
        return "Diesel"
    if "gasoline" in combined or "e85" in combined:
        return "Gasoline"
    return "Other" if primary else None


def transmission(value: str) -> str | None:
    key = value.casefold()
    if "automatic" in key or "auto" in key or "variable gear" in key:
        return "Automatic"
    if "manual" in key:
        return "Manual"
    return None


def drivetrain(value: str) -> str | None:
    key = normalize_key(value)
    if key == "front wheel drive":
        return "FWD"
    if key == "rear wheel drive":
        return "RWD"
    if key == "all wheel drive" or "all wheel" in key:
        return "AWD"
    if key in {"4 wheel drive", "part time 4 wheel drive", "4 wheel or all wheel drive"} or "4 wheel" in key:
        return "4WD"
    return None


def engine_label(displacement: float | None, cylinders: int | None, row: dict[str, str], fuel: str | None) -> str | None:
    if fuel == "EV" and displacement is None and cylinders is None:
        return "Electric motor"
    parts: list[str] = []
    if displacement is not None:
        parts.append(f"{displacement:g}L")
    if cylinders is not None:
        parts.append(f"{cylinders}-cylinder")
    if text(row.get("tCharger")).casefold() == "t":
        parts.append("turbocharged")
    if text(row.get("sCharger")).casefold() == "s":
        parts.append("supercharged")
    return " ".join(parts) or None


def price_for_record(make: str, model: str, year: int, names: NameNormalizer, prices: dict[tuple[str, str, int], dict[str, Any]]) -> tuple[dict[str, Any] | None, str | None, dict[str, Any] | None]:
    make_key = names.make(make)
    for position, model_key in enumerate(descriptor_stripped_keys(make, model, names)):
        source = prices.get((make_key, model_key, year))
        if source is None:
            continue
        rule = "exact-normalized" if position == 0 else "explicit-descriptor-stripped"
        return {
            "average": source["average"], "min": source["min"], "max": source["max"],
            "sampleSize": source["sampleSize"], "averageMileage": source["averageMileage"],
            "currency": "USD",
            "methodology": "Arithmetic mean of U.S. used-vehicle asking listings aggregated by ForCar for this make/model/model year; not a completed-sale price or live listing.",
            "source": FORCAR_SOURCE, "updatedAt": source["updatedAt"], "scope": "model-year", "matchRule": rule,
        }, rule, source
    return None, None, None


def epa_signature(row: dict[str, str]) -> tuple[str, ...]:
    keys = ("year", "make", "model", "trany", "drive", "cylinders", "displ", "fuelType1", "fuelType2", "city08", "highway08", "comb08", "atvType", "tCharger", "sCharger", "VClass")
    return tuple(text(row.get(key)) for key in keys)


def year_band(year: int, bands: list[list[int | None]]) -> tuple[int, int]:
    for lower, upper in bands:
        high = upper if upper is not None else 9999
        if lower <= year <= high:
            return lower, high
    decade = (year // 10) * 10
    return decade, decade + 9


def price_band(price: int | None, bands: list[list[int | None]]) -> tuple[int | None, int | None]:
    if price is None:
        return None, None
    for lower, upper in bands:
        high = upper if upper is not None else 2_147_483_647
        if lower <= price <= high:
            return lower, upper
    return 0, None


def shard_id(year_bounds: tuple[int, int], price_bounds: tuple[int | None, int | None]) -> str:
    lower_year, upper_year = year_bounds
    lower_price, upper_price = price_bounds
    if lower_price is None:
        price_part = "price-unavailable"
    elif upper_price is None:
        price_part = f"price-{lower_price:06d}-plus"
    else:
        price_part = f"price-{lower_price:06d}-{upper_price:06d}"
    return f"year-{lower_year}-{upper_year}_{price_part}"


def build_facets(records: list[dict[str, Any]], generated_at: str) -> dict[str, Any]:
    makes: dict[str, dict[str, Any]] = {}
    facet_counts: dict[str, Counter] = {
        "categories": Counter(), "bodyStyles": Counter(), "fuelTypes": Counter(),
        "transmissions": Counter(), "drivetrains": Counter(),
    }
    for record in records:
        make_entry = makes.setdefault(record["make"], {"count": 0, "models": {}})
        make_entry["count"] += 1
        model_entry = make_entry["models"].setdefault(record["model"], {"count": 0, "years": set(), "trims": set()})
        model_entry["count"] += 1
        model_entry["years"].add(record["year"])
        if record.get("trim"):
            model_entry["trims"].add(record["trim"])
        for output_key, value in (
            ("categories", record.get("category")), ("bodyStyles", record.get("bodyStyle")),
            ("fuelTypes", record["specs"].get("fuelType")),
            ("transmissions", record["specs"].get("transmission")),
            ("drivetrains", record["specs"].get("drivetrain")),
        ):
            if value:
                facet_counts[output_key][value] += 1

    make_list: list[dict[str, Any]] = []
    for make, entry in sorted(makes.items(), key=lambda item: item[0].casefold()):
        models = [{
            "name": model, "count": details["count"], "minYear": min(details["years"]),
            "maxYear": max(details["years"]), "years": sorted(details["years"]),
            "trims": sorted(details["trims"]),
        } for model, details in sorted(entry["models"].items(), key=lambda item: item[0].casefold())]
        make_list.append({"name": make, "count": entry["count"], "models": models})

    years = [record["year"] for record in records]
    priced_count = sum(record["price"] is not None for record in records)
    return {
        "generatedAt": generated_at, "total": len(records),
        "year": {"min": min(years), "max": max(years)},
        "priceAvailability": {"available": priced_count, "unavailable": len(records) - priced_count},
        "makes": make_list,
        **{key: [{"value": value, "count": count} for value, count in counter.most_common()] for key, counter in facet_counts.items()},
    }


def build_catalog(*, cache_dir: Path = CACHE_DIR, output_dir: Path = PUBLIC_DATA_DIR) -> dict[str, Any]:
    config = load_config()
    names = NameNormalizer(load_json(ALIASES_PATH))
    generated_at = utc_now()
    epa_path = cache_dir / config["sources"]["epa"]["cacheFile"]
    forcar_path = cache_dir / config["sources"]["forcar"]["cacheFile"]
    if not epa_path.exists() or not forcar_path.exists():
        raise FileNotFoundError("Source cache missing. Run scripts/data/fetch_sources.py first.")

    epa_meta, forcar_meta = read_metadata(epa_path), read_metadata(forcar_path)
    vpic_makes_path = cache_dir / "vpic" / "makes.json"
    vpic_meta = read_metadata(vpic_makes_path) if vpic_makes_path.exists() else {"retrievedAt": generated_at}
    prices, price_source_stats = load_prices(forcar_path, names, source_timestamp(forcar_meta))
    vpic_index = load_vpic_index(cache_dir, names)
    horsepower_snapshot = read_snapshot()
    generation_specs = load_generation_specs()

    seen_signatures: set[tuple[str, ...]] = set()
    records: list[dict[str, Any]] = []
    source_rows = duplicate_rows = invalid_rows = vpic_make_model_matches = 0
    join_rules: Counter = Counter()

    for row in iter_epa_rows(epa_path):
        source_rows += 1
        epa_id, make, model = text(row.get("id")), text(row.get("make")), text(row.get("model"))
        year = as_int(row.get("year"))
        if not epa_id or year is None or not make or not model:
            invalid_rows += 1
            continue
        signature = epa_signature(row)
        if signature in seen_signatures:
            duplicate_rows += 1
            continue
        seen_signatures.add(signature)

        displacement, cylinders = as_float(row.get("displ")), as_int(row.get("cylinders"))
        fuel = fuel_type(row)
        category, body_style = classify_vehicle(text(row.get("VClass")), model)
        price, join_rule, matched_price = price_for_record(make, model, year, names, prices)
        if join_rule:
            join_rules[join_rule] += 1
        provenance: list[dict[str, Any]] = [{
            "source": EPA_SOURCE, "sourceId": epa_id,
            "url": f"https://www.fueleconomy.gov/feg/Find.do?action=sbs&id={urllib.parse.quote(epa_id)}",
            "retrievedAt": source_timestamp(epa_meta), "license": config["sources"]["epa"]["license"],
        }]
        rated_power = lookup_horsepower(row, horsepower_snapshot)
        if rated_power:
            provenance.append(rated_power[1])
        vpic_match = vpic_index.get((names.make(make), names.model(make, model)))
        if vpic_match:
            vpic_make_model_matches += 1
            provenance.append({
                "source": VPIC_SOURCE, "sourceId": str(vpic_match.get("modelId") or ""), "url": VPIC_HOME,
                "retrievedAt": source_timestamp(vpic_meta), "license": config["sources"]["vpic"]["license"],
            })
        if price:
            provenance.append({
                "source": FORCAR_SOURCE, "url": matched_price["url"] if matched_price else FORCAR_HOME,
                "retrievedAt": source_timestamp(forcar_meta), "license": config["sources"]["forcar"]["license"],
            })
        record = {
            "id": f"epa-{epa_id}", "year": year, "make": make, "model": model, "trim": None,
            "category": category, "bodyStyle": body_style, "price": price,
            "specs": {
                "fuelType": fuel, "transmission": transmission(text(row.get("trany"))),
                "drivetrain": drivetrain(text(row.get("drive"))),
                "engine": engine_label(displacement, cylinders, row, fuel),
                "cylinders": cylinders, "displacementL": displacement, "horsepower": rated_power[0] if rated_power else None,
                "mpgCity": as_int(row.get("city08")), "mpgHighway": as_int(row.get("highway08")),
                "mpgCombined": as_int(row.get("comb08")), "doors": None, "seats": None,
            },
            "provenance": provenance,
            "sourceDetails": {
                "epaVehicleId": epa_id, "epaVehicleClass": text(row.get("VClass")) or None,
                "transmissionRaw": text(row.get("trany")) or None,
                "drivetrainRaw": text(row.get("drive")) or None,
                "fuelPrimaryRaw": text(row.get("fuelType1")) or None,
                "fuelSecondaryRaw": text(row.get("fuelType2")) or None,
                "efficiencyUnit": "MPGe" if fuel == "EV" else "MPG",
                "electricRangeMiles": positive_int(row.get("range")),
                "chargeTimeHours240V": positive_float(row.get("charge240")),
                "vpicMakeModelMatched": bool(vpic_match),
            },
        }
        enrich_vehicle(record, generation_specs)
        records.append(record)

    if not records:
        raise ValueError("Normalization produced zero records")
    records.sort(key=lambda item: (-item["year"], item["make"].casefold(), item["model"].casefold(), item["id"]))
    shard_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        y_bounds = year_band(record["year"], config["sharding"]["yearBands"])
        p_bounds = price_band(record["price"]["average"] if record["price"] else None, config["sharding"]["priceBands"])
        shard_groups[shard_id(y_bounds, p_bounds)].append(record)

    catalog_dir = output_dir / "catalog"
    catalog_dir.mkdir(parents=True, exist_ok=True)
    shard_manifest: list[dict[str, Any]] = []
    id_index: dict[str, str] = {}
    expected_files: set[str] = set()
    for identifier, shard_records in sorted(shard_groups.items()):
        filename = f"{identifier}.json"
        expected_files.add(filename)
        path = catalog_dir / filename
        atomic_write_json(path, shard_records)
        for item in shard_records:
            id_index[item["id"]] = identifier
        prices_in_shard = [item["price"]["average"] for item in shard_records if item["price"]]
        shard_manifest.append({
            "id": identifier, "url": f"data/catalog/{filename}", "count": len(shard_records),
            "minYear": min(item["year"] for item in shard_records),
            "maxYear": max(item["year"] for item in shard_records),
            "minPrice": min(prices_in_shard) if prices_in_shard else None,
            "maxPrice": max(prices_in_shard) if prices_in_shard else None,
            "bytes": path.stat().st_size, "sha256": sha256_file(path),
        })
    resolved_catalog = catalog_dir.resolve()
    if resolved_catalog.parent != output_dir.resolve():
        raise RuntimeError(f"Refusing to clean unexpected catalog directory: {resolved_catalog}")
    for old_path in catalog_dir.glob("*.json"):
        if old_path.name not in expected_files:
            old_path.unlink()

    priced_count = sum(record["price"] is not None for record in records)
    version_seed = "\n".join(shard["sha256"] for shard in shard_manifest)
    catalog_version = hashlib.sha256(version_seed.encode("utf-8")).hexdigest()[:16]
    spec_coverage = {
        field: sum(record["specs"].get(field) is not None for record in records)
        for field in ("horsepower", "doors", "seats")
    }
    spec_coverage["generation"] = sum(bool(record.get("generation")) for record in records)
    years, makes = {record["year"] for record in records}, {record["make"] for record in records}
    models = {(record["make"], record["model"]) for record in records}
    stats = {
        "schemaVersion": config["schemaVersion"], "catalogVersion": catalog_version,
        "generatedAt": generated_at, "total": len(records), "priced": priced_count,
        "priceUnavailable": len(records) - priced_count,
        "priceCoveragePercent": round(priced_count * 100 / len(records), 2),
        "specCoverage": spec_coverage,
        "makes": len(makes), "models": len(models),
        "years": {"min": min(years), "max": max(years), "count": len(years)},
        "sourceRows": {"epa": source_rows, "forcar": price_source_stats["rows"]},
        "normalization": {
            "epaDuplicateConfigurationsRemoved": duplicate_rows, "epaInvalidRowsRemoved": invalid_rows,
            "vpicMakeModelMatchedRecords": vpic_make_model_matches,
            "priceJoinRules": dict(join_rules), "forcar": price_source_stats,
        },
    }
    sources = [
        {"name": EPA_SOURCE, "url": EPA_HOME, "retrievedAt": source_timestamp(epa_meta), "license": config["sources"]["epa"]["license"]},
        {"name": VPIC_SOURCE, "url": VPIC_HOME, "retrievedAt": source_timestamp(vpic_meta), "license": config["sources"]["vpic"]["license"]},
        {
            "name": FORCAR_SOURCE, "url": FORCAR_HOME, "retrievedAt": source_timestamp(forcar_meta),
            "license": config["sources"]["forcar"]["license"],
            "priceMethodology": "Aggregated asking prices by make/model/model year; not completed sales or verified live inventory.",
        },
    ]
    if horsepower_snapshot["sources"]:
        sources.append({
            "name": HORSEPOWER_SOURCE, "url": HORSEPOWER_HOME,
            "retrievedAt": max(item["retrievedAt"] for item in horsepower_snapshot["sources"].values()),
            "license": "U.S. federal government public data",
        })
    manifest = {
        "schemaVersion": config["schemaVersion"], "catalogVersion": catalog_version,
        "generatedAt": generated_at, "total": len(records), "pricedCount": priced_count,
        "unpricedCount": len(records) - priced_count, "shards": shard_manifest, "specCoverage": spec_coverage,
        "facetsUrl": "data/facets.json", "statsUrl": "data/catalog-stats.json",
        "idIndexUrl": "data/id-index.json", "sources": sources,
    }
    attribution = {
        "generatedAt": generated_at, "sources": sources,
        "limitations": [
            "ForCar prices are model-year asking-price aggregates, not completed-sale prices or live listings.",
            "FuelEconomy.gov describes tested configurations. Additional specifications are shown when separate official evidence supports a match.",
            "Missing prices and specifications remain null; RoadFit does not fabricate estimates.",
            "Images, when added separately, must not be assumed to depict an exact trim unless explicitly verified.",
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    atomic_write_json(output_dir / "id-index.json", id_index)
    atomic_write_json(output_dir / "catalog-manifest.json", manifest, pretty=True)
    atomic_write_json(output_dir / "catalog-stats.json", stats, pretty=True)
    atomic_write_json(output_dir / "facets.json", build_facets(records, generated_at))
    atomic_write_json(output_dir / "attribution.json", attribution, pretty=True)
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    parser.add_argument("--output-dir", type=Path, default=PUBLIC_DATA_DIR)
    args = parser.parse_args()
    stats = build_catalog(cache_dir=args.cache_dir.resolve(), output_dir=args.output_dir.resolve())
    json.dump(stats, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
