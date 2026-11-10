"""Apply manufacturer-rated electric and hybrid system horsepower to EPA records."""

from __future__ import annotations

import re
from collections import defaultdict

from common import PIPELINE_DIR, load_json


def load_electrified_power() -> dict:
    by_make = defaultdict(list)
    for document in load_json(PIPELINE_DIR / 'electrified-power.json'):
        for rule in document['ratings']:
            pattern = re.compile(rule['model'], re.IGNORECASE)
            by_make[document['make'].casefold()].append((pattern, rule, document))
    return dict(by_make)


def add_electrified_power(vehicle: dict, rules: dict) -> None:
    specs = vehicle['specs']
    if specs['horsepower'] is not None:
        return
    model = ' '.join(vehicle['model'].split())
    year = vehicle['year']
    matches = []
    for pattern, rule, document in rules.get(vehicle['make'].casefold(), ()):
        if not (rule['years'][0] <= year <= rule['years'][1] and specs['fuelType'] == rule['fuel']
                and pattern.fullmatch(model)):
            continue
        if 'liters' in rule and rule['liters'] != specs.get('displacementL'):
            continue
        if 'drives' in rule and specs.get('drivetrain') not in rule['drives']:
            continue
        matches.append((rule['hp'], document))
    if not matches or len({hp for hp, _ in matches}) != 1:
        return
    horsepower, document = matches[0]
    specs['horsepower'] = horsepower
    vehicle['sourceDetails']['horsepowerScope'] = 'system'
    vehicle['provenance'].append({
        'source': document['name'], 'url': document['url'],
        'license': 'Manufacturer specifications; numeric facts only',
        'fields': ['Electric drive output' if specs['fuelType'] == 'EV' else 'Combined hybrid system horsepower'],
    })
