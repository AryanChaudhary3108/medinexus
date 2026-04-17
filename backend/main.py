from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from qdrant_client import QdrantClient
from fastembed import TextEmbedding
from io import BytesIO
import os
import json
import re
from pathlib import Path
from dotenv import load_dotenv
from groq import Groq
from typing import Any, Optional
from pydantic import Field

from patient_store import (
    assign_bed_to_patient,
    create_patient,
    transfer_patient_to_bed,
    vacate_bed,
    format_patient_snapshot,
    get_bed,
    get_patient,
    init_patient_db,
    list_beds,
    list_patients,
    update_bed_status,
    update_patient,
    save_lab_report,
    get_lab_reports,
    get_lab_report_file,
    delete_lab_report,
)

load_dotenv(dotenv_path=Path(__file__).with_name(".env"))

app = FastAPI(title="MediNexus CareGuide Clinical API")
FRONTEND_ROOT = Path(__file__).resolve().parent.parent

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
if not GROQ_API_KEY:
    print("[WARN] GROQ_API_KEY not set. Set it before starting the server.")
groq_client = Groq(api_key=GROQ_API_KEY)

# Initialize embeddings and local Qdrant
print("Loading Embedding Model...")
embedding_model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")
qdrant = QdrantClient(path=str(Path(__file__).with_name("qdrant_db")))
COLLECTION_NAME = "hospital_knowledge"

class ChatRequest(BaseModel):
    messages: list
    language: str = "en"
    role: Optional[str] = "nurse"   # nurse | doctor | admin

class PatientCreateRequest(BaseModel):
    patient_code: str = Field(..., min_length=2)
    display_name: str = Field(..., min_length=2)
    age: int = Field(..., ge=0, le=130)
    sex: Optional[str] = None
    ward: str = Field(..., min_length=2)
    bed: str = Field(..., min_length=1)
    room: Optional[str] = None
    conditions: list[str] = Field(default_factory=list)
    ews: int = Field(0, ge=0, le=10)
    status: str = "stable"
    medications: list[str] = Field(default_factory=list)
    pending_labs: str = ""
    notes: str = ""
    active: bool = True


class PatientUpdateRequest(BaseModel):
    patient_code: Optional[str] = None
    display_name: Optional[str] = None
    age: Optional[int] = Field(None, ge=0, le=130)
    sex: Optional[str] = None
    ward: Optional[str] = None
    bed: Optional[str] = None
    room: Optional[str] = None
    conditions: Optional[list[str]] = None
    ews: Optional[int] = Field(None, ge=0, le=10)
    status: Optional[str] = None
    medications: Optional[list[str]] = None
    pending_labs: Optional[str] = None
    notes: Optional[str] = None
    active: Optional[bool] = None


class BedStatusUpdateRequest(BaseModel):
    status: str = Field(..., min_length=3)


class BedAssignRequest(BaseModel):
    patient_id: int = Field(..., ge=1)


class BedTransferRequest(BaseModel):
    target_bed_id: int = Field(..., ge=1)

ROLE_CONTEXT = {
    "nurse": (
        "You are assisting a WARD NURSE. Focus on: real-time symptom progression, "
        "medication administration schedules, nurse tasks, shift handover reports, "
        "escalation protocols, and patient safety alerts. "
        "Use concise clinical language. Bullet points are preferred."
    ),
    "doctor": (
        "You are assisting a PHYSICIAN/DOCTOR. Focus on: clinical decision support, "
        "patient summaries, investigation orders, discharge planning, drug interactions, "
        "differential guidance (without replacing clinical judgement), and treatment protocols. "
        "Use professional medical terminology."
    ),
    "admin": (
        "You are assisting a HOSPITAL ADMINISTRATOR. Focus on: bed management, "
        "resource allocation, staff scheduling, operational KPIs, energy usage reports, "
        "and system-level summaries. Use clear, data-driven language."
    ),
}

VALID_RISK_STATUS = {"stable", "warning", "critical"}


def _status_from_ews(ews: int) -> str:
    if ews >= 7:
        return "critical"
    if ews >= 4:
        return "warning"
    return "stable"


def _heuristic_risk_assessment(payload: dict[str, Any]) -> dict[str, Any]:
    ews = int(payload.get("ews", 0) or 0)
    conditions = [str(c).lower() for c in payload.get("conditions", [])]
    pending_labs = str(payload.get("pending_labs", "") or "").lower()
    notes = str(payload.get("notes", "") or "").lower()

    severe_terms = [
        "sepsis", "shock", "acute mi", "mi", "stroke", "hemorrhagic", "respiratory failure",
        "aki", "acute kidney injury", "unstable", "critical",
    ]
    moderate_terms = [
        "heart failure", "cancer", "copd", "pneumonia", "asthma", "hypertension", "diabetes",
    ]
    urgent_terms = ["urgent", "critical", "repeat", "pending", "high risk", "escalate"]

    condition_text = " ".join(conditions)
    severe_hits = sum(1 for t in severe_terms if t in condition_text)
    moderate_hits = sum(1 for t in moderate_terms if t in condition_text)
    lab_hits = sum(1 for t in urgent_terms if t in pending_labs)
    note_hits = sum(1 for t in ["worsening", "distress", "escalation", "icu", "unstable"] if t in notes)

    combo_bonus = 0
    if "heart failure" in condition_text and "cancer" in condition_text:
        combo_bonus = 2

    adjusted = ews + min(3, severe_hits * 2) + min(2, moderate_hits) + min(1, lab_hits) + min(1, note_hits) + combo_bonus
    adjusted = max(0, min(10, adjusted))
    status = _status_from_ews(adjusted)

    reason = (
        f"Heuristic model: base EWS {ews}, severe markers {severe_hits}, "
        f"moderate comorbidity markers {moderate_hits}."
    )
    return {
        "ews": adjusted,
        "status": status,
        "reason": reason,
        "source": "heuristic",
    }


