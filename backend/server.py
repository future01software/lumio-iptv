"""IPTV Player Backend - M3U / Xtream Codes / XMLTV EPG parsing & playlist storage."""
from fastapi import FastAPI, APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, Response, StreamingResponse
import json
import base64
from cryptography.fernet import Fernet
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import hmac
import hashlib
import ipaddress
import socket
import logging
import uuid
import requests
import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor
import xml.etree.ElementTree as ET
from urllib.parse import urljoin, urlparse
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import urllib3
import logo_db

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Packaged desktop builds ship no .env: MongoDB is optional (in-memory fallback
# below) and FERNET_KEY is supplied per install by the Electron shell.
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=3000)
db = client[os.environ.get('DB_NAME', 'lumio')]

_mongo_ready = False
# In-process cache for /api/logo-proxy so re-visiting a category (or two rows
# sharing the same tvg-logo) doesn't re-fetch the same image from the internet
# every time. Capped in logo_proxy() so a very long session can't grow forever.
_logo_cache: Dict[str, tuple] = {}
_mem: Dict[str, List[Dict[str, Any]]] = {
    "playlists": [],
    "favorites": [],
    "history": [],
}

app = FastAPI(title="IPTV Player API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("iptv")

# --- Keep provider credentials out of the logs -------------------------------
# Several routes (legacy GET endpoints still used by installed app builds) and
# proxied upstream URLs carry Xtream usernames/passwords. Uvicorn's access log
# prints the full path + query, so mask anything credential-shaped before it
# is written.
_SECRET_QUERY_RE = re.compile(r"((?:^|[?&])(?:password|username|pass|user|epg_url|u|t)=)[^&\s]*", re.I)
_SECRET_PATH_RE = re.compile(r"(/(?:live|movie|series|timeshift)/)[^/\s]+/[^/\s]+/", re.I)


def redact_secrets(text: str) -> str:
    text = _SECRET_QUERY_RE.sub(r"\1***", text)
    return _SECRET_PATH_RE.sub(r"\1***/***/", text)


class _RedactAccessLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # uvicorn.access args: (client_addr, method, full_path, http_version, status_code)
        if isinstance(record.args, tuple) and len(record.args) >= 3:
            args = list(record.args)
            args[2] = redact_secrets(str(args[2]))
            record.args = tuple(args)
        elif isinstance(record.msg, str):
            record.msg = redact_secrets(record.msg)
        return True


logging.getLogger("uvicorn.access").addFilter(_RedactAccessLogFilter())

@app.on_event("startup")
async def _init_db():
    global _mongo_ready
    # The desktop app never has MongoDB; skip the 3s connection timeout so the
    # bundled backend is ready sooner.
    if os.environ.get("LUMIO_NO_MONGO") == "1":
        logger.info("MongoDB disabled (desktop build); using in-memory store")
        return
    try:
        await client.admin.command("ping")
        _mongo_ready = True
        logger.info("MongoDB connected")
    except Exception as exc:
        _mongo_ready = False
        logger.warning("MongoDB unreachable (%s); using in-memory store", exc)

@app.on_event("startup")
async def _init_logo_db():
    # Fire-and-forget on a worker thread so a cold cache (~6MB CSV download)
    # never delays server readiness or the first playlist request.
    asyncio.create_task(asyncio.to_thread(logo_db.build_index_blocking))

FERNET_KEY = os.environ.get('FERNET_KEY')
if not FERNET_KEY:
    FERNET_KEY = Fernet.generate_key().decode()
fernet = Fernet(FERNET_KEY)

def encrypt_token(server: str, username: str, password: str, kind: str, ext: str = "",
                   extra: Optional[Dict[str, str]] = None) -> str:
    payload = {"s": server, "u": username, "p": password, "k": kind, "e": ext}
    if extra:
        payload.update(extra)
    return fernet.encrypt(json.dumps(payload).encode()).decode()

def decrypt_token(token: str) -> dict:
    try:
        return json.loads(fernet.decrypt(token.encode()).decode())
    except Exception:
        raise HTTPException(status_code=400, detail="Oturum geçersiz veya süresi dolmuş")

def _encode_proxy_url(url: str) -> str:
    return base64.urlsafe_b64encode(url.encode()).decode().rstrip("=")

# HLS proxy URLs are only ever produced by this server (manifest rewriting, /play), so
# they carry an HMAC of the target keyed by the per-install secret. Without it any web
# page open on this PC could use /hls-proxy as a relay into the local network, e.g. with
# <img src="http://127.0.0.1:8000/api/hls-proxy?u=...router admin page...">.
_PROXY_SIG_KEY = hashlib.sha256(b"lumio-hls-proxy:" + FERNET_KEY.encode()).digest()

def _sign_proxy_url(url: str) -> str:
    return hmac.new(_PROXY_SIG_KEY, url.encode(), hashlib.sha256).hexdigest()[:32]

def _proxy_sig_ok(url: str, sig: str) -> bool:
    return bool(sig) and hmac.compare_digest(_sign_proxy_url(url), sig)

def _is_public_host(url: str) -> bool:
    """False for loopback / private / link-local targets (and anything unresolvable)."""
    host = urlparse(url).hostname
    if not host:
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return False
    return True

def _decode_proxy_url(value: str) -> str:
    try:
        padding = "=" * (-len(value) % 4)
        return base64.urlsafe_b64decode((value + padding).encode()).decode()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid proxy URL")

def _proxy_path(request: Request, url: str) -> str:
    return str(request.url_for("hls_proxy")) + f"?u={_encode_proxy_url(url)}&s={_sign_proxy_url(url)}"

def _rewrite_hls_manifest(text: str, base_url: str, request: Request) -> str:
    rewritten: List[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            rewritten.append(raw_line)
            continue

        if line.startswith("#EXT-X-KEY") and 'URI="' in line:
            def repl(match: re.Match[str]) -> str:
                absolute = urljoin(base_url, match.group(1))
                return f'URI="{_proxy_path(request, absolute)}"'
            rewritten.append(re.sub(r'URI="([^"]+)"', repl, raw_line))
            continue

        if line.startswith("#"):
            rewritten.append(raw_line)
            continue

        absolute = urljoin(base_url, line)
        rewritten.append(_proxy_path(request, absolute))

    return "\n".join(rewritten) + "\n"

# ---------------------- Models ----------------------

class Channel(BaseModel):
    id: str
    name: str
    logo: Optional[str] = None
    group: Optional[str] = None
    url: str
    tvg_id: Optional[str] = None
    epg_channel_id: Optional[str] = None
    kind: str = "live"  # live | movie | series
    number: Optional[str] = None
    catchup: bool = False
    catchup_days: int = 0

class Movie(BaseModel):
    id: str
    name: str
    logo: Optional[str] = None
    group: Optional[str] = None
    url: str
    year: Optional[str] = None
    rating: Optional[str] = None

class SeriesEpisode(BaseModel):
    id: str
    title: str
    season: int = 1
    episode: int = 1
    url: str
    logo: Optional[str] = None

class Series(BaseModel):
    id: str
    name: str
    logo: Optional[str] = None
    group: Optional[str] = None
    episodes: List[SeriesEpisode] = []

class PlaylistParseRequest(BaseModel):
    name: str = "My Playlist"
    type: str  # "m3u" | "xtream"
    m3u_url: Optional[str] = None
    m3u_content: Optional[str] = None
    server: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    epg_url: Optional[str] = None

class ParsedPlaylist(BaseModel):
    name: str
    channels: List[Channel] = []
    movies: List[Movie] = []
    series: List[Series] = []
    groups: Dict[str, List[str]] = {}  # kind -> sorted unique groups

class SavePlaylistRequest(BaseModel):
    device_id: str
    name: str
    type: str
    m3u_url: Optional[str] = None
    server: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    epg_url: Optional[str] = None

class PlaylistRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id: str
    name: str
    type: str
    m3u_url: Optional[str] = None
    server: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    epg_url: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class FavoriteRequest(BaseModel):
    device_id: str
    item_id: str
    kind: str  # live | movie | series
    name: str
    logo: Optional[str] = None
    url: Optional[str] = None

class WatchHistoryRequest(BaseModel):
    device_id: str
    item_id: str
    kind: str
    name: str
    logo: Optional[str] = None
    url: Optional[str] = None
    position: float = 0
    duration: float = 0

class EPGProgram(BaseModel):
    channel: str
    title: str
    desc: Optional[str] = None
    start: str
    stop: str

TR_GROUP_KEYWORDS = (
    "turkiye", "turk", "turkey", "türk", "türkiye", "ulusal", "yerli",
    "kanallari", "kanalları", "national tr",
)

ADULT_KEYWORDS = (
    "adult", "xxx", "+18", "18+", "erotic", "erotik", "porn", "sex",
    "yetiskin", "for adult", "mature",
)

LOW_PRIORITY_KEYWORDS = (
    "free", "h65", "h265", "h266", "hevc", "backup", "yedek", "alt yayin",
    "2nd", "duplicate", "test",
)

def _norm_group(name: str) -> str:
    n = name.lower()
    for src, dst in (("ı", "i"), ("ş", "s"), ("ğ", "g"), ("ü", "u"), ("ö", "o"), ("ç", "c")):
        n = n.replace(src, dst)
    return n

def _strip_decorations(name: str) -> str:
    return re.sub(r"[★☆✦➾▶►●◆◇•|]", " ", name).strip()

def _is_adult_group(name: str) -> bool:
    n = _norm_group(_strip_decorations(name))
    return any(kw in n for kw in ADULT_KEYWORDS)

def _is_low_priority_group(name: str) -> bool:
    n = _norm_group(_strip_decorations(name))
    return any(kw in n for kw in LOW_PRIORITY_KEYWORDS)

def _turkish_group_score(name: str) -> int:
    if _is_low_priority_group(name):
        return 0
    n = _norm_group(_strip_decorations(name))
    score = 0
    for kw in TR_GROUP_KEYWORDS:
        if _norm_group(kw) in n:
            score += 15
    if re.match(r"^tr[\s.:|\-/]", n) or n.startswith("tr "):
        score += 40
    if re.search(r"\btr\b", n):
        score += 25
    if n == "tr" or n.endswith(" tr"):
        score += 30
    return score

def sort_content_groups(groups: set) -> List[str]:
    items = [g for g in groups if g]
    adult = [g for g in items if _is_adult_group(g)]
    low = [g for g in items if not _is_adult_group(g) and _is_low_priority_group(g)]
    regular = [g for g in items if not _is_adult_group(g) and not _is_low_priority_group(g)]
    regular.sort(key=lambda g: (-_turkish_group_score(g), g.lower()))
    low.sort(key=lambda g: g.lower())
    adult.sort(key=lambda g: g.lower())
    return regular + low + adult

# ---------------------- M3U Parser ----------------------

# Title starts at the first comma outside quotes: attribute values such as
# http-user-agent="... (KHTML, like Gecko) ..." contain commas.
EXTINF_RE = re.compile(r'#EXTINF:(?P<duration>-?\d+)(?P<attrs>(?:[^",]|"[^"]*")*),(?P<title>.*)$')
ATTR_RE = re.compile(r'(\S+?)="(.*?)"')
SERIES_EP_RE = re.compile(r'S(\d+)\s*E(\d+)', re.IGNORECASE)

def parse_m3u(content: str) -> ParsedPlaylist:
    channels: List[Channel] = []
    movies: List[Movie] = []
    series_map: Dict[str, Series] = {}
    lines = content.splitlines()
    i = 0
    cur_attrs: Dict[str, str] = {}
    cur_title = ""
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("#EXTINF"):
            m = EXTINF_RE.match(line)
            if m:
                cur_title = m.group("title").strip()
                cur_attrs = {k.lower(): v for k, v in ATTR_RE.findall(m.group("attrs"))}
        elif line and not line.startswith("#"):
            url = line
            group = cur_attrs.get("group-title", "Kategorisiz")
            logo = cur_attrs.get("tvg-logo")
            tvg_id = cur_attrs.get("tvg-id")
            name = cur_title or "Adsız"
            lower_group = (group or "").lower()
            lower_url = url.lower()
            # Classify
            is_series = bool(SERIES_EP_RE.search(name)) or "series" in lower_group
            is_movie = (("movie" in lower_group) or ("vod" in lower_group) or ("film" in lower_group)
                        or lower_url.endswith((".mp4", ".mkv", ".avi"))) and not is_series
            if is_series:
                m_ep = SERIES_EP_RE.search(name)
                season = int(m_ep.group(1)) if m_ep else 1
                ep = int(m_ep.group(2)) if m_ep else 1
                base_name = re.sub(r'\s*S\d+\s*E\d+.*$', '', name, flags=re.IGNORECASE).strip() or name
                sid = base_name.lower()
                if sid not in series_map:
                    series_map[sid] = Series(id=str(uuid.uuid4()), name=base_name, logo=logo, group=group, episodes=[])
                series_map[sid].episodes.append(SeriesEpisode(
                    id=str(uuid.uuid4()), title=name, season=season, episode=ep, url=url, logo=logo
                ))
            elif is_movie:
                movies.append(Movie(id=str(uuid.uuid4()), name=name, logo=logo, group=group, url=url))
            else:
                chno = cur_attrs.get("tvg-chno") or cur_attrs.get("tvg-chno".replace("-", "_"))
                catchup_attr = cur_attrs.get("catchup")
                catchup_days_raw = cur_attrs.get("catchup-days") or cur_attrs.get("catchup-source-days")
                try:
                    catchup_days = int(catchup_days_raw) if catchup_days_raw else 0
                except ValueError:
                    catchup_days = 0
                channels.append(Channel(
                    id=str(uuid.uuid4()), name=name, logo=logo, group=group, url=url,
                    tvg_id=tvg_id, epg_channel_id=tvg_id, kind="live",
                    number=chno,
                    catchup=bool(catchup_attr) and catchup_attr.lower() != "0",
                    catchup_days=catchup_days,
                ))
            cur_attrs = {}
            cur_title = ""
        i += 1

    series_list = list(series_map.values())
    for s in series_list:
        s.episodes.sort(key=lambda e: (e.season, e.episode))

    groups = {
        "live": sort_content_groups({c.group for c in channels if c.group}),
        "movie": sort_content_groups({m.group for m in movies if m.group}),
        "series": sort_content_groups({s.group for s in series_list if s.group}),
    }
    return ParsedPlaylist(name="M3U Playlist", channels=channels, movies=movies, series=series_list, groups=groups)

def fetch_text(url: str, timeout: int = 30) -> str:
    headers = {"User-Agent": "IPTVSmarters/1.0"}
    r = requests.get(url, headers=headers, timeout=timeout, verify=False)
    r.raise_for_status()
    return r.text

# ---------------------- Xtream Parser ----------------------

def xtream_get(server: str, username: str, password: str, action: Optional[str] = None,
               extra: Optional[Dict[str, str]] = None) -> Any:
    base = server.rstrip("/")
    params = {"username": username, "password": password}
    if action:
        params["action"] = action
    if extra:
        params.update(extra)
    url = f"{base}/player_api.php"
    headers = {"User-Agent": "IPTVSmarters/1.0"}
    r = requests.get(url, params=params, headers=headers, timeout=30, verify=False)
    r.raise_for_status()
    return r.json()

async def parse_xtream(server: str, username: str, password: str, base_url: str, load_vods: bool = True) -> ParsedPlaylist:
    server = server.rstrip("/")
    info = await asyncio.to_thread(xtream_get, server, username, password)
    if not info or "user_info" not in info or info["user_info"].get("auth") in (0, "0"):
        raise HTTPException(status_code=401, detail="Xtream kullanıcı adı veya şifre hatalı")

    tasks = [
        asyncio.to_thread(xtream_get, server, username, password, "get_live_categories"),
        asyncio.to_thread(xtream_get, server, username, password, "get_vod_categories"),
        asyncio.to_thread(xtream_get, server, username, password, "get_series_categories"),
        asyncio.to_thread(xtream_get, server, username, password, "get_live_streams")
    ]
    if load_vods:
        tasks.extend([
            asyncio.to_thread(xtream_get, server, username, password, "get_vod_streams"),
            asyncio.to_thread(xtream_get, server, username, password, "get_series")
        ])
    
    results = await asyncio.gather(*tasks)
    live_cats, vod_cats, ser_cats, live_streams = results[0], results[1], results[2], results[3]
    vod_streams = results[4] if load_vods else []
    ser_streams = results[5] if load_vods else []

    live_cat_map = {str(c["category_id"]): c["category_name"] for c in live_cats}
    vod_cat_map = {str(c["category_id"]): c["category_name"] for c in vod_cats}
    ser_cat_map = {str(c["category_id"]): c["category_name"] for c in ser_cats}

    channels = [
        Channel(
            id=str(s["stream_id"]),
            name=s.get("name", "Adsız"),
            logo=s.get("stream_icon"),
            group=live_cat_map.get(str(s.get("category_id", "")), "Kategorisiz"),
            url=f"{base_url}/api/play/{s['stream_id']}?t={encrypt_token(server, username, password, 'live', '.m3u8')}",
            tvg_id=s.get("epg_channel_id"),
            epg_channel_id=s.get("epg_channel_id"),
            kind="live",
            number=str(s.get("num")) if s.get("num") is not None else None,
            catchup=bool(int(s.get("tv_archive", 0) or 0)),
            catchup_days=int(s.get("tv_archive_duration", 0) or 0),
        )
        for s in live_streams
    ]
    movies = [
        Movie(
            id=str(s["stream_id"]),
            name=s.get("name", "Adsız"),
            logo=s.get("stream_icon"),
            group=vod_cat_map.get(str(s.get("category_id", "")), "Kategorisiz"),
            url=f"{base_url}/api/play/{s['stream_id']}?t={encrypt_token(server, username, password, 'movie', '.' + s.get('container_extension', 'mp4'))}",
            year=str(s.get("year", "")) or None,
            rating=str(s.get("rating", "")) or None,
        )
        for s in vod_streams
    ]
    series_list: List[Series] = []
    for s in ser_streams:
        series_list.append(Series(
            id=str(s["series_id"]),
            name=s.get("name", "Adsız"),
            logo=s.get("cover"),
            group=ser_cat_map.get(str(s.get("category_id", "")), "Kategorisiz"),
            episodes=[],
        ))

    groups = {
        "live": sort_content_groups({c.group for c in channels if c.group}),
        "movie": sort_content_groups({m.group for m in movies if m.group}),
        "series": sort_content_groups({s.group for s in series_list if s.group}),
    }
    return ParsedPlaylist(name=info["user_info"].get("username", "Xtream"), channels=channels,
                          movies=movies, series=series_list, groups=groups)

# ---------------------- XMLTV EPG Parser ----------------------

def parse_xmltv_time(s: str) -> str:
    # XMLTV format: 20240101120000 +0000
    try:
        s = s.strip()
        # iso-ish
        if "T" in s:
            return s
        dt = datetime.strptime(s.split(" ")[0], "%Y%m%d%H%M%S")
        return dt.replace(tzinfo=timezone.utc).isoformat()
    except Exception:
        return s

def parse_xmltv(content: str, channel_ids: Optional[List[str]] = None,
                limit: int = 50000) -> List[EPGProgram]:
    programs: List[EPGProgram] = []
    try:
        root = ET.fromstring(content)
    except ET.ParseError as e:
        logger.warning(f"XMLTV parse error: {e}")
        return programs
    cid_set = set(channel_ids) if channel_ids else None
    for p in root.findall("programme"):
        cid = p.get("channel", "")
        if cid_set and cid not in cid_set:
            continue
        title_el = p.find("title")
        desc_el = p.find("desc")
        programs.append(EPGProgram(
            channel=cid,
            title=title_el.text if title_el is not None and title_el.text else "",
            desc=desc_el.text if desc_el is not None else None,
            start=parse_xmltv_time(p.get("start", "")),
            stop=parse_xmltv_time(p.get("stop", "")),
        ))
        if len(programs) >= limit:
            break
    return programs

# ---------------------- Routes ----------------------

@api_router.get("/")
async def root():
    return {"message": "IPTV Player API", "status": "ok"}

def enrich_channel_logos(parsed: ParsedPlaylist) -> ParsedPlaylist:
    """Best-effort: fill in a live channel's logo from the iptv-org database
    when the playlist itself didn't provide one. Movies/series are untouched -
    that database only covers TV channels, and VOD posters usually already
    come from the provider (Xtream stream_icon/cover) or TMDB on the client."""
    for c in parsed.channels:
        if not c.logo:
            found = logo_db.lookup(c.name)
            if found:
                c.logo = found
    return parsed

@api_router.post("/playlist/parse", response_model=ParsedPlaylist)
async def parse_playlist(req: PlaylistParseRequest, request: Request):
    base_url = str(request.base_url).rstrip("/")
    try:
        if req.type == "m3u":
            if req.m3u_url and req.m3u_url != "local_file":
                content = fetch_text(req.m3u_url.strip())
            elif req.m3u_content:
                content = req.m3u_content
            else:
                raise HTTPException(status_code=400, detail="Geçersiz istek")
            parsed = parse_m3u(content)
            parsed.name = req.name.strip() if req.name else ""
            return enrich_channel_logos(parsed)
        elif req.type == "xtream":
            if not (req.server and req.username and req.password):
                raise HTTPException(status_code=400, detail="Sunucu, kullanıcı adı ve şifre gerekli")
            
            # Aggressively clean the server URL
            server_clean = "".join(c for c in req.server if ord(c) > 32 and ord(c) < 127).rstrip("/")
            if server_clean.endswith("/player_api.php"):
                server_clean = server_clean[:-15]
            if server_clean.endswith("/get.php"):
                server_clean = server_clean[:-8]

            parsed = await parse_xtream(server_clean, req.username.strip(), req.password.strip(), base_url, load_vods=False)
            parsed.name = req.name.strip() if req.name else ""
            return enrich_channel_logos(parsed)
        else:
            raise HTTPException(status_code=400, detail="Desteklenmeyen liste türü")
    except HTTPException:
        raise
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Çalma listesi alınamadı: {e}")
    except Exception as e:
        logger.exception("parse failed")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/playlist/vods", response_model=ParsedPlaylist)
async def load_vods(req: PlaylistParseRequest, request: Request):
    base_url = str(request.base_url).rstrip("/")
    try:
        if req.type == "m3u":
            return ParsedPlaylist() # M3U handles all streams at once
        elif req.type == "xtream":
            if not (req.server and req.username and req.password):
                raise HTTPException(status_code=400, detail="Sunucu, kullanıcı adı ve şifre gerekli")
            server_clean = "".join(c for c in req.server if ord(c) > 32 and ord(c) < 127).rstrip("/")
            if server_clean.endswith("/player_api.php"):
                server_clean = server_clean[:-15]
            if server_clean.endswith("/get.php"):
                server_clean = server_clean[:-8]
            
            # Fetch ONLY vods and series
            info = await asyncio.to_thread(xtream_get, server_clean, req.username.strip(), req.password.strip())
            if not info or "user_info" not in info or info["user_info"].get("auth") in (0, "0"):
                raise HTTPException(status_code=401, detail="Xtream kullanıcı adı veya şifre hatalı")

            tasks = [
                asyncio.to_thread(xtream_get, server_clean, req.username.strip(), req.password.strip(), "get_vod_categories"),
                asyncio.to_thread(xtream_get, server_clean, req.username.strip(), req.password.strip(), "get_series_categories"),
                asyncio.to_thread(xtream_get, server_clean, req.username.strip(), req.password.strip(), "get_vod_streams"),
                asyncio.to_thread(xtream_get, server_clean, req.username.strip(), req.password.strip(), "get_series")
            ]
            results = await asyncio.gather(*tasks)
            vod_cats, ser_cats, vod_streams, ser_streams = [r or [] for r in results]
            
            vod_cat_map = {str(c["category_id"]): c["category_name"] for c in vod_cats}
            ser_cat_map = {str(c["category_id"]): c["category_name"] for c in ser_cats}

            movies = [
                Movie(
                    id=str(s["stream_id"]),
                    name=s.get("name", "Adsız"),
                    logo=s.get("stream_icon"),
                    group=vod_cat_map.get(str(s.get("category_id", "")), "Kategorisiz"),
                    url=f"{base_url}/api/play/{s['stream_id']}?t={encrypt_token(server_clean, req.username.strip(), req.password.strip(), 'movie', '.' + s.get('container_extension', 'mp4'))}",
                    year=str(s.get("year", "")) or None,
                    rating=str(s.get("rating", "")) or None,
                )
                for s in vod_streams
            ]
            
            series_list = []
            series_map = {}
            for s in ser_streams:
                series_list.append(Series(
                    id=str(s["series_id"]),
                    name=s.get("name", "Adsız"),
                    logo=s.get("cover"),
                    group=ser_cat_map.get(str(s.get("category_id", "")), "Kategorisiz"),
                    episodes=[],
                ))

            groups = {
                "movie": sort_content_groups({m.group for m in movies if m.group}),
                "series": sort_content_groups({s.group for s in series_list if s.group}),
            }
            return ParsedPlaylist(name=req.name.strip() if req.name else "", movies=movies, series=series_list, groups=groups)
    except Exception as e:
        logger.exception("vod fetch failed")
        raise HTTPException(status_code=500, detail=str(e))
    except HTTPException:
        raise
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Çalma listesi alınamadı: {e}")
    except Exception as e:
        logger.exception("parse failed")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/epg/parse")
async def parse_epg(epg_url: str, channel_ids: Optional[str] = None):
    try:
        content = fetch_text(epg_url, timeout=60)
        ids = channel_ids.split(",") if channel_ids else None
        programs = parse_xmltv(content, ids)
        return {"programs": [p.dict() for p in programs], "count": len(programs)}
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Yayın akışı (EPG) alınamadı: {e}")

class XtreamCredentials(BaseModel):
    server: str
    username: str
    password: str


class SeriesInfoRequest(XtreamCredentials):
    series_id: str


class CatchupUrlRequest(XtreamCredentials):
    stream_id: str
    start: str
    duration: int = 60


class EpgFetchRequest(BaseModel):
    epg_url: str
    channel_ids: Optional[str] = None


# Body-based variants of the credentialed routes: a POST body never shows up in
# access logs or proxy logs the way a query string does. The GET/query versions
# stay for app builds already installed on devices.
@api_router.post("/epg/fetch")
async def parse_epg_body(req: EpgFetchRequest):
    return await parse_epg(req.epg_url, req.channel_ids)


@api_router.post("/xtream/series-info")
async def xtream_series_info_body(req: SeriesInfoRequest, request: Request):
    return await xtream_series_info(req.server, req.username, req.password, req.series_id, request)


@api_router.post("/catchup/url")
async def catchup_url_body(req: CatchupUrlRequest, request: Request):
    return await catchup_url(request, req.server, req.username, req.password, req.stream_id, req.start, req.duration)


@api_router.get("/xtream/series-info")
async def xtream_series_info(server: str, username: str, password: str, series_id: str, request: Request):
    base_url = str(request.base_url).rstrip("/")
    try:
        data = xtream_get(server, username, password, "get_series_info", {"series_id": series_id})
        # Normalize episodes
        episodes_by_season: Dict[str, List[Dict[str, Any]]] = data.get("episodes", {}) or {}
        eps: List[SeriesEpisode] = []
        for season_num, season_eps in episodes_by_season.items():
            for e in season_eps:
                ext = e.get("container_extension", "mp4")
                eps.append(SeriesEpisode(
                    id=str(e.get("id")),
                    title=e.get("title", "Episode"),
                    season=int(e.get("season", season_num) or 1),
                    episode=int(e.get("episode_num", 1) or 1),
                    url=f"{base_url}/api/play/{e['id']}?t={encrypt_token(server, username, password, 'series', '.' + ext)}",
                    logo=e.get("info", {}).get("movie_image") if isinstance(e.get("info"), dict) else None,
                ))
        eps.sort(key=lambda x: (x.season, x.episode))
        info = data.get("info", {}) or {}
        return {
            "name": info.get("name") or data.get("info", {}).get("name"),
            "plot": info.get("plot"),
            "cover": info.get("cover"),
            "cast": info.get("cast"),
            "rating": info.get("rating"),
            "release_date": info.get("releaseDate") or info.get("release_date"),
            "episodes": [e.dict() for e in eps],
        }
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=str(e))

# One pooled session for stream traffic: segments reuse the TCP/TLS connection to
# the IPTV server instead of opening a new one every few seconds.
_stream_session = requests.Session()
_stream_session.mount("http://", requests.adapters.HTTPAdapter(pool_connections=8, pool_maxsize=32))
_stream_session.mount("https://", requests.adapters.HTTPAdapter(pool_connections=8, pool_maxsize=32))

# Live playlist URL -> (edge URL it redirected to, last time that edge answered).
_STICKY_TTL = 120
_sticky_playlists: Dict[str, tuple] = {}

# ---- Live segment prefetch ----
# Many IPTV servers cap each connection at roughly 1 MB/s, which is barely real time
# for a 1080p channel, and the player downloads one segment at a time, so any dip
# froze the picture even on a fast line. Parallel connections each get the full
# per-connection rate, so when a live playlist passes through, start fetching its
# newest segments in parallel; the player's request is then served from memory.
_PREFETCH_SEGMENTS = 4
_PREFETCH_TTL = 60           # seconds a fetched segment is kept
_PREFETCH_MAX_BYTES = 200 * 1024 * 1024
_prefetch_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="seg-prefetch")
_prefetch_lock = threading.Lock()
_prefetch_cache: Dict[str, dict] = {}

