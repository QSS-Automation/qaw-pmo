from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime,
    ForeignKey, Text, Enum as SAEnum, UniqueConstraint
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.db.database import Base


# ── Enums ────────────────────────────────────────────────────────────────────

class ProjectStatus(str, enum.Enum):
    in_progress = "In Progress"
    completed   = "Completed"
    on_hold     = "On Hold"
    dropped     = "Dropped"
    not_started = "Not Started"


class RAGStatus(str, enum.Enum):
    green = "Green"
    amber = "Amber"
    red   = "Red"
    none  = "None"


class CashflowStatus(str, enum.Enum):
    positive = "Positive"
    negative = "Negative"


class DealStage(str, enum.Enum):
    # Exact API names from QAW Salesforce (StageName field)
    qualification_stage   = "0E - Qualification Stage"
    qualified_condition   = "1D - Qualified Condition"
    evaluation_condition  = "2C - Evaluation Condition"
    high_chance           = "3B - High Chance To Proceed Condition"
    almost_win            = "4A - Almost Win"
    closed_won            = "Closed Won"
    closed_lost           = "Closed Lost"
    kiv                   = "KIV"


class ResourceType(str, enum.Enum):
    qaw     = "QAW"
    intern  = "Intern"
    non_qaw = "Non-QAW"
    presales = "Pre Sales"


# ── Project ──────────────────────────────────────────────────────────────────

class Project(Base):
    __tablename__ = "projects"

    id              = Column(Integer, primary_key=True, index=True)
    code            = Column(String(50), unique=True, nullable=True)
    name            = Column(String(200), nullable=False)
    wbs_uploaded    = Column(Boolean, default=False)   # WBS Excel import allowed once per project
    short_name      = Column(String(80), nullable=False)
    project_code    = Column(String(50), nullable=True)
    customer        = Column(String(100), nullable=False)
    entity          = Column(String(50), nullable=True)   # QM, QPH, etc.
    project_type    = Column(String(80), nullable=True)
    technology      = Column(String(200), nullable=True)
    currency        = Column(String(10), default="MYR")

    # Financials
    contract_value      = Column(Float, default=0)         # original currency amount
    contract_value_myr  = Column(Float, default=0)         # converted to MYR
    revenue_deduction   = Column(Float, default=0)
    net_revenue         = Column(Float, default=0)
    project_budget      = Column(Float, default=0)         # user-defined project budget in MYR
    budget              = Column(Float, default=0)         # kept for backward compat (50% net rev)
    budget_utilized     = Column(Float, default=0)         # total cost incurred
    license_cost        = Column(Float, default=0)         # manually filled
    third_party_cost    = Column(Float, default=0)         # manually filled
    gp_margin_target    = Column(Float, default=0.5)
    gp_margin_forecast  = Column(Float, nullable=True)

    # Progress
    planned_progress = Column(Float, default=0)
    actual_progress  = Column(Float, default=0)
    billed_pct       = Column(Float, default=0)

    # Dates
    start_date      = Column(String(20), nullable=True)
    original_end_date = Column(String(20), nullable=True)
    rebased_end_date  = Column(String(20), nullable=True)

    # Status
    status          = Column(SAEnum(ProjectStatus), default=ProjectStatus.in_progress)
    rag             = Column(SAEnum(RAGStatus), default=RAGStatus.green)
    cashflow_status = Column(SAEnum(CashflowStatus), default=CashflowStatus.negative)
    health_remarks  = Column(Text, nullable=True)

    # Risk
    timeline_risk   = Column(String(30), nullable=True)
    scope_risk      = Column(String(30), nullable=True)
    budget_risk     = Column(String(30), nullable=True)
    overall_risk    = Column(String(30), nullable=True)

    # People
    account_manager = Column(String(80), nullable=True)
    project_manager = Column(String(80), nullable=True)

    # Source
    salesforce_deal_id = Column(String(50), nullable=True)  # link back to deal

    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    allocations     = relationship("Allocation",      back_populates="project", cascade="all, delete-orphan")
    billings        = relationship("Billing",         back_populates="project", cascade="all, delete-orphan")
    # viewonly + filtered to the current SCD version — every existing reader
    # (budget_summary's billed sum, project_to_dict) keeps working unchanged,
    # transparently seeing only current milestones, never superseded versions.
    # Cascading delete no longer happens automatically here — see
    # delete_project, which explicitly cleans up Milestone/GanttTask/etc rows.
    milestones      = relationship(
        "Milestone", primaryjoin="and_(Project.id==Milestone.project_id, Milestone.is_current==True)",
        viewonly=True,
    )
    misc_costs      = relationship("MiscCost",        back_populates="project", cascade="all, delete-orphan")


