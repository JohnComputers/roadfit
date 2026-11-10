"""Extract exact model-year body and seating facts from the NHTSA vPIC plain dump."""

from __future__ import annotations

import argparse
import csv
import io
import re
from collections import defaultdict
from pathlib import Path
from urllib.request import Request, urlopen
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
VPIC_PATH = ROOT / 'pipeline/vpic-body-specs.csv'
VPIC_URL = 'https://vpic.nhtsa.dot.gov/downloads/vPICList_lite_2026_10.plain.zip'
VPIC_DOCUMENTATION = 'https://vpic.nhtsa.dot.gov/Downloads'
VPIC_COLUMNS = ('year', 'make', 'model', 'body', 'drives', 'doors', 'seats', 'qualifiers')
TABLES = ('make', 'model', 'element', 'bodystyle', 'drivetype', 'vehiclespecpattern',
          'vehiclespecschema', 'vehiclespecschema_model', 'vehiclespecschema_year', 'vspecschemapattern')
COPY_HEADER = re.compile(r'^COPY vpic\.([a-z_]+) \((.+)\) FROM stdin;$')
BODY_STYLES = {
    'Convertible/Cabriolet': 'convertible', 'Roadster': 'convertible', 'Coupe': 'coupe',
    'Hatchback/Liftback/Notchback': 'hatchback', 'Sedan/Saloon': 'sedan', 'Wagon': 'wagon',
    'Sport Utility Vehicle [SUV]/Multipurpose Vehicle [MPV]': 'suv', 'Crossover Utility Vehicle [CUV]': 'suv',
    'Pickup': 'pickup', 'Minivan': 'minivan', 'Cargo Van': 'van', 'Van': 'van',
}
DRIVE_TYPES = {'FWD': 'FWD', 'RWD': 'RWD', 'AWD': 'AWD', '4WD': '4WD', '4x2': 'FWD/RWD', '2WD/4WD': '4WD/FWD/RWD'}
SUPPORTED_KEYS = {'BodyClass', 'DriveType', 'Doors', 'Seats'}


def read_copy_tables(archive: Path) -> dict[str, list[dict[str, str]]]:
    """Read named COPY sections without installing or executing PostgreSQL."""
    result = {name: [] for name in TABLES}
    with ZipFile(archive) as zipped:
        [member] = [name for name in zipped.namelist() if name.endswith('.sql')]
        with io.TextIOWrapper(zipped.open(member), encoding='utf-8', newline='') as lines:
            fields = ()
            records = None
            for line in lines:
                if line.startswith('COPY vpic.'):
                    header = COPY_HEADER.fullmatch(line.rstrip('\r\n'))
                    if header and header[1] in result:
                        fields = tuple(header[2].split(', '))
                        records = result[header[1]]
                elif records is not None:
                    if line.startswith('\\.'):
                        records = None
                    else:
                        values = line.rstrip('\r\n').split('\t')
                        if len(values) != len(fields):
                            raise ValueError(f'Unexpected COPY row for {fields}')
                        records.append(dict(zip(fields, values, strict=True)))
    if missing := [name for name, rows in result.items() if not rows]:
        raise ValueError(f'Missing vPIC tables: {", ".join(missing)}')
    return result


def int_within(value: str, low: int, high: int) -> str:
    return value if value.isascii() and value.isdecimal() and low <= int(value) <= high else ''


def index_body_patterns(tables: dict[str, list[dict[str, str]]]) -> set[tuple[str, ...]]:
    names = {table: {r['id']: r['name'] for r in tables[table]} for table in ('make', 'model', 'bodystyle', 'drivetype')}
    codes = {r['id']: r['code'] for r in tables['element']}
    schemes = {r['id']: r['makeid'] for r in tables['vehiclespecschema']
               if r['vehicletypeid'] in {'2', '3', '7'} and r['tobeqced'] in {'f', r'\N'}}
    years, models, groups = defaultdict(set), defaultdict(set), defaultdict(list)
    for r in tables['vehiclespecschema_model']:
        if r['modelid'] in names['model']:
            models[r['vehiclespecschemaid']].add(names['model'][r['modelid']])
    for r in tables['vehiclespecschema_year']:
        if int_within(r['year'], 1981, 2039):
            years[r['vehiclespecschemaid']].add(r['year'])
    for r in tables['vehiclespecpattern']:
        groups[r['vspecschemapatternid']].append((codes.get(r['elementid'], ''), r['attributeid'], r['iskey'] == 't'))

    rows = set()
    for pattern in tables['vspecschemapattern']:
        scheme = pattern['schemaid']
        if scheme not in schemes or not years[scheme] or not models[scheme] or schemes[scheme] not in names['make']:
            continue
        fields = defaultdict(set)
        keys = set()
        for code, value, is_key in groups[pattern['id']]:
            if is_key:
                keys.add(code or 'unknown')
            if code in SUPPORTED_KEYS:
                fields[code].add(value)
        def unique(code: str) -> str:
            return next(iter(fields[code])) if len(fields[code]) == 1 else ''

        body = BODY_STYLES.get(names['bodystyle'].get(unique('BodyClass'), ''), '')
        drive = names['drivetype'].get(unique('DriveType'), '')
        drives = DRIVE_TYPES.get(drive, DRIVE_TYPES.get(drive.split('/')[0], ''))
        doors = int_within(unique('Doors'), 2, 6)
        seats = int_within(unique('Seats'), 1, 15)
        # Preserve unsupported trim/cab/series selectors, even for rows without body facts.
        qualifiers = '/'.join(sorted(keys - SUPPORTED_KEYS))
        for year in years[scheme]:
            for model in models[scheme]:
                rows.add((year, names['make'][schemes[scheme]], model, body, drives, doors, seats, qualifiers))
    return rows


def build_vpic_snapshot(archive: Path, output: Path = VPIC_PATH) -> int:
    rows = index_body_patterns(read_copy_tables(archive))
    if len(rows) < 100:
        raise ValueError('Unexpectedly small vPIC body snapshot')
    temporary = output.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8', newline='') as file:
        writer = csv.writer(file, lineterminator='\n')
        writer.writerow(VPIC_COLUMNS)
        writer.writerows(sorted(rows))
    temporary.replace(output)
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=ROOT / 'pipeline/cache/vpic-postgres.zip')
    parser.add_argument('--output', type=Path, default=VPIC_PATH)
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    if args.download:
        args.input.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.input.with_suffix('.download')
        request = Request(VPIC_URL, headers={'User-Agent': 'RoadFit/1.1 (https://github.com/JohnComputers/roadfit)'})
        with urlopen(request, timeout=60) as response, temporary.open('wb') as file:
            total = 0
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > 200_000_000:
                    raise ValueError('Unexpected vPIC archive size')
                file.write(chunk)
        with ZipFile(temporary) as archive:
            if not any(name.endswith('.sql') for name in archive.namelist()):
                raise ValueError('vPIC archive is missing its plain SQL dump')
        temporary.replace(args.input)
    count = build_vpic_snapshot(args.input, args.output)
    print(f'Wrote {count:,} distinct NHTSA vPIC body/seat options to {args.output}')


if __name__ == '__main__':
    main()