def _try_groq_risk_assessment(payload: dict[str, Any]) -> dict[str, Any] | None:
    if not GROQ_API_KEY:
        return None

    condensed = {
        "display_name": payload.get("display_name", ""),
        "age": payload.get("age", 0),
        "ward": payload.get("ward", ""),
        "conditions": payload.get("conditions", []),
        "pending_labs": payload.get("pending_labs", ""),
        "notes": payload.get("notes", ""),
        "ews": payload.get("ews", 0),
        "status": payload.get("status", "stable"),
    }

    prompt = (
        "You are a clinical triage risk assistant. "
        "Given patient context, estimate adjusted risk score and status. "
        "Return ONLY valid JSON with keys: adjusted_ews (integer 0-10), status (stable|warning|critical), reason (short string). "
        "Do not include markdown.\n\n"
        f"PATIENT: {json.dumps(condensed, ensure_ascii=True)}"
    )

    try:
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=180,
        )
        content = completion.choices[0].message.content or ""

        # Accept plain JSON or JSON wrapped in free text.
        match = re.search(r"\{.*\}", content, flags=re.DOTALL)
        json_text = match.group(0) if match else content
        data = json.loads(json_text)

        adjusted_ews = int(data.get("adjusted_ews"))
        adjusted_ews = max(0, min(10, adjusted_ews))
        status = str(data.get("status", "")).strip().lower()
        if status not in VALID_RISK_STATUS:
            status = _status_from_ews(adjusted_ews)

        return {
            "ews": adjusted_ews,
            "status": status,
            "reason": str(data.get("reason", "Groq-assisted triage assessment.")),
            "source": "groq",
        }
    except Exception:
        return None


def assess_patient_risk(payload: dict[str, Any]) -> dict[str, Any]:
    heuristic = _heuristic_risk_assessment(payload)
    groq = _try_groq_risk_assessment(payload)

    if not groq:
        return heuristic

    # Blend both and bias toward safer (higher) risk to avoid under-triage.
    blended_ews = max(heuristic["ews"], round((heuristic["ews"] + groq["ews"]) / 2))
    blended_ews = max(0, min(10, blended_ews))

    blended_status = _status_from_ews(blended_ews)

    return {
        "ews": blended_ews,
        "status": blended_status,
        "reason": f"Groq + heuristic blend. {groq['reason']}",
        "source": "groq+heuristic",
    }


@app.on_event("startup")
async def startup_event():
    init_patient_db()