# ── Resource (headcount) ─────────────────────────────────────────────────────

class Resource(Base):
    __tablename__ = "resources"

    id              = Column(Integer, primary_key=True, index=True)
    name            = Column(String(100), nullable=False)   # short/display name used throughout the UI
    full_name       = Column(String(150), nullable=True)    # full legal name — matched against SSO identity later
    employee_code   = Column(String(20), nullable=True)   # QAW060, etc.
    resource_type   = Column(String(30), default="QAW")
    # First-layer access role: Admin | Management | Project Manager | Account
    # Manager | Team Member. Deliberately separate from resource_type (which
    # tracks employment/cost-card category — QAW/Non-QAW/Intern — and is
    # unrelated to what someone can see or edit). Defaults to the
    # least-privileged role; Admin assigns anything higher explicitly via the
    # Permissions page. The SECOND layer — whether someone is staffed as PM
    # on a specific project — is unchanged and lives in the Allocation/
    # staffing cascade, not here.
    access_role     = Column(String(30), default="Team Member", nullable=False)
    rate_card       = Column(Integer, nullable=True)      # seniority 1–25
    monthly_cost    = Column(Float, nullable=False)
    is_active       = Column(Boolean, default=True)
    status          = Column(String(20), default="Active")   # Active | No Project | Resigned — user-editable

    email          = Column(String(120), nullable=True)

    # Invitation flow — Admin invites someone by name+email; invite_token is
    # a one-time, unguessable link that "activates" this Resource on
    # whichever browser opens it (writes to localStorage the same way the
    # "Logged in as" dropdown already does — this app has no password-based
    # accounts, so that's the closest equivalent to a real login it has).
    # The token itself is only ever needed for that one activation; access
    # afterward comes from the browser's own cached identity, not the token.
    invite_token    = Column(String(64), nullable=True, unique=True, index=True)
    invite_status   = Column(String(20), nullable=True)   # Pending | Accepted — null for resources never invited (e.g. seeded ones)
    invited_at      = Column(DateTime(timezone=True), nullable=True)
    accepted_at     = Column(DateTime(timezone=True), nullable=True)

    remarks         = Column(Text, nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), onupdate=func.now())

    allocations     = relationship("Allocation", back_populates="resource", cascade="all, delete-orphan")


# ── Allocation (Resource ↔ Project) ──────────────────────────────────────────

class Allocation(Base):
    __tablename__ = "allocations"

    id              = Column(Integer, primary_key=True, index=True)
    resource_id     = Column(Integer, ForeignKey("resources.id"), nullable=False)
    project_id      = Column(Integer, ForeignKey("projects.id"), nullable=False)
    allocation_pct  = Column(Float, default=100)          # 0–100
    role            = Column(String(60), nullable=True)   # e.g. Project Manager
    start_month     = Column(String(10), nullable=True)   # e.g. "2026-01"
    end_month       = Column(String(10), nullable=True)
    notes           = Column(String(200), nullable=True)

    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), onupdate=func.now())

    resource        = relationship("Resource", back_populates="allocations")
    project         = relationship("Project", back_populates="allocations")


# ── Milestone ─────────────────────────────────────────────────────────────────

