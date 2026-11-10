"""Generate the optional photo index and local, credit-preserving cover thumbnails."""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import io
import json
import re
import threading
import time
import unicodedata
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import unquote, urlsplit, urlunsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'public'
CACHE = ROOT / 'pipeline/cache'
INDEX = PUBLIC / 'data/vehicle-images.json'
RIGHTS_URL = 'https://carimages.org/media/data/carimages-rights-latest.csv'
USER_AGENT = 'RoadFit/1.1 vehicle photo import (https://github.com/JohnComputers/roadfit)'
CDN = {'upload.wikimedia.org', 'thumb.wikimedia.org'}
MAX_IMAGE_BYTES = 12_000_000
REJECT = re.compile(r'\b(?:interior|dashboard|cockpit|steering wheel|engine bay|engine compartment|motorraum|innenraum|innenansicht|detail|brochure|manual|diecast|die cast|scale model|miniature|toy car|wheel closeup|logo|emblem|badge|headlight|taillight|tail light|key fob|chassis|cutaway|drawing|illustration|rendering|concept|prototype|replica|custom built|race car|racecar|rally car|safety car|pace car|taxi|police|ambulance|wreck|crash|burned|scrapped|facelift comparison|rear view|rear left|rear right|heckansicht|heck|back view|instrument cluster|charging port|display screen|kit car|barn find|front seat|trunk open|motor show concept|uk spec|jdm|eu spec|european spec|australian spec)\b', re.I)
FORBIDDEN_VARIANT = re.compile(r'\b(?:raptor|shelby|saleen|roush|gt350r?|gt500|hellcat|demon|trackhawk|type r|nismo|st line|gr sport|brabus|blackwing|gtr|amg|zr1|z06|trans am|sti|wrx|super duty|lightning|electric|plug in|phev|hybrid|bullitt|mach 1|dark horse|gtd|classic|warlock|trx|ltd|ld|axio|fielder|altis|europa|superleggera|interceptor|tremor|trd pro|woodland edition|plaid)\b')
DRIVE = re.compile(r'\b(?:2wd|4wd|awd|fwd|rwd|4x4|4x2|quattro|xdrive|4matic)\b')
YEAR_FIRST = re.compile(r"^(?:(19[5-9]\d|20[0-3]\d)|['’](\d{2}))[ _-]+(.+)$", re.I)
YEAR_SPAN_FIRST = re.compile(r"^['’]?((?:19|20)?\d{2})\s*[-–—]\s*['’]?((?:19|20)?\d{2})[ _-]+(.+)$")
BODY = {
    'convertible': r'convertible|cabriolet|cabrio|roadster|spider|spyder|volante|targa|soft top',
    'wagon': r'wagon|station wagon|avant|estate|sportbrake|touring sports|allroad|tourx',
    'hatchback': r'hatchback|hatch|liftback|fastback',
    'coupe': r'coupe',
    'sedan': r'sedan|saloon',
}
MAKE_ALIASES = {'chevy': 'chevrolet', 'mercedes': 'mercedesbenz', 'vw': 'volkswagen',
                'mclarenautomotive': 'mclaren', 'rollsroycemotorcars': 'rollsroyce'}
# Shared global nameplates that can represent visually different cars in the same year.
# An exact US-market source can still be supplied via an independently verified CSV row.
MARKET_AMBIGUOUS = {('ford', 'ranger'), ('ford', 'escort'), ('ford', 'fusion'), ('ford', 'mondeo'),
                    ('honda', 'accord'), ('honda', 'civic'), ('toyota', 'corolla'), ('toyota', 'camry'),
                    ('volkswagen', 'passat'), ('volkswagen', 'jetta'), ('nissan', 'sentra'),
                    ('chevrolet', 'cruze'), ('chevrolet', 'malibu'), ('ford', 'focus'), ('ford', 'fiesta')}
MODEL_EXCLUSIONS = {
    ('ford', 'bronco'): r'\bbronco (?:ii|sport)\b',
    ('ford', 'taurus'): r'\btaurus x\b',
    ('hyundai', 'elantra'): r'\belantra (?:gt|touring)\b',
    ('gmc', 'acadia'): r'\bacadia limited\b',
    ('chevrolet', 'equinox'): r'\bequinox ev\b',
    ('chevrolet', 'colorado'): r'\bcolorado zr2\b',
    ('hyundai', 'ioniq5'): r'\bioniq 5 n\b',
    ('jeep', 'grandwagoneer'): r'\bgrand wagoneer l\b',
    ('subaru', 'outback'): r'\boutback wilderness\b',
    ('subaru', 'forester'): r'\bforester wilderness\b',
}
US_CUE = re.compile(r'\b(?:united states|usa|us spec|north american|us market|u s spec|canada|canadian)\b')


