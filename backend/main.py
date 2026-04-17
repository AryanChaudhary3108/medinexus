from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from qdrant_client import QdrantClient
from fastembed import TextEmbedding
import os
from groq import Groq
from typing import Optional

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
qdrant = QdrantClient(path="./qdrant_db")
COLLECTION_NAME = "hospital_knowledge"

class ChatRequest(BaseModel):
    messages: list
    language: str = "en"
    role: Optional[str] = "nurse"   # nurse | doctor | admin

ROLE_CONTEXT = {
    "nurse": (
        "You are assisting a WARD NURSE. Focus on: real-time patient vitals, "
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

@app.post("/api/chat")
async def chat_with_careguide(req: ChatRequest):
    try:
        user_query = req.messages[-1]["content"] if req.messages else ""

        # ── 1. Embed query and search Qdrant ──────────────────────────
        context = ""
        retrieved_docs = []
        if user_query:
            query_vector = list(embedding_model.embed([user_query]))[0]
            search_result = qdrant.search(
                collection_name=COLLECTION_NAME,
                query_vector=query_vector.tolist(),
                limit=4
            )
            retrieved_docs = [hit.payload["text"] for hit in search_result]
            context = "\n".join(retrieved_docs)

        # ── 2. Build role-aware clinical system prompt ─────────────────
        role = req.role or "nurse"
        role_instruction = ROLE_CONTEXT.get(role, ROLE_CONTEXT["nurse"])

        system_prompt = f"""You are CareGuide Clinical, an AI-powered clinical intelligence assistant for MediNexus Hospital staff.

{role_instruction}

== RETRIEVED HOSPITAL KNOWLEDGE (from Qdrant vector DB) ==
{context if context else "No specific knowledge retrieved for this query. Use general clinical guidelines."}
==========================================================

== RULES ==
- Ground your answer in the retrieved knowledge above whenever relevant.
- If the retrieved knowledge directly answers the query, cite it clearly.
- For clinical protocol questions not in the knowledge base, provide standard best-practice guidance.
- NEVER diagnose — say "suggest clinical review" or "consider X based on current vitals".
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