class Milestone(Base):
    """
    SCD Type 2. id is a per-VERSION surrogate key; entity_id is the stable
    logical identifier that stays the same across every version of "this
    milestone" — it's what the API and frontend always treat as "the id".
    Editing a milestone never UPDATEs a row: it closes the current version
    (end_date=now, is_current=False) and inserts a new one (same entity_id,
    version+1, is_current=True). There is no separate revision/audit table —
    the full history is just every row sharing the same entity_id, ordered
    by effective_date. Exactly one row per entity_id has is_current=True at
    any moment (zero, if it's been deleted).
    """
    __tablename__ = "milestones"

    id                = Column(Integer, primary_key=True, index=True)
    entity_id         = Column(Integer, nullable=True, index=True)   # briefly NULL between insert and self-assignment; always set by the time a caller sees the row
    version           = Column(Integer, nullable=False, default=1)
    effective_date    = Column(DateTime, server_default=func.now())
    end_date          = Column(DateTime, nullable=True)
    is_current        = Column(Boolean, default=True, index=True)

    project_id      = Column(Integer, ForeignKey("projects.id"), nullable=False)
    label           = Column(String(100), nullable=False)
    percentage      = Column(Float, default=0)            # % of contract value
    due_date        = Column(String(20), nullable=True)
    is_completed      = Column(Boolean, default=False)
    completed_date    = Column(String(20), nullable=True)
    amount            = Column(Float, default=0)
    invoice_number    = Column(String(50), nullable=True)
    invoice_date      = Column(String(20), nullable=True)
    autocount_ref     = Column(String(50), nullable=True)
    is_paid           = Column(Boolean, default=False)
    paid_date         = Column(String(20), nullable=True)
    notification_sent = Column(Boolean, default=False)


class MiscCost(Base):
    """
    Itemized 'Revenue Deduction' line items — replaces the old flat
    third_party_cost / revenue_deduction number fields. category is one of
    the fixed dropdown options; custom_detail holds the free-text description
    when category == "Others". The SUM of amounts is written into the
    existing Project.revenue_deduction column (kept for backward compat with
    every net-base formula that already reads it) — third_party_cost is
    always 0 going forward, so those same formulas keep working unchanged.
    """
    __tablename__ = "misc_costs"

    id              = Column(Integer, primary_key=True, index=True)
    project_id      = Column(Integer, ForeignKey("projects.id"), nullable=False)
    category        = Column(String(60), nullable=False)   # Outsourced Professional Services | Training | Logistics | Others
    custom_detail   = Column(String(255), nullable=True)   # free text, only meaningful when category == "Others"
    amount          = Column(Float, default=0)

    project         = relationship("Project", back_populates="misc_costs")


