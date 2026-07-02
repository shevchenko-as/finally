"""
Database access layer for FinAlly.

All functions use user_id="default" as the default parameter.
Raises ValueError for business logic errors (duplicate ticker, insufficient funds).
Raises KeyError for not-found errors.
Raw SQLite errors propagate unchanged.
"""

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

_DB_DIR = Path(__file__).parent.parent.parent / "db"
_DEFAULT_DB_PATH = str(_DB_DIR / "finally.db")
_SCHEMA_PATH = Path(__file__).parent / "schema.sql"
_SEED_PATH = Path(__file__).parent / "seed.sql"

_initialized = False


def _get_db_path() -> str:
    return os.environ.get("DB_PATH", _DEFAULT_DB_PATH)


@contextmanager
def get_db():
    """Context manager returning a sqlite3.Connection with row_factory=sqlite3.Row."""
    conn = sqlite3.connect(_get_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Create schema and seed data. Idempotent — safe to call multiple times."""
    db_path = _get_db_path()
    # Ensure the db directory exists
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    schema = _SCHEMA_PATH.read_text()
    seed = _SEED_PATH.read_text()

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.executescript(schema)
        # Only seed if users_profile is empty
        row = conn.execute("SELECT COUNT(*) FROM users_profile").fetchone()
        if row[0] == 0:
            conn.executescript(seed)
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Watchlist
# ---------------------------------------------------------------------------

def get_watchlist(user_id: str = "default") -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT ticker, added_at FROM watchlist WHERE user_id = ? ORDER BY added_at",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def add_to_watchlist(ticker: str, user_id: str = "default") -> dict:
    """Add ticker to watchlist. Raises ValueError if already exists."""
    with get_db() as conn:
        existing = conn.execute(
            "SELECT ticker FROM watchlist WHERE user_id = ? AND ticker = ?",
            (user_id, ticker),
        ).fetchone()
        if existing:
            raise ValueError(f"Ticker {ticker} already in watchlist")
        conn.execute(
            "INSERT INTO watchlist (user_id, ticker) VALUES (?, ?)",
            (user_id, ticker),
        )
        row = conn.execute(
            "SELECT ticker, added_at FROM watchlist WHERE user_id = ? AND ticker = ?",
            (user_id, ticker),
        ).fetchone()
        return dict(row)


def remove_from_watchlist(ticker: str, user_id: str = "default") -> None:
    """Remove ticker from watchlist. Raises KeyError if not found."""
    with get_db() as conn:
        existing = conn.execute(
            "SELECT ticker FROM watchlist WHERE user_id = ? AND ticker = ?",
            (user_id, ticker),
        ).fetchone()
        if not existing:
            raise KeyError(f"Ticker {ticker} not in watchlist")
        conn.execute(
            "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?",
            (user_id, ticker),
        )


# ---------------------------------------------------------------------------
# Portfolio — profile
# ---------------------------------------------------------------------------

def get_profile(user_id: str = "default") -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, cash_balance, created_at FROM users_profile WHERE id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            raise KeyError(f"User profile not found: {user_id}")
        return dict(row)


def deduct_cash(amount: float, user_id: str = "default") -> float:
    """Deduct amount from cash balance. Raises ValueError if insufficient funds."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (user_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"User profile not found: {user_id}")
        balance = row["cash_balance"]
        if balance < amount:
            raise ValueError(
                f"Insufficient cash. Need ${amount:.2f}, have ${balance:.2f}"
            )
        new_balance = round(balance - amount, 10)
        conn.execute(
            "UPDATE users_profile SET cash_balance = ? WHERE id = ?",
            (new_balance, user_id),
        )
        return new_balance


def add_cash(amount: float, user_id: str = "default") -> float:
    """Add amount to cash balance. Returns new balance."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (user_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"User profile not found: {user_id}")
        new_balance = round(row["cash_balance"] + amount, 10)
        conn.execute(
            "UPDATE users_profile SET cash_balance = ? WHERE id = ?",
            (new_balance, user_id),
        )
        return new_balance


# ---------------------------------------------------------------------------
# Portfolio — positions
# ---------------------------------------------------------------------------

def get_positions(user_id: str = "default") -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT ticker, quantity, avg_cost, updated_at FROM positions WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_position(ticker: str, user_id: str = "default") -> dict | None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT ticker, quantity, avg_cost, updated_at FROM positions WHERE user_id = ? AND ticker = ?",
            (user_id, ticker),
        ).fetchone()
        return dict(row) if row else None


def update_position(
    ticker: str, quantity: float, avg_cost: float, user_id: str = "default"
) -> None:
    """Insert or update a position row."""
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO positions (user_id, ticker, quantity, avg_cost, updated_at)
            VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            ON CONFLICT(user_id, ticker) DO UPDATE SET
                quantity   = excluded.quantity,
                avg_cost   = excluded.avg_cost,
                updated_at = excluded.updated_at
            """,
            (user_id, ticker, quantity, avg_cost),
        )


def remove_position(ticker: str, user_id: str = "default") -> None:
    """Delete the position row (called when quantity reaches 0)."""
    with get_db() as conn:
        conn.execute(
            "DELETE FROM positions WHERE user_id = ? AND ticker = ?",
            (user_id, ticker),
        )


# ---------------------------------------------------------------------------
# Trades
# ---------------------------------------------------------------------------

def record_trade(
    ticker: str,
    side: str,
    quantity: float,
    price: float,
    user_id: str = "default",
) -> dict:
    """Record a trade and return the trade dict."""
    with get_db() as conn:
        conn.execute(
            "INSERT INTO trades (user_id, ticker, side, quantity, price) VALUES (?, ?, ?, ?, ?)",
            (user_id, ticker, side, quantity, price),
        )
        row = conn.execute(
            "SELECT id, ticker, side, quantity, price, executed_at FROM trades WHERE user_id = ? ORDER BY executed_at DESC LIMIT 1",
            (user_id,),
        ).fetchone()
        return dict(row)


# ---------------------------------------------------------------------------
# Portfolio snapshots
# ---------------------------------------------------------------------------

def add_snapshot(total_value: float, user_id: str = "default") -> None:
    with get_db() as conn:
        conn.execute(
            "INSERT INTO portfolio_snapshots (user_id, total_value) VALUES (?, ?)",
            (user_id, total_value),
        )


def get_snapshots(user_id: str = "default", limit: int = 500) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT total_value, recorded_at FROM portfolio_snapshots WHERE user_id = ? ORDER BY recorded_at LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

def get_chat_history(user_id: str = "default", limit: int = 20) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, role, content, actions, created_at
            FROM (
                SELECT id, role, content, actions, created_at, rowid
                FROM chat_messages
                WHERE user_id = ?
                ORDER BY rowid DESC
                LIMIT ?
            )
            ORDER BY rowid ASC
            """,
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def save_chat_message(
    role: str,
    content: str,
    actions: str | None = None,
    user_id: str = "default",
) -> dict:
    """Save a chat message and return the saved dict."""
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO chat_messages (user_id, role, content, actions) VALUES (?, ?, ?, ?)",
            (user_id, role, content, actions),
        )
        row = conn.execute(
            "SELECT id, role, content, actions, created_at FROM chat_messages WHERE rowid = ?",
            (cur.lastrowid,),
        ).fetchone()
        return dict(row)
