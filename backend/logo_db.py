"""Best-effort channel logo enrichment sourced from the public iptv-org/database.

Builds a normalized-name -> logo-url index once (cached to disk for a week),
in the background at startup so it never blocks the request path. Only exact
normalized-name matches are used deliberately - fuzzy/similarity matching risks
silently attaching the wrong channel's logo, which is worse than showing no logo.
"""
import os
import csv
import io
import json
import logging
import re
import time
import unicodedata
from pathlib import Path
from typing import Dict, Optional

import requests

logger = logging.getLogger("iptv")

# LUMIO_DATA_DIR: a writable per-user folder from the desktop shell (the install
# directory may be read-only); falls back to next to this file for dev runs.
CACHE_DIR = Path(os.environ["LUMIO_DATA_DIR"]) / "cache" if os.environ.get("LUMIO_DATA_DIR") else Path(__file__).parent / ".cache"
CACHE_FILE = CACHE_DIR / "channel_logos.json"
CACHE_TTL_SECONDS = 7 * 24 * 3600

CHANNELS_CSV_URL = "https://raw.githubusercontent.com/iptv-org/database/master/data/channels.csv"
LOGOS_CSV_URL = "https://raw.githubusercontent.com/iptv-org/database/master/data/logos.csv"

# This app's playlists are overwhelmingly Turkish-market; several short/generic
# channel names (ATV, NTV, Star TV...) collide with unrelated channels of the
# same name in other countries, so prefer a Turkish entry on a name collision.
PREFERRED_COUNTRY = "TR"

_index: Dict[str, str] = {}
_ready = False

QUALITY_RE = re.compile(r"\b(4K|FHD|UHD|HD|SD|1080P?|720P?|H265|H264|HEVC)\b", re.IGNORECASE)
PREFIX_RE = re.compile(r"^[A-Z]{2,4}\s*[:|]\s*", re.IGNORECASE)
SUFFIX_PAREN_RE = re.compile(r"\(([A-Z]{2,4})\)\s*$", re.IGNORECASE)


def normalize(name: str) -> str:
    """Folds a channel name down to a bare alnum key for exact matching:
    strips accents (Türk -> Turk), a leading/trailing country-code marker
    ("TR:", "(TR)"), and quality tags (HD/4K/...) that provider panels add."""
    if not name:
        return ""
    folded = unicodedata.normalize("NFKD", name)
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    folded = PREFIX_RE.sub("", folded)
    folded = SUFFIX_PAREN_RE.sub("", folded)
    folded = QUALITY_RE.sub("", folded)
    folded = re.sub(r"[^a-zA-Z0-9]", "", folded)
    return folded.lower()


def _fetch_csv(url: str) -> list:
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return list(csv.DictReader(io.StringIO(resp.text)))


def _build_index_sync() -> Dict[str, str]:
    channels = _fetch_csv(CHANNELS_CSV_URL)
    logos = _fetch_csv(LOGOS_CSV_URL)

    # Pick each channel's best logo: prefer PNG (broad Image-component support)
    # over SVG, then the highest resolution among same-format entries.
    best_logo: Dict[str, tuple] = {}
    for row in logos:
        if (row.get("in_use") or "").upper() != "TRUE":
            continue
        cid = row.get("channel")
        url = row.get("url")
        if not cid or not url:
            continue
        fmt = (row.get("format") or "").upper()
        try:
            width = int(row.get("width") or 0)
        except ValueError:
            width = 0
        score = (1 if fmt == "PNG" else 0, width)
        current = best_logo.get(cid)
        if current is None or score > current[0]:
            best_logo[cid] = (score, url)

    # rank: higher wins a collision on the same normalized name.
    index: Dict[str, str] = {}
    index_rank: Dict[str, int] = {}
    for row in channels:
        if (row.get("is_nsfw") or "").upper() == "TRUE":
            continue
        cid = row.get("id")
        logo = best_logo.get(cid)
        if not logo:
            continue
        logo_url = logo[1]
        rank = 1 if (row.get("country") or "").upper() == PREFERRED_COUNTRY else 0
        names = [row.get("name") or ""]
        alt = row.get("alt_names") or ""
        names.extend(n for n in alt.split(";") if n)
        for n in names:
            key = normalize(n)
            if not key:
                continue
            if key not in index or rank > index_rank.get(key, -1):
                index[key] = logo_url
                index_rank[key] = rank
    return index


def _load_cache() -> Optional[Dict[str, str]]:
    if not CACHE_FILE.exists():
        return None
    try:
        if time.time() - CACHE_FILE.stat().st_mtime > CACHE_TTL_SECONDS:
            return None
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return None


def _save_cache(index: Dict[str, str]) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(json.dumps(index), encoding="utf-8")
    except Exception:
        pass


def build_index_blocking() -> None:
    """Runs on a worker thread at startup - downloads/parses ~6MB of CSV, or
    just loads last week's cache. Never called on the request path."""
    global _index, _ready
    cached = _load_cache()
    if cached is not None:
        _index = cached
        _ready = True
        logger.info("Channel logo index loaded from cache (%d entries)", len(_index))
        return
    try:
        _index = _build_index_sync()
        _save_cache(_index)
        _ready = True
        logger.info("Channel logo index built from iptv-org database (%d entries)", len(_index))
    except Exception as exc:
        logger.warning("Channel logo index build failed (channels keep no logo fallback): %s", exc)


def lookup(name: str) -> Optional[str]:
    if not _ready or not name:
        return None
    return _index.get(normalize(name))
