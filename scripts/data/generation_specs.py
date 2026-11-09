"""Enrich EPA configurations with sourced generation labels and seating/body counts.

Refresh the compact NCAP snapshot using `python scripts/data/generation_specs.py
--refresh-ncap`. The normal catalog build reads the checked-in snapshot offline.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import NamedTuple
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
GENERATION_PATH = ROOT / 'pipeline/vehicle-generations.json'
NCAP_PATH = ROOT / 'pipeline/ncap-body-specs.csv'
NCAP_URL = 'https://static.nhtsa.gov/nhtsa/downloads/Safercar/Safercar_data.csv'
NCAP_DOCUMENTATION = 'https://www.nhtsa.gov/nhtsa-datasets-and-apis'
NCAP_COLUMNS = ('year', 'make', 'model', 'drives', 'body', 'doors', 'seats')
DOOR_COUNT = re.compile(r'\b([2-6])\s*(?:doors?|dr|hb)\b', re.I)
DRIVE_WORD = re.compile(r'\b(?:2wd|4wd|awd|fwd|rwd|4x2|4x4)\b', re.I)
BODY_WORD = re.compile(r'\b(hatchback|hatch|liftback|sedan|coupe|convertible|cabriolet|wagon)\b', re.I)
BODY_ALIAS = {'hatch': 'hatchback', 'liftback': 'hatchback', 'cabriolet': 'convertible'}
DRIVE_ALIAS = {'4X4': ('4WD',), '2WD': ('FWD', 'RWD'), '4X2': ('FWD', 'RWD')}


class BodySpec(NamedTuple):
    drives: tuple[str, ...]
    body: str
    doors: int | None
    seats: int | None


def words(value: str) -> str:
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode()
    return ' '.join(re.findall(r'[a-z0-9]+', value.casefold()))


def make_key(value: str) -> str:
    return words(value).replace(' ', '')


def model_key(value: str) -> str:
    normalized = words(value)
    normalized = DRIVE_WORD.sub(' ', normalized)
    normalized = DOOR_COUNT.sub(' ', normalized)
    normalized = BODY_WORD.sub(' ', normalized)
    return normalized.replace(' ', '')


def explicit_body(value: str) -> str:
    match = BODY_WORD.search(words(value))
    return BODY_ALIAS.get(match[1], match[1]) if match else ''


def read_ncap_body(row: dict) -> tuple[str, int | None]:
    raw = words(row['BODY_STYLE'])
    count = DOOR_COUNT.search(raw)
    doors = int(count[1]) if count else None
    body = explicit_body(row['MODEL']) or explicit_body(raw)
    if not body:
        if re.search(r'\b[2-5]\s*hb\b', raw):
            body = 'hatchback'
        elif raw == 'c':
            body = 'convertible'
        elif raw == 'sw':
            body = 'wagon'
        elif raw.startswith('suv') or raw.endswith(' suv'):
            body = 'suv'
        elif row['VEHICLE_TYPE'].strip().upper() == 'PC' and doors in {2, 4}:
            body = 'coupe' if doors == 2 else 'sedan'
    return body, doors


def read_ncap_seats(row: dict) -> int | None:
    number = row['NUM_OF_SEATING'].strip()
    if not re.fullmatch(r'(?:[1-9]|1[0-5])', number):
        return None
    seats = int(number)
    locations = row['SEAT_LOC'].strip()
    if re.fullmatch(r'\d{1,2}(?:,\s*\d{1,2})*', locations):
        # A few submissions disagree with their own explicit position list.
        if len(set(re.findall(r'\d+', locations))) != seats:
            return None
    return seats


def build_ncap_snapshot(source: Path, output: Path = NCAP_PATH) -> int:
    rows = set()
    with source.open(encoding='utf-8-sig', newline='') as file:
        reader = csv.DictReader(file)
        required = {'MAKE', 'MODEL', 'MODEL_YR', 'BODY_STYLE', 'VEHICLE_TYPE', 'DRIVE_TRAIN', 'NUM_OF_SEATING', 'SEAT_LOC'}
        if not required.issubset(reader.fieldnames or ()):
            raise ValueError('NHTSA SaferCar CSV header changed')
        for row in reader:
            year = row['MODEL_YR'].strip()
            make, model = make_key(row['MAKE']), model_key(row['MODEL'])
            if not re.fullmatch(r'(?:19[89]|20[0-3])\d', year) or not make or not model:
                continue
            drives = set()
            for drive in row['DRIVE_TRAIN'].strip().upper().split('/'):
                if drive in {'AWD', 'RWD', 'FWD', '4WD'}:
                    drives.add(drive)
                else:
                    drives.update(DRIVE_ALIAS.get(drive, ()))
            body, doors = read_ncap_body(row)
            seats = read_ncap_seats(row)
            # Keep conflicting or ambiguous rows, even when the value is blank.
            rows.add((year, make, model, '/'.join(sorted(drives)), body, str(doors or ''), str(seats or '')))
    if len(rows) < 10_000:
        raise ValueError('NHTSA SaferCar snapshot is unexpectedly small')
    temp = output.with_suffix('.tmp')
    with temp.open('w', encoding='utf-8', newline='') as file:
        writer = csv.writer(file, lineterminator='\n')
        writer.writerow(NCAP_COLUMNS)
        writer.writerows(sorted(rows))
    temp.replace(output)
    return len(rows)


def load_generation_specs() -> tuple[dict, dict]:
    source = json.loads(GENERATION_PATH.read_text(encoding='utf-8'))
    generations = defaultdict(list)
    for family in source['families']:
        make = make_key(family['make'])
        pattern = re.compile(family['modelPattern'])
        for name, start, end, *override in family['years']:
            generation = {
                'name': name, 'startYear': start, 'endYear': end,
                'sourceUrl': override[0] if override else family['sourceUrl'],
            }
            generations[make].append((pattern, generation, family.get('bodySpecs'), family.get('seatingNote')))
    ncap = defaultdict(list)
    with NCAP_PATH.open(encoding='utf-8', newline='') as file:
        for row in csv.DictReader(file):
            ncap[(int(row['year']), row['make'], row['model'])].append(BodySpec(
                tuple(row['drives'].split('/')) if row['drives'] else (), row['body'],
                int(row['doors']) if row['doors'] else None, int(row['seats']) if row['seats'] else None,
            ))
    return dict(generations), dict(ncap)


def consensus(records: list[BodySpec], field: str) -> int | None:
    values = {getattr(record, field) for record in records}
    return values.pop() if len(values) == 1 else None


def enrich_vehicle(vehicle: dict, dataset: tuple[dict, dict]) -> None:
    generations, ncap = dataset
    year, make, model = vehicle['year'], make_key(vehicle['make']), vehicle['model']
    normalized_model = words(model)
    specs = vehicle['specs']
    provenance = vehicle['provenance']
    matches = [(generation, body, note) for pattern, generation, body, note in generations.get(make, ())
               if generation['startYear'] <= year <= generation['endYear'] and pattern.fullmatch(normalized_model)]
    if len(matches) == 1:
        generation, body, note = matches[0]
        vehicle['generation'] = generation
        if body and body.get('startYear', year) <= year <= body.get('endYear', year):
            fields = []
            for field in ('doors', 'seats'):
                if specs.get(field) is None and field in body:
                    specs[field] = body[field]
                    fields.append(field)
            if fields:
                provenance.append({'source': 'Manufacturer body specifications', 'url': body['sourceUrl'], 'fields': fields})
        if note and year == note['year'] and not any(cab in normalized_model for cab in ('raptor', 'regular cab', 'supercab', 'supercrew')):
            vehicle.setdefault('sourceDetails', {})['seatingNote'] = note['text']
            provenance.append({'source': 'Ford F-150 Technical Specifications', 'url': note['sourceUrl'],
                               'fields': ['seatingNote']})

    explicit = DOOR_COUNT.search(normalized_model)
    doors = int(explicit[1]) if explicit else None
    if specs.get('doors') is None and doors is not None:
        specs['doors'] = doors
    body = explicit_body(model)
    drive = specs.get('drivetrain')
    possible = [record for record in ncap.get((year, make, model_key(model)), ())
                if (not drive or not record.drives or drive in record.drives)
                and (not body or body == record.body)
                and (doors is None or record.doors is None or record.doors == doors)]
    fields = []
    for field in ('doors', 'seats'):
        value = consensus(possible, field)
        if specs.get(field) is None and value is not None:
            specs[field] = value
            fields.append(field)
    if fields:
        provenance.append({'source': 'NHTSA SaferCar (NCAP)', 'url': NCAP_DOCUMENTATION,
                           'license': 'U.S. federal government public data', 'fields': fields})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh-ncap', action='store_true')
    parser.add_argument('--input', type=Path, default=ROOT / 'pipeline/cache/safercar-data.csv')
    args = parser.parse_args()
    if args.refresh_ncap:
        args.input.parent.mkdir(parents=True, exist_ok=True)
        download = args.input.with_suffix('.download')
        request = Request(NCAP_URL, headers={'User-Agent': 'RoadFit/1.1 (https://github.com/JohnComputers/roadfit)'})
        with urlopen(request, timeout=60) as response, download.open('wb') as file:
            data = response.read(20_000_001)
            if not 1_000_000 <= len(data) <= 20_000_000:
                raise ValueError('Unexpected NHTSA SaferCar response size')
            file.write(data)
        download.replace(args.input)
    count = build_ncap_snapshot(args.input)
    print(f'Wrote {count:,} distinct NHTSA vehicle body/seat rows to {NCAP_PATH}')


if __name__ == '__main__':
    main()