def words(value: str) -> str:
    plain = unicodedata.normalize('NFKD', html.unescape(value)).encode('ascii', 'ignore').decode().lower()
    return ' '.join(re.findall(r'[a-z0-9]+', plain))


def key(value: str) -> str:
    return words(value).replace(' ', '')


def make_key(value: str) -> str:
    clean = key(value)
    return MAKE_ALIASES.get(clean, clean)


def model_key(value: str) -> str:
    value = DRIVE.sub('', words(value))
    value = re.sub(r'\bpickup\b$', '', value.strip())
    return value.replace(' ', '')


def body_of(name: str) -> str:
    if 'gran coupe' in name or 'four door coupe' in name:
        return ''
    for kind, pattern in BODY.items():
        if re.search(rf'\b(?:{pattern})\b', name):
            return kind
    return ''


def model_family(value: str) -> str:
    """Ignore only body and EPA drivetrain/fuel qualifiers that preserve the nameplate."""
    plain = words(value)
    for pattern in BODY.values():
        plain = re.sub(rf'\b(?:{pattern})\b', '', plain)
    plain = re.sub(r'\b(?:(?:2|4) ?(?:door|dr)|ffv)\b', '', plain)
    return model_key(plain) or model_key(value)


def read_catalog() -> list[dict]:
    vehicles = []
    manifest = json.loads((PUBLIC / 'data/catalog-manifest.json').read_text(encoding='utf-8'))
    for shard in manifest['shards']:
        data = json.loads((PUBLIC / shard['url']).read_text(encoding='utf-8'))
        vehicles.extend(data if isinstance(data, list) else data['vehicles'])
    return vehicles


def allowed_credit(row: dict) -> bool:
    license_url = urlsplit(row.get('license_url', ''))
    source = urlsplit(row.get('source_page_url', ''))
    media = urlsplit(row.get('source_url', ''))
    if any(x.scheme != 'https' or x.username or x.password for x in (license_url, source, media)):
        return False
    if source.netloc != 'commons.wikimedia.org' or not source.path.startswith('/wiki/File:'):
        return False
    if media.netloc not in CDN or not media.path.startswith('/wikipedia/commons/'):
        return False
    if license_url.netloc not in {'creativecommons.org', 'www.creativecommons.org'}:
        return False
    if re.fullmatch(r'/publicdomain/(?:mark|zero)/1\.0/?', license_url.path):
        return bool(row.get('license_name'))
    return bool(row.get('license_name') and row.get('creator_name', '').strip() and re.fullmatch(
        r'/licenses/by(?:-sa)?/[1-4]\.\d(?:/[a-z-]+)?/?', license_url.path))


def title_models(tail: str, make: str, pairs: set[tuple[str, str]]) -> set[str]:
    tokens = words(tail).split()
    return {
        ''.join(tokens[i:j])
        for i in range(1, min(4, len(tokens))) if make_key(' '.join(tokens[:i])) == make
        for j in range(i + 1, min(len(tokens), i + 8) + 1)
        if (make, ''.join(tokens[i:j])) in pairs
    }


