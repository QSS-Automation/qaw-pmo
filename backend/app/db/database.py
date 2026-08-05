from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.config import settings

# Kept alive for the app's entire lifetime if an SSH tunnel is opened below —
# letting this get garbage-collected would silently kill the tunnel underneath
# the connection pool.
_tunnel = None


def _mysql_configured() -> bool:
    return all([
        getattr(settings, 'PMO_MYSQL_HOST', ''),
        getattr(settings, 'PMO_MYSQL_USER', ''),
        getattr(settings, 'PMO_MYSQL_PASSWORD', ''),
        getattr(settings, 'PMO_MYSQL_DATABASE', ''),
    ])


def _ssh_configured() -> bool:
    return bool(getattr(settings, 'SSH_HOST', '') and getattr(settings, 'SSH_USER', ''))


def _build_engine():
    """
    This app's OWN tables (projects, resources, gantt_tasks, milestones, etc.)
    live inside raw_pmo — the SAME MySQL database the PMO plan/actual tables
    already use — whenever PMO_MYSQL_* is configured. Falls back to local
    SQLite (the original default) when it isn't, so local development
    without a live MySQL connection keeps working unchanged.

    Unlike the ad-hoc pmo_query()/pmo_execute() helpers in pmo_mysql.py — which
    open and close an SSH tunnel per call — a pooled SQLAlchemy engine needs a
    STABLE host:port for as long as the app runs. So if a tunnel is needed, it's
    opened ONCE here, kept alive in the module-level `_tunnel`, and the engine
    is pointed at the tunnel's local forwarded port instead of the real host.
    """
    global _tunnel

    if not _mysql_configured():
        return create_engine(
            settings.DATABASE_URL,
            connect_args={"check_same_thread": False},  # SQLite only
        )

    host = settings.PMO_MYSQL_HOST
    port = int(settings.PMO_MYSQL_PORT)

    if _ssh_configured():
        from app.db.ssh_compat import ensure_paramiko_compat
        ensure_paramiko_compat()
        from sshtunnel import SSHTunnelForwarder
        ssh_kwargs = dict(
            ssh_address_or_host=(settings.SSH_HOST, settings.SSH_PORT),
            ssh_username=settings.SSH_USER,
            remote_bind_address=(host, port),
            set_keepalive=15,   # SSH-level keepalive every 15s — most idle-timeout
                                 # disconnects (jump server or firewall/NAT closing
                                 # quiet connections) happen well under an hour, so
                                 # this matters more than any MySQL-side timeout
                                 # setting does for "dies after sitting idle" symptoms.
        )
        if getattr(settings, 'SSH_PASSWORD', ''):
            ssh_kwargs['ssh_password'] = settings.SSH_PASSWORD
        elif getattr(settings, 'SSH_KEY_FILE', ''):
            ssh_kwargs['ssh_pkey'] = settings.SSH_KEY_FILE
        _tunnel = SSHTunnelForwarder(**ssh_kwargs)
        _tunnel.start()
        host, port = '127.0.0.1', _tunnel.local_bind_port

    url = (
        f"mysql+pymysql://{settings.PMO_MYSQL_USER}:{settings.PMO_MYSQL_PASSWORD}"
        f"@{host}:{port}/{settings.PMO_MYSQL_DATABASE}?charset=utf8mb4"
    )
    new_engine = create_engine(
        url,
        pool_pre_ping=True,   # verify a pooled connection is still alive before using it —
                              # catches a MySQL-side timeout (server closed an idle
                              # session) as long as the tunnel underneath is still up.
        pool_recycle=3600,    # recycle connections hourly, ahead of MySQL's own wait_timeout
    )

    if _tunnel is not None:
        # pool_pre_ping only catches a dead MySQL SESSION — it has no idea how to
        # fix a dead TUNNEL, since from its point of view that's just "the local
        # port refused the connection", not something reconnecting the MySQL
        # session helps with. This runs right before every new DBAPI connection
        # attempt and transparently restarts the tunnel first if it's gone down,
        # so a tunnel-level idle disconnect self-heals the same way pool_pre_ping
        # already makes a MySQL-level one self-heal.
        @event.listens_for(new_engine, "do_connect")
        def _ensure_tunnel_alive(dialect, conn_rec, cargs, cparams):
            if not _tunnel.is_active:
                print("[db] SSH tunnel was down — restarting it before reconnecting to MySQL")
                _tunnel.restart()

    return new_engine


engine = _build_engine()

# Enable foreign keys for SQLite only — this pragma doesn't exist in MySQL,
# and the event simply never fires for a non-sqlite engine, so it's harmless
# to register unconditionally, but gating it is clearer about intent.
if engine.dialect.name == "sqlite":
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