def _segment_key(url: str) -> str:
    # Some panels re-sign segment URLs on every playlist refresh; the path is what
    # identifies the segment.
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"

def _prefetch_evict_locked() -> None:
    now = time.monotonic()
    for key in [k for k, e in _prefetch_cache.items() if now - e["t"] > _PREFETCH_TTL]:
        del _prefetch_cache[key]
    total = sum(len(e["data"] or b"") for e in _prefetch_cache.values())
    for key in sorted(_prefetch_cache, key=lambda k: _prefetch_cache[k]["t"]):
        if total <= _PREFETCH_MAX_BYTES:
            break
        total -= len(_prefetch_cache[key]["data"] or b"")
        del _prefetch_cache[key]

def _prefetch_segment(url: str, entry: dict) -> None:
    try:
        resp = _stream_session.get(
            url, timeout=(8, 20), verify=False,
            headers={"User-Agent": "IPTVSmarters/1.0", "Accept": "*/*", "Connection": "keep-alive"},
        )
        resp.raise_for_status()
        entry["data"] = resp.content
        entry["ctype"] = resp.headers.get("Content-Type") or "video/mp2t"
    except Exception:
        entry["data"] = None  # the player's own request falls back to a direct fetch
    finally:
        entry["done"].set()

def _schedule_prefetch(manifest: str, base_url: str) -> None:
    if "#EXTINF" not in manifest or "#EXT-X-ENDLIST" in manifest:
        return  # master playlist, or VOD/catchup (the player buffers that fine)
    segments = [urljoin(base_url, line.strip()) for line in manifest.splitlines()
                if line.strip() and not line.startswith("#")]
    with _prefetch_lock:
        _prefetch_evict_locked()
        for url in segments[-_PREFETCH_SEGMENTS:]:
            key = _segment_key(url)
            if key in _prefetch_cache:
                continue
            entry = {"done": threading.Event(), "data": None, "ctype": None, "t": time.monotonic()}
            _prefetch_cache[key] = entry
            _prefetch_pool.submit(_prefetch_segment, url, entry)

