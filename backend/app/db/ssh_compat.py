"""
Compatibility shim for sshtunnel==0.4.0 (the latest release, pinned in
requirements.txt) against modern paramiko.

sshtunnel's SSHTunnelForwarder unconditionally builds a lookup dict of key
classes at init time — including paramiko.DSSKey (DSA keys). paramiko 3.0
(released 2023) removed DSSKey entirely, since DSA is deprecated/insecure —
so ANY SSH tunnel attempt raises AttributeError on import, even if you're
authenticating with an RSA/Ed25519 key or a plain password and never touch
DSA at all. There's no newer sshtunnel release that fixes this.

Call ensure_paramiko_compat() before importing SSHTunnelForwarder anywhere
in this codebase. It's a no-op if paramiko already has DSSKey (older
versions), and otherwise adds a harmless alias so sshtunnel's dict-building
succeeds — nothing actually exercises DSA support unless someone explicitly
configures a DSA key, which is exceedingly rare today.
"""


def ensure_paramiko_compat() -> None:
    import paramiko
    if not hasattr(paramiko, "DSSKey"):
        paramiko.DSSKey = paramiko.RSAKey  # alias only — never actually used for real DSA auth
