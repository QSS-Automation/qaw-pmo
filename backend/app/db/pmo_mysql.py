"""
PMO MySQL connection — raw_pmo database (read + write).

Separate from the CRM connection (raw_CRM / curated_deals).
Handles plan_* and actual_* tables for the Projects section.

Uses the same SSH tunnel settings as the CRM connection.
Add to .env:
    PMO_MYSQL_HOST=your_mysql_host_or_ip
    PMO_MYSQL_PORT=3306
    PMO_MYSQL_USER=your_username
    PMO_MYSQL_PASSWORD=your_password
    PMO_MYSQL_DATABASE=raw_pmo
"""

import pymysql
import pymysql.cursors
from contextlib import contextmanager
from typing import Optional, List
from app.config import settings


def _pmo_configured() -> bool:
    return all([
        getattr(settings, 'PMO_MYSQL_HOST', ''),
        getattr(settings, 'PMO_MYSQL_USER', ''),
        getattr(settings, 'PMO_MYSQL_PASSWORD', ''),
        getattr(settings, 'PMO_MYSQL_DATABASE', ''),
    ])


def _ssh_configured() -> bool:
    return bool(getattr(settings, 'SSH_HOST', '') and getattr(settings, 'SSH_USER', ''))


@contextmanager
def _get_connection():
    """Open a pymysql connection to raw_pmo, via SSH tunnel if configured."""
    host = getattr(settings, 'PMO_MYSQL_HOST', '')
    port = int(getattr(settings, 'PMO_MYSQL_PORT', 3306))
    user = getattr(settings, 'PMO_MYSQL_USER', '')
    pwd  = getattr(settings, 'PMO_MYSQL_PASSWORD', '')
    db   = getattr(settings, 'PMO_MYSQL_DATABASE', 'raw_pmo')

    if _ssh_configured():
        from app.db.ssh_compat import ensure_paramiko_compat
        ensure_paramiko_compat()
        from sshtunnel import SSHTunnelForwarder
        ssh_kwargs = dict(
            ssh_address_or_host=(settings.SSH_HOST, settings.SSH_PORT),
            ssh_username=settings.SSH_USER,
            remote_bind_address=(host, port),
        )
        if getattr(settings, 'SSH_PASSWORD', ''):
            ssh_kwargs['ssh_password'] = settings.SSH_PASSWORD
        elif getattr(settings, 'SSH_KEY_FILE', ''):
            ssh_kwargs['ssh_pkey'] = settings.SSH_KEY_FILE

        tunnel = SSHTunnelForwarder(**ssh_kwargs)
        tunnel.start()
        try:
            conn = pymysql.connect(
                host='127.0.0.1', port=tunnel.local_bind_port,
                user=user, password=pwd, database=db,
                cursorclass=pymysql.cursors.DictCursor,
                connect_timeout=10, read_timeout=30, charset='utf8mb4',
            )
            try:
                yield conn
            finally:
                conn.close()
        finally:
            tunnel.stop()
    else:
        conn = pymysql.connect(
            host=host, port=port, user=user, password=pwd, database=db,
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=10, read_timeout=30, charset='utf8mb4',
        )
        try:
            yield conn
        finally:
            conn.close()


def pmo_query(sql: str, params: tuple = ()) -> List[dict]:
    with _get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


def pmo_execute(sql: str, params: tuple = ()) -> int:
    with _get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            affected = cur.rowcount
        conn.commit()
    return affected


def pmo_executemany(sql: str, rows: list) -> int:
    if not rows:
        return 0
    with _get_connection() as conn:
        with conn.cursor() as cur:
            cur.executemany(sql, rows)
            affected = cur.rowcount
        conn.commit()
    return affected


def safe_date(v) -> Optional[str]:
    """Convert any date-like value to YYYY-MM-DD string or None."""
    if not v:
        return None
    s = str(v).strip()
    return s[:10] if s not in ('', 'None', 'null') else None