# ── Gantt schedule (independent of Milestones — pure scheduling/progress) ────
class GanttTask(Base):
    """
    SCD Type 2. One version-row per SUB-ACTIVITY — the leaf level of the WBS
    hierarchy (Category → Activity → Sub-Activity). task_name holds the
    sub-activity's own name; category/activity identify which branch of the
    WBS it rolls up into. Activity- and Category-level rows shown in the
    dashboard/Gantt are NOT stored — they're computed live by averaging/
    min/max over the CURRENT sub-activities that share the same
    category+activity (see gantt.py).

    id is a per-VERSION surrogate key; entity_id is the stable logical task
    identifier used everywhere else (GanttProgressLog, PendingDateChange,
    the API, the frontend) — it never changes across edits. Every field
    change closes the current version (end_date=now, is_current=False) and
    inserts a new one (same entity_id, version+1). There's no separate
    revision table — the history IS the set of rows sharing an entity_id,
    ordered by effective_date. A pending (not yet Management-approved) date
    change does NOT create a new version — planned_start/planned_end stay on
    the current version until approved; see PendingDateChange.

    status must be one of the fixed WBS statuses (see STATUS_PERCENT_MAP in
    app/api/gantt.py) — percent_complete is always DERIVED from status, never
    entered as a free number, so it stays consistent with the WBS status list.
    """
    __tablename__ = "gantt_tasks"

    id                = Column(Integer, primary_key=True, index=True)
    entity_id         = Column(Integer, nullable=True, index=True)   # briefly NULL between insert and self-assignment; always set by the time a caller sees the row
    version           = Column(Integer, nullable=False, default=1)
    effective_date    = Column(DateTime, server_default=func.now())
    end_date          = Column(DateTime, nullable=True)
    is_current        = Column(Boolean, default=True, index=True)

    project_id        = Column(Integer, ForeignKey("projects.id"), nullable=False)
    category          = Column(String(200), nullable=False, default="")
    activity          = Column(String(200), nullable=False, default="")
    task_name         = Column(String(200), nullable=False)   # Sub-Activity name
    assigned_to       = Column(String(150), nullable=True)    # from WBS Excel's "Assigned To" — freely editable
    planned_start     = Column(String(20), nullable=True)     # YYYY-MM-DD
    planned_end       = Column(String(20), nullable=True)     # YYYY-MM-DD
    status            = Column(String(50), default="Not Started")
    percent_complete  = Column(Float, default=0)              # derived from status
    sort_order        = Column(Integer, default=0)


class GanttProgressLog(Base):
    """
    A dated progress-update entry for one GanttTask (sub-activity) — the
    'site diary' style record shown in the Progress Update panel. Always
    was, and remains, a pure append-only event log — SCD Type 2 (multi-row-
    per-entity-with-supersession) doesn't apply here, since there's no
    "current version" to replace: every entry is already its own permanent
    historical record the moment it's created.

    gantt_task_id stores the task's stable entity_id (NOT a specific
    version's surrogate id) — a progress note belongs to "the task" as a
    concept, not to whichever version happened to be current when it was
    logged. Not a formal SQL foreign key: entity_id is intentionally not
    unique on gantt_tasks (many version-rows share one), so a standard FK
    constraint can't target it.

    status is the WBS status chosen at that update; percent_complete is the
    resolved value at log time (stored alongside status so history stays
    stable even if the status→% mapping is ever changed later).
    """
    __tablename__ = "gantt_progress_logs"

    id               = Column(Integer, primary_key=True, index=True)
    gantt_task_id    = Column(Integer, nullable=False, index=True)   # = GanttTask.entity_id
    log_date         = Column(String(20), nullable=False)   # YYYY-MM-DD
    description      = Column(Text, nullable=True)
    status           = Column(String(50), nullable=False)
    percent_complete = Column(Float, nullable=False)
    created_at       = Column(DateTime, server_default=func.now())


class ActualDraft(Base):
    """
    SCD Type 2. Server-side persistence for the Actual tab's 'Save Draft' —
    previously localStorage only, invisible to the backend. entity_id is the
    stable logical identifier for "this project+year+month's draft" — the
    same one across every save; id is a per-VERSION surrogate. Every Save
    Draft click closes out the current version (end_date=now, is_current=
    False) and inserts a new one, so the full history of every intermediate
    draft save is preserved rather than overwritten in place. Once the real
    Submit (push_actual) succeeds, the current version is closed out the
    same way — no new version follows it, same as a soft delete — since
    actual_resource becomes authoritative at that point, but the draft
    history leading up to it stays queryable rather than being wiped.

    Used by app/auth.py to determine who currently counts as staffed on a
    project (and with what role) for Schedule visibility/edit — draft takes
    priority over submitted actual_resource, which takes priority over
    plan_resource, matching the fallback chain the user asked for.
    """
    __tablename__ = "actual_drafts"

    id                = Column(Integer, primary_key=True, index=True)
    entity_id         = Column(Integer, nullable=True, index=True)   # briefly NULL between insert and self-assignment; always set by the time a caller sees the row
    version           = Column(Integer, nullable=False, default=1)
    effective_date    = Column(DateTime, server_default=func.now())
    end_date          = Column(DateTime, nullable=True)
    is_current        = Column(Boolean, default=True, index=True)

    project_id      = Column(Integer, ForeignKey("projects.id"), nullable=False)
    year            = Column(Integer, nullable=False)
    month           = Column(Integer, nullable=False)
    resources_json  = Column(Text, nullable=False, default="[]")   # [{staff_name, role, monthly_salary, distribution, project_cost}]
    milestones_json = Column(Text, nullable=False, default="[]")
    misc_costs_json = Column(Text, nullable=False, default="[]")
    rag             = Column(String(10), nullable=True)
    saved_by        = Column(Integer, ForeignKey("resources.id"), nullable=True)
    updated_at      = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())


