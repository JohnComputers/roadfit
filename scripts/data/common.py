"""Shared, dependency-free utilities for the RoadFit catalog build."""

from __future__ import annotations

import hashlib
import json
import os
import random
import re
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
PIPELINE_DIR = REPO_ROOT / "pipeline"
CACHE_DIR = PIPELINE_DIR / "cache"
PUBLIC_DATA_DIR = REPO_ROOT / "public" / "data"
CONFIG_PATH = PIPELINE_DIR / "config.json"
ALIASES_PATH = PIPELINE_DIR / "aliases.json"
USER_AGENT = "RoadFit-catalog/1.0 (+https://github.com/; public-data refresh)"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_config() -> dict[str, Any]:
    return load_json(CONFIG_PATH)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write_json(path: Path, value: Any, *, pretty: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    indent = 2 if pretty else None
    separators = None if pretty else (",", ":")
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", newline="\n", delete=False, dir=path.parent, suffix=".tmp"
    ) as handle:
        json.dump(value, handle, ensure_ascii=False, indent=indent, separators=separators)
        handle.write("\n")
        temp_path = Path(handle.name)
    os.replace(temp_path, path)


def slug(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "unknown"


def download_with_cache(
    url: str,
    destination: Path,
    *,
    offline: bool = False,
    timeout: int = 90,
    attempts: int = 3,
) -> tuple[Path, dict[str, Any]]:
    """Download *url* atomically, reusing conditional metadata and last-good data.

    A network error is non-fatal when a non-empty cached file exists. The returned
    metadata always says whether the current run downloaded, revalidated, or fell
    back to the cache.
    """

    destination.parent.mkdir(parents=True, exist_ok=True)
    metadata_path = destination.with_suffix(destination.suffix + ".meta.json")
    metadata: dict[str, Any] = load_json(metadata_path) if metadata_path.exists() else {}

    if offline:
        if not destination.exists() or destination.stat().st_size == 0:
            raise FileNotFoundError(f"Offline cache is missing: {destination}")
        metadata = {**metadata, "runStatus": "offline-cache", "usedAt": utc_now()}
        return destination, metadata

    headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if metadata.get("etag"):
        headers["If-None-Match"] = metadata["etag"]
    if metadata.get("lastModified"):
        headers["If-Modified-Since"] = metadata["lastModified"]

    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(url, headers=headers)
        temp_path: Path | None = None
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                with tempfile.NamedTemporaryFile("wb", delete=False, dir=destination.parent, suffix=".part") as out:
                    temp_path = Path(out.name)
                    while True:
                        block = response.read(1024 * 1024)
                        if not block:
                            break
                        out.write(block)
                if not temp_path.exists() or temp_path.stat().st_size == 0:
                    raise OSError(f"Source returned an empty body: {url}")
                os.replace(temp_path, destination)
                retrieved = utc_now()
                metadata = {
                    "url": url,
                    "retrievedAt": retrieved,
                    "usedAt": retrieved,
                    "etag": response.headers.get("ETag"),
                    "lastModified": response.headers.get("Last-Modified"),
                    "contentType": response.headers.get("Content-Type"),
                    "bytes": destination.stat().st_size,
                    "sha256": sha256_file(destination),
                    "runStatus": "downloaded",
                }
                atomic_write_json(metadata_path, metadata, pretty=True)
                return destination, metadata
        except urllib.error.HTTPError as error:
            if error.code == 304 and destination.exists():
                metadata = {**metadata, "usedAt": utc_now(), "runStatus": "revalidated"}
                atomic_write_json(metadata_path, metadata, pretty=True)
                return destination, metadata
            last_error = error
        except (OSError, TimeoutError, urllib.error.URLError) as error:
            last_error = error
        finally:
            if temp_path and temp_path.exists():
                temp_path.unlink(missing_ok=True)

        if attempt < attempts:
            time.sleep((2 ** (attempt - 1)) + random.random())

    if destination.exists() and destination.stat().st_size > 0:
        metadata = {
            **metadata,
            "usedAt": utc_now(),
            "runStatus": "stale-cache-fallback",
            "lastError": str(last_error),
        }
        return destination, metadata
    raise RuntimeError(f"Unable to download {url}: {last_error}") from last_error


def source_timestamp(metadata: dict[str, Any]) -> str:
    return metadata.get("retrievedAt") or metadata.get("usedAt") or utc_now()