async def _serve_prefetched(url: str) -> Optional[Response]:
    with _prefetch_lock:
        entry = _prefetch_cache.get(_segment_key(url))
    if entry is None:
        return None
    await asyncio.to_thread(entry["done"].wait, 25)
    if not entry["data"]:
        return None
    return Response(entry["data"], media_type=entry["ctype"], headers={"Cache-Control": "no-store"})

@api_router.get("/hls-proxy", name="hls_proxy")
async def hls_proxy(request: Request, u: str = Query(...), s: str = Query("")):
    url = _decode_proxy_url(u)
    if not _proxy_sig_ok(url, s):
        raise HTTPException(status_code=403, detail="Unsigned proxy URL")
    return await _proxy_hls(request, url)

async def _proxy_hls(request: Request, url: str, remember_as: Optional[str] = None):
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Only HTTP(S) URLs can be proxied")

    prefetched = await _serve_prefetched(url)
    if prefetched is not None:
        return prefetched

    def _open():
        resp = _stream_session.get(
            url,
            stream=True,
            # (connect, read): a stalled segment must fail fast so hls.js can retry it.
            timeout=(8, 15),
            headers={
                "User-Agent": "IPTVSmarters/1.0",
                "Accept": "application/x-mpegURL, application/vnd.apple.mpegurl, */*",
                "Connection": "keep-alive",
            },
            verify=False
        )
        resp.raise_for_status()
        return resp

    try:
        # requests blocks. Run inline in this async handler, one slow segment used to
        # freeze the whole server: playlist refreshes and the next segments queued
        # behind it, and the video stalled until the user switched channels.
        upstream = await asyncio.to_thread(_open)
    except requests.RequestException as exc:
        print("PROXY FETCH FAILED EXCEPTION:", redact_secrets(str(exc)))
        raise HTTPException(status_code=502, detail=f"Proxy fetch failed: {exc}")

    content_type = upstream.headers.get("Content-Type", "")
    # requests only allows a single iter_content() call per response - the old code
    # called it once to probe the first bytes and again to read the rest, which
    # raised StreamConsumedError on the second call and broke every proxied stream.
    # Create the iterator once and keep pulling from that same object throughout.
    content_iter = upstream.iter_content(chunk_size=1024 * 64)
    probe = b""
    try:
        probe = await asyncio.to_thread(next, content_iter, b"")
    except Exception:
        probe = b""

    is_manifest = (
        "mpegurl" in content_type.lower()
        or "vnd.apple.mpegurl" in content_type.lower()
        or probe.lstrip().startswith(b"#EXTM3U")
    )

    if is_manifest:
        try:
            rest = await asyncio.to_thread(b"".join, content_iter)
        except requests.RequestException as exc:
            upstream.close()
            raise HTTPException(status_code=502, detail=f"Proxy fetch failed: {exc}")
        final_url = upstream.url
        upstream.close()
        raw_manifest = (probe + rest).decode("utf-8", errors="replace")
        rewritten = _rewrite_hls_manifest(raw_manifest, final_url, request)
        _schedule_prefetch(raw_manifest, final_url)
        if remember_as:
            _sticky_playlists[remember_as] = (final_url, time.monotonic())
        return Response(
            rewritten,
            media_type="application/vnd.apple.mpegurl",
            headers={"Cache-Control": "no-store"},
        )

    def iter_content():
        try:
            if probe:
                yield probe
            for chunk in content_iter:
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    headers = {"Cache-Control": "no-store"}
    if upstream.headers.get("Content-Length"):
        headers["Content-Length"] = upstream.headers["Content-Length"]
    return StreamingResponse(
        iter_content(),
        media_type=content_type or "application/octet-stream",
        headers=headers,
    )

