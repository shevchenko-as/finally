"""Tests for watchlist endpoints."""


def test_get_watchlist(client):
    """Should return watchlist items enriched with price."""
    response = client.get("/api/watchlist")
    assert response.status_code == 200
    items = response.json()
    assert isinstance(items, list)
    # Seed data has 10 tickers
    assert len(items) == 10
    # Check shape of first item
    item = items[0]
    assert "ticker" in item
    assert "added_at" in item
    assert "price" in item
    assert "change_percent" in item


def test_add_ticker(client, mock_market_source):
    """POST /api/watchlist should add a new ticker."""
    response = client.post("/api/watchlist", json={"ticker": "SHOP"})
    assert response.status_code == 201
    data = response.json()
    assert data["ticker"] == "SHOP"
    assert "added_at" in data
    mock_market_source.add_ticker.assert_awaited_once_with("SHOP")


def test_add_ticker_lowercase_normalised(client, mock_market_source):
    """Ticker should be uppercased."""
    response = client.post("/api/watchlist", json={"ticker": "shop"})
    assert response.status_code == 201
    assert response.json()["ticker"] == "SHOP"


def test_add_duplicate_ticker(client):
    """Adding a ticker already in watchlist should return 400."""
    # AAPL is in the seed data
    response = client.post("/api/watchlist", json={"ticker": "AAPL"})
    assert response.status_code == 400
    assert "already in watchlist" in response.json()["detail"]


def test_delete_ticker(client, mock_market_source):
    """DELETE /api/watchlist/{ticker} should remove the ticker."""
    response = client.delete("/api/watchlist/AAPL")
    assert response.status_code == 204
    mock_market_source.remove_ticker.assert_awaited_once_with("AAPL")


def test_delete_nonexistent_ticker(client):
    """Deleting a ticker not in watchlist should return 404."""
    response = client.delete("/api/watchlist/UNKNOWN")
    assert response.status_code == 404
    assert "not in watchlist" in response.json()["detail"]


def test_watchlist_price_enrichment(client, price_cache):
    """AAPL is in seed data and has a price in the cache."""
    price_cache.update("AAPL", 200.00)
    response = client.get("/api/watchlist")
    items = response.json()
    aapl = next((i for i in items if i["ticker"] == "AAPL"), None)
    assert aapl is not None
    assert aapl["price"] == 200.00