@app.post("/api/chat")
async def chat_with_careguide(req: ChatRequest):
    try:
        user_query = req.messages[-1]["content"] if req.messages else ""

        # ── 1. Embed query and search Qdrant ──────────────────────────
        context = ""
        retrieved_docs = []
        if user_query:
            query_vector = list(embedding_model.embed([user_query]))[0]
            query_values = query_vector.tolist()

            # qdrant-client >= 1.17 uses query_points(); older versions use search().
            if hasattr(qdrant, "query_points"):
                query_result = qdrant.query_points(
                    collection_name=COLLECTION_NAME,
                    query=query_values,
                    limit=4,
                    with_payload=True,
                )
                search_hits = query_result.points
            else:
                search_hits = qdrant.search(
                    collection_name=COLLECTION_NAME,
                    query_vector=query_values,
                    limit=4,
                )

            retrieved_docs = [
                hit.payload.get("text", "")
                for hit in search_hits
                if getattr(hit, "payload", None)
            ]
            context = "\n".join(retrieved_docs)

        # ── 2. Build role-aware clinical system prompt ─────────────────
        role = req.role or "nurse"
        role_instruction = ROLE_CONTEXT.get(role, ROLE_CONTEXT["nurse"])
        live_patient_snapshot = format_patient_snapshot(limit=12)

        system_prompt = f"""You are CareGuide Clinical, an AI-powered clinical intelligence assistant for MediNexus Hospital staff.

{role_instruction}

    == LIVE PATIENT SNAPSHOT (from operational SQLite DB) ==
    {live_patient_snapshot}
    =========================================================

== RETRIEVED HOSPITAL KNOWLEDGE (from Qdrant vector DB) ==
{context if context else "No specific knowledge retrieved for this query. Use general clinical guidelines."}
==========================================================

== RULES ==
- Ground your answer in the retrieved knowledge above whenever relevant.
- If the retrieved knowledge directly answers the query, cite it clearly.
- For clinical protocol questions not in the knowledge base, provide standard best-practice guidance.
- NEVER diagnose — say "suggest clinical review" or "consider X based on current clinical presentation".
- Keep responses under 400 words unless generating a formal document (handover, discharge summary).
- Use bullet points or numbered lists for protocols, summaries, and multi-step answers.
- For discharge summaries, use: Patient Info | Diagnosis | Treatment | Discharge Meds | Follow-up.
- For handover reports, include: Outstanding tasks | Active alerts | Pending labs | Meds due.
- Always flag if a patient needs immediate human clinical assessment.
- Respond in English only (clinical staff interface).
"""

        messages_for_llm = [{"role": "system", "content": system_prompt}] + req.messages

        # ── 3. Call Groq LLM ──────────────────────────────────────────
        chat_completion = groq_client.chat.completions.create(
            messages=messages_for_llm,
            model="llama-3.1-8b-instant",
            temperature=0.5,
            max_tokens=600,
        )

        reply = chat_completion.choices[0].message.content

        return {
            "reply": reply,
            "retrieved_docs": retrieved_docs,   # expose what Qdrant returned
            "role": role,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/health")
async def health():
    return {"status": "ok", "model": "llama-3.1-8b-instant", "vector_db": "qdrant-local"}


@app.get("/api/patients")
async def patients(active_only: bool = True):
    return {"patients": list_patients(active_only=active_only)}


@app.post("/api/patients/{patient_id}/lab-reports")
async def upload_lab_report(patient_id: int, file: UploadFile = File(...)):
    """Upload a lab report (PDF only) for a patient."""
    # Validate file type
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    
    # Validate file extension
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="File must have .pdf extension")
    
    try:
        # Read file content
        file_content = await file.read()
        
        # Save to database
        report = save_lab_report(patient_id, file.filename, file_content, "application/pdf")
        return report
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error uploading file: {str(e)}")


@app.get("/api/patients/{patient_id}/lab-reports")
async def list_lab_reports(patient_id: int):
    """Get all lab reports for a patient."""
    try:
        reports = get_lab_reports(patient_id)
        return {"lab_reports": reports}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/lab-reports/{report_id}/download")
async def download_lab_report(report_id: int):
    """Download a lab report file."""
    result = get_lab_report_file(report_id)
    if not result:
        raise HTTPException(status_code=404, detail="Lab report not found")
    
    file_name, file_data, file_type = result
    return StreamingResponse(
        BytesIO(file_data),
        media_type=file_type,
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )


@app.delete("/api/lab-reports/{report_id}")
async def delete_lab_report_endpoint(report_id: int):
    """Delete a lab report."""
    if not delete_lab_report(report_id):
        raise HTTPException(status_code=404, detail="Lab report not found")
    return {"status": "deleted"}


@app.get("/api/beds")
async def beds():
    return {"beds": list_beds()}


@app.patch("/api/beds/{bed_id}/status")
async def patch_bed_status(bed_id: int, req: BedStatusUpdateRequest):
    try:
        updated = update_bed_status(bed_id, req.status)
        if not updated:
            raise HTTPException(status_code=404, detail="Bed not found")
        return updated
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/beds/{bed_id}/assign")
async def post_assign_bed(bed_id: int, req: BedAssignRequest):
    try:
        return assign_bed_to_patient(bed_id, req.patient_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/beds/{bed_id}/vacate")
async def post_vacate_bed(bed_id: int):
    try:
        return vacate_bed(bed_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/beds/{bed_id}/transfer")
async def post_transfer_bed(bed_id: int, req: BedTransferRequest):
    try:
        return transfer_patient_to_bed(bed_id, req.target_bed_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/patients/{patient_id}")
async def patient_by_id(patient_id: int):
    patient = get_patient(patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient


@app.post("/api/patients")
async def create_patient_record(req: PatientCreateRequest):
    try:
        payload = req.model_dump()
        assessment = assess_patient_risk(payload)
        payload["ews"] = assessment["ews"]
        payload["status"] = assessment["status"]

        created = create_patient(payload)
        created["risk_assessment"] = assessment
        return created
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/api/patients/{patient_id}")
async def update_patient_record(patient_id: int, req: PatientUpdateRequest):
    patch = req.model_dump(exclude_unset=True)

    existing = get_patient(patient_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Patient not found")

    merged = {**existing, **patch}
    assessment = assess_patient_risk(merged)
    patch["ews"] = assessment["ews"]
    patch["status"] = assessment["status"]

    updated = update_patient(patient_id, patch)
    if not updated:
        raise HTTPException(status_code=404, detail="Patient not found")
    updated["risk_assessment"] = assessment
    return updated


@app.get("/", include_in_schema=False)
async def serve_index():
    return FileResponse(FRONTEND_ROOT / "index.html")


app.mount("/", StaticFiles(directory=FRONTEND_ROOT, html=True), name="frontend")