@api_router.get("/logo-proxy")
async def logo_proxy(u: str = Query(...)):
    """Fetches a channel/EPG logo server-side. Many free logo hosts (lyngsat-logo.com
    and similar) 403 a direct hotlink from the app since it sends no Referer they
    recognize; requesting with the image's own origin as Referer satisfies that check
    for most of them, and doing it here means every client just sees a normal image."""
    url = _decode_proxy_url(u)
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Only HTTP(S) URLs can be proxied")
    # Logo URLs come from playlists, so they can't be signed like HLS ones. Keep this
    # from being a relay into the local network: public hosts only, images only.
    if not await asyncio.to_thread(_is_public_host, url):
        raise HTTPException(status_code=403, detail="Logo host not allowed")

    cached = _logo_cache.get(url)
    if cached is not None:
        content, content_type = cached
        return Response(content, media_type=content_type, headers={"Cache-Control": "public, max-age=604800"})

    parsed = urlparse(url)
    referer = f"{parsed.scheme}://{parsed.netloc}/"

    def _fetch():
        resp = requests.get(
            url,
            timeout=10,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
                "Referer": referer,
                "Accept": "image/*,*/*",
            },
            verify=False,
        )
        resp.raise_for_status()
        return resp

    try:
        # requests is blocking - a channel list can trigger dozens of these at once
        # (switching category), and running them inline on the event loop would
        # serialize every other request (playback, other logos) behind each fetch.
        resp = await asyncio.to_thread(_fetch)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Logo fetch failed: {exc}")

    content_type = resp.headers.get("Content-Type") or "image/png"
    if not content_type.lower().startswith("image/"):
        raise HTTPException(status_code=415, detail="Not an image")
    if len(_logo_cache) < 5000:
        _logo_cache[url] = (resp.content, content_type)
    return Response(
        resp.content,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=604800"},
    )

