from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams
from fastembed import TextEmbedding
import uuid
from pathlib import Path

# This corpus intentionally excludes named patient records.
# Real-time patient context comes from the operational SQLite database.
HOSPITAL_KNOWLEDGE = [
    "Hospital Layout - Ground Floor: Emergency Department, Pharmacy, Canteen, Restrooms, Reception.",
    "Hospital Layout - 1st Floor: Blood Bank (Wing B), Pathology Laboratory, General Wards G-01 to G-07.",
    "Hospital Layout - 2nd Floor: Radiology / X-Ray (Wing A), Cardiac Ward (C-01, C-02), Echo Lab.",
    "Hospital Layout - 3rd Floor: ICU (Beds ICU-1 to ICU-4), Physiotherapy and Rehab Centre.",
    "Staff areas: Nurses station on each floor. Doctor lounge on 2nd floor. Pharmacy store room in Ground Floor Wing C.",
    "Deteriorating Patient Protocol (EWS >=5): increase observations to every 15 minutes, inform ward doctor, reassess ABC, escalate to senior at EWS 7-8, activate MET at EWS >=9.",
    "Sepsis Protocol: draw blood cultures before antibiotics, broad-spectrum antibiotics within 1 hour, 30ml/kg crystalloid in first 3 hours, lactate monitoring, vasopressors if MAP <65 after fluids.",
    "Acute MI Protocol: ECG within 10 minutes, aspirin loading, second antiplatelet, anticoagulation, activate cath lab with 90-minute door-to-balloon target, oxygen for SpO2 below 94%.",
    "Fall Risk Protocol: non-slip footwear, bed in low position, call bell in reach, bed alarm, hourly checks for high-risk patients.",
    "DVT Prevention Protocol: LMWH prophylaxis unless contraindicated, mechanical prophylaxis, early mobilisation, daily reassessment.",
    "Common medication interaction alerts: metformin with IV contrast, warfarin with antibiotics, NSAIDs with ACE inhibitors, GTN with sildenafil.",
    "Antibiotic guidance summary: CAP first-line options, HAP broad-spectrum options, UTI oral regimens, sepsis empirical escalation policy per local stewardship.",
    "Bed management policy: prioritize ICU/HDU based on acuity, keep escalation buffer for emergency admissions, and update occupancy board every shift.",
    "Shift schedule baseline: day shift 07:00-19:00, night shift 19:00-07:00. Maintain handover checklist including outstanding tasks, active alerts, pending labs, and medications due.",
    "Lab turn-around targets: routine bloods 2 hours, ABG 15 minutes, troponin 1 hour, blood cultures preliminary 48-72 hours.",
    "Discharge workflow: finalize summary, medication reconciliation, follow-up booking, and GP communication before discharge.",
    "Energy and facility policy: eco-mode in non-clinical areas only, maintain full power for ICU/OT/critical wards, schedule generator tests in low-impact windows.",
    "Visitor policy baseline: controlled visiting windows, ICU restrictions, hand hygiene compliance, and isolation precautions for flagged patients.",
    "Emergency contacts policy: MET, ICU registrar, cardiology, blood bank, pharmacy on-call, radiology urgent line, and admin on-call escalation path.",
    "Data governance policy: identifiable patient data must come from operational systems, not static source code or vector seed files.",
]

print("Loading embedding model...")
embedding_model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")

print("Initializing local Qdrant...")
qdrant = QdrantClient(path=str(Path(__file__).with_name("qdrant_db")))
COLLECTION_NAME = "hospital_knowledge"

if qdrant.collection_exists(COLLECTION_NAME):
    qdrant.delete_collection(COLLECTION_NAME)
    print("Dropped existing collection.")

qdrant.create_collection(
    collection_name=COLLECTION_NAME,
    vectors_config=VectorParams(size=384, distance=Distance.COSINE),
)

print(f"Embedding and indexing {len(HOSPITAL_KNOWLEDGE)} documents...")
embeddings = list(embedding_model.embed(HOSPITAL_KNOWLEDGE))

points = []
for i, text in enumerate(HOSPITAL_KNOWLEDGE):
    points.append(
        PointStruct(
            id=str(uuid.uuid4()),
            vector=embeddings[i].tolist(),
            payload={"text": text, "index": i},
        )
    )

qdrant.upsert(collection_name=COLLECTION_NAME, points=points)
print(f"Successfully indexed {len(points)} documents into Qdrant!")
print("Knowledge base ready. Run main.py to start the API.")
