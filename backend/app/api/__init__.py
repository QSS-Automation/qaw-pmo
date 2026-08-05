"""
All API route handlers.
Imported individually in main.py.
"""

from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field, field_validator
from datetime import datetime, date
import json
import secrets

from app.db.database import get_db
from app.auth import get_current_resource, is_management, get_visible_project_ids
from app.models import (
    Project, Resource, Allocation, MiscCost, Billing, Deal, PlanDraft,
    ProjectStatus, RAGStatus, DealStage, FeaturePermission, ACCESS_ROLES
)
from app.services.salesforce import salesforce_service
from app.services.autocount import autocount_service


# ─── Pydantic Schemas ────────────────────────────────────────────────────────

class AllocationIn(BaseModel):
    resource_id:    int
    allocation_pct: float = Field(ge=0, le=200)
    role:           Optional[str] = None
    notes: Optional[str] = None

class MilestoneIn(BaseModel):
    label: str
    percentage: float
    due_date: Optional[str] = None
    amount: float = 0
    is_completed: bool = False

class MiscCostIn(BaseModel):
    category: str        # Outsourced Professional Services | Training | Logistics | Others
    custom_detail: Optional[str] = None   # free text, meaningful only when category == "Others"
    amount: float = 0

class ProjectCreate(BaseModel):
    name: str
    short_name: str
    customer: str
    entity: Optional[str] = None
    project_type: Optional[str] = None
    technology: Optional[str] = None
    currency: str = "MYR"
    contract_value: float = 0
    contract_value_myr: float = 0
    revenue_deduction: float = 0
    gp_margin_target: float = 0.5
    start_date: Optional[str] = None
    original_end_date: Optional[str] = None
    account_manager: Optional[str] = None
    project_manager: Optional[str] = None
    salesforce_deal_id: Optional[str] = None
    allocations: List[AllocationIn] = []

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    short_name: Optional[str] = None
    customer: Optional[str] = None
    entity: Optional[str] = None
    project_type: Optional[str] = None
    technology: Optional[str] = None
    currency: Optional[str] = None
    contract_value: Optional[float] = None
    contract_value_myr: Optional[float] = None
    revenue_deduction: Optional[float] = None
    net_revenue: Optional[float] = None
    budget: Optional[float] = None
    gp_margin_target: Optional[float] = None
    gp_margin_forecast: Optional[float] = None
    planned_progress: Optional[float] = None
    actual_progress: Optional[float] = None
    billed_pct: Optional[float] = None
    start_date: Optional[str] = None
    original_end_date: Optional[str] = None
    rebased_end_date: Optional[str] = None
    status: Optional[str] = None
    rag: Optional[str] = None
    cashflow_status: Optional[str] = None
    health_remarks: Optional[str] = None
    timeline_risk: Optional[str] = None
    scope_risk: Optional[str] = None
    budget_risk: Optional[str] = None
    overall_risk: Optional[str] = None
    account_manager:   Optional[str]   = None
    project_manager:   Optional[str]   = None
    project_code:      Optional[str]   = None
    project_budget:    Optional[float] = None
    license_cost:      Optional[float] = None
    third_party_cost:  Optional[float] = None
    salesforce_deal_id: Optional[str]  = None

class ResourceCreate(BaseModel):
    name:           str
    full_name:      Optional[str]   = None
    employee_code:  Optional[str]   = None
    resource_type:  str             = "QAW"
    rate_card:      Optional[int]   = None
    monthly_cost:   float
    status:         str             = "Active"   # Active | No Project | Resigned
    email:          Optional[str]   = None
    remarks:        Optional[str]   = None

    @field_validator("rate_card", mode="before")
    @classmethod
    def _blank_rate_card_to_none(cls, v):
        # HTML number inputs send "" when left untouched — treat as "not set"
        # rather than letting Pydantic reject it as an invalid integer.
        return None if v == "" else v

class ResourceUpdate(BaseModel):
    name: Optional[str] = None
    full_name: Optional[str] = None
    employee_code: Optional[str] = None
    resource_type: Optional[str] = None
    rate_card: Optional[int] = None
    monthly_cost: Optional[float] = None
    is_active: Optional[bool] = None
    status: Optional[str] = None   # Active | No Project | Resigned

    @field_validator("rate_card", mode="before")
    @classmethod
    def _blank_rate_card_to_none(cls, v):
        return None if v == "" else v

    remarks: Optional[str] = None
class BillingCreate(BaseModel):
    project_id: int
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    due_date: Optional[str] = None
    amount: float
    currency: str = "MYR"
    is_paid: bool = False
    paid_date: Optional[str] = None
    notes: Optional[str] = None

class DealConvertIn(BaseModel):
    name:               str
    short_name:         str
    project_code:       Optional[str]   = None
    entity:             Optional[str]   = None
    project_type:       Optional[str]   = None
    technology:         Optional[str]   = None
    currency:           str             = "MYR"
    contract_value_myr: float
    project_budget:     float           = 0
    license_cost:       float           = 0
    gp_margin_target:   float           = 0.5
    start_date:         Optional[str]   = None
    original_end_date:  Optional[str]   = None
    account_manager:    Optional[str]   = None
    project_manager:    Optional[str]   = None
    allocations:        List[AllocationIn] = []
    misc_costs:         List[MiscCostIn] = []   # replaces the old third_party_cost / revenue_deduction number fields


# ─── Helper: project → dict ───────────────────────────────────────────────────

def project_to_dict(p: Project) -> Dict[str, Any]:
    net_rev = p.contract_value_myr + (p.revenue_deduction or 0)
    budget  = net_rev * 0.5
    return {
        "id": p.id, "code": p.code, "project_code": p.project_code, "name": p.name, "short_name": p.short_name,
        "customer": p.customer, "entity": p.entity,
        "project_type": p.project_type, "technology": p.technology,
        "currency": p.currency, "contract_value": p.contract_value,
        "contract_value_myr": p.contract_value_myr,
        "revenue_deduction": p.revenue_deduction or 0,
        "net_revenue": net_rev, "budget": budget,
        "project_budget":    p.project_budget or 0,
        "license_cost":      p.license_cost or 0,
        "third_party_cost":  p.third_party_cost or 0,
        "misc_costs": [
            {"id": mc.id, "category": mc.category, "custom_detail": mc.custom_detail, "amount": mc.amount or 0}
            for mc in p.misc_costs
        ],
        "budget_utilized": p.budget_utilized or 0,
        "util_pct": round((p.budget_utilized or 0) / budget, 4) if budget else 0,
        "gp_margin_target": p.gp_margin_target,
        "gp_margin_forecast": p.gp_margin_forecast,
        "planned_progress": p.planned_progress, "actual_progress": p.actual_progress,
        "billed_pct": p.billed_pct,
        "start_date": p.start_date, "original_end_date": p.original_end_date,
        "rebased_end_date": p.rebased_end_date,
        "status": p.status, "rag": p.rag, "cashflow_status": p.cashflow_status,
        "health_remarks": p.health_remarks,
        "timeline_risk": p.timeline_risk, "scope_risk": p.scope_risk,
        "budget_risk": p.budget_risk, "overall_risk": p.overall_risk,
        "account_manager": p.account_manager, "project_manager": p.project_manager,
        "salesforce_deal_id": p.salesforce_deal_id,
        "milestones": [
            {"id": m.id, "label": m.label, "percentage": m.percentage,
             "due_date": m.due_date, "is_completed": m.is_completed, "completed_date": m.completed_date,
             "invoice_date": m.invoice_date, "amount": m.amount}
            for m in (p.milestones or [])
        ],
        "allocations": [
            {"id": a.id, "resource_id": a.resource_id,
             "resource_name":  a.resource.name          if a.resource else None,
             "resource_type":  a.resource.resource_type if a.resource else None,
             "monthly_cost":   a.resource.monthly_cost  if a.resource else 0,
             "role":           a.role,
             "allocation_pct": a.allocation_pct,
             "notes":          a.notes}
            for a in (p.allocations or [])
        ],
        "billings": [
            {"id": b.id, "invoice_number": b.invoice_number, "autocount_ref": b.autocount_ref,
             "invoice_date": b.invoice_date, "due_date": b.due_date,
             "amount": b.amount, "is_paid": b.is_paid, "paid_date": b.paid_date, "source": b.source}
            for b in (p.billings or [])
        ],
        "created_at": str(p.created_at) if p.created_at else None,
        "updated_at": str(p.updated_at) if p.updated_at else None,
    }


