"""Tests for GET /api/health."""

import os


def test_health_ok(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["db"] == "ok"
    assert data["market"] in ("simulator", "massive")


def test_health_simulator_by_default(client):
    os.environ.pop("MASSIVE_API_KEY", None)
    response = client.get("/api/health")
    assert response.json()["market"] == "simulator"


def test_health_massive_when_key_set(client):
    os.environ["MASSIVE_API_KEY"] = "fake-key"
    try:
        response = client.get("/api/health")
        assert response.json()["market"] == "massive"
    finally:
        os.environ.pop("MASSIVE_API_KEY", None)
