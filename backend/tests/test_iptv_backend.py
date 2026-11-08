"""IPTV backend test suite.

Covers: health, playlist parse (M3U + xtream validation), EPG parse,
playlists CRUD, favorites toggle, history upsert, and ObjectId leak checks.
"""
import time
import requests
import pytest

DEMO_M3U = "https://iptv-org.github.io/iptv/index.m3u"
DEMO_EPG = "https://i.mjh.nz/PlutoTV/all.xml"


def _no_id_leak(obj):
    """Recursively assert no MongoDB `_id` key appears anywhere."""
    if isinstance(obj, dict):
        assert "_id" not in obj, f"_id leaked in dict: keys={list(obj.keys())}"
        for v in obj.values():
            _no_id_leak(v)
    elif isinstance(obj, list):
        for v in obj:
            _no_id_leak(v)


# ---------------- Health ----------------
class TestHealth:
    def test_root_ok(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200
        body = r.json()
        assert body.get("status") == "ok"
        assert "IPTV" in body.get("message", "")


# ---------------- Playlist parse ----------------
class TestPlaylistParse:
    def test_parse_m3u_demo_iptv_org(self, api_client, base_url):
        payload = {"name": "Demo IPTV-org", "type": "m3u", "m3u_url": DEMO_M3U}
        r = api_client.post(f"{base_url}/api/playlist/parse", json=payload, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "Demo IPTV-org"
        for key in ("channels", "movies", "series", "groups"):
            assert key in data
        # iptv-org has thousands of live channels
        assert isinstance(data["channels"], list)
        assert len(data["channels"]) > 100, f"expected many channels, got {len(data['channels'])}"
        assert isinstance(data["groups"], dict)
        for k in ("live", "movie", "series"):
            assert k in data["groups"]
        _no_id_leak(data)

        # Sanity: channel object shape
        ch = data["channels"][0]
        for field in ("id", "name", "url", "kind"):
            assert field in ch
        assert ch["kind"] == "live"

    def test_parse_m3u_invalid_url(self, api_client, base_url):
        payload = {"name": "Bad", "type": "m3u",
                   "m3u_url": "http://invalid.nonexistent-host-xyz-12345.example/x.m3u"}
        r = api_client.post(f"{base_url}/api/playlist/parse", json=payload, timeout=60)
        assert r.status_code >= 400, r.text
        # Public ingress may replace upstream JSON 502 with an HTML error page.
        # Accept either a JSON `detail` from FastAPI or any 502/504 from the ingress.
        if "application/json" in r.headers.get("Content-Type", ""):
            assert "detail" in r.json()
        else:
            assert r.status_code in (502, 503, 504), \
                f"non-JSON error with unexpected status {r.status_code}"

    def test_parse_m3u_missing_url_400(self, api_client, base_url):
        payload = {"name": "Bad", "type": "m3u"}
        r = api_client.post(f"{base_url}/api/playlist/parse", json=payload)
        assert r.status_code == 400
        assert "m3u_url" in r.json().get("detail", "")

    def test_parse_xtream_missing_fields_400(self, api_client, base_url):
        payload = {"name": "BadXtream", "type": "xtream", "username": "u"}
        r = api_client.post(f"{base_url}/api/playlist/parse", json=payload)
        assert r.status_code == 400
        assert "server" in r.json().get("detail", "").lower() or \
               "password" in r.json().get("detail", "").lower()

    def test_parse_unsupported_type_400(self, api_client, base_url):
        payload = {"name": "X", "type": "weird"}
        r = api_client.post(f"{base_url}/api/playlist/parse", json=payload)
        assert r.status_code == 400


# ---------------- EPG parse ----------------
class TestEPG:
    def test_parse_epg_pluto(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/epg/parse",
                            params={"epg_url": DEMO_EPG}, timeout=120)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "programs" in body and "count" in body
        assert isinstance(body["programs"], list)
        assert body["count"] == len(body["programs"])
        assert body["count"] > 0, "PlutoTV EPG should contain programs"
        # Validate one program shape
        p = body["programs"][0]
        for field in ("channel", "title", "start", "stop"):
            assert field in p
        _no_id_leak(body)

    def test_parse_epg_bad_url_502(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/epg/parse",
            params={"epg_url": "http://invalid.nonexistent-host-xyz-12345.example/epg.xml"},
            timeout=60,
        )
        assert r.status_code == 502, r.text
        # Public ingress may replace the JSON error body with an HTML 502 page.
        if "application/json" in r.headers.get("Content-Type", ""):
            assert "detail" in r.json()


# ---------------- Playlists CRUD ----------------
class TestPlaylistsCRUD:
    saved_id = None

    def test_save_playlist(self, api_client, base_url, device_id):
        payload = {
            "device_id": device_id,
            "name": "TEST_My Demo Playlist",
            "type": "m3u",
            "m3u_url": DEMO_M3U,
            "epg_url": DEMO_EPG,
        }
        r = api_client.post(f"{base_url}/api/playlists/save", json=payload)
        assert r.status_code == 200, r.text
        rec = r.json()
        _no_id_leak(rec)
        assert rec["device_id"] == device_id
        assert rec["name"] == "TEST_My Demo Playlist"
        assert "id" in rec and rec["id"]
        assert "created_at" in rec
        TestPlaylistsCRUD.saved_id = rec["id"]

    def test_list_playlists_contains_saved(self, api_client, base_url, device_id):
        assert TestPlaylistsCRUD.saved_id, "save must run first"
        r = api_client.get(f"{base_url}/api/playlists/list",
                           params={"device_id": device_id})
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        _no_id_leak(items)
        ids = [it["id"] for it in items]
        assert TestPlaylistsCRUD.saved_id in ids

    def test_delete_playlist(self, api_client, base_url, device_id):
        assert TestPlaylistsCRUD.saved_id, "save must run first"
        r = api_client.delete(
            f"{base_url}/api/playlists/{TestPlaylistsCRUD.saved_id}"
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True

        # Verify removed
        r2 = api_client.get(f"{base_url}/api/playlists/list",
                            params={"device_id": device_id})
        assert r2.status_code == 200
        ids = [it["id"] for it in r2.json()]
        assert TestPlaylistsCRUD.saved_id not in ids


# ---------------- Favorites ----------------
class TestFavorites:
    def test_toggle_add_then_remove(self, api_client, base_url, device_id):
        item_id = "TEST_fav_item_001"
        payload = {
            "device_id": device_id,
            "item_id": item_id,
            "kind": "live",
            "name": "TEST_Channel",
            "logo": None,
            "url": "http://example.com/stream.m3u8",
        }
        # Add
        r1 = api_client.post(f"{base_url}/api/favorites/toggle", json=payload)
        assert r1.status_code == 200, r1.text
        assert r1.json().get("favorited") is True

        # List shows it
        r_list = api_client.get(f"{base_url}/api/favorites/list",
                                params={"device_id": device_id, "kind": "live"})
        assert r_list.status_code == 200
        favs = r_list.json()
        _no_id_leak(favs)
        assert any(f["item_id"] == item_id for f in favs)

        # Filter by other kind returns no match for our item
        r_movie = api_client.get(f"{base_url}/api/favorites/list",
                                 params={"device_id": device_id, "kind": "movie"})
        assert r_movie.status_code == 200
        assert not any(f["item_id"] == item_id for f in r_movie.json())

        # Toggle again -> remove
        r2 = api_client.post(f"{base_url}/api/favorites/toggle", json=payload)
        assert r2.status_code == 200
        assert r2.json().get("favorited") is False

        r_list2 = api_client.get(f"{base_url}/api/favorites/list",
                                 params={"device_id": device_id})
        assert r_list2.status_code == 200
        assert not any(f["item_id"] == item_id for f in r_list2.json())


# ---------------- History ----------------
class TestHistory:
    def test_history_upsert_and_order(self, api_client, base_url, device_id):
        items = [
            {"item_id": "TEST_hist_A", "name": "TEST_A"},
            {"item_id": "TEST_hist_B", "name": "TEST_B"},
            {"item_id": "TEST_hist_C", "name": "TEST_C"},
        ]
        for it in items:
            payload = {
                "device_id": device_id,
                "item_id": it["item_id"],
                "kind": "live",
                "name": it["name"],
                "url": "http://example.com/s.m3u8",
                "position": 10.0,
                "duration": 100.0,
            }
            r = api_client.post(f"{base_url}/api/history/upsert", json=payload)
            assert r.status_code == 200
            assert r.json().get("ok") is True
            time.sleep(1.05)  # ensure distinct updated_at timestamps

        r_list = api_client.get(f"{base_url}/api/history/list",
                                params={"device_id": device_id, "limit": 50})
        assert r_list.status_code == 200
        hist = r_list.json()
        _no_id_leak(hist)
        # Our 3 should be present; most-recently upserted (C) should appear before A
        our = [h for h in hist if h["item_id"].startswith("TEST_hist_")]
        assert len(our) >= 3
        idx_a = next(i for i, h in enumerate(our) if h["item_id"] == "TEST_hist_A")
        idx_c = next(i for i, h in enumerate(our) if h["item_id"] == "TEST_hist_C")
        assert idx_c < idx_a, f"Expected C newer than A in DESC order, got order: {[h['item_id'] for h in our]}"

        # Cleanup: upsert is not deletable directly via API; leave TEST_ records.
        # That is acceptable since they are clearly prefixed.

    def test_history_limit_param(self, api_client, base_url, device_id):
        r = api_client.get(f"{base_url}/api/history/list",
                           params={"device_id": device_id, "limit": 1})
        assert r.status_code == 200
        assert len(r.json()) <= 1
