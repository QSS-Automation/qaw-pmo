"""
PMO API — raw_pmo database.

Exact schema (from COLUMNS_202607030918.csv):
  plan_project:    project_name, project_code, customer, entity, project_type,
                   technology, currency, contract_value, project_budget, license_cost,
                   revenue_deduction, account_manager, start_date, target_end_date,
                   submit_date
  plan_resource:   project_name, project_code, staff_name, project_cost, submit_date,
                   role, distribution, year, month          ← only table with year/month
  plan_milestone:  project_code, milestone_name, milestone_amount, percentage,
                   expected_close_date, actual_close_date, status, invoice_no,
                   invoice_date, submit_date
  actual_project:  same as plan_project + rag_status
  actual_resource: project_name, project_code, staff_name, project_cost, submit_date,
                   role, distribution                       ← NO year/month
  actual_milestone: same as plan_milestone
"""

import calendar
from datetime import date, datetime
import json
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.auth import (
    get_current_resource, require_plan_actual_access_by_code, require_plan_actual_view_access_by_code,
    is_management, can_view_plan_actual, can_edit_plan_actual,
)
from app.models import Resource, Project, ActualDraft, PlanDraft

pmo_router = APIRouter(prefix='/api/pmo', tags=['PMO'])


# ── Pydantic models ───────────────────────────────────────────────────────────

class PmoResource(BaseModel):
    staff_name:     str
    role:           Optional[str] = None
    monthly_salary: float = 0       # raw salary — used to compute project_cost
    distribution:   float = 100     # allocation %

    def computed_cost(self) -> float:
        return round(self.monthly_salary * self.distribution / 100, 2)


class PmoProjectBase(BaseModel):
    project_name:      str
    customer:          Optional[str] = None
    entity:            Optional[str] = None
    project_type:      Optional[str] = None
    technology:        Optional[str] = None
    currency:          str = 'MYR'
    contract_value:    float = 0
    project_budget:    float = 0
    license_cost:      float = 0
    revenue_deduction: float = 0
    account_manager:   Optional[str] = None
    start_date:        Optional[str] = None
    target_end_date:   Optional[str] = None


class PmoMiscCost(BaseModel):
    category:      str                    # Outsourced Professional Services | Training | Logistics | Others
    custom_detail: Optional[str] = None   # free text, meaningful only when category == "Others"
    amount:        float = 0


class PlanSubmitBody(BaseModel):
    project:    PmoProjectBase
    resources:  List[PmoResource] = []
    misc_costs: List[PmoMiscCost] = []
    year:       int
    month:      int


class ActualPushBody(BaseModel):
    project:    PmoProjectBase
    resources:  List[PmoResource] = []
    misc_costs: List[PmoMiscCost] = []
    rag_status: Optional[str] = None
    year:       int
    month:      int


# ── Validation helper ──────────────────────────────────────────────────────────

def _validate_resources(resources: list, db_session=None, exclude_project_code: str = None):
    """
    Server-side hard validation — cannot be bypassed by frontend.
    Raises HTTPException(400) if:
      1. Duplicate staff_name in resources

    A resource's TOTAL allocation across every project is intentionally no
    longer capped at 100% here — over-allocation is now allowed (a single
    field is still clamped to 0-100 in the UI, but the accumulated total
    across projects is not blocked). Instead, an over-100% accumulated total
    is surfaced as a highlighted warning in the Resources master list —
    see get_resource_allocation_summary.

    exclude_project_code: kept for call-site compatibility; no longer used
    now that there's no capacity check here to exclude this project from.
    """
    # 1. Duplicate resource names
    names = [r.staff_name for r in resources if r.staff_name]
    if len(names) != len(set(names)):
        raise HTTPException(status_code=400, detail='Duplicate resources detected. Each resource can only be assigned once.')


# ── Helpers ───────────────────────────────────────────────────────────────────

def _pmo():
    from app.db.pmo_mysql import (pmo_query, pmo_execute, pmo_executemany,
                                   safe_date, _pmo_configured)
    if not _pmo_configured():
        raise HTTPException(
            status_code=503,
            detail='PMO database not configured. Add PMO_MYSQL_* to .env'
        )
    return pmo_query, pmo_execute, pmo_executemany, safe_date


