# QAW PM Ecosystem — Full Stack Dashboard

A full-stack project management system for QAW, featuring:

- **Pipeline** — Salesforce CRM deal monitoring (potential projects)
- **Projects** — Active project management with resource, budget, and timeline tracking
- **Resources** — Headcount allocation across projects
- **Budget** — Utilization tracking per project
- **Billing** — Autocount AR integration for billing forecasts

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + TailwindCSS |
| Backend | Python FastAPI |
| Database | SQLite (via SQLAlchemy) |
| CRM | Salesforce REST API (mocked) |
| Billing | Autocount API (mocked) |
| Auth | JWT Bearer tokens |

## Project Structure

```
qaw-pm-system/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app entry point
│   │   ├── config.py            # Settings & env vars
│   │   ├── db/
│   │   │   ├── database.py      # SQLAlchemy engine & session
│   │   │   └── seed.py          # Seed data from Book1.xlsx
│   │   ├── models/
│   │   │   ├── project.py       # Project ORM model
│   │   │   ├── resource.py      # Resource ORM model
│   │   │   ├── deal.py          # Salesforce deal ORM model
│   │   │   ├── billing.py       # Billing / AR ORM model
│   │   │   └── allocation.py    # Resource-Project allocation
│   │   ├── api/
│   │   │   ├── projects.py      # /api/projects CRUD
│   │   │   ├── resources.py     # /api/resources CRUD
│   │   │   ├── pipeline.py      # /api/pipeline (Salesforce deals)
│   │   │   ├── billing.py       # /api/billing (Autocount AR)
│   │   │   ├── budget.py        # /api/budget aggregations
│   │   │   └── integrations.py  # /api/sync (trigger mock syncs)
│   │   └── services/
│   │       ├── salesforce.py    # Salesforce mock service
│   │       └── autocount.py     # Autocount mock service
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── api/               # API client functions
│   │   ├── components/        # Reusable UI components
│   │   ├── pages/             # Tab/page components
│   │   ├── hooks/             # Custom React hooks
│   │   ├── types/             # TypeScript interfaces
│   │   └── utils/             # Formatters, helpers
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
├── docs/
│   ├── API.md                 # Full API reference
│   └── ARCHITECTURE.md        # System design decisions
├── .github/
│   └── workflows/
│       └── ci.yml             # GitHub Actions CI
├── .gitignore
└── README.md
```

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
python -m app.db.seed           # Seed with QAW data
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App: http://localhost:5173

## Environment Variables

See `backend/.env.example` for all configurable values.

Key variables:

```
SECRET_KEY=your-secret-key
DATABASE_URL=sqlite:///./qaw_pm.db
SALESFORCE_MOCK=true
AUTOCOUNT_MOCK=true
```

## Salesforce Integration

The system polls Salesforce for:
- **Open deals** with product type = Professional Services → shown in Pipeline tab
- **Closed Won deals** → triggers new project creation prompt

To switch from mock to real:
1. Set `SALESFORCE_MOCK=false` in `.env`
2. Add `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_USERNAME`, `SF_PASSWORD`
3. The service in `backend/app/services/salesforce.py` uses the same interface

## Autocount Integration

Finance AR team data is pulled from Autocount for billing actuals.

To switch from mock to real:
1. Set `AUTOCOUNT_MOCK=false` in `.env`
2. Add `AUTOCOUNT_BASE_URL`, `AUTOCOUNT_API_KEY`
3. The service in `backend/app/services/autocount.py` handles the mapping

## API Reference

See `docs/API.md` for the full endpoint reference.
