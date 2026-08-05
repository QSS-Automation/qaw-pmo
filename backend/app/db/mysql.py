"""
MySQL connection module — read-only for SELECTs, write for is_converted flag only.

Supports direct and SSH tunnel connections.
"""

import pymysql
import pymysql.cursors
from contextlib import contextmanager
from typing import Optional, Tuple, List
from app.config import settings


def _ssh_configured() -> bool:
    return bool(settings.SSH_HOST and settings.SSH_USER)


def _mysql_configured() -> bool:
    return all([
        settings.MYSQL_HOST,
        settings.MYSQL_USER,
        settings.MYSQL_PASSWORD,
        settings.MYSQL_DATABASE,
    ])


def is_configured() -> bool:
    return _mysql_configured()


@contextmanager
def _get_connection():
    """Yields an open pymysql connection, handling SSH tunnel if configured."""
    if _ssh_configured():
        from app.db.ssh_compat import ensure_paramiko_compat
        ensure_paramiko_compat()
        from sshtunnel import SSHTunnelForwarder
        ssh_kwargs = dict(
            ssh_address_or_host = (settings.SSH_HOST, settings.SSH_PORT),
            ssh_username        = settings.SSH_USER,
            remote_bind_address = (settings.MYSQL_HOST, settings.MYSQL_PORT),
        )
        if settings.SSH_PASSWORD:
            ssh_kwargs["ssh_password"] = settings.SSH_PASSWORD
        elif settings.SSH_KEY_FILE:
            ssh_kwargs["ssh_pkey"] = settings.SSH_KEY_FILE
        else:
            raise RuntimeError("SSH tunnel requires SSH_PASSWORD or SSH_KEY_FILE in .env")

        tunnel = SSHTunnelForwarder(**ssh_kwargs)
        tunnel.start()
        try:
            conn = pymysql.connect(
                host="127.0.0.1", port=tunnel.local_bind_port,
                user=settings.MYSQL_USER, password=settings.MYSQL_PASSWORD,
                database=settings.MYSQL_DATABASE,
                cursorclass=pymysql.cursors.DictCursor,
                connect_timeout=10, read_timeout=30, charset="utf8mb4",
            )
            try:
                yield conn
            finally:
                conn.close()
        finally:
            tunnel.stop()
    else:
        conn = pymysql.connect(
            host=settings.MYSQL_HOST, port=settings.MYSQL_PORT,
            user=settings.MYSQL_USER, password=settings.MYSQL_PASSWORD,
            database=settings.MYSQL_DATABASE,
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=10, read_timeout=30, charset="utf8mb4",
        )
        try:
            yield conn
        finally:
            conn.close()


def query(sql: str, params: Optional[tuple] = None) -> List[dict]:
    """Execute a SELECT and return all rows as dicts."""
    with _get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            return cur.fetchall()


def query_one(sql: str, params: Optional[tuple] = None) -> Optional[dict]:
    """Execute a SELECT and return the first row, or None."""
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: Optional[tuple] = None) -> int:
    """Execute an UPDATE/INSERT/DELETE. Returns rows affected."""
    with _get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            affected = cur.rowcount
        conn.commit()
    return affected


def column_exists(table: str, column: str) -> bool:
    """Check whether a column exists in a table."""
    try:
        rows = query(
            "SELECT COUNT(*) AS cnt FROM information_schema.columns "
            "WHERE table_schema = %s AND table_name = %s AND column_name = %s",
            (settings.MYSQL_DATABASE, table, column)
        )
        return (rows[0]["cnt"] if rows else 0) > 0
    except Exception:
        return False


def test_connection() -> Tuple[bool, str]:
    """Test the connection and return (ok, message)."""
    if not _mysql_configured():
        return False, (
            "MySQL credentials not set. Add MYSQL_HOST, MYSQL_USER, "
            "MYSQL_PASSWORD, MYSQL_DATABASE to your .env file."
        )
    tunnel_info = f" via SSH tunnel ({settings.SSH_HOST})" if _ssh_configured() else ""
    try:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT DATABASE() AS db, VERSION() AS ver")
                row = cur.fetchone()
        return True, f"Connected to {row['db']} (MySQL {row['ver']}){tunnel_info}"
    except Exception as e:
        err = str(e)
        if _ssh_configured():
            if "Authentication failed" in err or "No authentication methods" in err:
                return False, f"SSH authentication failed for {settings.SSH_USER}@{settings.SSH_HOST} — check SSH_USER and SSH_PASSWORD"
            if "Connection refused" in err or "timed out" in err.lower():
                return False, f"Cannot reach SSH server at {settings.SSH_HOST}:{settings.SSH_PORT}"
        if isinstance(e, pymysql.OperationalError):
            code = e.args[0]
            return False, {
                1045: f"Wrong MySQL username or password for user '{settings.MYSQL_USER}'",
                1049: f"Database '{settings.MYSQL_DATABASE}' does not exist",
                2003: f"Cannot reach MySQL at {settings.MYSQL_HOST}:{settings.MYSQL_PORT}{tunnel_info}",
                2013: "MySQL connection timed out",
            }.get(code, f"MySQL error {code}: {e.args[1]}")
        return False, f"Connection error: {err}"