MISC_COST_CATEGORIES = ['Outsourced Professional Services', 'Training', 'Logistics']


def _misc_cost_rows_to_frontend_shape(rows: list) -> list:
    """
    plan_misc_cost/actual_misc_cost store a single cost_name column (the
    category itself, or the free-text detail when category is "Others") —
    that's the reverse of submit_plan/push_actual's own write-side logic
    (mc.custom_detail if category=="Others" else mc.category). get_plan/
    get_actual were returning these raw rows unconverted, which meant
    anything that read a submitted month back into an editable form (Save
    on an older month, or the new Plan<->Actual draft-seeding chain) ended
    up carrying {cost_name: ...} forward instead of {category, custom_detail}
    — missing the required `category` field entirely and failing validation
    the moment that data was ever sent back to the server.
    """
    out = []
    for r in rows:
        cost_name = r.get('cost_name') or ''
        if cost_name in MISC_COST_CATEGORIES:
            category, custom_detail = cost_name, None
        else:
            category, custom_detail = 'Others', cost_name
        out.append({**r, 'category': category, 'custom_detail': custom_detail})
    return out


def _today() -> str:
    return date.today().isoformat()


def _is_last_day_of_month(year: int, month: int) -> bool:
    """True only if today is genuinely the last calendar day of the given
    year/month — used to gate final Submit, separate from Save Draft, which
    stays available any time during the month."""
    today = date.today()
    if today.year != year or today.month != month:
        return False
    last_day = calendar.monthrange(year, month)[1]
    return today.day == last_day


# ── GET /plan ─────────────────────────────────────────────────────────────────