class PlanDraft(Base):
    """
    SCD Type 2. Mirrors ActualDraft exactly, same reasoning throughout — see
    there for the full explanation of the versioning pattern. This is the
    Plan-tab equivalent: converting a deal no longer pushes straight to
    plan_project/plan_resource/plan_misc_cost. Instead it creates a
    PlanDraft (pre-filled with the resources/roles chosen at conversion,
    0% allocation), which is what the Plan tab's Resource Allocation table
    shows and lets the user edit and re-save until they click Submit Plan —
    that's the only action that actually pushes to the PMO plan_* tables.

    Also seeded automatically for the FOLLOWING month whenever push_actual
    (Final Submit) succeeds — carrying that month's just-submitted actual
    resources forward as next month's starting plan draft — but only when
    no current draft already exists for that month, so it never clobbers
    something the user is already partway through editing.
    """
    __tablename__ = "plan_drafts"

    id                = Column(Integer, primary_key=True, index=True)
    entity_id         = Column(Integer, nullable=True, index=True)   # briefly NULL between insert and self-assignment; always set by the time a caller sees the row
    version           = Column(Integer, nullable=False, default=1)
    effective_date    = Column(DateTime, server_default=func.now())
    end_date          = Column(DateTime, nullable=True)
    is_current        = Column(Boolean, default=True, index=True)

    project_id      = Column(Integer, ForeignKey("projects.id"), nullable=False)
    year            = Column(Integer, nullable=False)
    month           = Column(Integer, nullable=False)
    resources_json  = Column(Text, nullable=False, default="[]")   # [{staff_name, role, monthly_salary, distribution, project_cost}]
    misc_costs_json = Column(Text, nullable=False, default="[]")
    saved_by        = Column(Integer, ForeignKey("resources.id"), nullable=True)
    updated_at      = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())


class PendingDateChange(Base):
    """
    A Project Manager's request to change an EXISTING WBS row's planned_start
    or planned_end. Management must approve before the task's actual dates
    change. Only date changes go through this gate — every other field on a
    GanttTask (category, activity, name, assigned_to, status) still updates
    immediately via the normal PATCH endpoint (creating a new SCD version).
    Management's own date edits also apply immediately (they're the
    approver, not a requester) — those DO create a new version right away.

    gantt_task_id stores the task's stable entity_id, same as
    GanttProgressLog — not a formal FK, since entity_id isn't unique on
    gantt_tasks. One row per task at a time — a new request from the same
    person on the same task replaces the previous still-pending one rather
    than queuing.
    """
    __tablename__ = "pending_date_changes"

    id                     = Column(Integer, primary_key=True, index=True)
    gantt_task_id          = Column(Integer, nullable=False, index=True)   # = GanttTask.entity_id
    project_id             = Column(Integer, ForeignKey("projects.id"), nullable=False)   # denormalized for easy per-project queries
    requested_planned_start = Column(String(20), nullable=True)
    requested_planned_end   = Column(String(20), nullable=True)
    previous_planned_start  = Column(String(20), nullable=True)   # snapshot for display/audit
    previous_planned_end    = Column(String(20), nullable=True)
    requested_by           = Column(Integer, ForeignKey("resources.id"), nullable=True)
    requested_by_name      = Column(String(100), nullable=True)   # denormalized, survives resource deletion
    requested_at           = Column(DateTime, server_default=func.now())
    status                 = Column(String(20), default="pending")   # pending | approved | rejected
    reviewed_by            = Column(Integer, ForeignKey("resources.id"), nullable=True)
    reviewed_at            = Column(DateTime, nullable=True)
    review_note            = Column(String(255), nullable=True)