def year_span(name: str) -> tuple[int, int, str] | None:
    """Parse an explicit model-year range without assigning the photo a specific year."""
    match = YEAR_SPAN_FIRST.fullmatch(name)
    if not match:
        return None
    first, last, tail = match.groups()
    start = int(first) + (1900 if int(first) >= 50 else 2000) if len(first) == 2 else int(first)
    end = int(last) + (start // 100 * 100 if len(last) == 2 else 0)
    if end < start and len(last) == 2:
        end += 100
    return (start, end, tail) if 1984 <= start < end <= 2039 and end - start <= 12 else None


def photo_candidate(row: dict, pairs: set[tuple[str, str]]) -> dict | None:
    title = row.get('source_filename', '')
    if not title or not allowed_credit(row):
        return None
    name = title.rsplit('.', 1)[0]
    normalized = words(name)
    if REJECT.search(normalized) or re.search(r'\brear\b(?! wheel)', normalized) or not title.lower().endswith(('.jpg', '.jpeg', '.webp', '.png')):
        return None
    try:
        width, height = int(row['width']), int(row['height'])
    except (KeyError, ValueError):
        return None
    if width < 450 or height < 240 or not 1.04 <= width / height <= 3:
        return None

    verified = row.get('verified_exterior', '').lower() in {'1', 'true'}
    match = YEAR_FIRST.fullmatch(name)
    labeled_tail = match[3] if match else None
    span = None
    if verified:
        make, model = make_key(row.get('match_make', '')), model_key(row.get('match_model', ''))
        try:
            year = int(row.get('depicted_year', ''))
        except ValueError:
            return None
    else:
        # The archive's make/model classification and the Commons filename must agree.
        archive = urlsplit(row.get('carimages_url', ''))
        path = unquote(archive.path).strip('/').split('/')
        if archive.netloc != 'carimages.org' or len(path) < 3 or path[0] != 'cars':
            return None
        make, model = make_key(path[1]), model_key(path[2])
        if parsed_span := year_span(name):
            start, end, labeled_tail = parsed_span
            span = (start, end)
            year = None
        elif match:
            short = int(match[2]) if match[2] else None
            year = int(match[1]) if match[1] else short + (1900 if short >= 50 else 2000)
        else:
            return None
        north_america = US_CUE.search(normalized) or re.search(r'\((?:US|USA|U\.S\.)\)', title, re.I)
        if model not in title_models(labeled_tail, make, pairs) or ((make, model) in MARKET_AMBIGUOUS and not north_america):
            return None
        # Two makes, e.g. 'Toyota Tacoma & Honda Civic', are not a reliable subject.
        if '&' in title or re.search(r'\b(?:and|versus|vs)\b', normalized):
            return None
    if (make, model) not in pairs or (year is not None and not 1984 <= year <= 2039):
        return None
    if any(key(v) not in model for v in FORBIDDEN_VARIANT.findall(normalized)):
        return None
    if labeled_tail:
        labeled_models = title_models(labeled_tail, make, pairs)
        if any(other != model and other.startswith(model) and other != model + body_of(normalized) for other in labeled_models):
            return None  # A longer nameplate such as Taurus X or Rogue Sport is a different vehicle.
    excluded = MODEL_EXCLUSIONS.get((make, model))
    if excluded and re.search(excluded, normalized):
        return None
    body = words(row.get('body_hint', '')) or body_of(normalized)
    if make == 'ford' and model == 'mustang' and 'fastback' in normalized and body == 'hatchback':
        body = 'coupe'
    source_id = hashlib.sha256(row['source_page_url'].encode()).hexdigest()[:20]
    rank = (int(verified) * 12 + 6 * bool(re.search(r'\b(?:front|frontal|frontansicht)\b', normalized))
            + 2 * bool(re.search(r'\b(?:left|right|quarter)\b', normalized))
            + 2 * ('rear' not in normalized and 'side profile' not in normalized)
            + min(width / 1200, 1.5) - abs(width / height - 1.65))
    return dict(row=row, make=make, model=model, year=year, span=span, body=body, rank=rank, image_id=source_id)


def target_body(vehicle: dict) -> str:
    name = words(vehicle['model'])
    explicit = body_of(name)
    if explicit:
        return explicit
    if make_key(vehicle['make']) == 'honda' and model_family(name) == 'civic':
        if re.search(r'\b4 ?(?:door|dr)\b', name):
            return 'sedan'
        if re.search(r'\b2 ?(?:door|dr)\b', name):
            return 'coupe'
    style = (vehicle.get('bodyStyle') or '').lower()
    return style if style in {'convertible', 'coupe', 'hatchback', 'sedan', 'pickup', 'suv', 'van', 'minivan'} else ''


def compatible(candidate: dict, vehicle: dict) -> bool:
    target = target_body(vehicle)
    body = candidate['body']
    if target and body:
        return target == body
    # A roof/body variant requires photo evidence. Same-named generic EPA records can use a sedan/coupe.
    return target not in {'convertible', 'wagon', 'hatchback'} and body not in {'convertible', 'wagon', 'hatchback'}


def load_choices(vehicles: list[dict], paths: list[Path], ranges_path: Path) -> dict[str, list[tuple[dict, str]]]:
    pairs = {(make_key(v['make']), model) for v in vehicles for model in (model_key(v['model']), model_family(v['model'])) if model}
    by_pair = defaultdict(lambda: defaultdict(list))
    spans_by_pair = defaultdict(list)
    for path in paths:
        with path.open(encoding='utf-8-sig', newline='') as file:
            for row in csv.DictReader(file):
                item = photo_candidate(row, pairs)
                if item:
                    pair = item['make'], item['model']
                    if item['span']:
                        spans_by_pair[pair].append(item)
                    else:
                        by_pair[pair][item['year']].append(item)
    ranges = defaultdict(list)
    if ranges_path.exists():
        for record in json.loads(ranges_path.read_text(encoding='utf-8'))['ranges']:
            if record.get('source', '').startswith('https://') and 0 < record['end'] - record['start'] <= 12:
                ranges[(make_key(record['make']), model_key(record['model']))].append(record)

    choices = {}
    for v in vehicles:
        pair = make_key(v['make']), model_key(v['model'])
        family = pair[0], model_family(v['model'])
        year = v['year']
        candidates = [(c, 'model-year') for c in by_pair[pair].get(year, []) if compatible(c, v)]
        for identity in dict.fromkeys((pair, family)):
            if identity != pair:
                body = target_body(v)
                candidates.extend((c, 'model-year') for c in by_pair[identity].get(year, [])
                                  if compatible(c, v) and (c['body'] == body or body in {'pickup', 'suv', 'van', 'minivan'}))
            for bounds in ranges[identity]:
                if not bounds['start'] <= year <= bounds['end']:
                    continue
                if identity == ('chevrolet', 'silverado1500') and year in {2019, 2022}:
                    continue  # Prior-generation trucks were sold alongside the new body.
                body = (bounds.get('bodyStyle') or '').lower()
                if body and target_body(v) != body:
                    continue
                for photo in spans_by_pair[identity]:
                    start, end = photo['span']
                    if bounds['start'] <= start <= year <= end <= bounds['end'] and compatible(photo, v) and (
                            not body or photo['body'] == body or
                            (not photo['body'] and body in {'pickup', 'suv', 'van', 'minivan'})):
                        candidates.append((dict(photo, range_source=bounds['source']), 'generation'))
                for other_year, photos in by_pair[identity].items():
                    if identity == ('chevrolet', 'silverado1500') and other_year in {2019, 2022}:
                        continue
                    if other_year != year and bounds['start'] <= other_year <= bounds['end']:
                        candidates.extend((dict(c, range_source=bounds['source']), 'generation') for c in photos
                                          if compatible(c, v) and (not body or c['body'] == body or
                                             (not c['body'] and body in {'pickup', 'suv', 'van', 'minivan'})))
        candidates.sort(key=lambda item: (item[1] != 'model-year', abs(year - item[0]['year']) if item[0]['year'] else 1,
                                         -item[0]['rank'], item[0]['image_id']))
        if candidates:
            choices[v['id']] = candidates[:4]
    return choices


def thumbnail_url(url: str) -> str:
    split = urlsplit(url)
    path = split.path
    if '/commons/thumb/' in path:
        path = '/'.join(path.split('/')[:-1])
        filename = path.rsplit('/', 1)[-1]
    else:
        filename = path.rsplit('/', 1)[-1]
        path = path.replace('/commons/', '/commons/thumb/', 1)
    return urlunsplit(('https', 'thumb.wikimedia.org', f'{path}/960px-{filename}', '', ''))


download_gate = threading.Lock()
next_request_at = 0.0


def fetch_photo(url: str) -> bytes:
    global next_request_at
    with download_gate:
        time.sleep(max(0, next_request_at - time.monotonic()))
        next_request_at = time.monotonic() + 0.22
    with urlopen(Request(url, headers={'User-Agent': USER_AGENT}), timeout=18) as response:
        if urlsplit(response.geturl()).netloc not in CDN:
            raise ValueError('Unexpected image host')
        if not response.headers.get('Content-Type', '').startswith('image/'):
            raise ValueError('Invalid image content type')
        if int(response.headers.get('Content-Length', '0')) > MAX_IMAGE_BYTES:
            raise ValueError('Source image exceeds download limit')
        started = time.monotonic()
        data = bytearray()
        while chunk := response.read(128 * 1024):
            data.extend(chunk)
            if len(data) > MAX_IMAGE_BYTES:
                raise ValueError('Source image exceeds download limit')
            # Two workers at most; keep combined transfers below Wikimedia's 25 Mbps limit.
            time.sleep(max(0, started + len(data) / 1_200_000 - time.monotonic()))
        return bytes(data)


def asset_path(photo: dict) -> Path:
    return PUBLIC / f'assets/vehicles/{photo["image_id"][:2]}/{photo["image_id"]}.webp'


def download(photo: dict) -> tuple[str, str | None]:
    from PIL import Image, ImageOps

    ident = photo['image_id']
    target = asset_path(photo)
    if target.is_file():
        return ident, None
    url = photo['row']['source_url']
    try:
        thumbnail = thumbnail_url(url)
        try:
            data = fetch_photo(thumbnail)
        except HTTPError as error:
            if error.code not in {400, 404} or thumbnail == url:
                raise
            data = fetch_photo(url)
        with Image.open(io.BytesIO(data)) as original:
            if original.width * original.height > 40_000_000 or original.width < 400 or original.height < 220:
                raise ValueError('Image dimensions rejected')
            resized = ImageOps.exif_transpose(original).convert('RGB')
            resized.thumbnail((800, 640), Image.Resampling.LANCZOS)
            target.parent.mkdir(parents=True, exist_ok=True)
            temp = target.with_suffix('.tmp')
            resized.save(temp, 'WEBP', quality=76, method=4)
            temp.replace(target)
    except (OSError, ValueError, TimeoutError) as error:
        if isinstance(error, HTTPError) and error.code in {429, 503}:
            global next_request_at
            delay = error.headers.get('Retry-After', '10')
            with download_gate:
                next_request_at = max(next_request_at, time.monotonic() + (min(60, int(delay)) if delay.isdigit() else 10))
        return ident, str(error)
    return ident, None


def select_index(choices: dict) -> dict:
    images = {}
    assignments = {}
    for vehicle_id, options in sorted(choices.items()):
        for photo, scope in options:
            path = asset_path(photo)
            if not path.is_file():
                continue
            image_id = f'{photo["image_id"]}-{scope}'
            row = photo['row']
            subject = html.unescape(row['source_filename']).rsplit('.', 1)[0]
            images[image_id] = {
                'url': path.relative_to(PUBLIC).as_posix(), 'sourceUrl': row['source_page_url'],
                'title': html.unescape(row['source_filename']), 'creator': html.unescape(row.get('creator_name', '')),
                **{field: html.unescape(row[column]) for field, column in (('creditText', 'credit_text'),
                   ('copyrightNotice', 'copyright_notice'), ('creatorUrl', 'creator_url'))
                   if row.get(column) and (field != 'creatorUrl' or row[column].startswith('https://'))},
                'license': row['license_name'], 'licenseUrl': row['license_url'], 'scope': scope,
                'alt': subject,
                **({'depictedYear': photo['year']} if photo['year'] is not None else {}),
                **({'generationSource': photo['range_source']} if scope == 'generation' else {}),
            }
            assignments[vehicle_id] = image_id
            break
    return {'vehicles': assignments, 'images': images}


def validate_index(index: dict, vehicles: dict) -> None:
    if not index['vehicles'] or not index['images']:
        raise ValueError('Empty cover photo index')
    if set(index['vehicles'].values()) != index['images'].keys():
        raise ValueError('Image references do not match metadata')
    for image in index['images'].values():
        path = image['url']
        if not re.fullmatch(r'assets/vehicles/[0-9a-f]{2}/[0-9a-f]{20}\.webp', path):
            raise ValueError(f'Invalid cover path: {path}')
        with (PUBLIC / path).open('rb') as file:
            header = file.read(12)
        if header[:4] != b'RIFF' or header[8:] != b'WEBP':
            raise ValueError(f'Invalid WebP thumbnail: {path}')
        if (not image['license'] or urlsplit(image['licenseUrl']).netloc not in {'creativecommons.org', 'www.creativecommons.org'}
                or not image['sourceUrl'].startswith('https://commons.wikimedia.org/wiki/File:')):
            raise ValueError(f'Missing photo license or source: {path}')
    for vehicle_id, image_id in index['vehicles'].items():
        image = index['images'][image_id]
        vehicle = vehicles.get(vehicle_id)
        if not vehicle:
            continue  # A subsequent EPA refresh may retire IDs without invalidating the other photos.
        if image['scope'] == 'model-year' and image['depictedYear'] == vehicle['year']:
            continue
        if image['scope'] == 'generation' and image.get('generationSource', '').startswith('https://'):
            continue
        raise ValueError(f'Invalid cover match scope: {vehicle_id}')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rights', type=Path, default=CACHE / 'carimages-rights.csv')
    parser.add_argument('--additional', type=Path, action='append', default=[])
    parser.add_argument('--ranges', type=Path, default=ROOT / 'pipeline/photo-generations.json')
    parser.add_argument('--refresh-rights', action='store_true')
    parser.add_argument('--plan', action='store_true', help='Report candidate coverage without downloads or output changes')
    parser.add_argument('--validate', action='store_true', help='Check the published index, attribution, and WebP assets without network access')
    parser.add_argument('--allow-coverage-drop', action='store_true', help='Allow an intentional correction to reduce existing coverage')
    parser.add_argument('--workers', type=int, default=2, choices=(1, 2))
    args = parser.parse_args()
    vehicles = read_catalog()
    by_id = {v['id']: v for v in vehicles}
    if args.validate:
        index = json.loads(INDEX.read_text(encoding='utf-8'))
        validate_index(index, by_id)
        print(f'Valid photo index: {len(index["vehicles"]):,} assignments, {len(index["images"]):,} photo/scope records')
        return
    if args.refresh_rights or not args.rights.exists():
        args.rights.parent.mkdir(parents=True, exist_ok=True)
        temp = args.rights.with_suffix('.download')
        with urlopen(Request(RIGHTS_URL, headers={'User-Agent': USER_AGENT}), timeout=90) as response:
            with temp.open('wb') as file:
                while chunk := response.read(1024 * 1024):
                    file.write(chunk)
        if temp.stat().st_size < 1_000_000:
            raise ValueError('Unexpectedly small CarImages rights manifest')
        temp.replace(args.rights)
    supplemental = [ROOT / 'pipeline/photo-commons.csv', ROOT / 'pipeline/photo-commons-expansion.csv']
    paths = [args.rights, *(path for path in supplemental if path.exists()), *args.additional]
    choices = load_choices(vehicles, paths, args.ranges)
    print(f'Candidates: {len(choices):,} of {len(vehicles):,} configurations; '
          f'{len({(by_id[x]["make"], by_id[x]["model"], by_id[x]["year"]) for x in choices}):,} model-years', flush=True)
    if args.plan:
        return

    # New exact matches may replace previously downloaded generation covers.
    tried = set()
    for attempt in range(3):
        pending = {}
        for options in choices.values():
            for photo, _ in options:
                if asset_path(photo).is_file():
                    break
                if photo['image_id'] not in tried:
                    pending[photo['image_id']] = photo
                    break
        if not pending:
            break
        tried.update(pending)
        print(f'Download pass {attempt + 1}: {len(pending):,} unique files', flush=True)
        failures = Counter()
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            for number, (_, error) in enumerate(executor.map(download, pending.values()), start=1):
                if error:
                    failures[error] += 1
                if number % 100 == 0 or number == len(pending):
                    print(f'  {number:,}/{len(pending):,}, {sum(failures.values()):,} failed', flush=True)
        if failures:
            print(f'  failure reasons: {failures.most_common(5)}', flush=True)

    index = select_index(choices)
    old = json.loads(INDEX.read_text(encoding='utf-8')) if INDEX.exists() else {'vehicles': {}}
    if ((not args.allow_coverage_drop and len(index['vehicles']) < len(old['vehicles']) * 0.95)
            or len(index['vehicles']) < len(choices) * 0.80):
        raise RuntimeError('Photo coverage dropped or downloads were incomplete; previous index preserved')
    validate_index(index, by_id)
    temp = INDEX.with_suffix('.tmp')
    temp.write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    temp.replace(INDEX)
    print(f'Published: {len(index["vehicles"]):,} configurations; {len(index["images"]):,} photo/scope records', flush=True)


if __name__ == '__main__':
    main()
