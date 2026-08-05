"""
Autocount AR service — mock implementation.

To switch to real Autocount:
1. Set AUTOCOUNT_MOCK=false in .env
2. Set AUTOCOUNT_BASE_URL and AUTOCOUNT_API_KEY
3. Implement the real HTTP calls below using httpx.

Autocount exposes a REST API for AR invoices. The Finance team's invoices
are matched to projects via invoice reference numbers or customer names.
"""

from typing import List, Dict, Any
from app.config import settings


# Mock AR invoices that the Finance AR team has raised in Autocount
MOCK_AR_INVOICES: List[Dict[str, Any]] = [
    {
        "autocount_ref": "AR-2026-0341",
        "invoice_number": "INV-TM-001",
        "customer": "TM",
        "project_hint": "TM_Enterprise Data Enablement (EDE)",
        "invoice_date": "2026-02-01",
        "due_date": "2026-03-03",
        "amount": 800000.00,
        "currency": "MYR",
        "is_paid": True,
        "paid_date": "2026-02-28",
    },
    {
        "autocount_ref": "AR-2026-0342",
        "invoice_number": "INV-TM-002",
        "customer": "TM",
        "project_hint": "TM_Enterprise Data Enablement (EDE)",
        "invoice_date": "2026-03-15",
        "due_date": "2026-04-14",
        "amount": 1066667.00,
        "currency": "MYR",
        "is_paid": False,
        "paid_date": None,
    },
    {
        "autocount_ref": "AR-2026-0350",
        "invoice_number": "INV-SDP-001",
        "customer": "SDP",
        "project_hint": "SDP_Analytics Data Platform Migration",
        "invoice_date": "2026-01-20",
        "due_date": "2026-02-19",
        "amount": 182000.00,
        "currency": "MYR",
        "is_paid": True,
        "paid_date": "2026-02-15",
    },
    {
        "autocount_ref": "AR-2026-0365",
        "invoice_number": "INV-BURSA-001",
        "customer": "Bursa",
        "project_hint": "Bursa_Implementation of MDF Framework",
        "invoice_date": "2026-02-10",
        "due_date": "2026-03-11",
        "amount": 71392.00,
        "currency": "MYR",
        "is_paid": True,
        "paid_date": "2026-03-05",
    },
    {
        "autocount_ref": "AR-2026-0380",
        "invoice_number": "INV-MEA-001",
        "customer": "MEA",
        "project_hint": "MEA_LCNCDSS",
        "invoice_date": "2026-03-01",
        "due_date": "2026-03-31",
        "amount": 0,          # billing not yet triggered
        "currency": "MYR",
        "is_paid": False,
        "paid_date": None,
    },
    {
        "autocount_ref": "AR-2026-0391",
        "invoice_number": "INV-TIME-001",
        "customer": "TIME",
        "project_hint": "TIME_CSET Database Revamp",
        "invoice_date": "2026-02-20",
        "due_date": "2026-03-21",
        "amount": 192500.00,
        "currency": "MYR",
        "is_paid": True,
        "paid_date": "2026-03-18",
    },
    {
        "autocount_ref": "AR-2026-0402",
        "invoice_number": "INV-AKPK-001",
        "customer": "AKPK",
        "project_hint": "AKPK_Profiling System Enhancement",
        "invoice_date": "2026-03-10",
        "due_date": "2026-04-09",
        "amount": 170100.00,
        "currency": "MYR",
        "is_paid": False,
        "paid_date": None,
    },
]


class AutocountService:
    def __init__(self):
        self.mock = settings.AUTOCOUNT_MOCK

    async def get_ar_invoices(self) -> List[Dict[str, Any]]:
        """
        Fetch all AR invoices from Autocount.
        Real endpoint: GET /ar/invoices?status=all&limit=500
        """
        if self.mock:
            return MOCK_AR_INVOICES
        # Real:
        # async with httpx.AsyncClient() as client:
        #     resp = await client.get(
        #         f"{settings.AUTOCOUNT_BASE_URL}/ar/invoices",
        #         headers={"X-API-Key": settings.AUTOCOUNT_API_KEY},
        #         params={"status": "all", "limit": 500},
        #     )
        #     return self._map_autocount_records(resp.json()["data"])
        raise NotImplementedError("Set AUTOCOUNT_MOCK=true")

    async def get_invoices_for_customer(self, customer_name: str) -> List[Dict[str, Any]]:
        if self.mock:
            return [i for i in MOCK_AR_INVOICES if customer_name.lower() in i["customer"].lower()]
        raise NotImplementedError("Set AUTOCOUNT_MOCK=true")

    async def get_invoice_by_ref(self, ref: str) -> Dict[str, Any] | None:
        if self.mock:
            return next((i for i in MOCK_AR_INVOICES if i["autocount_ref"] == ref), None)
        raise NotImplementedError("Set AUTOCOUNT_MOCK=true")


autocount_service = AutocountService()
