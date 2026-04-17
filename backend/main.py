from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from qdrant_client import QdrantClient
from fastembed import TextEmbedding
import os
from pathlib import Path
from dotenv import load_dotenv
from groq import Groq
from typing import Optional
from pydantic import Field

from patient_store import (
    create_patient,
    format_patient_snapshot,
    get_patient,
    init_patient_db,
    list_patients,
    update_patient,
)

load_dotenv(dotenv_path=Path(__file__).with_name(".env"))

app = FastAPI(title="MediNexus CareGuide Clinical API")

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


@app.get("/api/patients/{patient_id}")
async def patient_by_id(patient_id: int):
    patient = get_patient(patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient


@app.post("/api/patients")
async def create_patient_record(req: PatientCreateRequest):
    try:
        return create_patient(req.model_dump())
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/api/patients/{patient_id}")
async def update_patient_record(patient_id: int, req: PatientUpdateRequest):
    patch = req.model_dump(exclude_unset=True)

    updated = update_patient(patient_id, patch)
    if not updated:
        raise HTTPException(status_code=404, detail="Patient not found")
    return updated