@api_router.get("/play/{stream_id}")
async def play_stream(request: Request, stream_id: str, t: str = Query(...), proxy: bool = Query(False)):
    payload = decrypt_token(t)
    server = payload["s"].rstrip("/")
    kind = payload["k"]
    ext = payload.get("e", "")
    username = payload["u"]
    password = payload["p"]
    
    if kind == "live":
        # Try both .m3u8 and .ts - use .m3u8 for HLS playback
        redirect_url = f"{server}/live/{username}/{password}/{stream_id}.m3u8"
    elif kind == "movie":
        redirect_url = f"{server}/movie/{username}/{password}/{stream_id}{ext}"
    elif kind == "series":
        redirect_url = f"{server}/series/{username}/{password}/{stream_id}{ext}"
    elif kind == "catchup":
        start_fmt = payload.get("start", "")
        duration = payload.get("duration", "60")
        redirect_url = f"{server}/timeshift/{username}/{password}/{duration}/{start_fmt}/{stream_id}.m3u8"
    else:
        raise HTTPException(status_code=400, detail="Invalid kind")

    if proxy:
        # The play token is already authenticated (Fernet), so no proxy signature needed.
        # Xtream panels redirect /live/... to one of several edge servers, and those can
        # be minutes apart (measured: ~25 min). The player re-requests this URL on every
        # playlist refresh, so without pinning it hopped between edges and the picture
        # jumped back and forth or froze. Stay on the edge the first request landed on,
        # and only re-resolve when it stops answering.
        pinned = _sticky_playlists.get(redirect_url)
        if pinned and time.monotonic() - pinned[1] < _STICKY_TTL:
            try:
                return await _proxy_hls(request, pinned[0], remember_as=redirect_url)
            except HTTPException:
                _sticky_playlists.pop(redirect_url, None)
        return await _proxy_hls(request, redirect_url, remember_as=redirect_url)

    return RedirectResponse(url=redirect_url, status_code=302)

