"""In-process security checks for the local backend (no network needed).

Run: venv\\Scripts\\python -m pytest tests/test_security.py
"""
import os

os.environ.setdefault("LUMIO_NO_MONGO", "1")
os.environ.setdefault("FERNET_KEY", "x" * 43 + "=")

import pytest
from fastapi.testclient import TestClient

import server

HOST = {"Host": "127.0.0.1:8000"}


@pytest.fixture(scope="module")
def client():
    with TestClient(server.app, base_url="http://127.0.0.1:8000") as c:
        yield c


def test_app_origin_allowed(client):
    r = client.get("/api/", headers={**HOST, "Origin": "app://-"})
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "app://-"


def test_foreign_origin_rejected(client):
    r = client.get("/api/", headers={**HOST, "Origin": "https://evil.example"})
    assert r.status_code == 403


def test_foreign_host_rejected(client):
    # DNS rebinding: the attacker's domain resolves to 127.0.0.1.
    r = client.get("/api/", headers={"Host": "evil.example:8000"})
    assert r.status_code == 403


def test_no_wildcard_cors(client):
    r = client.options(
        "/api/",
        headers={**HOST, "Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert r.headers.get("access-control-allow-origin") != "*"


def test_unsigned_hls_proxy_rejected(client):
    u = server._encode_proxy_url("http://192.168.1.1/")
    r = client.get(f"/api/hls-proxy?u={u}", headers=HOST)
    assert r.status_code == 403


def test_forged_signature_rejected(client):
    u = server._encode_proxy_url("http://192.168.1.1/")
    r = client.get(f"/api/hls-proxy?u={u}&s={'0' * 32}", headers=HOST)
    assert r.status_code == 403


def test_signature_roundtrip():
    url = "http://provider.example/live/a/b/1.m3u8"
    assert server._proxy_sig_ok(url, server._sign_proxy_url(url))
    assert not server._proxy_sig_ok(url + "x", server._sign_proxy_url(url))


def test_rewritten_manifest_urls_are_signed(client):
    class Req:
        def url_for(self, name):
            return "http://127.0.0.1:8000/api/hls-proxy"

    text = "#EXTM3U\n#EXTINF:4,\nseg1.ts\n"
    out = server._rewrite_hls_manifest(text, "http://provider.example/live/x/index.m3u8", Req())
    line = [l for l in out.splitlines() if l.startswith("http")][0]
    assert "&s=" in line


@pytest.mark.parametrize("target", ["http://127.0.0.1/admin", "http://192.168.1.1/", "http://10.0.0.5/x.png", "http://localhost/x.png"])
def test_logo_proxy_blocks_local_network(client, target):
    u = server._encode_proxy_url(target)
    r = client.get(f"/api/logo-proxy?u={u}", headers=HOST)
    assert r.status_code == 403
