import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "medinexus.db"
SEED_PATH = DATA_DIR / "patients_seed.json"


def _connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _has_column(conn: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    cols = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(c["name"] == column_name for c in cols)


def _create_patients_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS patients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_code TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            age INTEGER NOT NULL,
            sex TEXT,
            ward TEXT NOT NULL,
            bed TEXT NOT NULL,
            room TEXT,
            conditions_json TEXT NOT NULL,
            ews INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'stable',
            medications_json TEXT NOT NULL,
            pending_labs TEXT,
            notes TEXT,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )


def _migrate_remove_vitals_column(conn: sqlite3.Connection) -> None:
    # SQLite requires table rebuild to drop a column.
    conn.execute("ALTER TABLE patients RENAME TO patients_legacy")
    _create_patients_table(conn)
    conn.execute(
        """
        INSERT INTO patients (
            id, patient_code, display_name, age, sex, ward, bed, room,
            conditions_json, ews, status, medications_json,
            pending_labs, notes, active, created_at, updated_at
        )
        SELECT
            id, patient_code, display_name, age, sex, ward, bed, room,
            conditions_json, ews, status, medications_json,
            pending_labs, notes, active, created_at, updated_at
        FROM patients_legacy
        """
    )
    conn.execute("DROP TABLE patients_legacy")


def init_patient_db() -> None:
    with _connect() as conn:
        _create_patients_table(conn)
        if _has_column(conn, "patients", "vitals_json"):
            _migrate_remove_vitals_column(conn)

        count = conn.execute("SELECT COUNT(*) AS c FROM patients").fetchone()["c"]
        if count == 0 and SEED_PATH.exists():
            seed_rows = json.loads(SEED_PATH.read_text(encoding="utf-8"))
            now = datetime.utcnow().isoformat()
            for row in seed_rows:
                conn.execute(
                    """
                    INSERT INTO patients (
                        patient_code, display_name, age, sex, ward, bed, room,
                        conditions_json, ews, status, medications_json,
                        pending_labs, notes, active, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                    """,
                    (
                        row["patient_code"],
                        row["display_name"],
                        int(row.get("age", 0)),
                        row.get("sex"),
                        row["ward"],
                        row["bed"],
                        row.get("room"),
                        json.dumps(row.get("conditions", [])),
                        int(row.get("ews", 0)),
                        row.get("status", "stable"),
                        json.dumps(row.get("medications", [])),
                        row.get("pending_labs", ""),
                        row.get("notes", ""),
                        now,
                        now,
                    ),
                )


def _row_to_patient(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "patient_code": row["patient_code"],
        "display_name": row["display_name"],
        "age": row["age"],
        "sex": row["sex"],
        "ward": row["ward"],
        "bed": row["bed"],
        "room": row["room"],
        "conditions": json.loads(row["conditions_json"]),
        "ews": row["ews"],
        "status": row["status"],
        "medications": json.loads(row["medications_json"]),
        "pending_labs": row["pending_labs"] or "",
        "notes": row["notes"] or "",
        "active": bool(row["active"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_patients(active_only: bool = True) -> list[dict[str, Any]]:
    query = "SELECT * FROM patients"
    params: tuple[Any, ...] = ()
    if active_only:
        query += " WHERE active = ?"
        params = (1,)
    query += " ORDER BY ews DESC, ward ASC, bed ASC"

    with _connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_row_to_patient(r) for r in rows]


def get_patient(patient_id: int) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    return _row_to_patient(row) if row else None


def create_patient(payload: dict[str, Any]) -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO patients (
                patient_code, display_name, age, sex, ward, bed, room,
                conditions_json, ews, status, medications_json,
                pending_labs, notes, active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload["patient_code"],
                payload["display_name"],
                int(payload["age"]),
                payload.get("sex"),
                payload["ward"],
                payload["bed"],
                payload.get("room"),
                json.dumps(payload.get("conditions", [])),
                int(payload.get("ews", 0)),
                payload.get("status", "stable"),
                json.dumps(payload.get("medications", [])),
                payload.get("pending_labs", ""),
                payload.get("notes", ""),
                1 if payload.get("active", True) else 0,
                now,
                now,
            ),
        )
        new_id = cur.lastrowid
    patient = get_patient(int(new_id))
    if patient is None:
        raise RuntimeError("Failed to fetch patient after insert")
    return patient


def update_patient(patient_id: int, patch: dict[str, Any]) -> dict[str, Any] | None:
    existing = get_patient(patient_id)
    if not existing:
        return None

    merged = {**existing, **patch}
    now = datetime.utcnow().isoformat()

    with _connect() as conn:
        conn.execute(
            """
            UPDATE patients
            SET patient_code = ?, display_name = ?, age = ?, sex = ?, ward = ?, bed = ?, room = ?,
                conditions_json = ?, ews = ?, status = ?, medications_json = ?,
                pending_labs = ?, notes = ?, active = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                merged["patient_code"],
                merged["display_name"],
                int(merged["age"]),
                merged.get("sex"),
                merged["ward"],
                merged["bed"],
                merged.get("room"),
                json.dumps(merged.get("conditions", [])),
                int(merged.get("ews", 0)),
                merged.get("status", "stable"),
                json.dumps(merged.get("medications", [])),
                merged.get("pending_labs", ""),
                merged.get("notes", ""),
                1 if merged.get("active", True) else 0,
                now,
                patient_id,
            ),
        )

    return get_patient(patient_id)


def format_patient_snapshot(limit: int = 12) -> str:
    patients = list_patients(active_only=True)[:limit]
    if not patients:
        return "No active patients found in operational database."

    lines = []
    for p in patients:
        notes = p.get("notes", "") or "No note"
        pending_labs = p.get("pending_labs", "") or "No urgent labs"
        condition_str = ", ".join(p.get("conditions", [])[:3]) if p.get("conditions") else "General inpatient"
        lines.append(
            " | ".join(
                [
                    p["patient_code"],
                    p["display_name"],
                    f"{p['ward']} {p['bed']}",
                    f"EWS {p['ews']} ({p['status'].upper()})",
                    f"Conditions: {condition_str}",
                    f"Observation: {notes}",
                    f"Pending labs: {pending_labs}",
                ]
            )
        )
    return "\n".join(lines)