@pmo_router.get('/{project_code}/plan')
def get_plan(
    project_code: str, year: Optional[int] = None, month: Optional[int] = None,
    db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    """Return plan records. Resources filtered by year/month; project + milestones latest only."""
    require_plan_actual_view_access_by_code(current_resource, project_code, db)
    pmo_query, *_ = _pmo()
    now = date.today()
    y = year or now.year
    m = month or now.month

    # plan_project — filter by year/month; fallback to latest (covers rows with NULL year/month)
    project_row = pmo_query(
        'SELECT * FROM plan_project '
        'WHERE project_code = %s AND (year = %s AND month = %s OR year IS NULL) '
        'ORDER BY CASE WHEN year = %s AND month = %s THEN 0 ELSE 1 END, submit_date DESC '
        'LIMIT 1',
        (project_code, y, m, y, m)
    )

    # plan_resource — filter by year/month; fallback to the single most recent
    # month that HAS data, not a mix of every historical month's rows (that
    # mixing is what caused staff members to appear duplicated).
    resources = pmo_query(
        'SELECT * FROM plan_resource WHERE project_code = %s AND year = %s AND month = %s',
        (project_code, y, m)
    )
    if not resources:
        latest = pmo_query(
            'SELECT year, month FROM plan_resource WHERE project_code = %s '
            'ORDER BY submit_date DESC LIMIT 1',
            (project_code,)
        )
        if latest:
            resources = pmo_query(
                'SELECT * FROM plan_resource WHERE project_code = %s AND year = %s AND month = %s',
                (project_code, latest[0]['year'], latest[0]['month'])
            )

    # A project's own PM can now view Plan & Actual (added on request) but
    # never see cost — only Name/Role/Allocation% stay visible for them.
    if not is_management(current_resource):
        for r in resources:
            r.pop('project_cost', None)

    # plan_misc_cost — no year/month (matches confirmed actual_misc_cost schema);
    # returns the latest full itemized set for this project.
    misc_costs = _misc_cost_rows_to_frontend_shape(pmo_query(
        'SELECT * FROM plan_misc_cost WHERE project_code = %s ORDER BY submit_date DESC',
        (project_code,)
    ))
    return {
        'project':    project_row[0] if project_row else None,
        'resources':  resources,
        'misc_costs': misc_costs,
        'year': y, 'month': m,
    }


# ── GET /actual ───────────────────────────────────────────────────────────────

@pmo_router.get('/{project_code}/actual')
def get_actual(
    project_code: str, year: int, month: int,
    db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    """Return actual records for a specific year/month. actual_resource now retains full history."""
    require_plan_actual_view_access_by_code(current_resource, project_code, db)
    pmo_query, *_ = _pmo()

    project = pmo_query(
        'SELECT * FROM actual_project WHERE project_code = %s ORDER BY submit_date DESC LIMIT 1',
        (project_code,)
    )
    # actual_resource now has year/month — filter to the requested month;
    # fall back to the single most recent month that HAS data, not a mix of
    # every historical month's rows (that mixing caused duplicated staff entries).
    resources = pmo_query(
        'SELECT * FROM actual_resource WHERE project_code = %s AND year = %s AND month = %s',
        (project_code, year, month)
    )
    if not resources:
        latest = pmo_query(
            'SELECT year, month FROM actual_resource WHERE project_code = %s '
            'ORDER BY submit_date DESC LIMIT 1',
            (project_code,)
        )
        if latest:
            resources = pmo_query(
                'SELECT * FROM actual_resource WHERE project_code = %s AND year = %s AND month = %s',
                (project_code, latest[0]['year'], latest[0]['month'])
            )

    # A project's own PM can now view Plan & Actual (added on request) but
    # never see cost — only Name/Role/Allocation% stay visible for them.
    if not is_management(current_resource):
        for r in resources:
            r.pop('project_cost', None)

    misc_costs = _misc_cost_rows_to_frontend_shape(pmo_query(
        'SELECT * FROM actual_misc_cost WHERE project_code = %s ORDER BY submit_date DESC',
        (project_code,)
    ))
    # Budget utilized = sum of ALL actual resource costs across every month (cumulative)
    util = pmo_query(
        'SELECT SUM(project_cost) as total FROM actual_resource WHERE project_code = %s',
        (project_code,)
    )
    budget_utilized = float(util[0]['total'] or 0) if util else 0

    return {
        'project':         project[0] if project else None,
        'resources':       resources,
        'misc_costs':      misc_costs,
        'budget_utilized': budget_utilized,
        'year': year, 'month': month,
    }


# ── GET /history ──────────────────────────────────────────────────────────────

@pmo_router.get('/{project_code}/history')
def get_history(
    project_code: str, db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    """List submitted plan months (from plan_resource year/month) and total utilization."""
    require_plan_actual_view_access_by_code(current_resource, project_code, db)
    pmo_query, *_ = _pmo()

    # plan months — derive from plan_resource (the only table with year/month)
    plan_months = pmo_query(
        'SELECT DISTINCT year, month FROM plan_resource '
        'WHERE project_code = %s ORDER BY year, month',
        (project_code,)
    )
    # actual months — now genuinely historical since actual_resource retains
    # every month's submission instead of being overwritten each time.
    # total_cost per month is what powers the month-to-month comparison view.
    actual_months = pmo_query(
        'SELECT year, month, SUM(project_cost) as total_cost FROM actual_resource '
        'WHERE project_code = %s GROUP BY year, month ORDER BY year, month',
        (project_code,)
    )
    util = pmo_query(
        'SELECT SUM(project_cost) as total FROM actual_resource WHERE project_code = %s',
        (project_code,)
    )
    total_utilized = float(util[0]['total'] or 0) if util else 0

    return {
        'plan_months':    [{'year': r['year'], 'month': r['month']} for r in plan_months],
        'actual_months':  [{'year': r['year'], 'month': r['month'], 'total_cost': float(r['total_cost'] or 0)} for r in actual_months],
        'total_utilized': total_utilized,
    }


# ── GET /submitted-months ─────────────────────────────────────────────────────

@pmo_router.get('/{project_code}/submitted-months')
def get_submitted_months(
    project_code: str, db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    """Which year/month combinations have plan_resource data."""
    require_plan_actual_view_access_by_code(current_resource, project_code, db)
    pmo_query, *_ = _pmo()
    rows = pmo_query(
        'SELECT DISTINCT year, month FROM plan_resource '
        'WHERE project_code = %s AND year IS NOT NULL '
        'UNION '
        'SELECT DISTINCT year, month FROM plan_project '
        'WHERE project_code = %s AND year IS NOT NULL '
        'ORDER BY year, month',
        (project_code, project_code)
    )
    return [{'year': r['year'], 'month': r['month']} for r in rows]


# ── POST /plan/submit ─────────────────────────────────────────────────────────

@pmo_router.post('/{project_code}/plan/submit')
def submit_plan(
    project_code: str, body: PlanSubmitBody, db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    """Submit plan for a specific year/month."""
    project = require_plan_actual_access_by_code(current_resource, project_code, db)

    # Submit now pushes whatever was last explicitly SAVED as a draft, not
    # whatever happens to be sitting in the request body from live, possibly
    # unsaved, form state — same reasoning and same pattern as push_actual.
    # body.resources/body.misc_costs are intentionally ignored below in favor
    # of the saved draft; body.project (contract value, dates, etc.) is
    # unrelated to the draft and still comes from the request as before.
    current_plan_draft = _get_current_plan_draft(db, project.id, body.year, body.month)
    if not current_plan_draft:
        raise HTTPException(
            status_code=400,
            detail="No saved draft found for this month — please Save before submitting."
        )
    resources  = [PmoResource(**r) for r in json.loads(current_plan_draft.resources_json)]
    misc_costs = [PmoMiscCost(**mc) for mc in json.loads(current_plan_draft.misc_costs_json)]

    # Server-side hard validation — cannot be bypassed by frontend
    _validate_resources(resources, db, exclude_project_code=project_code)

    pmo_query, pmo_execute, pmo_executemany, safe_date = _pmo()
    proj  = body.project
    today = _today()
    y, m  = body.year, body.month

    # Check if already submitted for this year/month
    existing = pmo_query(
        'SELECT COUNT(*) as cnt FROM plan_resource '
        'WHERE project_code = %s AND year = %s AND month = %s',
        (project_code, y, m)
    )
    if existing and existing[0]['cnt'] > 0:
        raise HTTPException(
            status_code=400,
            detail=f'Plan already submitted for {y}-{m:02d}'
        )

    # plan_project — no year/month columns, REPLACE latest
    # revenue_deduction is computed server-side from misc_costs, not trusted
    # from the request body — matches the pattern used in convert_deal_to_project.
    total_misc = sum(mc.amount or 0 for mc in misc_costs)
    pmo_execute('''
        REPLACE INTO plan_project
        (project_code, project_name, customer, entity, project_type, technology,
         currency, contract_value, project_budget, license_cost, revenue_deduction,
         account_manager, start_date, target_end_date, submit_date)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    ''', (project_code, proj.project_name, proj.customer, proj.entity,
          proj.project_type, proj.technology, proj.currency, proj.contract_value,
          proj.project_budget, proj.license_cost, total_misc,
          proj.account_manager, safe_date(proj.start_date),
          safe_date(proj.target_end_date), today))

    # plan_resource — has year/month
    if resources:
        pmo_executemany('''
            INSERT IGNORE INTO plan_resource
            (project_code, project_name, staff_name, role, project_cost,
             distribution, submit_date, year, month)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ''', [(project_code, proj.project_name, r.staff_name, r.role,
               r.computed_cost(), r.distribution, today, y, m)
              for r in resources])


    # plan_misc_cost — itemized Revenue Deduction breakdown, REPLACE latest set
    pmo_execute('DELETE FROM plan_misc_cost WHERE project_code = %s', (project_code,))
    if misc_costs:
        pmo_executemany('''
            INSERT INTO plan_misc_cost
            (project_code, project_name, amount, submit_date, cost_name)
            VALUES (%s,%s,%s,%s,%s)
        ''', [(project_code, proj.project_name,
               mc.amount or 0, today,
               mc.custom_detail if (mc.category == "Others" and mc.custom_detail) else mc.category)
              for mc in misc_costs])

    # Draft is now superseded by the real submission — close out its current
    # version the same way push_actual does for ActualDraft (no hard delete,
    # full history stays queryable).
    current_plan_draft.is_current = False
    current_plan_draft.end_date = datetime.utcnow()

    # Carry this month's just-submitted plan forward as the Actual tab's
    # starting draft for the SAME month — but only if nothing is already
    # sitting there, so this never clobbers actual work already in progress.
    if not _get_current_actual_draft(db, project.id, y, m):
        seed = ActualDraft(
            project_id=project.id, year=y, month=m,
            resources_json=json.dumps([r.model_dump() for r in resources]),
            misc_costs_json=json.dumps([mc.model_dump() for mc in misc_costs]),
            rag=None, saved_by=current_resource.id if current_resource else None,
            version=1, is_current=True,
        )
        db.add(seed)
        db.flush()
        seed.entity_id = seed.id

    db.commit()

    return {'project_code': project_code, 'year': y, 'month': m,
            'submit_date': today, 'message': 'Plan submitted successfully'}


# ── POST /actual/push ─────────────────────────────────────────────────────────

def _finalize_actual_draft(
    db: Session, project_row: Project, current_draft: ActualDraft,
    proj: Optional['PmoProjectBase'] = None, saved_by_id: Optional[int] = None,
) -> dict:
    """
    The actual "push this draft to the database, officially" logic — shared
    between the manual Final Submit button (push_actual, below, still gated
    to the last day of the month) and the automatic month-end catch-up job
    (see auto_finalize_overdue_drafts in main.py). That job exists
    specifically because a missed Final Submit used to leave a month
    permanently stuck as a draft that could never become official — once
    today's month no longer equals that draft's month, the last-day check
    can never pass for it again, no matter how long it waits.

    proj: the manual path still passes body.project, since the user may have
    edited contract value/dates etc. directly in the form before submitting.
    The scheduler has no request body to read that from, so when proj is
    omitted, this falls back to whatever's on the local Project record —
    that's genuinely the only data available for an automatic submission.
    """
    resources  = [PmoResource(**r) for r in json.loads(current_draft.resources_json)]
    misc_costs = [PmoMiscCost(**mc) for mc in json.loads(current_draft.misc_costs_json)]
    rag_status = current_draft.rag
    y, m = current_draft.year, current_draft.month
    project_code = project_row.project_code

    if proj is None:
        proj = PmoProjectBase(
            project_name=project_row.name, customer=project_row.customer,
            entity=project_row.entity, project_type=project_row.project_type,
            technology=project_row.technology, currency=project_row.currency or 'MYR',
            contract_value=project_row.contract_value_myr or 0,
            project_budget=project_row.project_budget or 0,
            license_cost=project_row.license_cost or 0,
            account_manager=project_row.account_manager,
            start_date=project_row.start_date, target_end_date=project_row.original_end_date,
        )

    pmo_query, pmo_execute, pmo_executemany, safe_date = _pmo()
    today = _today()

    total_misc = sum(mc.amount or 0 for mc in misc_costs)
    pmo_execute('''
        REPLACE INTO actual_project
        (project_code, project_name, customer, entity, project_type, technology,
         currency, contract_value, project_budget, license_cost, revenue_deduction,
         account_manager, start_date, target_end_date, rag_status, submit_date)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    ''', (project_code, proj.project_name, proj.customer, proj.entity,
          proj.project_type, proj.technology, proj.currency, proj.contract_value,
          proj.project_budget, proj.license_cost, total_misc,
          proj.account_manager, safe_date(proj.start_date),
          safe_date(proj.target_end_date), rag_status, today))

    # actual_resource — scope the replace to THIS month only, so other
    # months' actual cost history is preserved instead of being wiped.
    pmo_execute('DELETE FROM actual_resource WHERE project_code = %s AND year = %s AND month = %s', (project_code, y, m))
    if resources:
        pmo_executemany('''
            INSERT IGNORE INTO actual_resource
            (project_code, project_name, staff_name, role, project_cost, distribution, submit_date, year, month)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ''', [(project_code, proj.project_name, r.staff_name, r.role,
               r.computed_cost(), r.distribution, today, y, m)
              for r in resources])

    pmo_execute('DELETE FROM actual_misc_cost WHERE project_code = %s', (project_code,))
    if misc_costs:
        pmo_executemany('''
            INSERT IGNORE INTO actual_misc_cost
            (project_code, project_name, amount, submit_date, cost_name)
            VALUES (%s,%s,%s,%s,%s)
        ''', [(project_code, proj.project_name, mc.amount or 0, today,
               mc.custom_detail if (mc.category == "Others" and mc.custom_detail) else mc.category)
              for mc in misc_costs])

    # Draft is now superseded by the real submission — close out its current
    # version (not a hard delete) so the Schedule permission fallback chain
    # correctly moves on to actual_resource, while every draft save leading
    # up to this submission stays in the table as history rather than being
    # erased. No new version follows this one; the trail just ends here.
    current_draft.is_current = False
    current_draft.end_date = datetime.utcnow()

    # Carry this month's just-submitted actual forward as next month's
    # starting plan draft — but only if nothing is already sitting there
    # for next month, so this never clobbers work already in progress.
    next_year, next_month = (y + 1, 1) if m == 12 else (y, m + 1)
    if not _get_current_plan_draft(db, project_row.id, next_year, next_month):
        seed = PlanDraft(
            project_id=project_row.id, year=next_year, month=next_month,
            resources_json=json.dumps([r.model_dump() for r in resources]),
            misc_costs_json=json.dumps([mc.model_dump() for mc in misc_costs]),
            saved_by=saved_by_id,
            version=1, is_current=True,
        )
        db.add(seed)
        db.flush()
        seed.entity_id = seed.id

    db.commit()
    return {'project_code': project_code, 'submit_date': today, 'message': 'Actual data pushed successfully'}


@pmo_router.post('/{project_code}/actual/push')
def push_actual(
    project_code: str, body: ActualPushBody, db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    """Push actual data for a specific year/month. actual_resource now retains full month-by-month history."""
    require_plan_actual_access_by_code(current_resource, project_code, db)

    # Submit is only allowed on the last calendar day of the month being
    # submitted for — Save Draft stays available all month for iterative
    # work; this is specifically the gate on the FINAL, official record.
    if not _is_last_day_of_month(body.year, body.month):
        last_day = calendar.monthrange(body.year, body.month)[1]
        raise HTTPException(
            status_code=400,
            detail=f"Submit is only allowed on the last day of the month ({last_day}/{body.month}/{body.year}). "
                   f"You can keep using Save Draft until then."
        )

    project_row = db.query(Project).filter(Project.project_code == project_code).first()
    current_draft = _get_current_actual_draft(db, project_row.id, body.year, body.month) if project_row else None
    if not current_draft:
        raise HTTPException(
            status_code=400,
            detail="No saved draft found for this month — please Save Draft before submitting."
        )

    # Submit now pushes whatever was last explicitly SAVED as a draft, not
    # whatever happens to be sitting in the request body from live, possibly
    # unsaved, form state — the two could differ if someone edited a field
    # and hit Submit without saving first. body.resources/body.misc_costs/
    # body.rag_status are intentionally ignored in favor of the saved draft
    # (see _finalize_actual_draft); body.project (contract value, dates,
    # etc.) is unrelated to the draft and is still honored as before.
    resources_preview = [PmoResource(**r) for r in json.loads(current_draft.resources_json)]

    # Server-side hard validation — cannot be bypassed by frontend
    # Exclude this project's own existing allocation from the capacity check
    _validate_resources(resources_preview, db, exclude_project_code=project_code)

    return _finalize_actual_draft(
        db, project_row, current_draft,
        proj=body.project, saved_by_id=current_resource.id if current_resource else None,
    )


def auto_finalize_overdue_drafts(db: Session) -> list:
    """
    Finds every CURRENT ActualDraft whose (year, month) has already fully
    passed relative to today, and finalizes it automatically — the same
    _finalize_actual_draft logic Final Submit uses, just without a human
    clicking the button first.

    Exists because Final Submit is gated to the last day of the month being
    submitted for; if that single day gets missed for any reason, today's
    month can never equal that draft's month again, and the manual button's
    own check can never pass for it afterward. Without this, that draft
    would sit there forever — visible in the interface, but never promoted
    to the official actual_resource record, and never seeding the following
    month's Plan draft either, stalling the whole Plan→Actual→next-Plan
    cycle for that project.

    Called once at startup (catching anything already stuck) and on a daily
    schedule after that — see main.py. Returns a list of what got finalized,
    purely for logging; callers aren't required to do anything with it.
    """
    from app.db.pmo_mysql import _pmo_configured
    if not _pmo_configured():
        return []

    today = date.today()
    finalized = []

    overdue_drafts = db.query(ActualDraft).filter(ActualDraft.is_current == True).all()
    for draft in overdue_drafts:
        if (draft.year, draft.month) >= (today.year, today.month):
            continue   # current or future month — not overdue, leave it for the normal Final Submit flow
        project_row = db.query(Project).filter(Project.id == draft.project_id).first()
        if not project_row or not project_row.project_code:
            continue
        try:
            resources_preview = [PmoResource(**r) for r in json.loads(draft.resources_json)]
            _validate_resources(resources_preview, db, exclude_project_code=project_row.project_code)
            _finalize_actual_draft(db, project_row, draft, saved_by_id=draft.saved_by)
            finalized.append({"project_code": project_row.project_code, "year": draft.year, "month": draft.month})
            print(f"[auto-finalize] Finalized overdue Actual for {project_row.project_code} ({draft.year}-{draft.month:02d})")
        except Exception as e:
            db.rollback()
            print(f"[auto-finalize] Failed to finalize {project_row.project_code} ({draft.year}-{draft.month:02d}), left as a draft for manual review: {e}")

    return finalized


# ── GET/PUT actual draft (server-side — used for pre-fill AND Schedule access) ─

def _get_current_actual_draft(db: Session, project_id: int, year: int, month: int) -> Optional[ActualDraft]:
    return db.query(ActualDraft).filter(
        ActualDraft.project_id == project_id, ActualDraft.year == year, ActualDraft.month == month,
        ActualDraft.is_current == True,
    ).first()


def _new_actual_draft_version(db: Session, current: ActualDraft, **changes) -> ActualDraft:
    """SCD Type 2 write — same pattern as gantt.py's _new_task_version, see there for the full explanation."""
    now = datetime.utcnow()
    current.is_current = False
    current.end_date = now

    new = ActualDraft(
        entity_id=current.entity_id,
        version=current.version + 1,
        effective_date=now,
        end_date=None,
        is_current=True,
        project_id=current.project_id,
        year=current.year,
        month=current.month,
        resources_json=changes.get("resources_json", current.resources_json),
        milestones_json=current.milestones_json,
        misc_costs_json=changes.get("misc_costs_json", current.misc_costs_json),
        rag=changes.get("rag", current.rag),
        saved_by=changes.get("saved_by", current.saved_by),
    )
    db.add(new)
    return new


def _get_current_plan_draft(db: Session, project_id: int, year: int, month: int) -> Optional[PlanDraft]:
    return db.query(PlanDraft).filter(
        PlanDraft.project_id == project_id, PlanDraft.year == year, PlanDraft.month == month,
        PlanDraft.is_current == True,
    ).first()


def _new_plan_draft_version(db: Session, current: PlanDraft, **changes) -> PlanDraft:
    """SCD Type 2 write — mirrors _new_actual_draft_version exactly."""
    now = datetime.utcnow()
    current.is_current = False
    current.end_date = now

    new = PlanDraft(
        entity_id=current.entity_id,
        version=current.version + 1,
        effective_date=now,
        end_date=None,
        is_current=True,
        project_id=current.project_id,
        year=current.year,
        month=current.month,
        resources_json=changes.get("resources_json", current.resources_json),
        misc_costs_json=changes.get("misc_costs_json", current.misc_costs_json),
        saved_by=changes.get("saved_by", current.saved_by),
    )
    db.add(new)
    return new


@pmo_router.get('/{project_code}/actual/draft')
def get_actual_draft(
    project_code: str, year: int, month: int, db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    project = require_plan_actual_access_by_code(current_resource, project_code, db)
    draft = _get_current_actual_draft(db, project.id, year, month)
    if not draft:
        return None
    return {
        "resources":  json.loads(draft.resources_json),
        "misc_costs": json.loads(draft.misc_costs_json),
        "rag":        draft.rag,
        "updated_at": draft.updated_at.isoformat() if draft.updated_at else None,
    }


@pmo_router.put('/{project_code}/actual/draft')
def save_actual_draft(
    project_code: str, body: ActualPushBody, db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    """
    Persists the Actual tab's draft server-side (previously localStorage
    only). SCD Type 2 — every Save Draft click creates a new version rather
    than overwriting the previous one, so the full history of every
    intermediate draft save is preserved and auditable directly from the
    database. Also feeds the Schedule visibility/edit permission check in
    app/auth.py, which only ever reads the CURRENT version.
    """
    project = require_plan_actual_access_by_code(current_resource, project_code, db)

    resources_json = json.dumps([r.model_dump() for r in body.resources])
    misc_costs_json = json.dumps([mc.model_dump() for mc in body.misc_costs])
    saved_by = current_resource.id if current_resource else None

    current = _get_current_actual_draft(db, project.id, body.year, body.month)
    if current:
        _new_actual_draft_version(
            db, current,
            resources_json=resources_json, misc_costs_json=misc_costs_json,
            rag=body.rag_status, saved_by=saved_by,
        )
    else:
        draft = ActualDraft(
            project_id=project.id, year=body.year, month=body.month,
            resources_json=resources_json, misc_costs_json=misc_costs_json,
            rag=body.rag_status, saved_by=saved_by,
            version=1, is_current=True,
        )
        db.add(draft)
        db.flush()          # assigns draft.id so it can become its own stable entity_id
        draft.entity_id = draft.id

    db.commit()
    return {"message": "Draft saved"}


@pmo_router.get('/{project_code}/plan/draft')
def get_plan_draft(
    project_code: str, year: int, month: int, db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    project = require_plan_actual_access_by_code(current_resource, project_code, db)
    draft = _get_current_plan_draft(db, project.id, year, month)
    if not draft:
        return None
    return {
        "resources":  json.loads(draft.resources_json),
        "misc_costs": json.loads(draft.misc_costs_json),
        "updated_at": draft.updated_at.isoformat() if draft.updated_at else None,
    }


@pmo_router.put('/{project_code}/plan/draft')
def save_plan_draft(
    project_code: str, body: PlanSubmitBody, db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    """
    Persists the Plan tab's draft server-side. SCD Type 2 — mirrors
    save_actual_draft exactly, see there for the full explanation. Converting
    a deal creates the FIRST version of this draft (see convert_deal_to_project);
    Submit Plan is the only action that actually pushes to plan_project/
    plan_resource/plan_misc_cost — Save just persists the in-progress state.
    """
    project = require_plan_actual_access_by_code(current_resource, project_code, db)

    resources_json = json.dumps([r.model_dump() for r in body.resources])
    misc_costs_json = json.dumps([mc.model_dump() for mc in body.misc_costs])
    saved_by = current_resource.id if current_resource else None

    current = _get_current_plan_draft(db, project.id, body.year, body.month)
    if current:
        _new_plan_draft_version(
            db, current,
            resources_json=resources_json, misc_costs_json=misc_costs_json,
            saved_by=saved_by,
        )
    else:
        draft = PlanDraft(
            project_id=project.id, year=body.year, month=body.month,
            resources_json=resources_json, misc_costs_json=misc_costs_json,
            saved_by=saved_by,
            version=1, is_current=True,
        )
        db.add(draft)
        db.flush()          # assigns draft.id so it can become its own stable entity_id
        draft.entity_id = draft.id

    db.commit()
    return {"message": "Draft saved"}


@pmo_router.get('/{project_code}/my-access')
def my_plan_actual_access(
    project_code: str, db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    """
    Single source of truth for 'can the CURRENT user view/edit this project's
    Plan & Actual' — mirrors gantt.py's Schedule my-access endpoint. The
    frontend calls this directly instead of keeping its own copy of the
    permission logic.
    """
    project = db.query(Project).filter(Project.project_code == project_code).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {
        "can_view": can_view_plan_actual(current_resource, project, db),
        "can_edit": can_edit_plan_actual(current_resource, project),
    }
