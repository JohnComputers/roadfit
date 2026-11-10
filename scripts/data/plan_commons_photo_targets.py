"""Rank uncovered model years for the Commons cover-photo search."""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path

from build_vehicle_photos import INDEX, make_key, model_key, read_catalog
from common import CACHE_DIR


def display_model(make: str, model: str) -> str:
    # Remove drivetrain descriptors used by EPA, not trims or body variants.
    label = re.sub(r"\b(?:2wd|4wd|awd|fwd|rwd|4x4|4x2)\b", "", model, flags=re.I)
    label = re.sub(r"\s+pickup$", "", label.strip(), flags=re.I)
    label = " ".join(label.split())
    if make == "Ford":
        label = re.sub(r"^F(150|250|350)(?=\s|$)", r"F-\1", label, flags=re.I)
    return label


def ranked_targets(vehicles: list[dict], assigned: set[str], limit: int) -> list[tuple[int, str, str]]:
    scores: Counter = Counter()
    labels: dict[tuple[int, str, str], Counter] = {}
    for vehicle in vehicles:
        if vehicle["id"] in assigned:
            continue
        year, make = vehicle["year"], vehicle["make"]
        model = display_model(make, vehicle["model"])
        if not model:
            continue
        target = year, make_key(make), model_key(model)
        price = vehicle.get("price") or {}
        weight = 1 + (2 if price.get("average", float("inf")) <= 25_000 else 0)
        scores[target] += weight
        labels.setdefault(target, Counter())[(make, model)] += weight
    return [(key[0], *labels[key].most_common(1)[0][0]) for key, _ in scores.most_common(limit)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=300)
    parser.add_argument("--output", type=Path, default=CACHE_DIR / "commons-photo-targets.csv")
    args = parser.parse_args()
    assigned = set(json.loads(INDEX.read_text(encoding="utf-8"))["vehicles"])
    targets = ranked_targets(read_catalog(), assigned, args.limit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(("year", "make", "model"))
        writer.writerows(targets)
    print(f"Wrote {len(targets):,} uncovered model-year targets to {args.output}")


if __name__ == "__main__":
    main()