@api_router.get("/catchup/url")
async def catchup_url(request: Request, server: str, username: str, password: str,
                       stream_id: str, start: str, duration: int = 60):
    """Build a play URL for a past program on a catchup-capable channel.

    `start` is an ISO-8601 timestamp (UTC) marking the beginning of the
    program, `duration` is in minutes. Xtream's timeshift endpoint expects
    the start time as YYYY-MM-DD:HH-MM in the provider's own timezone; since
    we only have UTC from XMLTV, providers that expect local time may be off
    by their UTC offset.
    """
    server_clean = server.rstrip("/")
    try:
        dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid start timestamp")
    start_fmt = dt.strftime("%Y-%m-%d:%H-%M")
    base_url = str(request.base_url).rstrip("/")
    token = encrypt_token(server_clean, username, password, "catchup", ".m3u8",
                           extra={"start": start_fmt, "duration": str(duration)})
    return {"url": f"{base_url}/api/play/{stream_id}?t={token}"}

# Playlists CRUD

@api_router.post("/playlists/save")
async def save_playlist(req: SavePlaylistRequest):
    rec = PlaylistRecord(**req.dict())
    doc = rec.dict()
    if _mongo_ready:
        await db.playlists.insert_one(doc)
    else:
        _mem["playlists"].append(doc)
    return doc

