"""Find open-license cover candidates with explicit Wikimedia Commons model-year evidence."""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import html
import json
import os
import re
import sys
import tempfile
import time
from datetime import timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from common import CACHE_DIR, atomic_write_json, load_json


API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "RoadFit-photo-catalog/1.0 (https://github.com/JohnComputers/roadfit)"
SEARCH_CACHE = CACHE_DIR / "commons-photo-search"
OUTPUT = CACHE_DIR / "commons-vehicle-photos.csv"
FIELDS = (
    "photo_id", "source_page_url", "source_url", "source_filename", "license_code",
    "license_name", "license_url", "attribution_required", "share_alike",
    "allows_derivatives", "creator_name", "creator_url", "credit_text",
    "copyright_notice", "width", "height", "carimages_url", "match_make",
    "match_model", "depicted_year", "body_hint", "verified_exterior", "market_evidence",
)
# Queries are ordered by usefulness to shoppers, starting with the shared vehicle detail.
MODELS = (
    ("Ford", "F-150"), ("Honda", "Civic"), ("Toyota", "Camry"), ("Honda", "Accord"),
    ("Toyota", "Corolla"), ("Nissan", "Altima"), ("Ford", "Escape"), ("Honda", "CR-V"),
    ("Toyota", "RAV4"), ("Chevrolet", "Equinox"), ("Ford", "Explorer"),
    ("Hyundai", "Elantra"), ("Nissan", "Rogue"), ("Chevrolet", "Malibu"),
    ("Ford", "Fusion"), ("Subaru", "Outback"), ("Mazda", "CX-5"),
    ("Hyundai", "Sonata"), ("Kia", "Soul"), ("Subaru", "Forester"),
    ("Volkswagen", "Jetta"), ("Jeep", "Grand Cherokee"), ("Jeep", "Wrangler"),
    ("Ford", "Mustang"), ("Chevrolet", "Silverado 1500"), ("GMC", "Sierra 1500"),
    ("Ram", "1500"), ("Toyota", "Tacoma"), ("Toyota", "Prius"), ("Lexus", "RX 350"),
    ("Chevrolet", "Camaro"), ("Dodge", "Charger"), ("Tesla", "Model 3"),
    ("Tesla", "Model Y"), ("BMW", "330i"), ("Audi", "A4"), ("Porsche", "911"),
)
YEARS = (2020, 2018, 2016, 2014, 2022, 2024, 2012, 2010, 2008, 2006, 2004, 2002,
         2025, 2026, 2023, 2021, 2019, 2017, 2015, 2013, 2011, 2009, 2007, 2005,
         2003, 2001, 2000)
