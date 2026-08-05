"""
Interim identity + role-based access control.

There is no real session/token auth yet — the frontend sends an
`X-Resource-Id` header identifying which Resource record the current browser
session is "logged in as" (set via a Resource picker, replacing the old
free-text "Logged in as" box). This is NOT secure against a user editing
headers in devtools; it exists so the RBAC *logic* below can be built and
tested now, ready to swap onto real Azure AD / Entra ID SSO later without
touching any of the permission logic — only get_current_resource() would
change (to derive the resource from a verified SSO token/session instead of
a client-supplied header).

Role model — two tabs, two different rules:

  PLAN & ACTUAL tab:
    - Management only — view AND edit. Hidden entirely from everyone else,
      including the Project Manager and Account Manager. Unaffected by
      everything below.

  PROJECT VISIBILITY + SCHEDULE tab (Gantt/WBS):
    Determined from PMO staffing data, NOT the local Allocation table. For a
    given project, in order:
      1. The server-side Actual DRAFT (ActualDraft, local SQLite) for the
         current month. If it exists for this project, that's authoritative —
         it reflects the most current staffing intent, even before Submit.
      2. Else, actual_resource (PMO, already submitted) for the current
         month, if it has any rows at all for this project.
      3. Else, plan_resource (PMO) for the current month, as the final
         fallback when neither a draft nor a submission exists yet.
      4. Management always sees + edits every project regardless.
      5. If PMO itself is unreachable/not configured (e.g. local dev without
         MySQL), fall back to the OLD Allocation-based rule as a safety net
         so the app stays testable without a live PMO connection. The local
         draft tier still applies even then, since it doesn't need PMO.

    Matching is by exact resource.name == staff_name in whichever source
    applies — reliable because the Resource Table's staff dropdown always
    writes the resource's exact `name`, never free text, when picked from
    the list.

  No identity at all (missing/unknown X-Resource-Id) fails CLOSED on every
  check below — sees nothing, edits nothing.
"""

import time
import json
from datetime import date
from typing import Optional, Set, Dict, Tuple
from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models import Resource, Project, ActualDraft

PROJECT_MANAGER_ROLES = {"Project Manager"}

# Short in-memory cache for the PMO-sourced tiers only — several Gantt
# endpoints check this independently on a single page load; without caching
# that's several PMO/SSH round-trips per view. The draft tier is local
# SQLite (cheap) and always queried fresh, never cached.
_CACHE_TTL_SECONDS = 15
_staff_map_cache: Dict[str, object] = {"ts": 0.0, "actual": None, "plan": None}


def get_current_resource(
    x_resource_id: Optional[int] = Header(None, alias="X-Resource-Id"),
    db: Session = Depends(get_db),
) -> Optional[Resource]:
    """Resolve the 'logged in as' Resource from the request header, if any."""
    if x_resource_id is None:
        return None
    return db.query(Resource).filter(Resource.id == x_resource_id).first()


def is_management(resource: Optional[Resource]) -> bool:
    return bool(resource and resource.resource_type == "Management")


def _has_any_allocation(resource: Resource, project: Project) -> bool:
    return any(a.project_id == project.id for a in resource.allocations)


def _allocation_role(resource: Resource, project: Project) -> Optional[str]:
    for a in resource.allocations:
        if a.project_id == project.id:
            return a.role
    return None


def _draft_staff_map(db: Session) -> dict:
    """
    {project_code: {staff_name: role}} from local ActualDraft rows for the
    current month. Always queried fresh — it's local SQLite, cheap, and
    should reflect edits immediately, unlike the PMO-sourced tiers below.
    ActualDraft is now SCD Type 2 (every Save Draft click creates a new
    version) — is_current=True is required here, or this would mix historical
    draft versions together the same way plan_resource/actual_resource once
    did before that was fixed, showing the same staff member duplicated.
    """
    today = date.today()
    rows = (
        db.query(ActualDraft, Project.project_code)
        .join(Project, Project.id == ActualDraft.project_id)
        .filter(ActualDraft.year == today.year, ActualDraft.month == today.month, ActualDraft.is_current == True)
        .all()
    )
    draft_map: dict = {}
    for draft, code in rows:
        if not code:
            continue
        try:
            resources = json.loads(draft.resources_json)
        except Exception:
            resources = []
        draft_map[code] = {r.get("staff_name"): r.get("role") for r in resources if r.get("staff_name")}
    return draft_map


def _current_month_staff_maps() -> Tuple[Optional[dict], Optional[dict]]:
    """
    Returns (actual_map, plan_map), each {project_code: {staff_name: role}}
    for the current month, sourced from PMO. Returns (None, None) if PMO
    isn't configured or the query fails — callers should fall back to the
    Allocation-based rule in that case, not treat it as "everyone is unstaffed".
    """
    now = time.time()
    if now - _staff_map_cache["ts"] < _CACHE_TTL_SECONDS and _staff_map_cache["actual"] is not None:
        return _staff_map_cache["actual"], _staff_map_cache["plan"]

    from app.db.pmo_mysql import _pmo_configured, pmo_query
    if not _pmo_configured():
        return None, None

    today = date.today()
    try:
        actual_rows = pmo_query(
            "SELECT project_code, staff_name, role FROM actual_resource "
            "WHERE year = %s AND month = %s",
            (today.year, today.month)
        )
        plan_rows = pmo_query(
            "SELECT project_code, staff_name, role FROM plan_resource "
            "WHERE year = %s AND month = %s",
            (today.year, today.month)
        )
    except Exception as e:
        print(f"[auth] PMO staff lookup failed — falling back to Allocation table: {e}")
        return None, None

    actual_map: dict = {}
    for r in actual_rows:
        actual_map.setdefault(r["project_code"], {})[r["staff_name"]] = r["role"]
    plan_map: dict = {}
    for r in plan_rows:
        plan_map.setdefault(r["project_code"], {})[r["staff_name"]] = r["role"]

    _staff_map_cache.update({"ts": now, "actual": actual_map, "plan": plan_map})
    return actual_map, plan_map


