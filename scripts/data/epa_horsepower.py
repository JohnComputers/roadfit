#!/usr/bin/env python3
"""Match public EPA test-car rated engine power to FuelEconomy.gov configurations."""

from __future__ import annotations

import argparse
import csv
import hashlib
import re
import shutil
import subprocess
import unicodedata
import xml.etree.ElementTree as ET
from binascii import crc32
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from itertools import chain
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from zipfile import ZipFile

from common import CACHE_DIR, PIPELINE_DIR, atomic_write_json, download_with_cache, load_config, load_json, source_timestamp


SOURCE = "EPA Fuel Economy Test Car List"
SOURCE_HOME = "https://www.epa.gov/compliance-and-fuel-economy-data/data-cars-used-testing-fuel-economy"
SNAPSHOT = PIPELINE_DIR / "epa-horsepower.json"
OEM_RATINGS = PIPELINE_DIR / "horsepower-oem.json"
DRIVES = {
    "frontwheeldrive": "F", "rearwheeldrive": "R", "allwheeldrive": "A",
    "4wheeldrive": "4", "parttime4wheeldrive": "P",
}
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
Key = tuple[int, str, str, Decimal, int, str, int, str, str]
LEGACY_MAKES = {
    "fordmotorcompany": {"ford", "lincoln", "mercury"},
    "generalmotors": {"buick", "cadillac", "chevrolet", "gmc", "hummer", "oldsmobile", "pontiac", "saturn"},
    "chryslerllc": {"chrysler", "dodge", "jeep", "plymouth"},
    "daimlerchrysler": {"chrysler", "dodge", "jeep", "plymouth"},
    "toyota": {"toyota", "lexus", "scion"},
    "honda": {"honda", "acura"},
    "nissan": {"nissan", "infiniti"},
    "volkswagen": {"volkswagen", "audi"},
    "fujiheavyind": {"subaru"},
    "mazdamotorcorp": {"mazda"},
    "kiamotorscorporation": {"kia"},
    "mitsubishimotorscorporation": {"mitsubishi"},
    "mitsubishimotorsnorthamerica": {"mitsubishi"},
    "jaguarcarslimited": {"jaguar"},
    "suzukimotorcorporation": {"suzuki"},
    "bentleymotorsltd": {"bentley"},
    "rollsroycemotorcarsltd": {"rollsroyce"},
}

# EPA 420-B-26-027 lists the manufacturer codes for the ZIP archives. The
# additional older codes below are identified by the archive's manufacturer
# abbreviations. Make resolution still requires an exact, unique carline.
ARCHIVE_MAKES = {
    10: {"amc", "jeep", "renault"}, 20: LEGACY_MAKES["daimlerchrysler"] | {"eagle"},
    30: LEGACY_MAKES["fordmotorcompany"], 40: LEGACY_MAKES["generalmotors"] | {"geo"},
    70: {"astonmartin"}, 90: {"alfaromeo", "fiat"}, 95: {"amgeneral", "hummer"},
    108: {"landrover"}, 120: {"bmw"}, 178: {"daewoo"}, 190: {"daihatsu"},
    196: {"dodge", "eagle", "mitsubishi", "plymouth"}, 200: {"mercedesbenz"},
    220: {"ferrari"}, 230: {"fiat"}, 260: LEGACY_MAKES["honda"], 265: {"hyundai"},
    290: {"isuzu"}, 305: {"jaguar"}, 338: {"kia"}, 350: {"lotus"}, 360: {"maserati"},
    380: LEGACY_MAKES["nissan"], 407: {"panoz"}, 410: {"peugeot"}, 413: {"pininfarina"},
    420: {"porsche"}, 430: {"renault"}, 440: {"bentley", "rollsroyce"},
    460: {"landrover"}, 470: {"saab"}, 490: {"mitsubishi", "dodge", "plymouth"},
    491: {"mitsubishi"}, 492: {"mitsubishi"}, 540: {"suzuki", "chevrolet", "geo"},
    560: {"mazda"}, 570: LEGACY_MAKES["toyota"], 576: {"chevrolet", "geo", "pontiac", "toyota"},
    590: {"audi", "volkswagen"}, 600: {"volvo"}, 614: {"yugo"},
    640: {"audi"}, 660: {"subaru"}, 690: {"lamborghini"}, 691: {"lamborghini"},
}
ARCHIVE_DRIVES = {"FWD": "F", "RWD": "R", "4WD": "4", "F": "F", "R": "R", "4": "4"}
GUIDE_ARCHIVE_DRIVES = {**DRIVES, "4wheelorallwheeldrive": "4", "2wheeldrive": "2", "": ""}
CUBIC_INCH_LITERS = Decimal("0.016387064")