@api_router.get("/playlists/list")
async def list_playlists(device_id: str):
    if _mongo_ready:
        items = await db.playlists.find({"device_id": device_id}, {"_id": 0}).to_list(100)
    else:
        items = [x for x in _mem["playlists"] if x["device_id"] == device_id][:100]
    return items

@api_router.delete("/playlists/{playlist_id}")
async def delete_playlist(playlist_id: str):
    if _mongo_ready:
        await db.playlists.delete_one({"id": playlist_id})
    else:
        _mem["playlists"] = [x for x in _mem["playlists"] if x.get("id") != playlist_id]
    return {"ok": True}

# Favorites
@api_router.post("/favorites/toggle")
async def toggle_favorite(req: FavoriteRequest):
    if _mongo_ready:
        existing = await db.favorites.find_one({"device_id": req.device_id, "item_id": req.item_id})
        if existing:
            await db.favorites.delete_one({"device_id": req.device_id, "item_id": req.item_id})
            return {"favorited": False}
        doc = req.dict()
        doc["created_at"] = datetime.now(timezone.utc).isoformat()
        await db.favorites.insert_one(doc)
        return {"favorited": True}

    existing = next(
        (x for x in _mem["favorites"] if x["device_id"] == req.device_id and x["item_id"] == req.item_id),
        None,
    )
    if existing:
        _mem["favorites"] = [
            x for x in _mem["favorites"]
            if not (x["device_id"] == req.device_id and x["item_id"] == req.item_id)
        ]
        return {"favorited": False}
    doc = req.dict()
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    _mem["favorites"].append(doc)
    return {"favorited": True}

