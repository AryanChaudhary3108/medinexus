import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "medinexus.db"
SEED_PATH = DATA_DIR / "patients_seed.json"
MANUAL_BED_STATUSES = {"available", "reserved"}


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


def _create_beds_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS beds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bed_code TEXT NOT NULL UNIQUE,
            ward TEXT NOT NULL,
            room TEXT,
            status TEXT NOT NULL DEFAULT 'available',
            patient_id INTEGER,
            patient_code TEXT,
            patient_name TEXT,
            updated_at TEXT NOT NULL
        )
        """
    )


def _create_lab_reports_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS lab_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            file_name TEXT NOT NULL,
            file_data BLOB NOT NULL,
            file_type TEXT NOT NULL DEFAULT 'application/pdf',
            uploaded_at TEXT NOT NULL,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
        """
    )


def _seed_default_beds(conn: sqlite3.Connection) -> None:
    now = datetime.utcnow().isoformat()
    existing_rows = conn.execute("SELECT bed_code FROM beds").fetchall()
    existing_codes = {r["bed_code"] for r in existing_rows}
    rows: list[tuple[str, str, str, str, str]] = []

    def add_group(ward: str, prefix: str, count: int, floor: int, reserve_every: int = 0) -> None:
        for i in range(1, count + 1):
            code = f"{prefix}-{i:02d}"
            if code in existing_codes:
                continue
            room = f"{floor}{((i - 1) // 4) + 1:02d}-A"
            status = "reserved" if reserve_every and i % reserve_every == 0 else "available"
            rows.append((code, ward, room, status, now))

    add_group("General", "G", 40, 1, reserve_every=20)
    add_group("Cardiac", "C", 20, 2, reserve_every=0)
    add_group("ICU", "ICU", 20, 3, reserve_every=0)
    add_group("Geriatric", "R", 20, 4, reserve_every=0)

    if rows:
        conn.executemany(
            """
            INSERT INTO beds (bed_code, ward, room, status, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            rows,
        )


def _sync_beds_with_patients(conn: sqlite3.Connection) -> None:
    now = datetime.utcnow().isoformat()
    conn.execute(
        """
        UPDATE beds
        SET patient_id = NULL,
            patient_code = NULL,
            patient_name = NULL,
            status = CASE WHEN status = 'reserved' THEN 'reserved' ELSE 'available' END,
            updated_at = ?
        """,
        (now,),
    )

    rows = conn.execute(
        """
        SELECT id, patient_code, display_name, ward, bed, room, status
        FROM patients
        WHERE active = 1
        """
    ).fetchall()

    for row in rows:
        bed_code = str(row["bed"] or "").strip()
        if not bed_code:
            continue

        exists = conn.execute("SELECT id FROM beds WHERE bed_code = ?", (bed_code,)).fetchone()
        if not exists:
            conn.execute(
                """
                INSERT INTO beds (bed_code, ward, room, status, updated_at)
                VALUES (?, ?, ?, 'available', ?)
                """,
                (bed_code, row["ward"] or "General", row["room"], now),
            )

        patient_status = str(row["status"] or "stable").lower()
        ward_name = str(row["ward"] or "General")
        derived_status = "critical" if patient_status == "critical" else ("icu" if ward_name.upper() == "ICU" else "occupied")

        conn.execute(
            """
            UPDATE beds
            SET ward = ?, room = ?, status = ?, patient_id = ?, patient_code = ?, patient_name = ?, updated_at = ?
            WHERE bed_code = ?
            """,
            (
                ward_name,
                row["room"],
                derived_status,
                row["id"],
                row["patient_code"],
                row["display_name"],
                now,
                bed_code,
            ),
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
        _create_beds_table(conn)
        _create_lab_reports_table(conn)
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

        _seed_default_beds(conn)
        _sync_beds_with_patients(conn)


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


def _row_to_bed(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "bed_code": row["bed_code"],
        "ward": row["ward"],
        "room": row["room"],
        "status": row["status"],
        "patient_id": row["patient_id"],
        "patient_code": row["patient_code"],
        "patient_name": row["patient_name"],
        "updated_at": row["updated_at"],
    }


def list_beds() -> list[dict[str, Any]]:
    with _connect() as conn:
        _sync_beds_with_patients(conn)
        rows = conn.execute(
            """
            SELECT *
            FROM beds
            ORDER BY
              CASE ward
                WHEN 'ICU' THEN 1
                WHEN 'Cardiac' THEN 2
                WHEN 'General' THEN 3
                WHEN 'Geriatric' THEN 4
                ELSE 5
              END,
              bed_code ASC
            """
        ).fetchall()
    return [_row_to_bed(r) for r in rows]


def get_bed(bed_id: int) -> dict[str, Any] | None:
    with _connect() as conn:
        _sync_beds_with_patients(conn)
        row = conn.execute("SELECT * FROM beds WHERE id = ?", (bed_id,)).fetchone()
    return _row_to_bed(row) if row else None


def update_bed_status(bed_id: int, status: str) -> dict[str, Any] | None:
    next_status = str(status or "").strip().lower()
    if next_status not in MANUAL_BED_STATUSES:
        raise ValueError("Only 'available' or 'reserved' can be set manually")

    with _connect() as conn:
        _sync_beds_with_patients(conn)
        row = conn.execute("SELECT * FROM beds WHERE id = ?", (bed_id,)).fetchone()
        if not row:
            return None
        if row["patient_id"]:
            raise ValueError("Cannot manually change status for an occupied patient bed")

        now = datetime.utcnow().isoformat()
        conn.execute(
            "UPDATE beds SET status = ?, updated_at = ? WHERE id = ?",
            (next_status, now, bed_id),
        )

    return get_bed(bed_id)


def assign_bed_to_patient(bed_id: int, patient_id: int) -> dict[str, Any]:
    with _connect() as conn:
        _sync_beds_with_patients(conn)

        bed = conn.execute("SELECT * FROM beds WHERE id = ?", (bed_id,)).fetchone()
        if not bed:
            raise ValueError("Bed not found")

        if bed["patient_id"]:
            raise ValueError("Bed is currently occupied")

        patient = conn.execute(
            "SELECT * FROM patients WHERE id = ? AND active = 1", (patient_id,)
        ).fetchone()
        if not patient:
            raise ValueError("Active patient not found")

        now = datetime.utcnow().isoformat()

        # Remove this patient from any previously assigned bed by clearing old bed code.
        conn.execute(
            """
            UPDATE patients
            SET bed = ?, ward = ?, room = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                bed["bed_code"],
                bed["ward"],
                bed["room"],
                now,
                patient_id,
            ),
        )

        _sync_beds_with_patients(conn)

    fresh_bed = get_bed(bed_id)
    fresh_patient = get_patient(patient_id)
    if not fresh_bed or not fresh_patient:
        raise RuntimeError("Assignment completed but verification fetch failed")
    return {"bed": fresh_bed, "patient": fresh_patient}


