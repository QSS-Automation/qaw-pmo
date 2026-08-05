from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    ENVIRONMENT: str = "development"

    DATABASE_URL: str = "sqlite:///./qaw_pm.db"

    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    SALESFORCE_MOCK: bool = True          # legacy flag — use SF_AUTH_METHOD instead
    SF_AUTH_METHOD: str = "mock"           # mock | jwt | client_credentials
    SF_CLIENT_ID: str = ""                 # Consumer Key from Connected App
    SF_CLIENT_SECRET: str = ""             # Consumer Secret (client_credentials only)
    SF_USERNAME: str = ""                  # SF user the app runs as (jwt only)
    SF_PRIVATE_KEY_FILE: str = ""          # path to .key file (jwt only)
    SF_PRIVATE_KEY: str = ""               # PEM string alternative to file (jwt only)
    SF_INSTANCE_URL: str = "https://login.salesforce.com"

    # ── PMO MySQL (raw_pmo — plan/actual project data, read+write) ──────────────
    PMO_MYSQL_HOST:     str = ""
    PMO_MYSQL_PORT:     int = 3306
    PMO_MYSQL_USER:     str = ""
    PMO_MYSQL_PASSWORD: str = ""
    PMO_MYSQL_DATABASE: str = "raw_pmo"

    # ── MySQL (CRM — read-only, Upcoming Projects feed) ──────────────────────
    MYSQL_HOST:     str = ""
    MYSQL_PORT:     int = 3306
    MYSQL_USER:     str = ""
    MYSQL_PASSWORD: str = ""
    MYSQL_DATABASE: str = ""        # e.g. curated_CRM

    # ── SSH tunnel (required if MySQL is behind a jump server) ────────────────
    # Leave SSH_HOST empty to connect to MySQL directly (no tunnel)
    SSH_HOST:       str = ""        # jump server IP or hostname
    SSH_PORT:       int = 22        # SSH port (almost always 22)
    SSH_USER:       str = ""        # SSH username
    SSH_PASSWORD:   str = ""        # SSH password (leave empty if using key)
    SSH_KEY_FILE:   str = ""        # path to private key file (optional)

    AUTOCOUNT_MOCK: bool = True
    AUTOCOUNT_BASE_URL: str = "https://api.autocount.com/v1"
    AUTOCOUNT_API_KEY: str = ""

    # ── SMTP (invitation emails) ────────────────────────────────────────────────
    # Leave SMTP_HOST empty to skip sending — invitations still get created,
    # Admin just falls back to copying the link manually, exactly like today.
    # Works with any standard SMTP provider: your company's mail server,
    # Gmail (smtp.gmail.com, port 587, an "app password" not your real one),
    # Outlook/Microsoft 365 (smtp.office365.com, port 587), or a transactional
    # service like SendGrid/Mailgun's SMTP relay — nothing here is
    # provider-specific.
    SMTP_HOST:      str = ""
    SMTP_PORT:      int = 587
    SMTP_USER:      str = ""
    SMTP_PASSWORD:  str = ""
    SMTP_FROM_EMAIL: str = ""
    SMTP_FROM_NAME:  str = "QAW PM Ecosystem"
    APP_BASE_URL:    str = "http://localhost:5173"   # used to build the invitation link in the email body

    SF_POLL_INTERVAL: int = 300
    AUTOCOUNT_POLL_INTERVAL: int = 600

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
