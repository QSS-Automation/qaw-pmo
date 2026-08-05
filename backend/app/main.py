from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.config import settings
from app.db.database import engine
from app.models import Base
from app.api.pmo import pmo_router
from app.api.gantt import gantt_router
from app.api import (
    projects_router, resources_router, pipeline_router,
    billing_router, budget_router, integrations_router, admin_router, invite_router
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup if they don't exist
    Base.metadata.create_all(bind=engine)
    # Seed default feature permissions (only inserts rows that don't already
    # exist — never overwrites an Admin's own edits, safe on every restart)
    from app.db.database import SessionLocal
    from app.api import seed_default_permissions
    db = SessionLocal()
    try:
        seed_default_permissions(db)
    finally:
        db.close()
    yield


app = FastAPI(
    title="QAW PM Ecosystem API",
    description="Full-stack project management system with Salesforce & Autocount integration",
    version="1.0.0",
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # FastAPI's default 422 body already contains this detail, but it's only
    # visible in the browser's Network tab — printing it here too means it
    # shows up right in this terminal log, alongside the "422" status line,
    # without needing to go dig through devtools.
    print(f"[422] {request.method} {request.url.path} — validation failed:")
    for err in exc.errors():
        print(f"    field: {'.'.join(str(p) for p in err['loc'])} — {err['msg']} (got: {err.get('input')!r})")
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects_router)
app.include_router(resources_router)
app.include_router(pipeline_router)
app.include_router(billing_router)
app.include_router(budget_router)
app.include_router(integrations_router)
app.include_router(admin_router)
app.include_router(invite_router)
app.include_router(pmo_router)
app.include_router(gantt_router)


@app.get("/")
def root():
    return {
        "name": "QAW PM Ecosystem API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
def health():
    return {"status": "ok", "environment": settings.ENVIRONMENT}
