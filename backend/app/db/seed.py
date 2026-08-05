"""
Seed the database with real QAW data from Book1.xlsx.
Run: python -m app.db.seed
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from app.db.database import engine
from app.models import Base, Resource


def create_tables():
    Base.metadata.create_all(bind=engine)
    print("✓ Tables created")


def seed_resources(db):
    resources_data = [
        dict(name="Adam",        employee_code="QAW060", resource_type="QAW",      rate_card=17, monthly_cost=6000),
        dict(name="Afif",        employee_code="QAW062", resource_type="QAW",      rate_card=19, monthly_cost=4500),
        dict(name="Afiqah",      employee_code=None,     resource_type="Intern",   rate_card=25, monthly_cost=1500),
        dict(name="Aiman",       employee_code=None,     resource_type="Non-QAW",  rate_card=15, monthly_cost=8000),
        dict(name="Alvina",      employee_code="QAW072", resource_type="QAW",      rate_card=20, monthly_cost=4000),
        dict(name="Ammar",       employee_code=None,     resource_type="Intern",   rate_card=25, monthly_cost=1500),
        dict(name="Azhar",       employee_code=None,     resource_type="Intern",   rate_card=25, monthly_cost=1500),
        dict(name="Chi Liong",   employee_code="QAW071", resource_type="QAW",      rate_card=20, monthly_cost=4000),
        dict(name="Christopher", employee_code="QAW036", resource_type="QAW",      rate_card=16, monthly_cost=7000),
        dict(name="Daniel Yap",  employee_code=None,     resource_type="Non-QAW",  rate_card=13, monthly_cost=10000),
        dict(name="Darsshan",    employee_code="QAW057", resource_type="QAW",      rate_card=17, monthly_cost=6000),
        dict(name="Dennis",      employee_code="QAW066", resource_type="QAW",      rate_card=19, monthly_cost=4500),
        dict(name="Farah",       employee_code="QAW070", resource_type="QAW",      rate_card=19, monthly_cost=4500),
        dict(name="Faustina",    employee_code="QAW067", resource_type="QAW",      rate_card=19, monthly_cost=4500),
        dict(name="Izzati",      employee_code=None,     resource_type="Intern",   rate_card=25, monthly_cost=1500),
        dict(name="Jesslyn",     employee_code=None,     resource_type="Intern",   rate_card=25, monthly_cost=1500),
        dict(name="Kah Wai",     employee_code="QAW073", resource_type="QAW",      rate_card=5,  monthly_cost=18000),
        dict(name="Kayla",       employee_code=None,     resource_type="Intern",   rate_card=25, monthly_cost=1500),
        dict(name="Khairuddin",  employee_code="QAW039", resource_type="QAW",      rate_card=17, monthly_cost=6000),
        dict(name="Leslie",      employee_code="QAW068", resource_type="QAW",      rate_card=15, monthly_cost=8000),
        dict(name="Li Xuan",     employee_code="QAW005", resource_type="QAW",      rate_card=10, monthly_cost=13000),
        dict(name="Luqman",      employee_code="QAW053", resource_type="QAW",      rate_card=17, monthly_cost=6000),
        dict(name="Magdelina",   employee_code=None,     resource_type="Intern",   rate_card=25, monthly_cost=1500),
        dict(name="Maisarah",    employee_code=None,     resource_type="Intern",   rate_card=25, monthly_cost=1500),
        dict(name="Maxwell",     employee_code=None,     resource_type="Intern",   rate_card=25, monthly_cost=1500),
        dict(name="Mok Lee",     employee_code="QAW007", resource_type="QAW",      rate_card=11, monthly_cost=12000),
        dict(name="Muhtar",      employee_code="QAW064", resource_type="QAW",      rate_card=10, monthly_cost=13000),
        dict(name="Nazihah",     employee_code=None,     resource_type="Intern",   rate_card=20, monthly_cost=4000),
        dict(name="Saddique",    employee_code="QAW058", resource_type="QAW",      rate_card=6,  monthly_cost=17000),
        dict(name="Si Qin",      employee_code=None,     resource_type="Intern",   rate_card=19, monthly_cost=4500),
        dict(name="Syarafuddin", employee_code="QAW059", resource_type="QAW",      rate_card=17, monthly_cost=6000),
        dict(name="Tanusha",     employee_code=None,     resource_type="Intern",   rate_card=19, monthly_cost=4500),
        dict(name="Teck Ming",   employee_code="QAW069", resource_type="QAW",      rate_card=19, monthly_cost=4500),
        dict(name="Ubayd",       employee_code=None,     resource_type="Intern",   rate_card=21, monthly_cost=3500),
        dict(name="Uzair",       employee_code=None,     resource_type="Non-QAW",  rate_card=10, monthly_cost=13000),
        dict(name="Wong",        employee_code=None,     resource_type="Non-QAW",  rate_card=10, monthly_cost=13000),
        dict(name="Yi Lin",      employee_code=None,     resource_type="Pre Sales",rate_card=22, monthly_cost=3000),
        dict(name="Zhafir",      employee_code=None,     resource_type="Intern",   rate_card=20, monthly_cost=4000),
    ]
    resources = []
    for rd in resources_data:
        existing = db.query(Resource).filter(Resource.name == rd["name"]).first()
        if not existing:
            r = Resource(**rd)
            db.add(r)
            resources.append(r)
    db.flush()
    print(f"✓ Seeded {len(resources)} resources")
    return {r.name: r for r in db.query(Resource).all()}


def main():
    from app.db.database import engine, Base, SessionLocal
    Base.metadata.create_all(bind=engine)
    print("✓ Tables created")

    db = SessionLocal()
    try:
        seed_resources(db)
        db.commit()
        print("\n✅ Database initialised successfully!")
        print("   Mock project data has been removed.")
        print("   Resources seeded — add real projects via the interface.")
    except Exception as e:
        db.rollback()
        raise e
    finally:
        db.close()


if __name__ == "__main__":
    main()
