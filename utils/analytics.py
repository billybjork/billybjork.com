from __future__ import annotations

import hashlib
import os
import re
import sqlite3
from datetime import date

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "analytics.db")

BOT_PATTERN = re.compile(
    r"bot|crawl|spider|slurp|bingpreview|mediapartners-google|googlebot"
    r"|baiduspider|yandex|duckduck|facebookexternalhit|twitterbot"
    r"|linkedinbot|embedly|quora link preview|showyoubot|outbrain"
    r"|pinterest|applebot|semrush|ahrefs|mj12bot|dotbot|petalbot"
    r"|bytespider|gptbot|claudebot|anthropic|curl|wget|python-requests"
    r"|httpx|go-http-client|java/|libwww|scrapy|nutch|archive\.org_bot",
    re.IGNORECASE,
)


def _get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=3000")
    return conn


def init_db() -> None:
    """Create data directory, tables, and indexes. Idempotent."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = _get_connection()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS page_views (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                project_slug  TEXT NOT NULL,
                visitor_hash  TEXT NOT NULL,
                timestamp     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now')),
                user_agent    TEXT,
                referrer      TEXT,
                is_bot        INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_pv_slug ON page_views(project_slug);
            CREATE INDEX IF NOT EXISTS idx_pv_slug_visitor ON page_views(project_slug, visitor_hash);
            CREATE INDEX IF NOT EXISTS idx_pv_timestamp ON page_views(timestamp);
            """
        )
    finally:
        conn.close()


def is_bot(user_agent: str | None) -> bool:
    if not user_agent:
        return True
    return bool(BOT_PATTERN.search(user_agent))


def hash_ip(ip: str) -> str:
    """SHA-256 hash of IP + daily salt, truncated to 16 chars."""
    daily_salt = f"pv-salt-{date.today().isoformat()}"
    raw = hashlib.sha256(f"{ip}{daily_salt}".encode()).hexdigest()
    return raw[:16]


def record_view(
    slug: str,
    ip: str,
    user_agent: str | None = None,
    referrer: str | None = None,
) -> None:
    visitor_hash = hash_ip(ip)
    bot = is_bot(user_agent)
    conn = _get_connection()
    try:
        conn.execute(
            """
            INSERT INTO page_views (project_slug, visitor_hash, user_agent, referrer, is_bot)
            VALUES (?, ?, ?, ?, ?)
            """,
            (slug, visitor_hash, user_agent, referrer, int(bot)),
        )
        conn.commit()
    finally:
        conn.close()


def get_project_stats(slug: str) -> dict:
    conn = _get_connection()
    try:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS total_views,
                COUNT(DISTINCT visitor_hash) AS unique_visitors
            FROM page_views
            WHERE project_slug = ? AND is_bot = 0
            """,
            (slug,),
        ).fetchone()
        return {"total_views": row[0], "unique_visitors": row[1]}
    finally:
        conn.close()