# ─── PROJECTS router ─────────────────────────────────────────────────────────

projects_router = APIRouter(prefix="/api/projects", tags=["Projects"])

@projects_router.get("")
def list_projects(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    q = db.query(Project)
    if status:
        q = q.filter(Project.status == status)

    visible_ids = get_visible_project_ids(current_resource, db)
    if visible_ids is not None:   # None = management, sees everything
        q = q.filter(Project.id.in_(visible_ids)) if visible_ids else q.filter(False)

    return [project_to_dict(p) for p in q.all()]

@projects_router.get("/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")

    return project_to_dict(p)

@projects_router.post("", status_code=201)
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    net_rev = body.contract_value_myr + body.revenue_deduction
    p = Project(
        name=body.name, short_name=body.short_name, customer=body.customer,
        entity=body.entity, project_type=body.project_type, technology=body.technology,
        currency=body.currency, contract_value=body.contract_value,
        contract_value_myr=body.contract_value_myr,
        revenue_deduction=body.revenue_deduction, net_revenue=net_rev,
        budget=net_rev * 0.5, budget_utilized=0,
        project_budget=body.project_budget,
        license_cost=body.license_cost,
        third_party_cost=body.third_party_cost,
        gp_margin_target=body.gp_margin_target,
        start_date=(body.start_date or None), original_end_date=(body.original_end_date or None),
        account_manager=body.account_manager, project_manager=body.project_manager,
        salesforce_deal_id=body.salesforce_deal_id,
        status=ProjectStatus.in_progress, rag=RAGStatus.green,
    )
    db.add(p)
    db.flush()
    for a in body.allocations:
        db.add(Allocation(resource_id=a.resource_id, project_id=p.id, allocation_pct=a.allocation_pct, notes=a.notes))
    db.commit()
    db.refresh(p)
    return project_to_dict(p)

@projects_router.patch("/{project_id}")
def update_project(project_id: int, body: ProjectUpdate, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(p, field, value)
    db.commit()
    db.refresh(p)
    return project_to_dict(p)

@projects_router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")

    # Milestone and GanttTask are no longer cascade-deleted via a relationship
    # (Milestone's is viewonly under SCD Type 2; GanttTask never had one) —
    # clean them up explicitly so a deleted project doesn't leave orphans.
    from app.models import GanttTask, Milestone, GanttProgressLog, PendingDateChange
    task_entity_ids = [
        row[0] for row in db.query(GanttTask.entity_id).filter(GanttTask.project_id == project_id).distinct().all()
    ]
    if task_entity_ids:
        db.query(GanttProgressLog).filter(GanttProgressLog.gantt_task_id.in_(task_entity_ids)).delete(synchronize_session=False)
    db.query(PendingDateChange).filter(PendingDateChange.project_id == project_id).delete(synchronize_session=False)
    db.query(GanttTask).filter(GanttTask.project_id == project_id).delete(synchronize_session=False)
    db.query(Milestone).filter(Milestone.project_id == project_id).delete(synchronize_session=False)

    db.delete(p)
    db.commit()

@projects_router.post("/{project_id}/complete")
def complete_project(
    project_id: int, db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    if not is_management(current_resource):
        raise HTTPException(status_code=403, detail="Only Management can mark a project as completed.")
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")

    # Server-side check, not just a UI gate — completion requires the WBS
    # Schedule's actual progress (not the old local field) to genuinely be 100%.
    from app.api.gantt import _rollup_group
    from app.models import GanttTask
    tasks = db.query(GanttTask).filter(GanttTask.project_id == project_id, GanttTask.is_current == True).all()
    wbs_progress = _rollup_group(tasks)
    if not tasks or wbs_progress["actual_pct"] < 99.99:
        raise HTTPException(
            status_code=400,
            detail=f"WBS actual progress is only {wbs_progress['actual_pct']:.1f}% — must reach 100% before completing this project."
        )

    p.status = ProjectStatus.completed
    p.actual_progress = 1.0
    db.commit()
    db.refresh(p)
    return project_to_dict(p)

@projects_router.post("/{project_id}/reactivate")
def reactivate_project(project_id: int, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    p.status = ProjectStatus.in_progress
    db.commit()
    db.refresh(p)
    return project_to_dict(p)


# ─── ADMIN router — first-layer permission matrix ────────────────────────────
# See app/models.py's FeaturePermission docstring for the two-layer design.
# feature_key values below match QAW_PM_SYSTEM_ACCESS.xlsx exactly — each
# (section, row) pair in that sheet becomes one key here, grouped the same
# way for the Permissions page's table.

admin_router = APIRouter(prefix="/api/admin", tags=["Admin"])

FEATURE_KEYS = [
    # (section label, feature_key, feature label)
    ("Main", "main.conversion_window", "Awarded Project Conversion Window"),
    ("Main", "main.upcoming_summary", "Upcoming Projects Summary Indicators"),
    ("Main", "main.upcoming_table", "Upcoming Projects Table List"),
    ("Projects - Portfolio", "portfolio.summary", "Summary Indicators"),
    ("Projects - Portfolio", "portfolio.active_projects", "All Active Projects Summary"),
    ("Projects - Project Drill-Down", "drilldown.summary", "Summary Indicators"),
    ("Projects - Project Drill-Down", "drilldown.plan_actual", "Plan & Actual"),
    ("Projects - Project Drill-Down", "drilldown.schedule", "Schedule"),
    ("Projects - Project Drill-Down", "drilldown.milestones", "Milestones"),
    ("Projects - Project Drill-Down", "drilldown.update_progress", "Update Progress"),
    ("Completed Projects", "completed.summary", "Summary Indicators"),
    ("Completed Projects", "completed.all_projects", "All Projects Summary"),
    ("Resources", "resources.summary", "Summary Indicators"),
    ("Resources", "resources.table", "Resource Table List"),
    ("Budget Utilization", "budget.utilization", "Budget Utilization"),
]
FEATURE_KEY_SET = {k for _, k, _ in FEATURE_KEYS}

# Seed defaults — chosen to match how the app actually behaves TODAY, so
# turning this feature on doesn't change anyone's access on day one. Admin
# can immediately adjust any of it from the Permissions page afterward.
# Account Manager has no prior behavior to match (brand new role) — seeded
# conservatively: general project visibility, no financial/resource detail,
# no edit anywhere.
_DEFAULTS = {
    # feature_key: {role: (can_view, can_edit)}
    "main.conversion_window":     {"Admin": (True,True), "Management": (True,True), "Project Manager": (True,False), "Account Manager": (True,False), "Team Member": (False,False)},
    "main.upcoming_summary":      {"Admin": (True,True), "Management": (True,True), "Project Manager": (True,False), "Account Manager": (True,False), "Team Member": (True,False)},
    "main.upcoming_table":        {"Admin": (True,True), "Management": (True,True), "Project Manager": (True,False), "Account Manager": (True,False), "Team Member": (True,False)},
    "portfolio.summary":          {"Admin": (True,True), "Management": (True,True), "Project Manager": (True,False), "Account Manager": (True,False), "Team Member": (True,False)},
    "portfolio.active_projects":  {"Admin": (True,True), "Management": (True,True), "Project Manager": (True,False), "Account Manager": (True,False), "Team Member": (True,False)},
    "drilldown.summary":          {"Admin": (True,True), "Management": (True,True), "Project Manager": (True,False), "Account Manager": (True,False), "Team Member": (True,False)},
    "drilldown.plan_actual":      {"Admin": (True,True), "Management": (True,True), "Project Manager": (True,False), "Account Manager": (False,False), "Team Member": (False,False)},
    "drilldown.schedule":         {"Admin": (True,True), "Management": (True,True), "Project Manager": (True,True),  "Account Manager": (True,False), "Team Member": (True,False)},
    "drilldown.milestones":       {"Admin": (True,True), "Management": (True,True), "Project Manager": (True,True),  "Account Manager": (True,False), "Team Member": (True,False)},
    "drilldown.update_progress":  {"Admin": (True,True), "Management": (True,True), "Project Manager": (True,True),  "Account Manager": (False,False), "Team Member": (True,True)},
    "completed.summary":          {"Admin": (True,True), "Management": (True,True), "Project Manager": (True,False), "Account Manager": (True,False), "Team Member": (True,False)},
    "completed.all_projects":     {"Admin": (True,True), "Management": (True,True), "Project Manager": (True,False), "Account Manager": (True,False), "Team Member": (True,False)},
    "resources.summary":          {"Admin": (True,True), "Management": (True,True), "Project Manager": (True,False), "Account Manager": (False,False), "Team Member": (True,False)},
    "resources.table":            {"Admin": (True,True), "Management": (True,True), "Project Manager": (True,False), "Account Manager": (False,False), "Team Member": (True,False)},
    "budget.utilization":         {"Admin": (True,True), "Management": (True,True), "Project Manager": (True,False), "Account Manager": (False,False), "Team Member": (False,False)},
}


def _require_admin(current_resource: Optional[Resource]):
    if not current_resource or current_resource.access_role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admin can manage permissions.")


def seed_default_permissions(db: Session):
    """Called once at startup — inserts any (role, feature_key) row that
    doesn't already exist yet, using _DEFAULTS above. Never overwrites a row
    an Admin has already edited; safe to call on every startup."""
    existing = {(p.role, p.feature_key) for p in db.query(FeaturePermission).all()}
    added = 0
    for _, key, _ in FEATURE_KEYS:
        for role in ACCESS_ROLES:
            if (role, key) in existing:
                continue
            can_view, can_edit = _DEFAULTS.get(key, {}).get(role, (False, False))
            db.add(FeaturePermission(role=role, feature_key=key, can_view=can_view, can_edit=can_edit))
            added += 1
    if added:
        db.commit()


@admin_router.get("/permissions")
def get_permissions(db: Session = Depends(get_db), current_resource: Optional[Resource] = Depends(get_current_resource)):
    """Full matrix for the Permissions page: sections, ordered feature rows, and every role's current can_view/can_edit."""
    _require_admin(current_resource)
    seed_default_permissions(db)  # covers any FEATURE_KEYS added after initial deploy
    rows = db.query(FeaturePermission).all()
    matrix: Dict[str, Dict[str, Dict[str, bool]]] = {}
    for p in rows:
        matrix.setdefault(p.feature_key, {})[p.role] = {"can_view": p.can_view, "can_edit": p.can_edit}

    sections = []
    current_section = None
    for section, key, label in FEATURE_KEYS:
        if current_section is None or current_section["section"] != section:
            current_section = {"section": section, "features": []}
            sections.append(current_section)
        current_section["features"].append({
            "key": key, "label": label,
            "roles": matrix.get(key, {}),
        })
    return {"roles": ACCESS_ROLES, "sections": sections}


class PermissionUpdate(BaseModel):
    feature_key: str
    role: str
    can_view: bool
    can_edit: bool


@admin_router.put("/permissions")
def update_permission(
    body: PermissionUpdate, db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    """Single-cell update — called once per checkbox toggle, matching the
    Resources page's own save-on-change pattern rather than a bulk-save button."""
    _require_admin(current_resource)
    if body.feature_key not in FEATURE_KEY_SET:
        raise HTTPException(status_code=400, detail=f"Unknown feature_key: {body.feature_key}")
    if body.role not in ACCESS_ROLES:
        raise HTTPException(status_code=400, detail=f"Unknown role: {body.role}")

    row = db.query(FeaturePermission).filter(
        FeaturePermission.feature_key == body.feature_key, FeaturePermission.role == body.role
    ).first()
    if not row:
        row = FeaturePermission(feature_key=body.feature_key, role=body.role)
        db.add(row)
    row.can_view = body.can_view
    row.can_edit = body.can_edit
    db.commit()
    return {"message": "Updated"}


class InvitationCreate(BaseModel):
    name: str
    email: str
    resource_type: str = "QAW"
    access_role: str = "Team Member"


@admin_router.post("/invitations")
def create_invitation(
    body: InvitationCreate, db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    """
    Admin invites someone by name + email. Creates their Resource record up
    front (so Admin can immediately set their role/type, matching "assign
    role to them when they've entered" — the role just starts at the given
    default and can be adjusted any time via Role Assignment, before or
    after they accept) plus a one-time-generated, unguessable token.

    Attempts to email the invitation link directly if SMTP is configured
    (see config.py) — if not configured, or sending fails for any reason,
    this still succeeds and returns the link for Admin to copy manually,
    exactly like before email sending existed. email_sent in the response
    tells the frontend which happened, so it can show the right message.
    """
    _require_admin(current_resource)
    if body.access_role not in ACCESS_ROLES:
        raise HTTPException(status_code=400, detail=f"access_role must be one of {ACCESS_ROLES}")
    existing = db.query(Resource).filter(Resource.email == body.email).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"{body.email} is already registered as {existing.name}.")

    r = Resource(
        name=body.name, email=body.email, resource_type=body.resource_type,
        access_role=body.access_role, monthly_cost=0, status="Active",
        invite_token=secrets.token_urlsafe(32), invite_status="Pending",
        invited_at=datetime.utcnow(),
    )
    db.add(r); db.commit(); db.refresh(r)

    from app.services.email import send_invitation_email, is_smtp_configured
    email_sent = send_invitation_email(r.email, r.name, r.invite_token) if is_smtp_configured() else False

    return {"id": r.id, "name": r.name, "email": r.email, "invite_token": r.invite_token, "email_sent": email_sent}


@admin_router.get("/invitations")
def list_invitations(db: Session = Depends(get_db), current_resource: Optional[Resource] = Depends(get_current_resource)):
    """Everyone ever invited, with status — for Admin to see who's pending vs. already in."""
    _require_admin(current_resource)
    rows = db.query(Resource).filter(Resource.invite_status.isnot(None)).order_by(Resource.invited_at.desc()).all()
    return [{
        "id": r.id, "name": r.name, "email": r.email, "access_role": r.access_role,
        "invite_status": r.invite_status, "invited_at": r.invited_at, "accepted_at": r.accepted_at,
        "invite_token": r.invite_token,
    } for r in rows]


@admin_router.delete("/invitations/{resource_id}", status_code=204)
def revoke_invitation(resource_id: int, db: Session = Depends(get_db), current_resource: Optional[Resource] = Depends(get_current_resource)):
    """Revoke a still-pending invite — invalidates the link. Refuses to touch one that's already been accepted; remove the person via Resources instead if that's actually the goal."""
    _require_admin(current_resource)
    r = db.query(Resource).filter(Resource.id == resource_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    if r.invite_status == "Accepted":
        raise HTTPException(status_code=400, detail="This invitation was already accepted — remove the person from Resources instead if needed.")
    db.delete(r)
    db.commit()


@admin_router.post("/invitations/{resource_id}/resend")
def resend_invitation(resource_id: int, db: Session = Depends(get_db), current_resource: Optional[Resource] = Depends(get_current_resource)):
    """Re-send the same link (same token, doesn't invalidate it) — for a failed first attempt or just to nudge someone."""
    _require_admin(current_resource)
    r = db.query(Resource).filter(Resource.id == resource_id).first()
    if not r or not r.invite_token:
        raise HTTPException(status_code=404, detail="Not found")
    if r.invite_status == "Accepted":
        raise HTTPException(status_code=400, detail="Already accepted — nothing to resend.")

    from app.services.email import send_invitation_email, is_smtp_configured
    if not is_smtp_configured():
        raise HTTPException(status_code=400, detail="SMTP isn't configured — copy the link instead.")
    sent = send_invitation_email(r.email, r.name, r.invite_token)
    if not sent:
        raise HTTPException(status_code=502, detail="Sending failed — check SMTP settings, or copy the link instead.")
    return {"message": "Resent"}


invite_router = APIRouter(prefix="/api", tags=["Invitations"])


@invite_router.get("/accept-invite/{token}")
def accept_invite(token: str, db: Session = Depends(get_db)):
    """
    No auth required here on purpose — this IS the auth step, so it's on its
    own public router rather than under /api/admin/*, even though Admin is
    who creates the invitation being accepted. Deliberately re-usable rather
    than single-use: someone opening this link on a second device (e.g.
    switching from laptop to phone) should activate there too, the same way
    a Google Sheets invite works across whichever devices you open it from
    — this app has no cross-device account to fall back on otherwise. Marks
    accepted_at the first time only, so Admin can still see when someone
    first came in even though the link keeps working after.
    """
    r = db.query(Resource).filter(Resource.invite_token == token).first()
    if not r:
        raise HTTPException(status_code=404, detail="This invitation link isn't valid.")
    if r.invite_status != "Accepted":
        r.invite_status = "Accepted"
        r.accepted_at = datetime.utcnow()
        db.commit()
    return {"id": r.id, "name": r.name, "resource_type": r.resource_type, "access_role": r.access_role}



def list_resources_with_roles(db: Session = Depends(get_db), current_resource: Optional[Resource] = Depends(get_current_resource)):
    """Every resource's name + current access_role, for the role-assignment side of the Permissions page."""
    _require_admin(current_resource)
    return [{"id": r.id, "name": r.name, "resource_type": r.resource_type, "access_role": r.access_role}
            for r in db.query(Resource).order_by(Resource.name).all()]


class AccessRoleUpdate(BaseModel):
    access_role: str


@admin_router.patch("/resources/{resource_id}/access-role")
def set_access_role(
    resource_id: int, body: AccessRoleUpdate, db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    _require_admin(current_resource)
    if body.access_role not in ACCESS_ROLES:
        raise HTTPException(status_code=400, detail=f"access_role must be one of {ACCESS_ROLES}")
    r = db.query(Resource).filter(Resource.id == resource_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Resource not found")
    r.access_role = body.access_role
    db.commit()
    return {"id": r.id, "name": r.name, "access_role": r.access_role}


# ─── RESOURCES router ─────────────────────────────────────────────────────────

resources_router = APIRouter(prefix="/api/resources", tags=["Resources"])


def resource_to_dict(
    r: Resource,
    allocation_summary: Optional[Dict[str, float]] = None,
    allocation_detail: Optional[Dict[str, Dict[int, dict]]] = None,
) -> Dict[str, Any]:
    # total_allocation_pct/is_over_allocated AND the per-project "allocations"
    # list below both now read from the SAME live Actual-section data (draft-
    # if-exists-else-submitted for the current month) — not the local
    # Allocation table, which is frozen at 0% since conversion stopped
    # setting a real percentage there (see convert_deal_to_project). Before
    # this, the total and the per-project breakdown came from two different
    # sources and could visibly disagree (e.g. a 200% total sitting next to
    # per-project figures that only summed to 100%). Callers that already
    # computed these once (e.g. the list endpoint, for every resource at
    # once) pass them in to avoid recomputing per resource.
    if allocation_summary is None:
        allocation_summary = {}
    if allocation_detail is None:
        allocation_detail = {}
    total_alloc = allocation_summary.get(r.name, 0)
    per_project = allocation_detail.get(r.name, {})
    return {
        "id": r.id, "name": r.name, "full_name": r.full_name, "employee_code": r.employee_code,
        "resource_type": r.resource_type, "access_role": r.access_role, "rate_card": r.rate_card,
        "monthly_cost": r.monthly_cost, "is_active": r.is_active, "status": r.status,
        "total_allocation_pct": total_alloc,
        "is_over_allocated": total_alloc > 100,
        "allocations": [
            {"id": project_id, "project_id": project_id,
             "project_name": proj["project_name"],
             "allocation_pct": proj["pct"], "notes": None}
            for project_id, proj in per_project.items()
        ],
        "remarks": r.remarks,
    }

def _compute_allocation_detail(db: Session) -> Dict[str, Dict[int, dict]]:
    """
    {resource_name: {project_id: {"pct": float, "project_name": str}}}

    For EACH resource, their allocation PER PROJECT (not just a collapsed
    total), computed from Actual-section data specifically (not the old
    Allocation table, which is now frozen at 0% at conversion time). For
    each project, in order:
      1. The CURRENT month's ActualDraft, if one exists (still being worked on)
      2. The current month's actual_resource submission, if one exists
      3. The MOST RECENT prior month's actual_resource submission, if one
         exists at all — a brand-new month that hasn't been touched yet
         doesn't mean the person's real-world allocation reset to zero; it
         means nothing's been entered for it YET, so this treats "last
         confirmed state" as still standing until something newer replaces
         it. Without this, a resource who's fully allocated on a submitted
         month shows 0% the moment the calendar rolls over, purely because
         no one has opened that project's Actual tab yet this month.
      4. Otherwise, genuinely nothing (a project with no history at all)

    This is the single source both total_allocation_pct AND the per-project
    breakdown shown in the Resources master list read from — they used to
    read from two different places (this live data vs the old, frozen
    Allocation table) and could show numbers that didn't add up, e.g. a
    200% total next to per-project figures that only summed to 100%.
    """
    today = date.today()
    y, m = today.year, today.month

    projects = db.query(Project).filter(Project.project_code.isnot(None)).all()
    detail: Dict[str, Dict[int, dict]] = {}

    from app.models import ActualDraft
    drafts = db.query(ActualDraft).filter(
        ActualDraft.year == y, ActualDraft.month == m, ActualDraft.is_current == True
    ).all()
    draft_by_project = {d.project_id: d for d in drafts}

    from app.db.pmo_mysql import _pmo_configured, pmo_query
    pmo_on = _pmo_configured()

    for p in projects:
        draft = draft_by_project.get(p.id)
        if draft:
            try:
                resources = json.loads(draft.resources_json)
            except Exception:
                resources = []
            for r in resources:
                name = r.get("staff_name")
                if name:
                    entry = detail.setdefault(name, {}).setdefault(p.id, {"pct": 0, "project_name": p.short_name, "project_code": p.project_code})
                    entry["pct"] += (r.get("distribution") or 0)
        elif pmo_on and p.project_code:
            try:
                rows = pmo_query(
                    'SELECT staff_name, distribution FROM actual_resource '
                    'WHERE project_code = %s AND year = %s AND month = %s',
                    (p.project_code, y, m)
                )
                if not rows:
                    # Nothing for the current month specifically — fall back
                    # to whichever past month this project most recently had
                    # an actual submission for, rather than treating "not
                    # touched yet this month" the same as "zero allocation".
                    latest = pmo_query(
                        'SELECT year, month FROM actual_resource WHERE project_code = %s '
                        'ORDER BY year DESC, month DESC LIMIT 1',
                        (p.project_code,)
                    )
                    if latest:
                        rows = pmo_query(
                            'SELECT staff_name, distribution FROM actual_resource '
                            'WHERE project_code = %s AND year = %s AND month = %s',
                            (p.project_code, latest[0]['year'], latest[0]['month'])
                        )
                for row in rows:
                    name = row.get("staff_name")
                    if name:
                        entry = detail.setdefault(name, {}).setdefault(p.id, {"pct": 0, "project_name": p.short_name, "project_code": p.project_code})
                        entry["pct"] += float(row.get("distribution") or 0)
            except Exception as e:
                print(f'[allocation-summary] PMO query failed for {p.project_code} (non-fatal): {e}')

    return detail


def _compute_allocation_summary(db: Session) -> Dict[str, float]:
    """Collapsed {resource_name: total_pct} view of _compute_allocation_detail — see there for the full explanation."""
    detail = _compute_allocation_detail(db)
    return {name: sum(proj["pct"] for proj in projs.values()) for name, projs in detail.items()}


@resources_router.get("/allocation-summary")
def get_resource_allocation_summary(db: Session = Depends(get_db)):
    """
    Used by the Resources master list to flag anyone whose accumulated total
    exceeds 100% with a warning — the 100% cap was removed as a hard block
    (a resource CAN be over-allocated now), so this is how it surfaces
    instead: visible, not blocking.
    """
    return {"totals": _compute_allocation_summary(db)}


@resources_router.get("/{resource_id}/remaining-capacity")
def get_remaining_capacity(
    resource_id: int,
    exclude_project_code: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Return how much allocation % this resource still has available — reads
    the same live Actual-section data as _compute_allocation_detail (this
    month's ActualDraft if one exists, otherwise the submitted actual,
    otherwise nothing), not the local Allocation table, which has been
    frozen at 0% since conversion stopped setting a real percentage there.
    Before this fix, this endpoint was the one place in the app that never
    got updated when that change was made — it always reported 100%
    remaining regardless of what had actually been entered in Plan/Actual.

    Pass exclude_project_code when editing a project's own Plan/Actual section —
    this excludes that project's own allocation of the resource so editing the
    same project doesn't wrongly show reduced remaining % against itself.
    """
    r = db.query(Resource).filter(Resource.id == resource_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Resource not found")
    detail = _compute_allocation_detail(db)
    per_project = detail.get(r.name, {})
    total = sum(
        proj["pct"] for proj in per_project.values()
        if exclude_project_code is None or proj.get("project_code") != exclude_project_code
    )
    return {
        "resource_id": resource_id,
        "resource_name": r.name,
        "total_allocated_pct": total,
        "remaining_pct": 100 - total,   # deliberately not clamped at 0 — negative means over-allocated, and the frontend highlights that rather than hiding it
        "is_fully_allocated": total >= 100,
    }


@resources_router.get("")
def list_resources(active_only: bool = False, db: Session = Depends(get_db)):
    q = db.query(Resource)
    if active_only:
        q = q.filter(Resource.is_active == True)
    detail = _compute_allocation_detail(db)
    summary = {name: sum(proj["pct"] for proj in projs.values()) for name, projs in detail.items()}
    return [resource_to_dict(r, summary, detail) for r in q.order_by(Resource.name).all()]

@resources_router.post("", status_code=201)
def create_resource(body: ResourceCreate, db: Session = Depends(get_db)):
    r = Resource(
        name=body.name, full_name=body.full_name, employee_code=body.employee_code,
        resource_type=body.resource_type, rate_card=body.rate_card,
        monthly_cost=body.monthly_cost, status=body.status, email=body.email, remarks=body.remarks,
    )
    db.add(r); db.commit(); db.refresh(r)
    detail = _compute_allocation_detail(db)
    summary = {name: sum(proj["pct"] for proj in projs.values()) for name, projs in detail.items()}
    return resource_to_dict(r, summary, detail)

@resources_router.delete("/{resource_id}", status_code=204)
def delete_resource(resource_id: int, db: Session = Depends(get_db)):
    r = db.query(Resource).filter(Resource.id == resource_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Resource not found")
    db.delete(r); db.commit()

@resources_router.get("/{resource_id}")
def get_resource(resource_id: int, db: Session = Depends(get_db)):
    r = db.query(Resource).filter(Resource.id == resource_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Resource not found")
    detail = _compute_allocation_detail(db)
    summary = {name: sum(proj["pct"] for proj in projs.values()) for name, projs in detail.items()}
    return resource_to_dict(r, summary, detail)

@resources_router.patch("/{resource_id}")
def update_resource(resource_id: int, body: ResourceUpdate, db: Session = Depends(get_db)):
    r = db.query(Resource).filter(Resource.id == resource_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Resource not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(r, field, value)
    db.commit()
    db.refresh(r)
    detail = _compute_allocation_detail(db)
    summary = {name: sum(proj["pct"] for proj in projs.values()) for name, projs in detail.items()}
    return resource_to_dict(r, summary, detail)


# ─── PIPELINE router (Salesforce deals) ──────────────────────────────────────


def _mark_converted_in_mysql(project_code: str) -> None:
    """
    Write is_converted=1 to curated_deals matched by project_code.
    Silently skipped if MySQL not configured or is_converted column doesn't exist.

    Add the column first if needed:
        ALTER TABLE curated_CRM.curated_deals
        ADD COLUMN is_converted TINYINT(1) NOT NULL DEFAULT 0;
    """
    from app.db.mysql import is_configured, column_exists, execute
    if not is_configured() or not project_code:
        return
    if not column_exists("curated_deals", "is_converted"):
        return
    try:
        execute(
            "UPDATE curated_deals SET is_converted = 1 WHERE project_code = %s",
            (project_code,)
        )
    except Exception:
        pass  # non-fatal


pipeline_router = APIRouter(prefix="/api/pipeline", tags=["Pipeline"])

def _mysql_row_to_deal(row: dict) -> dict:
    """Map a curated_deals MySQL row to our standard deal shape."""
    # award_date — handle None, empty string, and date/datetime objects
    raw_award = row.get("award_date")
    if raw_award and str(raw_award).strip() not in ("", "None", "null"):
        award_date = str(raw_award)[:10]   # keep only YYYY-MM-DD part
    else:
        award_date = None

    # project_code — strip whitespace in case of trailing spaces in DB
    project_code = row.get("project_code")
    project_code = project_code.strip() if isinstance(project_code, str) and project_code.strip() else None

    return {
        "sf_opportunity_id":      project_code,   # project_code is our unique deal key
        "name":                   row.get("deal_name") or "",
        "account_name":           row.get("account_name") or "",
        "stage":                  row.get("sales_stage") or "",
        "amount":                 float(row.get("estimated_amount") or 0),
        "currency":               "MYR",
        "close_date":             (str(row.get("expected_close_date"))[:10] if row.get("expected_close_date") else None),
        "probability":            float(row.get("probability") or 0),
        "product_type":           "Professional Services",
        "description":            None,
        "owner":                  row.get("account_owner") or "",
        "project_code":           project_code,
        "award_date":             award_date,
        "po_number":              None,
        "so_number":              None,
        "expected_invoice_month": None,
        "expected_invoice_year":  None,
        "pp_stage":               None,
        "pp_status":              None,
        "etl_loaded_at":          str(row.get("etl_loaded_at") or ""),
    }


# Only these 3 stages are shown in Upcoming Projects
ALLOWED_STAGES = (
    "3B - High Chance To Proceed Condition",
    "4A - Almost Win",
    "Closed Won",
)


def _fetch_deals_from_mysql(stage_filter: Optional[str] = None) -> List[dict]:
    """
    Read deals from curated_deals.
    - Only shows stages: 3B, 4A, Closed Won.
    - Only shows expected_close_date this year onwards.
    - Closed Won: also requires award_date IS NOT NULL.
    """
    from app.db.mysql import is_configured, query
    if not is_configured():
        return []

    from datetime import date
    year_start = f"{date.today().year}-01-01"

    placeholders = ",".join(["%s"] * len(ALLOWED_STAGES))

    if stage_filter == "Closed Won":
        sql = """
            SELECT * FROM curated_deals
            WHERE sales_stage = %s
              AND award_date IS NOT NULL
              AND (expected_close_date >= %s OR expected_close_date IS NULL)
            ORDER BY is_converted ASC, deal_name ASC, award_date DESC
        """
        params = ("Closed Won", year_start)
    else:
        sql = f"""
            SELECT * FROM curated_deals
            WHERE sales_stage IN ({placeholders})
              AND (expected_close_date >= %s OR expected_close_date IS NULL)
            ORDER BY is_converted ASC, deal_name ASC, expected_close_date ASC
        """
        params = (*ALLOWED_STAGES, year_start)

    rows = query(sql, params)
    return [_mysql_row_to_deal(r) for r in rows]


@pipeline_router.get("")
async def list_pipeline_deals(db: Session = Depends(get_db)):
    """
    Returns all open deals.
    Source priority: MySQL curated_deals → Salesforce mock (fallback).
    """
    from app.db.mysql import is_configured
    deals = None
    if is_configured():
        try:
            deals = _fetch_deals_from_mysql()   # live MySQL
        except Exception as e:
            # is_configured() only means credentials are present, not that the
            # connection actually works — without this, a genuine connection
            # failure (network blip, wrong password, SSH host down) would
            # crash this endpoint instead of falling back as documented above.
            print(f'[list_pipeline_deals] MySQL query failed, falling back to Salesforce mock: {e}')
    if deals is None:
        deals = await salesforce_service.get_all_ps_deals()   # mock fallback

    # Merge with local DB to show conversion status
    # Build conversion map: check local deals table AND curated_deals in MySQL
    local_deals = {d.sf_opportunity_id: d for d in db.query(Deal).all()}
    # Also read is_converted from MySQL curated_deals (persists across app restarts)
    mysql_converted: set = set()
    from app.db.mysql import is_configured, column_exists, query as mysql_query
    if is_configured() and column_exists("curated_deals", "is_converted"):
        try:
            rows = mysql_query(
                "SELECT project_code FROM curated_deals WHERE is_converted = 1"
            )
            mysql_converted = {r["project_code"] for r in rows if r.get("project_code")}
        except Exception:
            pass  # non-fatal

    result = []
    for d in deals:
        sf_id = d["sf_opportunity_id"]
        local = local_deals.get(sf_id)
        is_conv = (local.is_converted if local else False) or (sf_id in mysql_converted)
        result.append({
            **d,
            "is_converted":         is_conv,
            "converted_project_id": local.converted_project_id if local else None,
            "db_id":                local.id if local else None,
        })
    return result


@pipeline_router.get("/closed-won")
async def closed_won_deals(db: Session = Depends(get_db)):
    """
    Returns Closed Won deals not yet converted to projects.
    Source priority: MySQL curated_deals → Salesforce mock (fallback).
    """
    from app.db.mysql import is_configured
    deals = None
    if is_configured():
        try:
            deals = _fetch_deals_from_mysql(stage_filter="Closed Won")
        except Exception as e:
            print(f'[closed_won_deals] MySQL query failed, falling back to Salesforce mock: {e}')
    if deals is None:
        deals = await salesforce_service.get_closed_won_deals()

    # Filter out already-converted deals — must check BOTH the local DB flag
    # AND MySQL's curated_deals.is_converted, same as list_pipeline_deals does.
    # Checking only one of the two is what caused this banner to disagree
    # with the table below it.
    converted_ids = {
        d.sf_opportunity_id
        for d in db.query(Deal).filter(Deal.is_converted == True).all()
    }
    from app.db.mysql import column_exists, query as mysql_query
    if is_configured() and column_exists("curated_deals", "is_converted"):
        try:
            rows = mysql_query("SELECT project_code FROM curated_deals WHERE is_converted = 1")
            converted_ids |= {r["project_code"] for r in rows if r.get("project_code")}
        except Exception:
            pass  # non-fatal — fall back to whatever the local flag already gave us

    return [
        {**d, "is_converted": False}
        for d in deals
        if d["sf_opportunity_id"] not in converted_ids
    ]

@pipeline_router.post("/{sf_opportunity_id}/mark-converted", status_code=200)
def mark_deal_converted(
    sf_opportunity_id: str, db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    """
    Mark a deal as already converted (e.g. project exists in the system
    or was converted outside this app). Writes is_converted=1 to both
    the local deals table and curated_deals in MySQL.
    Does NOT create a project record.
    """
    if not is_management(current_resource):
        raise HTTPException(status_code=403, detail="Only Management can convert or mark deals as converted.")
    local = db.query(Deal).filter(Deal.sf_opportunity_id == sf_opportunity_id).first()
    if not local:
        # Create a minimal local record just to track the conversion flag
        local = Deal(
            sf_opportunity_id = sf_opportunity_id,
            name              = "—",
            stage             = DealStage.closed_won,
            is_converted      = True,
        )
        db.add(local)
    else:
        local.is_converted = True
    db.commit()
    # Also write to MySQL curated_deals
    _mark_converted_in_mysql(sf_opportunity_id)
    return {"sf_opportunity_id": sf_opportunity_id, "is_converted": True, "message": "Marked as converted"}


@pipeline_router.post("/{sf_opportunity_id}/mark-unconverted", status_code=200)
def mark_deal_unconverted(
    sf_opportunity_id: str, db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    """Undo a mark-converted (in case of mistake)."""
    if not is_management(current_resource):
        raise HTTPException(status_code=403, detail="Only Management can undo a deal conversion mark.")
    local = db.query(Deal).filter(Deal.sf_opportunity_id == sf_opportunity_id).first()
    if local:
        local.is_converted = False
        local.converted_project_id = None
        db.commit()
    # Undo in MySQL too
    from app.db.mysql import is_configured, execute as mysql_exec
    if is_configured():
        try:
            mysql_exec(
                "UPDATE curated_deals SET is_converted = 0 WHERE project_code = %s",
                (sf_opportunity_id,)   # sf_opportunity_id holds project_code
            )
        except Exception:
            pass
    return {"sf_opportunity_id": sf_opportunity_id, "is_converted": False}


@pipeline_router.post("/{sf_opportunity_id}/convert", status_code=201)
async def convert_deal_to_project(
    sf_opportunity_id: str, body: DealConvertIn, db: Session = Depends(get_db),
    current_resource: Optional[Resource] = Depends(get_current_resource),
):
    """
    User has confirmed a closed-won deal → create a new project with their inputs.
    Source: MySQL curated_deals (when configured) or Salesforce mock (fallback).
    """
    if not is_management(current_resource):
        raise HTTPException(status_code=403, detail="Only Management can convert deals into projects.")
    from app.db.mysql import is_configured, query_one
    if is_configured():
        row = query_one(
            "SELECT * FROM curated_deals WHERE project_code = %s LIMIT 1",
            (sf_opportunity_id,)   # sf_opportunity_id holds project_code as the key
        )
        deal_data = _mysql_row_to_deal(row) if row else None
    else:
        deal_data = await salesforce_service.get_deal_by_id(sf_opportunity_id)

    if not deal_data:
        raise HTTPException(status_code=404, detail="Deal not found")

    # Server-side hard validation — cannot be bypassed by frontend
    # Duplicate resources
    alloc_ids = [a.resource_id for a in body.allocations]
    if len(alloc_ids) != len(set(alloc_ids)):
        raise HTTPException(status_code=400, detail="Duplicate resources detected. Each resource can only be assigned once.")

    # Upsert local deal record
    local = db.query(Deal).filter(Deal.sf_opportunity_id == sf_opportunity_id).first()
    if not local:
        # Map stage string to enum safely
        stage_val = deal_data.get("stage", "Closed Won")
        try:
            stage_enum = DealStage(stage_val)
        except ValueError:
            stage_enum = DealStage.closed_won
        def _safe_date(v):
            """Return date string or None — never an empty string."""
            return v if (v and str(v).strip() not in ("", "None", "null")) else None

        local = Deal(
            sf_opportunity_id = sf_opportunity_id,
            name              = deal_data["name"],
            account_name      = deal_data["account_name"],
            stage             = stage_enum,
            amount            = deal_data["amount"],
            currency          = deal_data.get("currency", "MYR"),
            close_date        = _safe_date(deal_data.get("close_date")),
            probability       = deal_data.get("probability", 100),
            product_type      = deal_data.get("product_type", "Professional Services"),
            owner             = deal_data.get("owner", ""),
        )
        db.add(local)
        db.flush()

    if local.is_converted:
        raise HTTPException(status_code=400, detail="Deal already converted to a project")

    # Create project
    total_misc = sum(m.amount or 0 for m in body.misc_costs)
    net_rev = body.contract_value_myr + total_misc
    p = Project(
        name=body.name, short_name=body.short_name,
        project_code=body.project_code or deal_data.get("project_code"),
        customer=deal_data["account_name"],
        entity=body.entity, project_type=body.project_type, technology=body.technology,
        currency=body.currency, contract_value=deal_data["amount"],
        contract_value_myr=body.contract_value_myr,
        project_budget=body.project_budget,
        license_cost=body.license_cost,
        third_party_cost=0,   # deprecated in place — misc_costs is the itemized replacement below
        revenue_deduction=total_misc, net_revenue=net_rev,
        budget=net_rev * 0.5, budget_utilized=0,
        gp_margin_target=body.gp_margin_target,
        start_date=(body.start_date or None), original_end_date=(body.original_end_date or None),
        account_manager=body.account_manager, project_manager=body.project_manager,
        salesforce_deal_id=sf_opportunity_id,
        status=ProjectStatus.in_progress, rag=RAGStatus.green,
    )
    db.add(p)
    db.flush()

    for mc in body.misc_costs:
        db.add(MiscCost(project_id=p.id, category=mc.category, custom_detail=mc.custom_detail, amount=mc.amount or 0))

    for a in body.allocations:
        db.add(Allocation(resource_id=a.resource_id, project_id=p.id,
                          allocation_pct=a.allocation_pct,
                          role=getattr(a, "role", None)))

    local.is_converted = True
    local.converted_project_id = p.id
    try:
        db.commit()
        db.refresh(p)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(exc)}")

    # Write is_converted back to curated_deals in MySQL (best-effort — column may not exist)
    _mark_converted_in_mysql(sf_opportunity_id)

    # No longer pushes straight to plan_project/plan_resource/plan_misc_cost —
    # instead this creates the FIRST version of a PlanDraft (SCD Type 2, same
    # pattern as ActualDraft), pre-filled with the resources/roles chosen just
    # now (0% allocation, matching how Resource Allocation now works during
    # conversion). This is what the Plan tab's Resource Allocation table shows
    # immediately and lets the user edit/re-save until they click Submit Plan —
    # that's the only action that actually writes to the PMO plan_* tables.
    # Seeded for the current calendar month, matching the Plan tab's own
    # default month selection for a brand-new project — always current month,
    # regardless of whether it's been submitted yet.
    today_date = date.today()
    draft_year, draft_month = today_date.year, today_date.month

    res_lookup = {r.id: r for r in db.query(Resource).filter(Resource.id.in_(alloc_ids)).all()} if alloc_ids else {}
    draft_resources = [
        {
            "staff_name": res_lookup[a.resource_id].name,
            "role": a.role or "",
            "monthly_salary": res_lookup[a.resource_id].monthly_cost or 0,
            "distribution": a.allocation_pct or 0,
        }
        for a in body.allocations if a.resource_id in res_lookup
    ]
    draft_misc_costs = [
        {"category": mc.category, "custom_detail": mc.custom_detail, "amount": mc.amount or 0}
        for mc in body.misc_costs
    ]
    plan_draft = PlanDraft(
        project_id=p.id, year=draft_year, month=draft_month,
        resources_json=json.dumps(draft_resources),
        misc_costs_json=json.dumps(draft_misc_costs),
        saved_by=current_resource.id if current_resource else None,
        version=1, is_current=True,
    )
    db.add(plan_draft)
    db.flush()
    plan_draft.entity_id = plan_draft.id
    db.commit()

    return project_to_dict(p)


# ─── BILLING router (Autocount AR) ───────────────────────────────────────────

billing_router = APIRouter(prefix="/api/billing", tags=["Billing"])

@billing_router.get("")
def list_billings(project_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(Billing)
    if project_id:
        q = q.filter(Billing.project_id == project_id)
    rows = q.order_by(Billing.invoice_date.desc()).all()
    return [
        {"id": b.id, "project_id": b.project_id,
         "project_name": b.project.short_name if b.project else None,
         "autocount_ref": b.autocount_ref, "invoice_number": b.invoice_number,
         "invoice_date": b.invoice_date, "due_date": b.due_date,
         "amount": b.amount, "currency": b.currency,
         "is_paid": b.is_paid, "paid_date": b.paid_date,
         "notes": b.notes, "source": b.source}
        for b in rows
    ]

@billing_router.post("", status_code=201)
def create_billing(body: BillingCreate, db: Session = Depends(get_db)):
    b = Billing(
        project_id=body.project_id, invoice_number=body.invoice_number,
        invoice_date=body.invoice_date, due_date=body.due_date,
        amount=body.amount, currency=body.currency,
        is_paid=body.is_paid, paid_date=body.paid_date,
        notes=body.notes, source="manual"
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return {"id": b.id, "project_id": b.project_id, "amount": b.amount, "source": b.source}

@billing_router.patch("/{billing_id}/mark-paid")
def mark_paid(billing_id: int, paid_date: str = Body(..., embed=True), db: Session = Depends(get_db)):
    b = db.query(Billing).filter(Billing.id == billing_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Billing record not found")
    b.is_paid = True
    b.paid_date = paid_date
    db.commit()
    return {"id": b.id, "is_paid": True, "paid_date": paid_date}

@billing_router.get("/autocount/sync")
async def sync_autocount(db: Session = Depends(get_db)):
    """Pull latest AR invoices from Autocount and upsert into billing table."""
    invoices = await autocount_service.get_ar_invoices()
    synced, skipped = 0, 0
    for inv in invoices:
        if not inv.get("autocount_ref"):
            continue
        existing = db.query(Billing).filter(Billing.autocount_ref == inv["autocount_ref"]).first()
        # Match to project by hint (in real impl: match by customer/SO number)
        proj = db.query(Project).filter(
            Project.name.contains(inv.get("project_hint", "___NOMATCH___"))
        ).first() or db.query(Project).filter(
            Project.short_name.ilike(f"%{inv.get('customer','')}%")
        ).first()
        if not proj:
            skipped += 1
            continue
        if existing:
            existing.is_paid = inv["is_paid"]
            existing.paid_date = inv.get("paid_date")
            existing.amount = inv["amount"]
        else:
            db.add(Billing(
                project_id=proj.id, autocount_ref=inv["autocount_ref"],
                invoice_number=inv.get("invoice_number"),
                invoice_date=inv.get("invoice_date"), due_date=inv.get("due_date"),
                amount=inv["amount"], currency=inv.get("currency", "MYR"),
                is_paid=inv["is_paid"], paid_date=inv.get("paid_date"),
                source="autocount"
            ))
            synced += 1
    db.commit()
    return {"synced": synced, "skipped": skipped, "total": len(invoices)}


# ─── BUDGET router ────────────────────────────────────────────────────────────

budget_router = APIRouter(prefix="/api/budget", tags=["Budget"])


@budget_router.get("/summary")
def budget_summary(db: Session = Depends(get_db)):
    """
    Cost/RAG/Progress now come from raw_pmo's actual_* tables (what the user
    submits in the Actual tab) rather than the local SQLite Allocation/Milestone
    snapshot from conversion time. Falls back to the local calculation only
    when PMO isn't configured at all (e.g. local dev without MySQL access) —
    per-project, missing PMO data simply shows as 0, since that's the honest
    current state rather than stale conversion-time numbers.
    """
    from app.db.pmo_mysql import _pmo_configured, pmo_query
    pmo_on = _pmo_configured()

    projects = db.query(Project).filter(Project.status == ProjectStatus.in_progress).all()
    rows = []
    for p in projects:
        license_cost  = p.license_cost or 0
        project_budget = p.project_budget or 0
        contract_myr  = p.contract_value_myr or 0
        forecasted_gr = contract_myr - project_budget

        hc_cost          = 0.0
        rag              = p.rag.value if p.rag else None
        planned_progress = 0.0
        actual_progress  = 0.0
        # Billed = completed local Milestone amounts. Milestones now live in the
        # Schedule section (local SQLite), not actual_milestone — that MySQL
        # table is no longer written to at all since Milestones moved out of
        # Plan/Actual, so summing it here would silently read frozen data.
        billed = sum(m.amount or 0 for m in p.milestones if m.is_completed)
        # Revenue Deduction spend-to-date — this response field is still named
        # third_party_cost for wire-format compatibility with existing
        # consumers (e.g. Budget Utilization), but the LOCAL third_party_cost
        # column is now permanently 0 (see the Misc Cost / Revenue Deduction
        # feature). The real, live number is the sum of actual_misc_cost —
        # the same "query PMO fresh" pattern already used for hc_cost below.
        misc_cost_total = 0.0

        if pmo_on and p.project_code:
            try:
                util_rows = pmo_query(
                    'SELECT SUM(project_cost) as total FROM actual_resource WHERE project_code = %s',
                    (p.project_code,)
                )
                hc_cost = float(util_rows[0]['total'] or 0) if util_rows else 0.0

                misc_rows = pmo_query(
                    'SELECT SUM(amount) as total FROM actual_misc_cost WHERE project_code = %s',
                    (p.project_code,)
                )
                misc_cost_total = float(misc_rows[0]['total'] or 0) if misc_rows else 0.0

                actual_proj_rows = pmo_query(
                    'SELECT rag_status FROM actual_project WHERE project_code = %s ORDER BY submit_date DESC LIMIT 1',
                    (p.project_code,)
                )
                if actual_proj_rows and actual_proj_rows[0]['rag_status']:
                    rag_raw = actual_proj_rows[0]['rag_status']
                    rag = rag_raw.capitalize() if rag_raw else rag
            except Exception as e:
                print(f'[budget_summary] PMO query failed for {p.project_code} (non-fatal): {e}')

        # Progress — sourced from the WBS Schedule rollup (the actual live
        # progress tracking system), same calculation complete_project uses
        # to gate whether a project is allowed to be marked Completed.
        from app.api.gantt import _rollup_group
        from app.models import GanttTask
        wbs_tasks = db.query(GanttTask).filter(GanttTask.project_id == p.id, GanttTask.is_current == True).all()
        wbs_rollup = _rollup_group(wbs_tasks)
        planned_progress = wbs_rollup["planned_pct"]
        actual_progress  = wbs_rollup["actual_pct"]

        utilized  = hc_cost + license_cost + misc_cost_total
        actual_gr = contract_myr - utilized
        util_pct  = round(utilized / project_budget, 4) if project_budget else 0

        rows.append({
            "project_id":          p.id,
            "short_name":          p.short_name,
            "project_code":        p.project_code,
            "currency":            p.currency or "MYR",
            "contract_value":      p.contract_value or contract_myr,
            "contract_value_myr":  contract_myr,
            "project_budget":      project_budget,
            "forecasted_gr":       forecasted_gr,
            "license_cost":        license_cost,
            "third_party_cost":    misc_cost_total,
            "hc_cost":             hc_cost,
            "budget_utilized":     utilized,
            "actual_gr":           actual_gr,
            "util_pct":            util_pct,
            "planned_progress":    planned_progress,
            "actual_progress":     actual_progress,
            "billed_amount":       billed,
            "headcount":           len(p.allocations),
            "rag":                 rag,
            "cashflow_status":     p.cashflow_status.value if p.cashflow_status else None,
            "gp_margin_forecast":  p.gp_margin_forecast,
        })
    total_val  = sum(r["contract_value_myr"] for r in rows)
    total_util = sum(r["budget_utilized"]     for r in rows)
    total_bud  = sum(r["project_budget"]      for r in rows)
    return {
        "total_portfolio_myr": total_val,
        "total_budget":        total_bud,
        "total_utilized":      total_util,
        "overall_util_pct":    round(total_util / total_bud, 4) if total_bud else 0,
        "red_count":           sum(1 for r in rows if r["rag"] == "Red"),
        "positive_cf_count":   sum(1 for r in rows if r["cashflow_status"] == "Positive"),
        "projects":            rows,
    }


@budget_router.get("/compare")
def budget_compare(
    year1: int, month1: int, year2: int, month2: int,
    db: Session = Depends(get_db),
):
    """
    Portfolio-wide comparison of two selected (year, month) periods. For each
    active project: total actual resource cost for each period, plus the
    per-resource breakdown (who worked on it and at what cost) for each
    period — this is the same actual_resource data that feeds the Monthly
    Actual Resource Cost table in the Plan tab, just queried for two
    arbitrary months side by side instead of "this month vs one month back".
    A project with nothing submitted for a given period simply shows 0 and
    an empty breakdown for that period, not an error.
    """
    from app.db.pmo_mysql import _pmo_configured, pmo_query
    pmo_on = _pmo_configured()

    projects = db.query(Project).filter(Project.status == ProjectStatus.in_progress).all()
    rows = []
    for p in projects:
        month1_resources, month2_resources = [], []
        if pmo_on and p.project_code:
            try:
                month1_resources = pmo_query(
                    'SELECT staff_name, role, project_cost FROM actual_resource '
                    'WHERE project_code = %s AND year = %s AND month = %s ORDER BY staff_name',
                    (p.project_code, year1, month1)
                )
                month2_resources = pmo_query(
                    'SELECT staff_name, role, project_cost FROM actual_resource '
                    'WHERE project_code = %s AND year = %s AND month = %s ORDER BY staff_name',
                    (p.project_code, year2, month2)
                )
            except Exception as e:
                print(f'[budget_compare] PMO query failed for {p.project_code} (non-fatal): {e}')

        month1_total = sum(float(r.get('project_cost') or 0) for r in month1_resources)
        month2_total = sum(float(r.get('project_cost') or 0) for r in month2_resources)

        rows.append({
            "project_id":   p.id,
            "short_name":   p.short_name,
            "project_code": p.project_code,
            "month1_total":     month1_total,
            "month1_resources": [{"staff_name": r["staff_name"], "role": r.get("role"), "cost": float(r.get("project_cost") or 0)} for r in month1_resources],
            "month2_total":     month2_total,
            "month2_resources": [{"staff_name": r["staff_name"], "role": r.get("role"), "cost": float(r.get("project_cost") or 0)} for r in month2_resources],
            "delta": month2_total - month1_total,
        })

    return {
        "month1": {"year": year1, "month": month1},
        "month2": {"year": year2, "month": month2},
        "projects": rows,
        "total_month1": sum(r["month1_total"] for r in rows),
        "total_month2": sum(r["month2_total"] for r in rows),
    }


# ─── INTEGRATIONS router ─────────────────────────────────────────────────────

integrations_router = APIRouter(prefix="/api/integrations", tags=["Integrations"])

@integrations_router.post("/salesforce/sync")
async def sync_salesforce(db: Session = Depends(get_db)):
    """
    Pull all open PS deals + Closed Won from Salesforce (or mock) and
    upsert them into the local deals table.
    Already-converted deals keep their is_converted=True flag untouched.
    """
    try:
        result = await salesforce_service.sync_all()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Salesforce sync failed: {str(e)}")

    records = result.get("records", [])
    if not records:
        # Mock mode returns no records list — fall back to fetching separately
        open_deals   = await salesforce_service.get_all_ps_deals()
        closed_won   = await salesforce_service.get_closed_won_deals()
        seen = set()
        records = []
        for d in open_deals + closed_won:
            if d["sf_opportunity_id"] not in seen:
                seen.add(d["sf_opportunity_id"])
                records.append(d)

    upserted = 0
    updated  = 0
    now = datetime.utcnow()

    for d in records:
        sf_id = d["sf_opportunity_id"]
        local = db.query(Deal).filter(Deal.sf_opportunity_id == sf_id).first()
        if local:
            # Update mutable fields — never overwrite is_converted
            local.name        = d["name"]
            local.account_name = d["account_name"]
            local.stage       = d["stage"]
            local.amount      = d["amount"]
            local.currency    = d.get("currency", "MYR")
            local.close_date  = d["close_date"]
            local.probability = d["probability"]
            local.description = d.get("description")
            local.owner       = d.get("owner")
            local.project_code     = d.get("project_code")
            local.po_number        = d.get("po_number")
            local.so_number        = d.get("so_number")
            local.expected_invoice_month = d.get("expected_invoice_month")
            local.expected_invoice_year  = d.get("expected_invoice_year")
            local.pp_stage    = d.get("pp_stage")
            local.pp_status   = d.get("pp_status")
            local.last_synced_at = now
            updated += 1
        else:
            db.add(Deal(
                sf_opportunity_id = sf_id,
                name              = d["name"],
                account_name      = d["account_name"],
                stage             = d["stage"],
                amount            = d["amount"],
                currency          = d.get("currency", "MYR"),
                close_date        = d["close_date"],
                probability       = d["probability"],
                product_type      = d.get("product_type", "Professional Services"),
                description       = d.get("description"),
                owner             = d.get("owner"),
                project_code      = d.get("project_code"),
                po_number         = d.get("po_number"),
                so_number         = d.get("so_number"),
                expected_invoice_month = d.get("expected_invoice_month"),
                expected_invoice_year  = d.get("expected_invoice_year"),
                pp_stage          = d.get("pp_stage"),
                pp_status         = d.get("pp_status"),
                last_synced_at    = now,
                is_converted      = False,
            ))
            upserted += 1

    db.commit()
    return {
        "message":      "Salesforce sync complete",
        "source":       result.get("source", "mock"),
        "upserted_new": upserted,
        "updated":      updated,
        "total":        upserted + updated,
    }

@integrations_router.get("/crm/test")
def test_crm_connection():
    """
    Test the MySQL CRM connection (with SSH tunnel if configured).
    Returns connection details on success, actionable error on failure.
    """
    from app.db.mysql import test_connection, is_configured, _ssh_configured
    from app.config import settings
    ok, message = test_connection()
    return {
        "configured":  is_configured(),
        "connected":   ok,
        "message":     message,
        "mysql_host":  settings.MYSQL_HOST,
        "mysql_port":  settings.MYSQL_PORT,
        "mysql_db":    settings.MYSQL_DATABASE,
        "ssh_enabled": _ssh_configured(),
        "ssh_host":    settings.SSH_HOST if _ssh_configured() else None,
    }


@integrations_router.get("/pmo/test")
def test_pmo_connection():
    """
    Test the MySQL PMO connection (raw_pmo — Plan/Actual tables, with SSH tunnel if configured).
    """
    from app.db.pmo_mysql import _pmo_configured, _ssh_configured
    from app.config import settings

    configured = _pmo_configured()
    connected  = False
    message    = "PMO database not configured. Add PMO_MYSQL_* to backend/.env"

    if configured:
        try:
            from app.db.pmo_mysql import pmo_query
            pmo_query("SELECT 1")
            connected = True
            message = "Connected successfully"
        except Exception as e:
            message = f"Connection failed: {e}"

    return {
        "configured":  configured,
        "connected":   connected,
        "message":     message,
        "mysql_host":  getattr(settings, "PMO_MYSQL_HOST", ""),
        "mysql_port":  getattr(settings, "PMO_MYSQL_PORT", 3306),
        "mysql_db":    getattr(settings, "PMO_MYSQL_DATABASE", "raw_pmo"),
        "ssh_enabled": _ssh_configured(),
        "ssh_host":    settings.SSH_HOST if _ssh_configured() else None,
    }


@integrations_router.get("/status")
def integration_status():
    """Returns the status of all integrations."""
    from app.db.mysql import is_configured, test_connection
    ok, msg = test_connection()
    return {
        "mysql": {
            "configured": is_configured(),
            "connected":  ok,
            "message":    msg,
        }
    }
