"""Shared fixtures for IPTV backend tests."""
import os
import requests
import pytest

# Frontend .env uses EXPO_PUBLIC_BACKEND_URL; review specifies the same URL.
BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "http://127.0.0.1:8000"
).rstrip("/")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def device_id():
    return "TEST_device_pytest_001"
