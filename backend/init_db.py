from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance, PointStruct
from fastembed import TextEmbedding
import uuid

# ──────────────────────────────────────────────────────────────────
#  HOSPITAL KNOWLEDGE BASE  (clinical staff focus)
# ──────────────────────────────────────────────────────────────────
HOSPITAL_KNOWLEDGE = [

    # ── LAYOUT ────────────────────────────────────────────────────
    "Hospital Layout - Ground Floor: Emergency Department, Pharmacy, Canteen, Restrooms, Reception.",
    "Hospital Layout - 1st Floor: Blood Bank (Wing B), Pathology Laboratory, General Wards G-01 to G-07.",
    "Hospital Layout - 2nd Floor: Radiology / X-Ray (Wing A), Cardiac Ward (C-01, C-02), Echo Lab.",
    "Hospital Layout - 3rd Floor: ICU (Beds ICU-1 to ICU-4), Physiotherapy and Rehab Centre.",
    "Hospital Layout - Staff Areas: Nurses station on each floor. Doctor's lounge on 2nd floor. Pharmacy store-room Ground Floor Wing C.",

    # ── CURRENT PATIENTS ──────────────────────────────────────────
    "Patient Rajesh Kumar | 58M | Bed G-01 | General Ward | Hypertension, Diabetes | EWS 1 STABLE. "
    "Vitals: HR 75, SpO2 97%, BP 125/82, Temp 37.1, RR 16. "
    "Meds: Metformin 500mg after breakfast 08:00, Amlodipine 5mg after lunch 13:00, Aspirin 75mg after dinner 20:00. "
    "Appointments: 14:00 Blood Test Lab 1F, 16:30 Physiotherapy Ground Floor. Likely discharge: tomorrow morning.",

    "Patient Priya Sharma | 34F | Bed G-02 | General Ward | Post-operative Day 2 (Laparoscopic Cholecystectomy) | EWS 2 STABLE. "
    "Vitals: HR 88, SpO2 98%, BP 118/76, Temp 37.4, RR 18. "
    "Wound check due 15:00. Pain score 3/10. On IV fluids 500ml 8hrly. Oral liquids started today.",

    "Patient Mohammed Ali | 67M | Bed C-01 | Cardiac Ward | CAD, Congestive Heart Failure | EWS 5 WARNING. "
    "Vitals: HR 92, SpO2 95%, BP 145/92, Temp 37.0, RR 20. "
    "On Furosemide 40mg, Carvedilol 6.25mg, Ramipril 5mg. Daily weight monitoring. Fluid restriction 1.5L/day. "
    "Echo scheduled tomorrow 09:00. Cardiology review pending.",

    "Patient Anita Patel | 45F | Bed G-03 | General Ward | Community-Acquired Pneumonia | EWS 5 WARNING. "
    "Vitals: HR 95, SpO2 94%, BP 130/85, Temp 38.3, RR 22. ACTIVE ALERT: Fever spike. "
    "On Augmentin 1.2g IV 8hrly. Sputum culture sent. Chest X-ray done this morning. "
    "Antibiotic escalation to Piperacillin-Tazobactam recommended pending culture results. Needs O2 via nasal prongs 2L/min.",

    "Patient Suresh Nair | 72M | Bed ICU-1 | ICU | Sepsis secondary to UTI, Acute Kidney Injury | EWS 8 CRITICAL. "
    "Vitals: HR 110, SpO2 91%, BP 95/60, Temp 39.1, RR 26. ACTIVE ALERT: Sepsis protocol initiated. "
    "On Meropenem 1g IV 8hrly, Norepinephrine 0.1mcg/kg/min, O2 high-flow 15L/min. "
    "Urine output 20ml/hr (oliguria). Creatinine 3.2 (baseline 1.0). "
    "ICU transfer approved. Nephrology consult requested. Blood cultures x2 sent. Lactate 3.8.",

    "Patient Vikram Singh | 55M | Bed C-02 | Cardiac Ward | Acute STEMI, Hypertension | EWS 9 CRITICAL. "
    "Vitals: HR 108, SpO2 92%, BP 158/100, Temp 37.6, RR 24. ACTIVE ALERT: Acute MI protocol active. "
    "On Aspirin 300mg stat given, GTN infusion running, Heparin 5000 units IV given. "
    "Cath lab on standby. Cardiology/interventional team notified. ECG shows ST elevation V1-V4. "
    "Door-to-balloon target: 90 minutes. Family informed.",

    "Patient Meena Reddy | 29F | Bed G-04 | General Ward | Post-appendectomy Day 1 | EWS 1 STABLE. "
    "Vitals: HR 82, SpO2 99%, BP 115/74, Temp 37.8, RR 15. "
    "Ambulating independently. Tolerating soft diet. Drain output 30ml clear. Antibiotics for 24hrs more.",

    "Patient Arjun Mehta | 42M | Bed G-05 | General Ward | Post lumbar microdiscectomy Day 3 | EWS 0 STABLE. "
    "Vitals: HR 70, SpO2 99%, BP 120/78, Temp 37.2, RR 14. "
    "Mobilising with physio. Neurology signed off. Planned discharge today 17:00. Discharge summary pending.",

    "Patient Fatima Begum | 38F | Bed G-06 | General Ward | Acute Severe Asthma, Allergic Reaction | EWS 4 WARNING. "
    "Vitals: HR 98, SpO2 95%, BP 122/80, Temp 37.9, RR 21. "
    "On salbutamol nebulisation 4hrly, IV Hydrocortisone 200mg 6hrly, Chlorpheniramine. Peak flow monitoring. "
    "Trigger: suspected nuts allergy. Allergy testing ordered.",

    "Patient Ravi Krishnan | 63M | Bed ICU-2 | ICU | Haemorrhagic Stroke, Hypertension | EWS 4 WARNING. "
    "Vitals: HR 85, SpO2 96%, BP 170/105, Temp 37.3, RR 17. "
    "GCS 12/15. On Labetalol infusion targeting SBP 140-160. CT Head done - 1.5cm bleed right temporal. "
    "Neurosurgery reviewed - conservative management. Swallowing assessment pending. NG tube in situ.",

    "Patient Lakshmi Devi | 80F | Bed R-01 | Geriatric/Rehab | COPD exacerbation, Osteoarthritis | EWS 4 WARNING. "
    "Vitals: HR 78, SpO2 93%, BP 135/88, Temp 36.8, RR 19. "
    "On O2 2L/min, Salbutamol + Ipratropium nebulisation 6hrly, Prednisolone 30mg. "
    "High fall risk - bed alarm on, non-slip footwear. OT assessment tomorrow.",

    "Patient Sunita Joshi | 52F | Bed G-07 | General Ward | Acute Cholecystitis, Gallstones | EWS 1 STABLE. "
    "Vitals: HR 73, SpO2 98%, BP 118/76, Temp 37.0, RR 15. "
    "Elective laparoscopic cholecystectomy planned for tomorrow 10:00. NBM from midnight. Consent signed.",

    # ── CLINICAL PROTOCOLS ────────────────────────────────────────
    "Sepsis Protocol (qSOFA): Score ≥2 triggers sepsis alert. Steps: (1) Blood cultures x2 before antibiotics. "
    "(2) IV antibiotics within 1 hour (Piperacillin-Tazobactam or Meropenem for severe). "
    "(3) IV fluid resuscitation 30ml/kg crystalloid over 3 hours. "
    "(4) Measure lactate - if >2mmol/L repeat in 2hrs. (5) Foley catheter for urine output monitoring target >0.5ml/kg/hr. "
    "(6) Notify ICU if organ dysfunction present. (7) Vasopressors (Norepinephrine) if MAP <65 despite fluids.",

    "Acute MI (STEMI) Protocol: (1) 12-lead ECG within 10 min of presentation. "
    "(2) Aspirin 300mg loading dose stat. (3) Ticagrelor 180mg or Clopidogrel 600mg. "
    "(4) Heparin 5000 units IV or LMWH. (5) GTN sublingual/infusion if BP allows. "
    "(6) Activate cath lab - door-to-balloon target 90 minutes. "
    "(7) Morphine 2-4mg IV for pain. (8) O2 if SpO2 <94%. (9) Cardiology + Interventional Radiology urgent bleep.",

    "Deteriorating Patient Protocol (EWS ≥5): (1) Increase observations to every 15 minutes. "
    "(2) Inform ward doctor immediately. (3) Reassess airway, breathing, circulation. "
    "(4) EWS 7-8: Call senior doctor/registrar. (5) EWS ≥9 or rapidly deteriorating: Activate MET (Medical Emergency Team). "
    "(6) Prepare crash trolley, ensure IV access, draw bloods (FBC, U&E, CRP, cultures, ABG if needed).",

    "Fall Risk Protocol: Morse Fall Scale ≥45 = high risk. Actions: "
    "(1) Non-slip footwear at all times. (2) Bed alarm activated. (3) Nurse call button within reach. "
    "(4) Bed in lowest position. (5) Document as High Fall Risk in notes. "
    "(6) Hourly checks for high-risk patients. (7) Bed rails up at night.",

    "DVT Prevention Protocol: For immobile/post-op patients: "
    "(1) LMWH (Enoxaparin 40mg SC once daily) unless contraindicated. "
    "(2) TED stockings if not contraindicated. (3) Encourage early mobilisation. "
    "(4) Pneumatic compression devices for high-risk surgical patients. "
    "(5) Reassess daily and document.",

    # ── MEDICATIONS ───────────────────────────────────────────────
    "Common Drug Interactions to flag: "
    "Metformin + IV contrast → hold Metformin 48hrs before and after. "
    "Warfarin + Antibiotics → monitor INR closely. "
    "NSAIDs + ACE inhibitors → risk of AKI, monitor renal function. "
    "Furosemide + Aminoglycosides → increased ototoxicity risk. "
    "Metformin + Alcohol → lactic acidosis risk. "
    "GTN + Sildenafil → severe hypotension, contraindicated.",

    "Antibiotic Guide (common): CAP - Amoxicillin 500mg TDS or Augmentin 625mg TDS oral. "
    "Hospital-acquired pneumonia - Piperacillin-Tazobactam 4.5g IV 8hrly or Meropenem 1g IV 8hrly. "
    "UTI - Trimethoprim 200mg BD 7 days or Nitrofurantoin 100mg BD 5 days. "
    "Sepsis empirical - Meropenem 1g IV 8hrly + Metronidazole 500mg IV 8hrly if abdominal source.",

    # ── OPERATIONAL INFO ──────────────────────────────────────────
    "Bed Status: Total beds 127. ICU beds 4 (2 occupied - ICU-1 Suresh Nair, ICU-2 Ravi Krishnan). "
    "Cardiac beds C-01, C-02 both occupied. General Ward G-01 to G-07 all occupied. "
    "Available beds: HDU-1, HDU-2 (High Dependency Unit, 2nd floor). 8 general beds Wing B available.",

    "Shift Information: Day shift 07:00-19:00. Night shift 19:00-07:00. "
    "Day shift staff: Sr. Nurse Priya (Ward A), Nurse Deepa (ICU), Nurse Ramu (Cardiac). "
    "On-call Doctor: Dr. Sharma (Internal Medicine) until 22:00. "
    "On-call Surgeon: Dr. Kapoor. On-call Cardiologist: Dr. Mehta.",

    "Lab Turn-Around Times: Routine bloods (FBC, U&E, LFT) - 2 hours. "
    "Blood cultures - 48-72 hours for preliminary. "
    "ABG - 15 minutes (blood gas machine Ward 3). "
    "Troponin - 1 hour. D-dimer - 1 hour. "
    "Urgent request: call Lab ext. 224 for STAT processing.",

    "Pending Lab Results: Anita Patel - sputum culture sent this morning (results expected 48hrs). "
    "Suresh Nair - blood cultures x2 sent 2hrs ago, urine culture sent. Creatinine trend monitored 6hrly. "
    "Vikram Singh - Troponin I from 1hr ago: 4.2 (elevated, normal <0.04). Repeat at 3hr post-admission pending.",

    "Discharge Planning: Arjun Mehta (G-05) - discharge today 17:00. Discharge summary to be completed by 16:00. "
    "TTO (To Take Out) medications: Ibuprofen 400mg TDS 5 days, Gabapentin 300mg BD 2 weeks. "
    "Outpatient physio referral letter to send. GP letter needed. "
    "Rajesh Kumar (G-01) - likely discharge tomorrow. Endocrinology OPD follow-up to book.",

    "Energy and Facility: HVAC system managed by GreenAgent. Current energy saving: 22%. "
    "Eco-mode active in corridors and non-clinical areas. Clinical areas (ICU, OT, wards) at full power. "
    "Generator test scheduled Sunday 06:00-06:30.",

    "Visiting Hours: 16:00 to 19:00 daily. Max 2 visitors per patient. ICU: 1 immediate family member only, 30 min visits. "
    "Infection control: all visitors must sanitise hands at ward entrance. No visits for patients on isolation precautions.",

    "Emergency Contacts: MET Team - ext. 999. ICU Registrar - ext. 301. Cardiology - ext. 412. "
    "Blood Bank - ext. 115. Pharmacy on-call - ext. 220. Radiology (urgent) - ext. 335. "
    "Hospital Administrator on-call - ext. 100.",
]

# ──────────────────────────────────────────────────────────────────
print("Loading embedding model...")
embedding_model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")

print("Initializing local Qdrant...")
qdrant = QdrantClient(path="./qdrant_db")
COLLECTION_NAME = "hospital_knowledge"

# Re-create collection fresh
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
            payload={"text": text, "index": i}
        )
    )

qdrant.upsert(collection_name=COLLECTION_NAME, points=points)
print(f"Successfully indexed {len(points)} documents into Qdrant!")
print("Knowledge base ready. Run main.py to start the API.")
