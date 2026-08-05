"""
Salesforce service — supports mock, JWT Bearer, and Client Credentials auth.

Auth method is selected by SF_AUTH_METHOD in .env:
  mock               — use local MOCK_DEALS (default, no SF credentials needed)
  jwt                — OAuth2 JWT Bearer flow (recommended for SSO environments)
  client_credentials — OAuth2 Client Credentials flow (simpler setup)

JWT Bearer setup:
  1. Generate RSA key pair:
       openssl genrsa -out sf_private.key 2048
       openssl req -new -x509 -key sf_private.key -out sf_cert.pem -days 1825
  2. Salesforce Setup → App Manager → your Connected App:
       - Enable "Use digital signatures" → upload sf_cert.pem
       - Add OAuth scopes: api, refresh_token
       - Under "Manage" → "Edit Policies" → set Permitted Users = "Admin approved users are pre-authorized"
       - Add your SF user to the Connected App's profiles/permission sets
  3. .env:
       SF_AUTH_METHOD=jwt
       SF_CLIENT_ID=<Consumer Key from Connected App>
       SF_USERNAME=your@email.com
       SF_PRIVATE_KEY_FILE=./sf_private.key
       SF_INSTANCE_URL=https://yourorg.my.salesforce.com

Client Credentials setup:
  1. Salesforce Setup → App Manager → your Connected App:
       - Enable "Enable Client Credentials Flow"
       - Set "Run As" to a SF user the app operates as
       - Add OAuth scope: api
  2. .env:
       SF_AUTH_METHOD=client_credentials
       SF_CLIENT_ID=<Consumer Key>
       SF_CLIENT_SECRET=<Consumer Secret>
       SF_INSTANCE_URL=https://yourorg.my.salesforce.com
"""

import time
import httpx
from typing import List, Dict, Any, Optional
from datetime import date, timedelta
from app.config import settings

# ── QAW stage picklist ────────────────────────────────────────────────────────
STAGE_MAP = {
    "0E - Qualification Stage":              "0E - Qualification Stage",
    "1D - Qualified Condition":              "1D - Qualified Condition",
    "2C - Evaluation Condition":             "2C - Evaluation Condition",
    "3B - High Chance To Proceed Condition": "3B - High Chance To Proceed Condition",
    "Renewal":                               "Renewal",
    "4A - Almost Win":                       "4A - Almost Win",
    "Closed Won":                            "Closed Won",
    "Closed Lost":                           "Closed Lost",
    "KIV":                                   "KIV",
}

# ── Mock data ─────────────────────────────────────────────────────────────────
MOCK_DEALS: List[Dict[str, Any]] = [
    {
        "sf_opportunity_id": "SF-OPP-001",
        "name": "Bank Islam — Data Warehouse Implementation",
        "account_name": "Bank Islam Malaysia",
        "stage": "1D - Qualified Condition",
        "amount": 580000, "currency": "MYR",
        "close_date": (date.today() + timedelta(days=45)).isoformat(),
        "probability": 60, "product_type": "Professional Services",
        "description": "End-to-end data warehouse build using Talend + PowerBI.",
        "owner": "YT", "project_code": None, "po_number": None, "so_number": None,
        "expected_invoice_month": None, "expected_invoice_year": None,
        "pp_stage": None, "pp_status": None,
    },
    {
        "sf_opportunity_id": "SF-OPP-002",
        "name": "CIMB — RPA Automation Phase 2",
        "account_name": "CIMB Group",
        "stage": "3B - High Chance To Proceed Condition",
        "amount": 320000, "currency": "MYR",
        "close_date": (date.today() + timedelta(days=18)).isoformat(),
        "probability": 80, "product_type": "Professional Services",
        "description": "UiPath-based automation for back-office processes.",
        "owner": "Heng", "project_code": None, "po_number": None, "so_number": None,
        "expected_invoice_month": "Jul", "expected_invoice_year": "2026",
        "pp_stage": None, "pp_status": None,
    },
    {
        "sf_opportunity_id": "SF-OPP-003",
        "name": "Petronas — AI Analytics Platform",
        "account_name": "Petronas",
        "stage": "2C - Evaluation Condition",
        "amount": 1200000, "currency": "MYR",
        "close_date": (date.today() + timedelta(days=90)).isoformat(),
        "probability": 35, "product_type": "Professional Services",
        "description": "Snowflake-based AI/ML analytics platform for upstream operations.",
        "owner": "Marvin", "project_code": None, "po_number": None, "so_number": None,
        "expected_invoice_month": None, "expected_invoice_year": None,
        "pp_stage": None, "pp_status": None,
    },
    {
        "sf_opportunity_id": "SF-OPP-004",
        "name": "TNB — Power BI Dashboard Suite",
        "account_name": "Tenaga Nasional Berhad",
        "stage": "4A - Almost Win",
        "amount": 195000, "currency": "MYR",
        "close_date": (date.today() + timedelta(days=30)).isoformat(),
        "probability": 85, "product_type": "Professional Services",
        "description": "Executive KPI dashboards across 5 divisions.",
        "owner": "Loo", "project_code": None, "po_number": None, "so_number": None,
        "expected_invoice_month": "Jun", "expected_invoice_year": "2026",
        "pp_stage": None, "pp_status": None,
    },
    {
        "sf_opportunity_id": "SF-OPP-005",
        "name": "Sunway — Data Governance Framework",
        "account_name": "Sunway Group",
        "stage": "0E - Qualification Stage",
        "amount": 450000, "currency": "MYR",
        "close_date": (date.today() + timedelta(days=120)).isoformat(),
        "probability": 20, "product_type": "Professional Services",
        "description": "Enterprise data governance including cataloguing and lineage.",
        "owner": "YT", "project_code": None, "po_number": None, "so_number": None,
        "expected_invoice_month": None, "expected_invoice_year": None,
        "pp_stage": None, "pp_status": None,
    },
    {
        "sf_opportunity_id": "SF-OPP-006",
        "name": "Affin Bank — Talend Migration",
        "account_name": "Affin Bank",
        "stage": "Closed Won",
        "amount": 270000, "currency": "MYR",
        "close_date": date.today().isoformat(),
        "probability": 100, "product_type": "Professional Services",
        "description": "Migration from legacy ETL to Talend Cloud. 4-month engagement.",
        "owner": "William", "project_code": "QM-2026-042",
        "po_number": "PO-AFB-2026-001", "so_number": None,
        "expected_invoice_month": "May", "expected_invoice_year": "2026",
        "pp_stage": None, "pp_status": None,
    },
]


