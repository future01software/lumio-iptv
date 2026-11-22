#!/usr/bin/env python3
"""Fake Xtream Codes panel for testing Lumio iOS in the Simulator without real credentials.

    sh Tools/mock-xtream/make-media.sh        # once, needs ffmpeg
    python3 Tools/mock-xtream/server.py       # serves http://127.0.0.1:8899

In the app: server http://127.0.0.1:8899, username demo, password demo.
"""
import base64, json, os, re, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
MEDIA = os.path.join(ROOT, "media")
PORT = int(os.environ.get("PORT", "8899"))
USER, PASS = "demo", "demo"

LIVE_CATS = [{"category_id": "1", "category_name": "TR | Ulusal"}, {"category_id": "2", "category_name": "Haber"}]
LIVE = [
    {"num": 1, "name": "Lumio Test 1", "stream_id": 101, "category_id": "1", "epg_channel_id": "test1", "stream_icon": ""},
    {"num": 2, "name": "Lumio Test 2", "stream_id": 102, "category_id": "1", "epg_channel_id": "test2", "stream_icon": ""},
    {"num": 3, "name": "Test Haber", "stream_id": 103, "category_id": "2", "epg_channel_id": "", "stream_icon": ""},
]
VOD_CATS = [{"category_id": "10", "category_name": "Test Filmleri"}]
VOD = [
    {"name": "Test Filmi (MP4)", "stream_id": 201, "category_id": "10", "container_extension": "mp4", "rating": "7.5", "year": "2026", "stream_icon": ""},
    {"name": "Test Filmi (MKV → HLS yedeği)", "stream_id": 202, "category_id": "10", "container_extension": "mkv", "rating": "6.1", "year": "2025", "stream_icon": ""},
]
SER_CATS = [{"category_id": "20", "category_name": "Test Dizileri"}]
SERIES = [{"name": "Test Dizisi", "series_id": 301, "category_id": "20", "cover": "", "rating": "8", "plot": "Deneme amaçlı dizi."}]


def b64(s):
    return base64.b64encode(s.encode()).decode()


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Strip query strings (they carry credentials in real panels).
        print("%s %s" % (self.command, self.path.split("?")[0]))

    def send_json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == "/player_api.php":
            if q.get("username") != USER or q.get("password") != PASS:
                return self.send_json({"user_info": {"auth": 0}})
            a = q.get("action")
            now = int(time.time())
            if a is None:
                return self.send_json({"user_info": {"auth": 1, "status": "Active", "exp_date": str(now + 86400 * 30), "max_connections": "1"},
                                       "server_info": {"url": "127.0.0.1", "port": str(PORT)}})
            if a == "get_live_categories": return self.send_json(LIVE_CATS)
            if a == "get_live_streams": return self.send_json(LIVE)
            if a == "get_vod_categories": return self.send_json(VOD_CATS)
            if a == "get_vod_streams": return self.send_json(VOD)
            if a == "get_series_categories": return self.send_json(SER_CATS)
            if a == "get_series": return self.send_json(SERIES)
            if a == "get_vod_info":
                return self.send_json({"info": {"plot": "Yerel test sunucusunun ürettiği deneme filmi.", "genre": "Test", "duration_secs": 240, "rating": "7.5"}})
            if a == "get_series_info":
                eps = [{"id": str(400 + i), "episode_num": i, "title": f"Bölüm {i}", "container_extension": "mp4", "season": 1,
                        "info": {"plot": f"Bölüm {i} açıklaması.", "duration_secs": 60}} for i in (1, 2)]
                return self.send_json({"info": {"plot": "Deneme amaçlı dizi.", "genre": "Test"}, "episodes": {"1": eps}})
            if a == "get_short_epg":
                start = now - now % 1800
                titles = ["Sabah Haberleri", "Belgesel Kuşağı", "Akşam Filmi"]
                return self.send_json({"epg_listings": [
                    {"title": b64(titles[i]), "description": b64("Test programı"), "start_timestamp": str(start + i * 1800),
                     "stop_timestamp": str(start + (i + 1) * 1800)} for i in range(3)]})
            return self.send_json([])

        m = re.match(r"^/(live|movie|series)/([^/]+)/([^/]+)/(\d+)\.(\w+)$", u.path)
        if m:
            kind, user, pw, sid, ext = m.groups()
            if user != USER or pw != PASS:
                self.send_error(403); return
            if kind == "live":
                return self.serve_live()
            if ext == "mkv":
                self.send_error(415); return  # pretend AVPlayer can't use it
            if ext == "m3u8":
                return self.serve_file(os.path.join(MEDIA, "vod", "index.m3u8"))
            return self.serve_file(os.path.join(MEDIA, "movie.mp4"))
        # HLS segments
        m = re.match(r"^/(live|movie|series)/[^/]+/[^/]+/(seg\d+\.ts)$", u.path)
        if m:
            sub = "live" if m.group(1) == "live" else "vod"
            return self.serve_file(os.path.join(MEDIA, sub, m.group(2)))
        self.send_error(404)

    def serve_live(self):
        """Sliding-window live playlist looping over the generated segments."""
        segs = sorted(f for f in os.listdir(os.path.join(MEDIA, "live")) if f.endswith(".ts"))
        n, dur, window = len(segs), 4, 5
        seq = int(time.time() // dur)
        lines = ["#EXTM3U", "#EXT-X-VERSION:3", f"#EXT-X-TARGETDURATION:{dur}",
                 f"#EXT-X-MEDIA-SEQUENCE:{seq}", f"#EXT-X-DISCONTINUITY-SEQUENCE:{seq // n}"]
        for i in range(seq, seq + window):
            if i % n == 0 and i != seq:
                lines.append("#EXT-X-DISCONTINUITY")
            lines += [f"#EXTINF:{dur}.0,", segs[i % n]]
        body = ("\n".join(lines) + "\n").encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.apple.mpegurl")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def serve_file(self, path, live=False):
        if not os.path.exists(path):
            self.send_error(404); return
        data = open(path, "rb").read()
        if path.endswith(".m3u8"):
            text = data.decode()
            if live:
                text = text.replace("#EXT-X-ENDLIST", "").replace("#EXT-X-PLAYLIST-TYPE:VOD", "")
            data = text.encode()
            ctype = "application/vnd.apple.mpegurl"
        elif path.endswith(".ts"):
            ctype = "video/mp2t"
        else:
            ctype = "video/mp4"
        start, end = 0, len(data) - 1
        rng = self.headers.get("Range")
        status = 200
        if rng:
            mm = re.match(r"bytes=(\d*)-(\d*)", rng)
            if mm:
                if mm.group(1): start = int(mm.group(1))
                if mm.group(2): end = min(end, int(mm.group(2)))
                status = 206
        chunk = data[start:end + 1]
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(len(chunk)))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
        self.end_headers()
        self.wfile.write(chunk)


if __name__ == "__main__":
    print(f"Mock Xtream on http://127.0.0.1:{PORT}  (user {USER} / pass {PASS})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
