"""Unit tests for app/db/__init__.py."""

import os

import pytest


@pytest.fixture(autouse=True)
def temp_db(monkeypatch, tmp_path):
    """Point DB_PATH at a fresh temp file for each test."""
    db_file = str(tmp_path / "test_finally.db")
    monkeypatch.setenv("DB_PATH", db_file)
    import app.db as m
    m.init_db()
    return m


def _m():
    import app.db as m
    return m


# ---------------------------------------------------------------------------
# init_db
# ---------------------------------------------------------------------------

def test_init_db_idempotent():
    m = _m()
    m.init_db()
    m.init_db()
    profile = m.get_profile()
    assert profile["cash_balance"] == 10000.0
    watchlist = m.get_watchlist()
    assert len(watchlist) == 10


def test_seed_data_present():
    m = _m()
    profile = m.get_profile()
    assert profile["id"] == "default"
    assert profile["cash_balance"] == 10000.0

    tickers = {w["ticker"] for w in m.get_watchlist()}
    assert tickers == {"AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "NFLX"}


# ---------------------------------------------------------------------------
# Watchlist
# ---------------------------------------------------------------------------

def test_add_to_watchlist():
    m = _m()
    result = m.add_to_watchlist("PYPL")
    assert result["ticker"] == "PYPL"
    assert "added_at" in result
    tickers = [w["ticker"] for w in m.get_watchlist()]
    assert "PYPL" in tickers


def test_add_duplicate_raises_value_error():
    m = _m()
    with pytest.raises(ValueError, match="already in watchlist"):
        m.add_to_watchlist("AAPL")


def test_remove_from_watchlist():
    m = _m()
    m.remove_from_watchlist("AAPL")
    tickers = [w["ticker"] for w in m.get_watchlist()]
    assert "AAPL" not in tickers


def test_remove_nonexistent_raises_key_error():
    m = _m()
    with pytest.raises(KeyError):
        m.remove_from_watchlist("DOESNOTEXIST")


# ---------------------------------------------------------------------------
# Profile / cash
# ---------------------------------------------------------------------------

def test_get_profile():
    m = _m()
    p = m.get_profile()
    assert p["cash_balance"] == 10000.0


def test_deduct_cash():
    m = _m()
    new_balance = m.deduct_cash(1500.0)
    assert abs(new_balance - 8500.0) < 1e-6
    assert abs(m.get_profile()["cash_balance"] - 8500.0) < 1e-6


def test_deduct_cash_insufficient_raises():
    m = _m()
    with pytest.raises(ValueError, match="Insufficient cash"):
        m.deduct_cash(99999.0)


def test_add_cash():
    m = _m()
    new_balance = m.add_cash(500.0)
    assert abs(new_balance - 10500.0) < 1e-6


# ---------------------------------------------------------------------------
# Positions
# ---------------------------------------------------------------------------

def test_update_and_get_position():
    m = _m()
    m.update_position("AAPL", 10.0, 185.0)
    pos = m.get_position("AAPL")
    assert pos is not None
    assert pos["ticker"] == "AAPL"
    assert pos["quantity"] == 10.0
    assert pos["avg_cost"] == 185.0


def test_update_position_upsert():
    m = _m()
    m.update_position("AAPL", 10.0, 185.0)
    m.update_position("AAPL", 15.0, 187.0)
    pos = m.get_position("AAPL")
    assert pos["quantity"] == 15.0
    assert pos["avg_cost"] == 187.0


def test_get_position_none_when_missing():
    m = _m()
    assert m.get_position("ZZZZ") is None


def test_get_positions_list():
    m = _m()
    m.update_position("AAPL", 5.0, 190.0)
    m.update_position("MSFT", 3.0, 420.0)
    positions = m.get_positions()
    tickers = {p["ticker"] for p in positions}
    assert {"AAPL", "MSFT"}.issubset(tickers)


def test_remove_position():
    m = _m()
    m.update_position("AAPL", 10.0, 185.0)
    m.remove_position("AAPL")
    assert m.get_position("AAPL") is None


# ---------------------------------------------------------------------------
# Trades
# ---------------------------------------------------------------------------

def test_record_trade():
    m = _m()
    trade = m.record_trade("AAPL", "buy", 10.0, 190.0)
    assert trade["ticker"] == "AAPL"
    assert trade["side"] == "buy"
    assert trade["quantity"] == 10.0
    assert trade["price"] == 190.0
    assert "executed_at" in trade
    assert "id" in trade


def test_record_multiple_trades():
    m = _m()
    m.record_trade("AAPL", "buy", 10.0, 190.0)
    m.record_trade("AAPL", "sell", 5.0, 195.0)
    m.record_trade("MSFT", "buy", 3.0, 420.0)


# ---------------------------------------------------------------------------
# Portfolio snapshots
# ---------------------------------------------------------------------------

def test_add_and_get_snapshots():
    m = _m()
    m.add_snapshot(10000.0)
    m.add_snapshot(10500.0)
    snaps = m.get_snapshots()
    assert len(snaps) == 2
    assert snaps[0]["total_value"] == 10000.0
    assert snaps[1]["total_value"] == 10500.0


def test_get_snapshots_limit():
    m = _m()
    for i in range(10):
        m.add_snapshot(float(10000 + i * 100))
    snaps = m.get_snapshots(limit=5)
    assert len(snaps) == 5


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

def test_save_and_get_chat_message():
    m = _m()
    saved = m.save_chat_message("user", "Hello AI")
    assert saved["role"] == "user"
    assert saved["content"] == "Hello AI"
    assert saved["actions"] is None

    history = m.get_chat_history()
    assert len(history) == 1
    assert history[0]["content"] == "Hello AI"


def test_chat_history_with_actions():
    m = _m()
    m.save_chat_message("user", "Buy 5 AAPL")
    m.save_chat_message("assistant", "Done!", actions='{"trades": []}')
    history = m.get_chat_history()
    assert len(history) == 2
    assert history[1]["actions"] == '{"trades": []}'


def test_chat_history_limit():
    m = _m()
    for i in range(25):
        m.save_chat_message("user", f"message {i}")
    history = m.get_chat_history(limit=10)
    assert len(history) == 10


def test_chat_history_order():
    m = _m()
    m.save_chat_message("user", "first")
    m.save_chat_message("assistant", "second")
    history = m.get_chat_history()
    assert history[0]["content"] == "first"
    assert history[1]["content"] == "second"
