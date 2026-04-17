# MediNexus

MediNexus is an AI-driven hospital operations demo platform that combines a real-time command center UI, patient monitoring simulation, energy optimization dashboard, and a multilingual patient companion chatbot.

The project includes:
- A static frontend (multi-page HTML/CSS/JS)
- A FastAPI backend for Retrieval-Augmented Generation (RAG) chat
- Local vector search with Qdrant + FastEmbed
- Groq LLM integration (Llama 3)

## Project Highlights

- Multi-agent simulation with 5 conceptual agents:
  - SentinelAgent (patient safety)
  - FlowAgent (bed/resource flow)
  - GreenAgent (energy optimization)
  - CareGuide (patient companion)
  - CommandAgent (orchestration)
- Live-updating hospital vitals and alerts
- Bed occupancy visualization and action approval flows
- Multilingual CareGuide support (English, Hindi, Tamil, Telugu)
- RAG backend for hospital-knowledge grounded responses

## Folder Structure

```text
medinexus-main/
  index.html
  dashboard.html
  patients.html
  companion.html
  css/
    style.css
  js/
    simulation.js
  backend/
    main.py
    init_db.py
```

## Tech Stack

Frontend:
- HTML5
- CSS3
- Vanilla JavaScript

Backend:
- Python 3.10+
- FastAPI
- Uvicorn
- Qdrant (local file-based)
- FastEmbed (`BAAI/bge-small-en-v1.5`)
- Groq API (`llama3-8b-8192`)
- SQLite patient store (`backend/data/medinexus.db`)

## How It Works

1. Frontend pages render dashboards and use `js/simulation.js` to simulate real-time hospital data.
2. `backend/init_db.py` embeds hospital knowledge snippets and indexes them into a local Qdrant collection.
3. `backend/main.py` initializes an operational SQLite patient database (seeded from `backend/data/patients_seed.json`).
4. `backend/main.py` exposes `POST /api/chat`:
   - Embeds user query
   - Retrieves top relevant knowledge chunks from Qdrant
  - Injects live patient snapshot from SQLite (not hard-coded in source)
   - Builds a grounded system prompt
   - Sends response request to Groq LLM
5. Backend returns a concise multilingual reply.

## Setup and Run

### 1) Clone and enter the project

```bash
git clone <your-repo-url>
cd medinexus-main
```

### 2) Frontend run (recommended via local static server)

Use any local server so relative assets load correctly.

Python option:

```bash
python -m http.server 5500
```

Then open:
- `http://localhost:5500/index.html`

### Quick Start (Windows Batch Script)

You can use the included launcher script from the project root:

```bat
run_medinexus.bat setup
run_medinexus.bat initdb
set GROQ_API_KEY=your_groq_api_key_here
run_medinexus.bat all
```

Available commands:
- `run_medinexus.bat setup` (create venv + install backend deps)
- `run_medinexus.bat initdb` (index hospital knowledge into local Qdrant)
- `run_medinexus.bat backend` (start FastAPI on port 8000)
- `run_medinexus.bat frontend` (start static server on port 5500)
- `run_medinexus.bat all` (start frontend and backend in separate windows)

### 3) Backend setup

From the `backend` folder:

```bash
cd backend
python -m venv venv
```

Activate venv:

Windows (PowerShell):

```powershell
.\venv\Scripts\Activate.ps1
```

Install dependencies:

```bash
pip install fastapi uvicorn qdrant-client fastembed groq python-dotenv
```

Set environment variable:

Windows (PowerShell):

```powershell
$env:GROQ_API_KEY="your_groq_api_key_here"
```

Or create `backend/.env` from `backend/.env.example` and set:

```env
GROQ_API_KEY=your_groq_api_key_here
```

Initialize vector DB:

```bash
python init_db.py
```

Run API:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

API docs:
- `http://localhost:8000/docs`

## API

### `POST /api/chat`

Request body:

```json
{
  "messages": [
    { "role": "user", "content": "How do I reach radiology?" }
  ],
  "language": "en"
}
```

Response:

```json
{
  "reply": "...assistant response..."
}
```

### `GET /api/patients`

Returns active patient records from SQLite:

```json
{
  "patients": [
    {
      "id": 1,
      "patient_code": "P-1001",
      "display_name": "Patient 1001",
      "ward": "General",
      "bed": "G-01",
      "ews": 1,
      "status": "stable",
      "vitals": { "hr": 75, "spo2": 97, "sbp": 125, "dbp": 82, "temp": 37.1, "rr": 16 }
    }
  ]
}
```

### `POST /api/patients`

Creates a new patient record in SQLite.

### `PATCH /api/patients/{patient_id}`

Updates an existing patient record in SQLite.

## Important Note About Current Chat Integration

The current `companion.html` is configured to call Groq directly from the browser using:
- `OPENAI_KEY = 'YOUR_GROQ_API_KEY_HERE'`
- `https://api.groq.com/openai/v1/chat/completions`

At the same time, a secure backend endpoint (`/api/chat`) already exists.

For production/security best practice:
- Do **not** expose API keys in frontend code.
- Route chat calls from frontend to backend (`/api/chat`) instead.
- Keep `GROQ_API_KEY` only on the server.

## Core Pages

- `index.html`: Landing page and system overview
- `dashboard.html`: Command center with alerts, vitals, beds, and action logs
- `patients.html`: Detailed patient monitor cards with EWS and trends
- `companion.html`: CareGuide conversational assistant UI

## Simulation Engine

`js/simulation.js` provides:
- Synthetic patient data and vitals jitter
- EWS scoring logic
- Alert generation and escalation
- Agent activity feed events
- Bed status simulation
- Shared utility functions for vitals and display

## Troubleshooting

- Chat not responding:
  - Verify `GROQ_API_KEY` is set.
  - Ensure backend is running if you use `/api/chat`.
  - If using direct browser call, confirm placeholder key is replaced (not recommended for production).
- Qdrant errors:
  - Run `python init_db.py` before starting `main.py`.
  - Confirm write permissions for `backend/qdrant_db`.
- CORS or fetch issues:
  - Serve frontend over `http://localhost` (not `file://`).

## Future Improvements

- Connect `companion.html` to backend `/api/chat` endpoint by default
- Add authentication and role-based access
- Persist simulation and action logs in a real database
- Add tests for EWS scoring and API behavior
- Dockerize frontend + backend for simpler deployment

## License

No license file is currently present in this repository. Add one (for example MIT) if you plan to share or open-source this project.