@api_router.get("/favorites/list")
async def list_favorites(device_id: str, kind: Optional[str] = None):
    q: Dict[str, Any] = {"device_id": device_id}
    if kind:
        q["kind"] = kind
    if _mongo_ready:
        items = await db.favorites.find(q, {"_id": 0}).to_list(500)
    else:
        items = [x for x in _mem["favorites"] if x["device_id"] == device_id]
        if kind:
            items = [x for x in items if x.get("kind") == kind]
    return items

# Watch history
@api_router.post("/history/upsert")
async def upsert_history(req: WatchHistoryRequest):
    doc = req.dict()
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    if _mongo_ready:
        await db.history.update_one(
            {"device_id": req.device_id, "item_id": req.item_id},
            {"$set": doc}, upsert=True,
        )
    else:
        for i, row in enumerate(_mem["history"]):
            if row["device_id"] == req.device_id and row["item_id"] == req.item_id:
                _mem["history"][i] = doc
                break
        else:
            _mem["history"].append(doc)
    return {"ok": True}

@api_router.get("/history/list")
async def list_history(device_id: str, limit: int = 30):
    if _mongo_ready:
        items = await db.history.find({"device_id": device_id}, {"_id": 0}).sort("updated_at", -1).to_list(limit)
    else:
        items = sorted(
            [x for x in _mem["history"] if x["device_id"] == device_id],
            key=lambda x: x.get("updated_at", ""),
            reverse=True,
        )[:limit]
    return items

app.include_router(api_router)

# Only the app itself may talk to this server. It listens on 127.0.0.1, but any web page
# open in a browser on the same PC can still send requests to it:
# - Host: a DNS-rebinding page reaches us under its own domain name -> reject unknown Hosts.
# - Origin: browsers send it on cross-site fetches and form posts -> reject foreign ones.
# - CORS: never let another origin read a response.
# Requests without an Origin (the app's <video>/<img> loads, local tools) are allowed;
# the endpoints such requests could abuse are signed (hls-proxy) or restricted (logo-proxy).
_PORT = os.environ.get("LUMIO_BACKEND_PORT", "8000")
ALLOWED_HOSTS = {f"127.0.0.1:{_PORT}", f"localhost:{_PORT}", "127.0.0.1", "localhost"}
ALLOWED_HOSTS |= {h.strip() for h in os.environ.get("LUMIO_ALLOWED_HOSTS", "").split(",") if h.strip()}
ALLOWED_ORIGINS = [
    "app://-",                 # packaged Electron window (electron/serve-static.js)
    "http://localhost:8081",   # Expo web dev server
    "http://localhost:19006",
    "http://127.0.0.1:8081",
]
ALLOWED_ORIGINS += [o.strip() for o in os.environ.get("LUMIO_ALLOWED_ORIGINS", "").split(",") if o.strip()]

@app.middleware("http")
async def _local_only(request: Request, call_next):
    host = (request.headers.get("host") or "").lower()
    if host not in ALLOWED_HOSTS:
        return Response("Forbidden host", status_code=403)
    origin = request.headers.get("origin")
    if origin and origin not in ALLOWED_ORIGINS:
        return Response("Forbidden origin", status_code=403)
    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
