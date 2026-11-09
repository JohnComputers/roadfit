#!/usr/bin/env python3
"""Fetch, normalize, shard, and validate the complete RoadFit public catalog."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from build_catalog import build_catalog
from common import CACHE_DIR, PUBLIC_DATA_DIR
from fetch_sources import fetch_sources
from validate_catalog import validate_catalog


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Use the last-good cached downloads only")
    parser.add_argument("--skip-vpic-models", action="store_true", help="Skip per-make vPIC model requests")
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    parser.add_argument("--output-dir", type=Path, default=PUBLIC_DATA_DIR)
    args = parser.parse_args()
    cache_dir, output_dir = args.cache_dir.resolve(), args.output_dir.resolve()

    fetch_report = fetch_sources(
        offline=args.offline,
        skip_vpic_models=args.skip_vpic_models,
        cache_dir=cache_dir,
    )
    stats = build_catalog(cache_dir=cache_dir, output_dir=output_dir)
    validation = validate_catalog(output_dir)
    report = {
        "fetch": {
            "epa": fetch_report["sources"]["epa"].get("runStatus"),
            "forcar": fetch_report["sources"]["forcar"].get("runStatus"),
            "vpicMakes": fetch_report["sources"]["vpicMakes"].get("runStatus"),
            "vpicModelMakes": len(fetch_report.get("vpicModels", {})),
        },
        "catalog": stats,
        "validation": validation,
    }
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