REJECT = re.compile(
    r"\b(?:advert(?:isement)?|assembly|badge|blueprint|brochure|cargo area|chassis|"
    r"close[ -]?up|cockpit|collage|comparison|concept|cutaway|dashboard|dealership sign|"
    r"engine bay|exhaust|headlamp|headlight|illustration|interior|lego|license plate|"
    r"logo|model car|nascar|patent|police|race car|racing|render|scale model|screenshot|"
    r"speedometer|steering wheel|taillight|toy|trunk|wheel detail|wreck)\b", re.IGNORECASE,
)
FRONT = re.compile(r"\b(?:front(?:al)?|three[ -]quarter|avant|frontal)\b", re.IGNORECASE)
REAR = re.compile(r"\b(?:rear|back view|tail view|arrière)\b", re.IGNORECASE)
BODY_HINTS = {
    "Convertible": r"\b(?:convertible|cabriolet|cabrio|roadster|spyder|spider)\b",
    "Coupe": r"\b(?:coup[eé]|2[ -]door|2dr)\b",
    "Hatchback": r"\b(?:hatchback|5[ -]door|5dr)\b",
    "Sedan": r"\b(?:sedan|4[ -]door|4dr)\b",
    "Wagon": r"\b(?:wagon|estate|avant wagon)\b",
}
UNRELATED_SUFFIXES = {
    ("Ford", "F-150"): ("Lightning",),
    ("Ford", "Mustang"): ("Mach-E",),
    ("Honda", "Accord"): ("Crosstour",),
    ("Honda", "Civic"): ("Type R", "GT Type R", "Tourer"),
    ("Jeep", "Grand Cherokee"): ("L", "4xe"),
    ("Nissan", "Rogue"): ("Sport", "Select"),
    ("Toyota", "Corolla"): ("Altis", "Axio", "Cross", "Fielder", "iM", "Rumion", "Touring"),
    ("Toyota", "Prius"): ("c", "v", "Prime", "Plug-in"),
}
SHARED_NAMEPLATES = {
    ("Chevrolet", "Cruze"), ("Chevrolet", "Malibu"), ("Ford", "Escape"), ("Ford", "Escort"),
    ("Ford", "Fiesta"), ("Ford", "Focus"), ("Ford", "Fusion"), ("Ford", "Mondeo"),
    ("Ford", "Ranger"), ("Honda", "Accord"), ("Honda", "Civic"), ("Honda", "CR-V"),
    ("Nissan", "Sentra"), ("Toyota", "Camry"), ("Toyota", "Corolla"),
    ("Volkswagen", "Jetta"), ("Volkswagen", "Passat"),
}
NORTH_AMERICA = re.compile(
    r"\b(?:Alberta|Arizona|British Columbia|California|Canada|Canadian|Chicago|Connecticut|"
    r"Detroit|Florida|Illinois|Indiana|Las Vegas|Los Angeles|Manitoba|Massachusetts|Michigan|"
    r"Minnesota|Missouri|Montreal|Montréal|NAIAS|New Jersey|New York|North America(?:n)?|NYIAS|"
    r"Ohio|Ontario|Pennsylvania|Philadelphia|Québec|Quebec|Saskatchewan|Texas|Toronto|"
    r"United States|U\.?S\.?(?:A\.?|DM|[ -](?:market|spec))|Vancouver|Wisconsin)\b", re.IGNORECASE,
)
OUTSIDE_NORTH_AMERICA = re.compile(
    r"\b(?:Australia|China|Europe|Germany|Indonesia|Japan|Malaysia|New Zealand|Philippines|"
    r"Singapore|Thailand|United Kingdom|UK|United Arab Emirates)\b", re.IGNORECASE,
)
next_request_at = 0.0


def plain(value: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]*>", " ", value)).split())


def match_pattern(value: str) -> str:
    """Preserve token order and permit hyphen/space variation in model names."""
    return r"[\s_-]*".join(re.escape(token) for token in re.findall(r"[\w]+", value))


def request_search(year: int, make: str, model: str, *, refresh: bool) -> list[dict]:
    return request_pages({
        "generator": "search", "gsrnamespace": 6, "gsrlimit": 20,
        "gsrsearch": f'intitle:"{year} {make} {model}" filetype:bitmap',
        "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata",
        "iiextmetadatafilter": "Artist|LicenseShortName|LicenseUrl|ImageDescription|Attribution",
    }, refresh=refresh, label=f"{year} {make} {model}")