# ── Billing (from Autocount AR) ──────────────────────────────────────────────

class Billing(Base):
    __tablename__ = "billings"

    id              = Column(Integer, primary_key=True, index=True)
    project_id      = Column(Integer, ForeignKey("projects.id"), nullable=False)
    autocount_ref   = Column(String(50), nullable=True)   # AR invoice ref
    invoice_number  = Column(String(50), nullable=True)
    invoice_date    = Column(String(20), nullable=True)
    due_date        = Column(String(20), nullable=True)
    amount          = Column(Float, default=0)
    currency        = Column(String(10), default="MYR")
    is_paid         = Column(Boolean, default=False)
    paid_date       = Column(String(20), nullable=True)
    notes           = Column(Text, nullable=True)
    source          = Column(String(20), default="manual")  # manual | autocount

    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), onupdate=func.now())

    project         = relationship("Project", back_populates="billings")


# ── Salesforce Deal (Pipeline) ───────────────────────────────────────────────

class Deal(Base):
    __tablename__ = "deals"

    id                  = Column(Integer, primary_key=True, index=True)
    sf_opportunity_id   = Column(String(100), unique=True, nullable=False)  # stores project_code
    name                = Column(String(200), nullable=False)
    account_name        = Column(String(100), nullable=True)
    stage               = Column(SAEnum(DealStage), default=DealStage.qualification_stage)
    amount              = Column(Float, default=0)
    currency            = Column(String(10), default="MYR")
    close_date          = Column(String(20), nullable=True)
    probability         = Column(Float, default=0)        # 0–100
    product_type        = Column(String(80), nullable=True)
    description         = Column(Text, nullable=True)
    owner               = Column(String(80), nullable=True)

    # Set when deal closes and project is created
    converted_project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    is_converted        = Column(Boolean, default=False)

    last_synced_at      = Column(DateTime(timezone=True), nullable=True)
    created_at          = Column(DateTime(timezone=True), server_default=func.now())
    updated_at          = Column(DateTime(timezone=True), onupdate=func.now())


ACCESS_ROLES = ["Admin", "Management", "Project Manager", "Account Manager", "Team Member"]


class FeaturePermission(Base):
    """
    First-layer, global permission matrix: for each (role, feature_key) pair,
    whether that role can view and/or edit that feature. Admin manages this
    via the Permissions page — a plain, editable grid. Not versioned like the
    SCD tables elsewhere in this app; a permission change should just take
    effect immediately, with no history to preserve.

    feature_key values match the sections in QAW_PM_SYSTEM_ACCESS.xlsx, e.g.
    "main.conversion_window", "drilldown.plan_actual", "budget.utilization"
    — see FEATURE_KEYS in api/__init__.py for the full list. role is one of
    ACCESS_ROLES above.

    This is the FIRST layer only. Whether someone is staffed as PM on a
    specific project (the SECOND layer) is a separate, unrelated concept and
    is unchanged by this table — it still comes from the Allocation/staffing
    cascade in auth.py.
    """
    __tablename__ = "feature_permissions"

    id          = Column(Integer, primary_key=True, index=True)
    role        = Column(String(30), nullable=False, index=True)
    feature_key = Column(String(60), nullable=False, index=True)
    can_view    = Column(Boolean, default=False, nullable=False)
    can_edit    = Column(Boolean, default=False, nullable=False)
    updated_at  = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('role', 'feature_key', name='uq_role_feature'),
    )