def vacate_bed(bed_id: int) -> dict[str, Any]:
    with _connect() as conn:
        _sync_beds_with_patients(conn)

        bed = conn.execute("SELECT * FROM beds WHERE id = ?", (bed_id,)).fetchone()
        if not bed:
            raise ValueError("Bed not found")

        patient_id = bed["patient_id"]
        if not patient_id:
            raise ValueError("Bed is already vacant")

        now = datetime.utcnow().isoformat()
        conn.execute(
            "UPDATE patients SET bed = ?, updated_at = ? WHERE id = ?",
            ("", now, patient_id),
        )

        _sync_beds_with_patients(conn)

    fresh_bed = get_bed(bed_id)
    patient = get_patient(int(patient_id))
    if not fresh_bed:
        raise RuntimeError("Vacate completed but verification fetch failed")
    return {"bed": fresh_bed, "patient": patient}


def transfer_patient_to_bed(source_bed_id: int, target_bed_id: int) -> dict[str, Any]:
    if source_bed_id == target_bed_id:
        raise ValueError("Source bed and target bed cannot be the same")

    with _connect() as conn:
        _sync_beds_with_patients(conn)

        source_bed = conn.execute("SELECT * FROM beds WHERE id = ?", (source_bed_id,)).fetchone()
        if not source_bed:
            raise ValueError("Source bed not found")
        patient_id = source_bed["patient_id"]
        if not patient_id:
            raise ValueError("Source bed has no assigned patient")

        target_bed = conn.execute("SELECT * FROM beds WHERE id = ?", (target_bed_id,)).fetchone()
        if not target_bed:
            raise ValueError("Target bed not found")
        if target_bed["patient_id"]:
            raise ValueError("Target bed is already assigned to a patient")

        patient = conn.execute(
            "SELECT * FROM patients WHERE id = ? AND active = 1",
            (patient_id,),
        ).fetchone()
        if not patient:
            raise ValueError("Assigned patient record not found or inactive")

        now = datetime.utcnow().isoformat()
        conn.execute(
            """
            UPDATE patients
            SET bed = ?, ward = ?, room = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                target_bed["bed_code"],
                target_bed["ward"],
                target_bed["room"],
                now,
                patient_id,
            ),
        )

        _sync_beds_with_patients(conn)

    fresh_source = get_bed(source_bed_id)
    fresh_target = get_bed(target_bed_id)
    fresh_patient = get_patient(int(patient_id))
    if not fresh_source or not fresh_target or not fresh_patient:
        raise RuntimeError("Transfer completed but verification fetch failed")
    return {
        "source_bed": fresh_source,
        "target_bed": fresh_target,
        "patient": fresh_patient,
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
        _sync_beds_with_patients(conn)
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
        _sync_beds_with_patients(conn)

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


def save_lab_report(patient_id: int, file_name: str, file_data: bytes, file_type: str = "application/pdf") -> dict[str, Any]:
    """Save a lab report for a patient."""
    now = datetime.utcnow().isoformat()
    
    with _connect() as conn:
        # Verify patient exists
        patient = conn.execute("SELECT id FROM patients WHERE id = ? AND active = 1", (patient_id,)).fetchone()
        if not patient:
            raise ValueError(f"Patient {patient_id} not found or inactive")
        
        cur = conn.execute(
            """
            INSERT INTO lab_reports (patient_id, file_name, file_data, file_type, uploaded_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (patient_id, file_name, file_data, file_type, now),
        )
        report_id = cur.lastrowid
    
    return {
        "id": report_id,
        "patient_id": patient_id,
        "file_name": file_name,
        "file_type": file_type,
        "uploaded_at": now,
    }


def get_lab_reports(patient_id: int) -> list[dict[str, Any]]:
    """Get all lab reports for a patient."""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, patient_id, file_name, file_type, uploaded_at
            FROM lab_reports
            WHERE patient_id = ?
            ORDER BY uploaded_at DESC
            """,
            (patient_id,),
        ).fetchall()
    
    return [
        {
            "id": r["id"],
            "patient_id": r["patient_id"],
            "file_name": r["file_name"],
            "file_type": r["file_type"],
            "uploaded_at": r["uploaded_at"],
        }
        for r in rows
    ]


def get_lab_report_file(report_id: int) -> tuple[str, bytes, str] | None:
    """Get lab report file content."""
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT file_name, file_data, file_type
            FROM lab_reports
            WHERE id = ?
            """,
            (report_id,),
        ).fetchone()
    
    if row:
        return (row["file_name"], row["file_data"], row["file_type"])
    return None


def delete_lab_report(report_id: int) -> bool:
    """Delete a lab report."""
    with _connect() as conn:
        cur = conn.execute("DELETE FROM lab_reports WHERE id = ?", (report_id,))
        return cur.rowcount > 0