def request_pages(query: dict, *, refresh: bool, label: str) -> list[dict]:
    global next_request_at
    params = {"action": "query", **query, "format": "json", "formatversion": 2, "maxlag": 5}
    url = f"{API}?{urlencode(params)}"
    cache = SEARCH_CACHE / f"{hashlib.sha256(url.encode()).hexdigest()}.json"
    if cache.is_file() and not refresh:
        return load_json(cache)

    last_error = ""
    for attempt in range(3):
        request = Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"})
        time.sleep(max(0, next_request_at - time.monotonic()))
        started = time.monotonic()
        delay = 5 * 2**attempt
        try:
            with urlopen(request, timeout=25) as response:
                data = response.read()
                if response.headers.get("Content-Encoding") == "gzip":
                    data = gzip.decompress(data)
                payload = json.loads(data)
            elapsed = time.monotonic() - started
            next_request_at = time.monotonic() + (5 if elapsed > 1 else 0.35)
            if not payload.get("error"):
                pages = payload.get("query", {}).get("pages", [])
                atomic_write_json(cache, pages)
                return pages
            last_error = str(payload["error"])
        except HTTPError as error:
            last_error = str(error)
            if error.code not in (429, 500, 502, 503, 504):
                break
            retry_after = error.headers.get("Retry-After", "")
            if retry_after.isdigit():
                delay = max(delay, int(retry_after))
            elif retry_after:
                try:
                    retry_at = parsedate_to_datetime(retry_after)
                    now = parsedate_to_datetime(error.headers["Date"])
                    delay = max(delay, (retry_at - now + timedelta(seconds=1)).total_seconds())
                except (KeyError, TypeError, ValueError):
                    pass
        except (OSError, URLError, ValueError) as error:
            last_error = str(error)
        if attempt < 2:
            time.sleep(delay)
    if cache.is_file():
        print(f"{label}: Commons unavailable, using cached response", file=sys.stderr)
        return load_json(cache)
    raise RuntimeError(f"{label}: Commons request failed: {last_error}")


def candidate(page: dict, year: int, make: str, model: str) -> dict | None:
    filename = page["title"].removeprefix("File:")
    title = Path(filename).stem.replace("_", " ")
    prefix = rf"^{year}[\s_-]+{match_pattern(make)}[\s_-]+{match_pattern(model)}\b"
    match = re.match(prefix, title, re.IGNORECASE)
    if not match or not FRONT.search(title) or REJECT.search(title) or REAR.search(title) or " & " in title:
        return None
    suffix = title[match.end():]
    if any(re.match(rf"^[\s_-]+{match_pattern(word)}\b", suffix, re.IGNORECASE)
           for word in UNRELATED_SUFFIXES.get((make, model), ())):
        return None
    info = next(iter(page.get("imageinfo", [])), {})
    width, height = info.get("width", 0), info.get("height", 0)
    if info.get("mime") not in ("image/jpeg", "image/png", "image/webp") or width < 600 or not 1.1 <= width / max(height, 1) <= 2.6:
        return None
    metadata = info.get("extmetadata", {})
    license_name = plain(metadata.get("LicenseShortName", {}).get("value", ""))
    license_url = metadata.get("LicenseUrl", {}).get("value", "").replace("http://", "https://", 1)
    author = plain(metadata.get("Artist", {}).get("value", ""))
    credit = plain(metadata.get("Attribution", {}).get("value", "")) or author
    is_pd = license_name == "Public domain"
    if not is_pd and not re.fullmatch(r"CC(?:0 1\.0| BY(?:-SA)? [1-4]\.[05](?: [A-Z]+)?)", license_name):
        return None
    if is_pd and not license_url:
        license_url = "https://creativecommons.org/publicdomain/mark/1.0/"
    is_open_license = bool(re.fullmatch(r"https?://creativecommons\.org/(?:licenses/by(?:-sa)?/[1-4]\.0(?:/[a-z-]+)?|publicdomain/(?:zero|mark)/1\.0)/?", license_url))
    needs_credit = license_name.startswith("CC BY")
    if not is_open_license or (needs_credit and not credit):
        return None
    description = plain(metadata.get("ImageDescription", {}).get("value", ""))
    # An exact title plus an independent caption reference helps exclude event-date and mislabeled files.
    if not re.search(prefix.removeprefix("^"), description, re.IGNORECASE) or REJECT.search(description):
        return None
    source_url = info.get("url", "")
    source_page = info.get("descriptionurl", "")
    if urlsplit(source_url).hostname != "upload.wikimedia.org" or urlsplit(source_page).hostname != "commons.wikimedia.org":
        return None
    body_hint = next((body for body, pattern in BODY_HINTS.items()
                      if re.search(pattern, title, re.IGNORECASE)), "")
    if model == "F-150" or (make, model) in {("Ram", "1500"), ("Chevrolet", "Silverado 1500"),
                                              ("GMC", "Sierra 1500"), ("Toyota", "Tacoma")}:
        body_hint = "Pickup"
    return {
        "photo_id": f"commons-{page['pageid']}", "source_page_url": source_page,
        "source_url": source_url, "source_filename": filename,
        "license_code": license_name.casefold().replace(" ", "-"),
        "license_name": license_name, "license_url": license_url,
        "attribution_required": str(needs_credit).lower(),
        "share_alike": str(license_name.startswith("CC BY-SA")).lower(),
        "allows_derivatives": "true", "creator_name": author or credit, "credit_text": credit,
        "width": width, "height": height, "match_make": make, "match_model": model,
        "depicted_year": year, "body_hint": body_hint, "verified_exterior": "true",
        "_caption": description,
    }