def _staff_role_for_project(project_code: Optional[str], resource_name: str, draft_map: dict, actual_map: Optional[dict], plan_map: Optional[dict]) -> Optional[str]:
    """
    Per-project fallback, in priority order: draft > submitted actual > plan.
    Each tier is authoritative for a project IF it has any rows at all for
    that project this month — falls through to the next tier only when the
    current one is completely empty for that specific project.
    actual_map/plan_map being None (not just missing the project) means PMO
    itself was unreachable — that tier is skipped, not treated as empty.
    Returns this resource's role string if staffed, or None if not staffed.
    """
    if not project_code:
        return None
    if project_code in draft_map:
        return draft_map[project_code].get(resource_name)
    if actual_map is not None and project_code in actual_map:
        return actual_map[project_code].get(resource_name)
    if plan_map is not None and project_code in plan_map:
        return plan_map[project_code].get(resource_name)
    return None


def _resource_role_for_project(resource: Resource, project_id: int, project_code: Optional[str],
                                draft_map: dict, actual_map: Optional[dict], plan_map: Optional[dict]) -> Optional[str]:
    """Full chain including the final Allocation-table fallback, used when PMO has nothing for this project."""
    role = _staff_role_for_project(project_code, resource.name, draft_map, actual_map, plan_map)
    if role is not None:
        return role
    for a in resource.allocations:
        if a.project_id == project_id:
            return a.role
    return None


def get_visible_project_ids(resource: Optional[Resource], db: Session) -> Optional[Set[int]]:
    """Returns None to mean 'all projects visible' (management only)."""
    if resource is None:
        return set()
    if is_management(resource):
        return None

    draft_map = _draft_staff_map(db)
    actual_map, plan_map = _current_month_staff_maps()

    visible: Set[int] = set()
    for pid, code in db.query(Project.id, Project.project_code).filter(Project.project_code.isnot(None)).all():
        if _resource_role_for_project(resource, pid, code, draft_map, actual_map, plan_map) is not None:
            visible.add(pid)
    return visible


# ── Plan & Actual tab — Management can view+edit; a project's own Project
# Manager can now VIEW (added on request) but never edit. Everyone else
# still has it hidden entirely. ──────────────────────────────────────────────

def can_view_plan_actual(resource: Optional[Resource], project: Project, db: Optional[Session] = None) -> bool:
    if resource is None:
        return False
    if is_management(resource):
        return True
    draft_map = _draft_staff_map(db) if db is not None else {}
    actual_map, plan_map = _current_month_staff_maps()
    role = _resource_role_for_project(resource, project.id, project.project_code, draft_map, actual_map, plan_map)
    return (role or "").strip().lower() in {r.lower() for r in PROJECT_MANAGER_ROLES}


def can_edit_plan_actual(resource: Optional[Resource], project: Project) -> bool:
    return is_management(resource)


def require_plan_actual_view_access(resource: Optional[Resource], project: Project, db: Optional[Session] = None) -> None:
    if not can_view_plan_actual(resource, project, db):
        raise HTTPException(status_code=403, detail="You don't have access to view this project's Plan & Actual.")


def require_plan_actual_view_access_by_code(resource: Optional[Resource], project_code: str, db: Session) -> Project:
    project = db.query(Project).filter(Project.project_code == project_code).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_plan_actual_view_access(resource, project, db)
    return project


def require_plan_actual_access(resource: Optional[Resource], project: Project) -> None:
    if not can_edit_plan_actual(resource, project):
        raise HTTPException(status_code=403, detail="Only Management can edit Plan & Actual.")


def require_plan_actual_access_by_code(resource: Optional[Resource], project_code: str, db: Session) -> Project:
    project = db.query(Project).filter(Project.project_code == project_code).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_plan_actual_access(resource, project)
    return project


# ── Schedule tab — driven by current-month staffing: draft > actual > plan > Allocation ─

def can_view_schedule(resource: Optional[Resource], project: Project, db: Optional[Session] = None) -> bool:
    if resource is None:
        return False
    if is_management(resource):
        return True

    draft_map = _draft_staff_map(db) if db is not None else {}
    actual_map, plan_map = _current_month_staff_maps()
    return _resource_role_for_project(resource, project.id, project.project_code, draft_map, actual_map, plan_map) is not None


def can_edit_schedule(resource: Optional[Resource], project: Project, db: Optional[Session] = None) -> bool:
    if resource is None:
        return False
    if is_management(resource):
        return True

    draft_map = _draft_staff_map(db) if db is not None else {}
    actual_map, plan_map = _current_month_staff_maps()
    role = _resource_role_for_project(resource, project.id, project.project_code, draft_map, actual_map, plan_map)
    return (role or "").strip().lower() in {r.lower() for r in PROJECT_MANAGER_ROLES}


def require_schedule_edit_access(resource: Optional[Resource], project: Project, db: Optional[Session] = None) -> None:
    if not can_edit_schedule(resource, project, db):
        raise HTTPException(
            status_code=403,
            detail="You don't have edit access to this project's schedule. "
                   "Only Management or the Project Manager can update it."
        )
