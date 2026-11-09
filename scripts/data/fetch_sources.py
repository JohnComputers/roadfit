#!/usr/bin/env python3
"""Fetch and cache RoadFit's public source datasets."""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import urllib.parse
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from common import CACHE_DIR, download_with_cache, load_config, slug


def epa_makes(zip_path: Path) -> list[str]:
    with zipfile.ZipFile(zip_path) as archive:
        csv_name = next((name for name in archive.namelist() if name.lower().endswith("vehicles.csv")), None)
        if not csv_name:
            raise ValueError("EPA archive does not contain vehicles.csv")
        with archive.open(csv_name) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace", newline="")
            return sorted({row["make"].strip() for row in csv.DictReader(text) if row.get("make", "").strip()})


def fetch_vpic_model(make: str, template: str, cache_dir: Path, offline: bool) -> tuple[str, str, int]:
    encoded_make = urllib.parse.quote(make, safe="")
    url = template.format(make=encoded_make)
    path = cache_dir / "vpic" / "models" / f"{slug(make)}.json"
    try:
        path, metadata = download_with_cache(url, path, offline=offline, timeout=45, attempts=2)
        with path.open("r", encoding="utf-8-sig") as handle:
            result = json.load(handle)
        count = len(result.get("Results", [])) if isinstance(result, dict) else 0
        return make, metadata.get("runStatus", "unknown"), count
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        if offline:
            return make, "not-cached", 0
        return make, f"failed: {error}", 0


def fetch_sources(*, offline: bool, skip_vpic_models: bool, cache_dir: Path = CACHE_DIR) -> dict:
    config = load_config()
    sources = config["sources"]
    report: dict = {"sources": {}, "vpicModels": {}}

    epa_path, epa_metadata = download_with_cache(
        sources["epa"]["url"], cache_dir / sources["epa"]["cacheFile"], offline=offline
    )
    report["sources"]["epa"] = epa_metadata

    forcar_path, forcar_metadata = download_with_cache(
        sources["forcar"]["url"], cache_dir / sources["forcar"]["cacheFile"], offline=offline
    )
    report["sources"]["forcar"] = forcar_metadata

    makes_path, makes_metadata = download_with_cache(
        sources["vpic"]["makesUrl"], cache_dir / "vpic" / "makes.json", offline=offline
    )
    report["sources"]["vpicMakes"] = makes_metadata

    makes = epa_makes(epa_path)
    report["epaMakeCount"] = len(makes)
    if not skip_vpic_models:
        results: dict[str, dict] = {}
        with ThreadPoolExecutor(max_workers=4, thread_name_prefix="vpic") as executor:
            pending = {
                executor.submit(
                    fetch_vpic_model,
                    make,
                    sources["vpic"]["modelsForMakeUrl"],
                    cache_dir,
                    offline,
                ): make
                for make in makes
            }
            for future in as_completed(pending):
                make, status, count = future.result()
                results[make] = {"status": status, "models": count}
        report["vpicModels"] = dict(sorted(results.items()))

    # Assert downloads are non-trivial before a caller replaces generated data.
    if epa_path.stat().st_size < 500_000:
        raise ValueError(f"EPA archive is unexpectedly small: {epa_path.stat().st_size} bytes")
    if forcar_path.stat().st_size < 10_000:
        raise ValueError(f"ForCar CSV is unexpectedly small: {forcar_path.stat().st_size} bytes")
    if makes_path.stat().st_size < 1_000:
        raise ValueError(f"vPIC make response is unexpectedly small: {makes_path.stat().st_size} bytes")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Use only the last-good local cache")
    parser.add_argument("--skip-vpic-models", action="store_true", help="Skip per-make vPIC model enrichment")
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    args = parser.parse_args()
    report = fetch_sources(
        offline=args.offline,
        skip_vpic_models=args.skip_vpic_models,
        cache_dir=args.cache_dir.resolve(),
    )
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