def verify_market(rows: list[dict], *, refresh: bool) -> list[dict]:
    verified = []
    for offset in range(0, len(rows), 50):
        batch = rows[offset:offset + 50]
        ids = "|".join(row["photo_id"].removeprefix("commons-") for row in batch)
        pages = request_pages({"prop": "categories", "pageids": ids, "clshow": "!hidden", "cllimit": "max"},
                              refresh=refresh, label="Commons photo categories")
        categories = {f"commons-{page['pageid']}": [entry["title"].removeprefix("Category:")
                      for entry in page.get("categories", [])] for page in pages}
        for row in batch:
            evidence = [*categories.get(row["photo_id"], []), row["source_filename"], row.pop("_caption")]
            market = next((line for line in evidence if NORTH_AMERICA.search(line)), "")
            pair = row["match_make"], row["match_model"]
            if not market and (pair in SHARED_NAMEPLATES or any(OUTSIDE_NORTH_AMERICA.search(line) for line in evidence)):
                continue
            row["market_evidence"] = market
            if not row["body_hint"]:
                row["body_hint"] = next((body for body, pattern in BODY_HINTS.items()
                                         if any(re.search(pattern, line, re.IGNORECASE) for line in evidence[:-1])), "")
            verified.append(row)
    return verified


def write_rows(path: Path, rows: dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", dir=path.parent,
                                     suffix=".tmp", delete=False) as file:
        writer = csv.DictWriter(file, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows.values())
        temporary = Path(file.name)
    os.replace(temporary, path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--targets", type=Path, help="CSV of year, make, model using Commons display names")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--limit", type=int, help="Only query the first N targets")
    parser.add_argument("--refresh", action="store_true", help="Revalidate previously queried targets")
    args = parser.parse_args()
    if args.targets:
        with args.targets.open(encoding="utf-8-sig", newline="") as file:
            targets = [(int(row["year"]), row["make"].strip(), row["model"].strip())
                       for row in csv.DictReader(file)]
    else:
        targets = [(2020, "Ford", "F-150"), (2011, "Ford", "Mustang")]
        targets.extend((year, make, model) for year in YEARS for make, model in MODELS)

    rows: dict[str, dict] = {}
    if args.output.is_file():
        with args.output.open(encoding="utf-8", newline="") as file:
            rows = {row["source_page_url"]: row for row in csv.DictReader(file) if "market_evidence" in row}
    attempted, matched = 0, 0
    targets = list(dict.fromkeys(targets[:args.limit]))
    try:
        for offset in range(0, len(targets), 25):
            batch = targets[offset:offset + 25]
            found = []
            for year, make, model in batch:
                pages = request_search(year, make, model, refresh=args.refresh)
                found.extend(result for page in pages if (result := candidate(page, year, make, model)))
            verified = verify_market(found, refresh=args.refresh)
            attempted += len(batch)
            matched += len({(row["depicted_year"], row["match_make"], row["match_model"]) for row in verified})
            updated = set(batch)
            rows = {key: row for key, row in rows.items()
                    if (int(row["depicted_year"]), row["match_make"], row["match_model"]) not in updated}
            rows.update({row["source_page_url"]: row for row in verified})
            write_rows(args.output, rows)
            print(f"Commons: {attempted} targets checked, {matched} with photos, {len(rows)} candidates", flush=True)
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 1
    print(f"Commons: {attempted} targets checked, {matched} with photos, {len(rows)} candidates", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