# ── JWT helpers ───────────────────────────────────────────────────────────────

def _build_jwt_assertion(client_id: str, username: str, audience: str, private_key_pem: str) -> str:
    """
    Build a signed JWT assertion for the Salesforce JWT Bearer flow.
    Uses PyJWT if available, falls back to a manual implementation.
    """
    try:
        import jwt as pyjwt
        payload = {
            "iss": client_id,
            "sub": username,
            "aud": audience,
            "exp": int(time.time()) + 300,  # 5 min expiry
        }
        return pyjwt.encode(payload, private_key_pem, algorithm="RS256")
    except ImportError:
        # Manual JWT without PyJWT dependency
        import base64, json
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        from cryptography.hazmat.backends import default_backend

        header  = base64.urlsafe_b64encode(json.dumps({"alg":"RS256","typ":"JWT"}).encode()).rstrip(b"=")
        payload_data = {
            "iss": client_id, "sub": username,
            "aud": audience, "exp": int(time.time()) + 300,
        }
        payload_b64 = base64.urlsafe_b64encode(json.dumps(payload_data).encode()).rstrip(b"=")
        signing_input = header + b"." + payload_b64

        key = serialization.load_pem_private_key(
            private_key_pem.encode() if isinstance(private_key_pem, str) else private_key_pem,
            password=None, backend=default_backend()
        )
        signature = key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
        sig_b64   = base64.urlsafe_b64encode(signature).rstrip(b"=")
        return (signing_input + b"." + sig_b64).decode()


# ── Service ───────────────────────────────────────────────────────────────────