def text(value) -> str:
    return str(value or "").strip()


def name(value) -> str:
    ascii_value = unicodedata.normalize("NFKD", text(value)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", ascii_value.lower())


def integer(value) -> int | None:
    try:
        number = Decimal(text(value))
        return int(number) if number.is_finite() and number == number.to_integral_value() else None
    except InvalidOperation:
        return None


def displacement(value) -> Decimal | None:
    try:
        number = Decimal(text(value))
        return number.quantize(Decimal("0.1")) if 0 < number < 25 else None
    except InvalidOperation:
        return None


def guide_transmission(value) -> tuple[str, int] | None:
    value = text(value)
    explicit = re.fullmatch(r"(Automatic|Manual) (\d+)-spd", value)
    if explicit:
        return ("A" if explicit[1] == "Automatic" else "M"), int(explicit[2])
    code = re.fullmatch(r"Automatic \((S|AM-S|AM|AV-S)(\d+)\)", value)
    if code:
        return {"S": "SA", "AM-S": "AMS", "AM": "AM", "AV-S": "SCV"}[code[1]], int(code[2])
    if value in {"Automatic (AV)", "Automatic (variable gear ratios)"}:
        return "CVT", 0
    return None


def guide_key(row: dict) -> Key | None:
    year, cylinders = integer(row.get("year")), integer(row.get("cylinders"))
    make, model = name(row.get("make")), name(row.get("model"))
    liters, trans = displacement(row.get("displ")), guide_transmission(row.get("trany"))
    drive = DRIVES.get(name(row.get("drive")))
    fuel_name = text(row.get("fuelType1")).lower()
    fuel = "diesel" if fuel_name == "diesel" else "gasoline" if fuel_name.endswith("gasoline") else None
    # Test Car List values are engine ratings. Hybrids and EVs require system ratings.
    if text(row.get("atvType")).casefold() not in {"", "diesel"} or text(row.get("fuelType2")):
        return None
    if not all((year, make, model, liters, cylinders, trans, drive, fuel)):
        return None
    return (year, make, model, liters, cylinders, *trans, drive, fuel)


def guide_fingerprint(row: dict, key: Key) -> str:
    fields = [*key, text(row.get("engId")), text(row.get("eng_dscr")), text(row.get("tCharger")), text(row.get("sCharger"))]
    return hashlib.sha256("\x1f".join(map(str, fields)).encode()).hexdigest()[:16]


def archive_guide_key(row: dict) -> Key | None:
    """Retain the old guide's combined drive labels and explicit 1984 blanks."""
    drive = GUIDE_ARCHIVE_DRIVES.get(name(row.get("drive")))
    if drive is None:
        return None
    # Use the common engine and transmission validation while admitting
    # archive-only drive labels. The actual drive code stays in the signature.
    key = guide_key({**row, "drive": "Front-Wheel Drive"})
    return (*key[:7], drive, key[8]) if key else None


def test_key(row: dict) -> Key | None:
    year = integer(row.get("Model Year"))
    make, model = name(row.get("Represented Test Veh Make")), name(row.get("Represented Test Veh Model"))
    liters = displacement(row.get("Test Veh Displacement (L)"))
    cylinders = integer(row.get("# of Cylinders and Rotors"))
    trans, drive = text(row.get("Tested Transmission Type Code")), text(row.get("Drive System Code"))
    gears = 0 if trans == "CVT" else integer(row.get("# of Gears"))
    fuel_name = text(row.get("Test Fuel Type Description")).lower()
    if "e85" in fuel_name or text(row.get("Police - Emergency Vehicle?")).upper() == "Y":
        return None
    fuel = "diesel" if "diesel" in fuel_name else "gasoline" if "gasoline" in fuel_name else None
    if not all((year, make, model, liters, cylinders, trans, drive, fuel)) or gears is None:
        return None
    return (year, make, model, liters, cylinders, trans, gears, drive, fuel)


class ReportLinks(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.href: str | None = None
        self.label: list[str] = []
        self.years: dict[int, list[str]] = defaultdict(list)

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.href = dict(attrs).get("href")
            self.label = []

    def handle_data(self, data):
        if self.href:
            self.label.append(data)

    def handle_endtag(self, tag):
        if tag != "a" or not self.href:
            return
        match = re.search(r"\b((?:19|20)\d{2})\s+Test\s+Car\s+List\s+Data\b", "".join(self.label), flags=re.I)
        url = urljoin(SOURCE_HOME, self.href)
        target = urlsplit(url)
        if match and target.scheme == "https" and target.hostname == "www.epa.gov":
            year = int(match[1])
            suffixes = (".zip",) if year < 2000 else (".csv", ".xlsx")
            if target.path.endswith(suffixes) and url not in self.years[year]:
                self.years[year].append(url)
        self.href = None


def xlsx_rows(path: Path):
    """Read the simple first-sheet EPA tables using their Open XML cell values."""
    with ZipFile(path) as archive:
        shared_strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared_strings = ["".join(t.text or "" for t in item.iter(NS + "t")) for item in root]
        with archive.open("xl/worksheets/sheet1.xml") as sheet:
            for _, row in ET.iterparse(sheet, events=("end",)):
                if row.tag != NS + "row":
                    continue
                values: list[str] = []
                for cell in row.findall(NS + "c"):
                    address = cell.get("r", "")
                    column = 0
                    for char in address:
                        if not "A" <= char <= "Z":
                            break
                        column = column * 26 + ord(char) - ord("A") + 1
                    if not 1 <= column <= 1000:
                        continue
                    values.extend([""] * (column - len(values)))
                    value = cell.findtext(NS + "v", "")
                    if cell.get("t") == "s":
                        value = shared_strings[int(value)] if value else ""
                    if cell.get("t") == "inlineStr":
                        value = "".join(t.text or "" for t in cell.iter(NS + "t"))
                    values[column - 1] = value
                row.clear()
                yield values


def legacy_rows(reader, guide_rows):
    """Normalize documented 2000–09 fields, resolving older manufacturer groups conservatively."""
    guide_makes = defaultdict(set)
    for row in guide_rows:
        guide_makes[name(row.get("model"))].add(name(row.get("make")))
    for row in reader:
        manufacturer, model = name(row.get("VI_MFR_NM")), name(row.get("CL_NM"))
        possible = LEGACY_MAKES.get(manufacturer, {manufacturer}) & guide_makes[model]
        if len(possible) != 1:
            continue
        # Historical code 4 did not distinguish four-wheel and all-wheel drive.
        drive = text(row.get("DRV_SYS_CD"))
        cubic_inches = integer(row.get("GBE_CID_MSR"))
        if drive not in {"F", "R"} or cubic_inches is None:
            continue
        transmission = text(row.get("TRNS"))
        match = re.fullmatch(r"([ALCMS])(\d+)", transmission)
        if match:
            trans, gears = {"A": "A", "L": "A", "C": "M", "M": "M", "S": "SA"}[match[1]], int(match[2])
        elif transmission == "AV":
            trans, gears = "CVT", 0
        else:
            continue
        fuel_code = integer(row.get("VEH_FL_TYP_CD"))
        fuel = "Diesel" if fuel_code == 9 else "Gasoline" if fuel_code in {6, 23, 37, 61} else ""
        yield {
            "Model Year": row.get("MDLYR_DT"), "Represented Test Veh Make": next(iter(possible)),
            "Represented Test Veh Model": model, "Test Veh Displacement (L)": Decimal(cubic_inches) * Decimal("0.016387064"),
            "Rated Horsepower": row.get("VC_RTD_HP_MSR"), "# of Cylinders and Rotors": row.get("VC_CYL_CNT"),
            "Tested Transmission Type Code": trans, "# of Gears": gears,
            "Drive System Code": drive, "Test Fuel Type Description": fuel,
            "Police - Emergency Vehicle?": row.get("GBE_PLC_IND_CD"),
        }


def read_tests(path: Path, guide_rows):
    if path.suffix == ".xlsx":
        rows = iter(xlsx_rows(path))
        header = [text(cell) for cell in next(rows)]
        if "Rated Horsepower" not in header:
            raise ValueError(f"No horsepower column in {path}")
        yield from (dict(zip(header, cells)) for cells in rows)
    else:
        with path.open(encoding="cp1252", errors="replace", newline="") as file:
            reader = csv.DictReader(file)
            if "VC_RTD_HP_MSR" in (reader.fieldnames or ()):
                yield from legacy_rows(reader, guide_rows)
                return
            if "Rated Horsepower" not in (reader.fieldnames or ()):
                raise ValueError(f"No horsepower column in {path}")
            yield from reader


def read_archive_lines(path: Path) -> list[str]:
    with ZipFile(path) as archive:
        members = [item for item in archive.infolist() if not item.is_dir()]
        if len(members) != 1 or members[0].file_size > 2_000_000:
            raise ValueError(f"Unexpected EPA archive structure in {path}")
        member = members[0]
        if member.compress_type == 6:  # PKZIP Implode, used in the 1984–1993 files.
            unzip = shutil.which("unzip")
            git = shutil.which("git")
            if not unzip and git:
                bundled = Path(git).resolve().parents[1] / "usr" / "bin" / "unzip.exe"
                unzip = str(bundled) if bundled.is_file() else None
            if not unzip:
                raise RuntimeError("Install Info-ZIP unzip (included with Git for Windows) to read the older EPA archives.")
            payload = subprocess.run([unzip, "-p", str(path.resolve()), member.filename],
                                     capture_output=True, check=True, timeout=30).stdout
            if len(payload) != member.file_size or crc32(payload) != member.CRC:
                raise ValueError(f"EPA archive CRC mismatch in {path}")
        else:
            payload = archive.read(member)
    return payload.decode("cp1252", errors="replace").splitlines()


def fixed_archive_rows(lines):
    """Select only the documented engine rating, never the dynamometer setting."""
    for line in lines:
        if len(line) < 207 or line[88:89].strip():
            continue
        yield {"yr": line[:4], "mfr": line[6:9], "bidx": line[9:14], "cid": line[14:18],
               "trns": line[43:45], "rhp": line[120:123], "carline": line[165:190],
               "drv": line[203:206]}


def match_archive(year: int, guide_rows, archive_rows):
    guides_by_model = defaultdict(list)
    for row in guide_rows:
        key = archive_guide_key(row)
        if key is not None:
            guides_by_model[key[2]].append((row, key))
    ratings = defaultdict(set)
    for record in archive_rows:
        manufacturer = ARCHIVE_MAKES.get(integer(record.get("mfr")), set())
        engine_index = integer(record.get("bidx"))
        cubic_inches = integer(record.get("cid"))
        horsepower = integer(record.get("rhp"))
        transmission = text(record.get("trns"))
        raw_drive = text(record.get("drv"))
        drive = ARCHIVE_DRIVES.get(raw_drive)
        if (integer(record.get("yr")) != year or not manufacturer or not cubic_inches
                or not horsepower or not 25 <= horsepower <= 2000 or (year != 1984 and drive is None)
                or text(record.get("police")) == "Y"):
            continue
        if year < 1998 and not engine_index:
            continue
        match = re.fullmatch(r"([ALCMS])(\d+)", transmission)
        if match:
            trans = ({"A": "A", "L": "A", "C": "M", "M": "M", "S": "SA"}[match[1]], int(match[2]))
        elif transmission == "AV":
            trans = ("CVT", 0)
        else:
            continue
        if year >= 1998:
            code = integer(record.get("fuel"))
            fuel = "diesel" if code == 9 else "gasoline" if code in {6, 22, 23} else None
            if fuel is None:
                continue
        else:
            fuel = None  # The numeric basic engine index identifies the tested engine.
        carline = text(record.get("carline"))
        badge = re.fullmatch(r"(.*?)\s*\(([A-Za-z -]+)\)", carline)
        if badge and name(badge[2]) in manufacturer:
            carline, manufacturer = badge[1], {name(badge[2])}
        engine_liters = cubic_inches * CUBIC_INCH_LITERS
        candidates = [
            (row, key) for row, key in guides_by_model[name(carline)]
            if key[0] == year and key[1] in manufacturer and key[5:7] == trans
            and abs(key[3] - engine_liters) <= Decimal("0.055")
            and (drive == key[7] or (year == 1984 and not raw_drive))
            and (fuel is None or fuel == key[8])
            and (year >= 1998 or engine_index == integer(row.get("engId")))
        ]
        engines = {(key, *(text(row.get(field)) for field in ("engId", "eng_dscr", "tCharger", "sCharger")))
                   for row, key in candidates}
        if len(engines) != 1:
            continue
        for row, key in candidates:
            ratings[(text(row.get("id")), guide_fingerprint(row, key))].add(horsepower)
    return {identifier: [next(iter(values)), fingerprint]
            for (identifier, fingerprint), values in ratings.items() if len(values) == 1}


def read_snapshot() -> dict:
    snapshot = load_json(SNAPSHOT) if SNAPSHOT.exists() else {"sources": {}, "vehicles": {}}
    oem_sources = load_json(OEM_RATINGS) if OEM_RATINGS.exists() else []
    snapshot["oem"] = {identifier: (document, rating) for document in oem_sources for identifier, rating in document["ratings"].items()}
    return snapshot


def lookup_horsepower(row: dict, snapshot: dict) -> tuple[int, dict] | None:
    identifier = text(row.get("id"))
    oem_match = snapshot.get("oem", {}).get(identifier)
    if oem_match:
        document, (model, liters, cylinders, hp) = oem_match
        if (integer(row.get("year")), text(row.get("make")), text(row.get("model")),
                displacement(row.get("displ")), integer(row.get("cylinders"))) == (
                document["year"], document["make"], model, displacement(liters), cylinders):
            return hp, {
                "source": document["name"], "sourceId": identifier,
                "url": document["url"], "retrievedAt": document["retrievedAt"],
                "license": "Manufacturer specifications; numeric facts only",
            }
    match = snapshot["vehicles"].get(identifier)
    if not match:
        return None
    year = integer(row.get("year"))
    key = archive_guide_key(row) if year is not None and year < 2000 else guide_key(row)
    if key is None or match[1] != guide_fingerprint(row, key):
        return None
    source = snapshot["sources"][str(key[0])]
    return match[0], {
        "source": SOURCE, "sourceId": str(key[0]),
        "url": source["url"], "retrievedAt": source["retrievedAt"],
        "license": "U.S. federal government public data",
    }


def match_tests(guide_rows, test_rows):
    ratings = defaultdict(set)
    for row in test_rows:
        key = test_key(row)
        if key is not None:
            hp = integer(row.get("Rated Horsepower"))
            if hp is not None and 25 <= hp <= 2000:
                ratings[key].add(hp)

    guide_groups = defaultdict(list)
    for row in guide_rows:
        key = guide_key(row)
        if key in ratings:
            guide_groups[key].append(row)
    values = {}
    for key, rows in guide_groups.items():
        engines = {
            tuple(text(row.get(field)) for field in ("engId", "eng_dscr", "tCharger", "sCharger"))
            for row in rows
        }
        # A key must name one guide engine and every matching test must agree.
        if len(engines) != 1 or len(ratings[key]) != 1:
            continue
        hp = next(iter(ratings[key]))
        for row in rows:
            values[text(row.get("id"))] = [hp, guide_fingerprint(row, key)]
    return values


def main() -> None:
    from build_catalog import iter_epa_rows

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    parser.add_argument("--output", type=Path, default=SNAPSHOT)
    args = parser.parse_args()
    cache = args.cache_dir / "epa-test-car"
    webpage, _ = download_with_cache(SOURCE_HOME, cache / "report-index.html", offline=args.offline)
    links = ReportLinks()
    links.feed(webpage.read_text(encoding="utf-8"))
    if not set(range(1984, 2027)).issubset(links.years):
        raise ValueError("EPA index is missing expected 1984–2026 reports")
    guide_path = args.cache_dir / load_config()["sources"]["epa"]["cacheFile"]
    guide_by_year = defaultdict(list)
    for row in iter_epa_rows(guide_path):
        guide_by_year[integer(row.get("year"))].append(row)
    sources, vehicles = {}, {}
    for year, urls in sorted(links.years.items()):
        files = [
            download_with_cache(url, cache / Path(urlsplit(url).path).name, offline=args.offline)
            for url in urls
        ]
        guides = guide_by_year[year]
        if year < 2000:
            def archive_rows(path):
                lines = read_archive_lines(path)
                return csv.DictReader(lines) if year >= 1998 else fixed_archive_rows(lines)
            matched = match_archive(year, guides, chain.from_iterable(archive_rows(path) for path, _ in files))
        else:
            matched = match_tests(guides, chain.from_iterable(read_tests(path, guides) for path, _ in files))
        if not matched and guide_by_year[year]:
            raise ValueError(f"Zero matching horsepower records in {year}")
        print(f"{year}: {len(matched):,} horsepower matches", flush=True)
        sources[str(year)] = {
            "url": urls[0] if len(urls) == 1 else SOURCE_HOME,
            "retrievedAt": max(source_timestamp(meta) for _, meta in files),
            "files": [{"url": url, "sha256": meta.get("sha256")} for url, (_, meta) in zip(urls, files)],
        }
        vehicles.update(matched)
    if args.output.exists() and len(vehicles) < len(load_json(args.output)["vehicles"]) * .95:
        raise ValueError("Horsepower coverage fell by more than five percent. Previous snapshot preserved.")
    atomic_write_json(args.output, {"sources": sources, "vehicles": dict(sorted(vehicles.items()))})
    print(f"Published {len(vehicles):,} horsepower matches")


if __name__ == "__main__":
    main()