class SalesforceService:
    """
    Wraps Salesforce REST API with support for three auth modes:
      mock               — returns local MOCK_DEALS, no network calls
      jwt                — OAuth2 JWT Bearer (RSA key pair, no password)
      client_credentials — OAuth2 Client Credentials (client_id + secret)

    Tokens are cached in-process and refreshed automatically on 401.
    """

    def __init__(self):
        self.mode:       str           = getattr(settings, "SF_AUTH_METHOD", "mock").lower()
        self._token:     Optional[str] = None
        self._base_url:  Optional[str] = None
        self._token_exp: float         = 0.0      # unix timestamp when token expires

        # Treat SALESFORCE_MOCK=true as an alias for mode=mock
        if getattr(settings, "SALESFORCE_MOCK", True) and self.mode not in ("jwt", "client_credentials"):
            self.mode = "mock"

    # ── Authentication ────────────────────────────────────────────────────────

    async def _authenticate(self) -> str:
        """Return a valid access token, refreshing if expired or missing."""
        if self._token and time.time() < self._token_exp - 60:
            return self._token

        if self.mode == "jwt":
            return await self._auth_jwt()
        elif self.mode == "client_credentials":
            return await self._auth_client_credentials()
        else:
            raise RuntimeError("SalesforceService._authenticate called in mock mode")

    async def _auth_jwt(self) -> str:
        """
        JWT Bearer flow — signs a JWT with our private key and exchanges it
        for a Salesforce access token.  No username/password on the wire.
        """
        # Load private key (PEM string or file path)
        private_key_pem: str = ""
        key_file = getattr(settings, "SF_PRIVATE_KEY_FILE", "")
        key_str  = getattr(settings, "SF_PRIVATE_KEY", "")

        if key_file:
            try:
                with open(key_file, "r") as f:
                    private_key_pem = f.read()
            except FileNotFoundError:
                raise RuntimeError(
                    f"SF_PRIVATE_KEY_FILE '{key_file}' not found. "
                    "Run: openssl genrsa -out sf_private.key 2048"
                )
        elif key_str:
            private_key_pem = key_str.replace("\\n", "\n")
        else:
            raise RuntimeError(
                "JWT auth requires SF_PRIVATE_KEY_FILE (path to .key file) "
                "or SF_PRIVATE_KEY (PEM string) in .env"
            )

        audience  = getattr(settings, "SF_INSTANCE_URL", "https://login.salesforce.com")
        login_url = audience.rstrip("/") + "/services/oauth2/token"

        assertion = _build_jwt_assertion(
            client_id    = settings.SF_CLIENT_ID,
            username     = settings.SF_USERNAME,
            audience     = audience,
            private_key_pem = private_key_pem,
        )

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                login_url,
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion":  assertion,
                },
                timeout=15,
            )

        if resp.status_code != 200:
            raise RuntimeError(
                f"Salesforce JWT auth failed ({resp.status_code}): {resp.text}\n\n"
                "Common causes:\n"
                "  • Connected App not approved for this user (Manage → Edit Policies → "
                "Permitted Users = 'Admin approved users are pre-authorized')\n"
                "  • Wrong SF_CLIENT_ID — check the Consumer Key in your Connected App\n"
                "  • Wrong SF_USERNAME — must match a user in the Connected App's profiles\n"
                "  • Certificate mismatch — re-upload sf_cert.pem to the Connected App"
            )

        data = resp.json()
        self._token     = data["access_token"]
        self._base_url  = data["instance_url"]
        self._token_exp = time.time() + 3600   # SF JWT tokens last ~1h
        return self._token

    async def _auth_client_credentials(self) -> str:
        """
        OAuth2 Client Credentials flow — exchanges client_id + client_secret
        for an access token.  No user interaction required.
        Requires the Connected App to have Client Credentials Flow enabled
        and a "Run As" user configured in Salesforce Setup.
        """
        instance_url = getattr(settings, "SF_INSTANCE_URL", "https://login.salesforce.com")
        token_url    = instance_url.rstrip("/") + "/services/oauth2/token"

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                token_url,
                data={
                    "grant_type":    "client_credentials",
                    "client_id":     settings.SF_CLIENT_ID,
                    "client_secret": settings.SF_CLIENT_SECRET,
                },
                timeout=15,
            )

        if resp.status_code != 200:
            raise RuntimeError(
                f"Salesforce client_credentials auth failed ({resp.status_code}): {resp.text}\n\n"
                "Common causes:\n"
                "  • 'Enable Client Credentials Flow' not checked in Connected App\n"
                "  • No 'Run As' user set — Salesforce Setup → Connected App → Manage → "
                "Client Credentials Flow → set Run As\n"
                "  • Wrong SF_CLIENT_ID / SF_CLIENT_SECRET\n"
                "  • API scope missing — add 'api' to Connected App OAuth scopes"
            )

        data = resp.json()
        self._token     = data["access_token"]
        self._base_url  = data.get("instance_url", instance_url)
        self._token_exp = time.time() + 7200   # client_cred tokens last ~2h
        return self._token

    # ── SOQL helper ───────────────────────────────────────────────────────────

    async def _soql(self, query: str) -> List[Dict]:
        """Execute a SOQL query and return the records list, auto-retrying on 401."""
        token    = await self._authenticate()
        base_url = self._base_url or getattr(settings, "SF_INSTANCE_URL", "")
        url      = base_url.rstrip("/") + "/services/data/v59.0/query"

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                url,
                params={"q": query},
                headers={"Authorization": f"Bearer {token}"},
                timeout=20,
            )

        if resp.status_code == 401:
            # Token expired — clear and retry once
            self._token     = None
            self._token_exp = 0.0
            return await self._soql(query)

        if resp.status_code != 200:
            raise RuntimeError(
                f"Salesforce SOQL query failed ({resp.status_code}): {resp.text}"
            )

        return resp.json().get("records", [])

    # ── Field mapping ─────────────────────────────────────────────────────────

    @staticmethod
    def _map(r: Dict) -> Dict[str, Any]:
        """Map a raw SF Opportunity record to our internal shape."""
        return {
            "sf_opportunity_id":      r["Id"],
            "name":                   r.get("Name", ""),
            "account_name":           (r.get("Account") or {}).get("Name", ""),
            "stage":                  STAGE_MAP.get(r.get("StageName", ""), r.get("StageName", "")),
            "amount":                 float(r.get("Amount") or 0),
            "currency":               r.get("CurrencyIsoCode", "MYR"),
            "close_date":             r.get("CloseDate", ""),
            "probability":            int(r.get("Probability") or 0),
            "product_type":           r.get("Product__c", "Professional Services"),
            "description":            r.get("Description"),
            "owner":                  (r.get("Owner") or {}).get("Name", ""),
            "project_code":           r.get("Project_Code__c"),
            "po_number":              r.get("Purchase_Order_Number__c"),
            "so_number":              r.get("SO_Number__c"),
            "expected_invoice_month": r.get("Expected_Invoice_Month__c"),
            "expected_invoice_year":  r.get("Expected_Invoice_Year__c"),
            "pp_stage":               r.get("PP_Stage__c"),
            "pp_status":              r.get("PP_Status__c"),
        }

    # ── SOQL queries ──────────────────────────────────────────────────────────

    _PS_FIELDS = """
        Id, Name, Account.Name, StageName, Amount, CurrencyIsoCode,
        CloseDate, Probability, Description, Product__c,
        Project_Code__c, Purchase_Order_Number__c, SO_Number__c,
        Expected_Invoice_Month__c, Expected_Invoice_Year__c,
        PP_Stage__c, PP_Status__c, Owner.Name
    """

    async def get_all_ps_deals(self) -> List[Dict[str, Any]]:
        """All open Professional Services opportunities (pipeline view)."""
        if self.mode == "mock":
            return [d for d in MOCK_DEALS if d["stage"] != "Closed Lost"]

        records = await self._soql(f"""
            SELECT {self._PS_FIELDS}
            FROM Opportunity
            WHERE Product__c = 'Professional Services'
              AND StageName NOT IN ('Closed Lost')
            ORDER BY CloseDate ASC
            LIMIT 200
        """)
        return [self._map(r) for r in records]

    async def get_closed_won_deals(self) -> List[Dict[str, Any]]:
        """Closed Won PS deals — backend filters out already-converted ones."""
        if self.mode == "mock":
            return [d for d in MOCK_DEALS if d["stage"] == "Closed Won"]

        records = await self._soql(f"""
            SELECT {self._PS_FIELDS}
            FROM Opportunity
            WHERE Product__c = 'Professional Services'
              AND StageName = 'Closed Won'
            ORDER BY CloseDate DESC
            LIMIT 100
        """)
        return [self._map(r) for r in records]

    async def get_deal_by_id(self, sf_id: str) -> Optional[Dict[str, Any]]:
        """Fetch a single opportunity by its Salesforce Id."""
        if self.mode == "mock":
            return next((d for d in MOCK_DEALS if d["sf_opportunity_id"] == sf_id), None)

        records = await self._soql(f"""
            SELECT {self._PS_FIELDS}
            FROM Opportunity
            WHERE Id = '{sf_id}'
            LIMIT 1
        """)
        return self._map(records[0]) if records else None

    async def sync_all(self) -> Dict[str, Any]:
        """Pull all PS deals from SF. Called by POST /api/integrations/salesforce/sync."""
        if self.mode == "mock":
            return {"upserted": len(MOCK_DEALS), "source": "mock"}

        open_deals   = await self.get_all_ps_deals()
        closed_won   = await self.get_closed_won_deals()
        seen, combined = set(), []
        for d in open_deals + closed_won:
            if d["sf_opportunity_id"] not in seen:
                seen.add(d["sf_opportunity_id"])
                combined.append(d)
        return {"upserted": len(combined), "records": combined, "source": self.mode}

    @property
    def is_mock(self) -> bool:
        return self.mode == "mock"

    @property
    def auth_method(self) -> str:
        return self.mode


salesforce_service = SalesforceService()
