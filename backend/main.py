import json
import os
import random
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from firebase_admin import auth, credentials, firestore, initialize_app
from pydantic import BaseModel, Field


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ----------------------
# Firebase initialization
# ----------------------
if not os.environ.get("FIREBASE_APP_INITIALIZED"):
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not cred_path:
        local_key = Path(__file__).with_name("serviceAccountKey.json")
        if local_key.exists():
            cred_path = str(local_key)
    if cred_path:
        initialize_app(credentials.Certificate(cred_path))
    else:
        # Uses Application Default Credentials (ADC)
        initialize_app(credentials.ApplicationDefault())
    os.environ["FIREBASE_APP_INITIALIZED"] = "1"

db = firestore.client()


# ----------------------
# Pydantic schemas
# ----------------------
class Demographics(BaseModel):
    name: str
    age: int
    gender: str
    phone: str
    aadhar_last4: Optional[str] = None
    address: str
    village: str
    pincode: str


class GPS(BaseModel):
    lat: float
    lng: float
    accuracy_m: Optional[float] = None


class Vitals(BaseModel):
    weight_kg: Optional[float] = None
    height_cm: Optional[float] = None


class Symptom(BaseModel):
    symptom_code: str
    severity: Optional[str] = None
    duration_days: Optional[int] = None


class Clinical(BaseModel):
    cough_duration_days: Optional[int] = None
    cough_nature: Optional[str] = None
    fever_history: Optional[str] = None
    physical_signs: List[str] = Field(default_factory=list)
    risk_factors: List[str] = Field(default_factory=list)
    risk_factor_answers: Dict[str, str] = Field(default_factory=dict)
    other_observations: Optional[str] = None


class AudioMeta(BaseModel):
    audio_file_id: str
    file_name: Optional[str] = None
    mime_type: Optional[str] = None
    duration_sec: Optional[float] = None
    storage_uri: Optional[str] = None
    uploaded_at: Optional[str] = None


class AIResult(BaseModel):
    hear_embedding_id: Optional[str] = None
    hear_score: Optional[float] = None
    medgemini_summary: Optional[str] = None
    risk_score: Optional[float] = None
    risk_level: Optional[str] = None


class Status(BaseModel):
    triage_status: Optional[str] = None
    test_scheduled_date: Optional[str] = None
    doctor_notes: Optional[str] = None


class Patient(BaseModel):
    patient_local_id: str
    device_id: str
    asha_worker_id: str
    created_at_offline: str
    synced_at: Optional[str] = None

    demographics: Demographics
    gps: Optional[GPS] = None
    vitals: Optional[Vitals] = None
    symptoms: List[Symptom] = Field(default_factory=list)
    clinical: Optional[Clinical] = None
    audio: List[AudioMeta] = Field(default_factory=list)
    ai: Optional[AIResult] = None
    status: Optional[Status] = None


class SyncBatch(BaseModel):
    records: List[Patient]
    batch_metadata: Optional[Dict[str, Any]] = None


# ----------------------
# Mock AI functions
# ----------------------

def get_hear_score(_: Optional[List[AudioMeta]]) -> float:
    return round(random.uniform(0.2, 0.95), 2)


def get_medgemini_summary(risk_score: float, triage_status: Optional[str]) -> str:
    if triage_status == "ASSIGNED_TO_LAB":
        return "Assigned to lab for confirmatory testing. Prioritize sample processing."
    if triage_status == "LAB_DONE":
        return "Lab work completed. Review results and finalize treatment plan."
    if triage_status == "UNDER_TREATMENT":
        return "Patient on treatment. Continue monitoring and adherence support."
    if triage_status == "CLEARED":
        return "Low concern. Provide routine follow-up and health education."
    if triage_status == "TEST_PENDING":
        return "Testing pending. Schedule sputum or X-ray as soon as possible."

    if risk_score >= 8:
        return "High TB suspicion. Urgent evaluation and testing recommended."
    if risk_score >= 5:
        return "Moderate TB risk. Expedite diagnostics and follow-up."
    return "Low TB risk. Monitor symptoms and advise follow-up if worsening."


def get_risk_level(score: float) -> str:
    if score >= 7.0:
        return "HIGH"
    if score >= 4.0:
        return "MEDIUM"
    return "LOW"


# ----------------------
# Auth dependency
# ----------------------

def verify_firebase_token(request: Request) -> Dict[str, Any]:
    if os.environ.get("DISABLE_AUTH") == "1":
        return {"uid": "dev-user"}

    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = auth_header.split(" ", 1)[1].strip()
    try:
        decoded = auth.verify_id_token(token)
        return decoded
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Firebase ID token")


# ----------------------
# FastAPI app
# ----------------------
app = FastAPI(title="Smart TB Triage System", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/v1/sync")
async def sync_patients(request: Request, _: Dict[str, Any] = Depends(verify_firebase_token)):
    content_type = request.headers.get("content-type", "")

    if "multipart/form-data" in content_type:
        form = await request.form()
        records_raw = form.get("records")
        if not records_raw:
            raise HTTPException(status_code=400, detail="Missing 'records' JSON in form data")
        if isinstance(records_raw, bytes):
            records_raw = records_raw.decode("utf-8")
        try:
            payload = json.loads(records_raw)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON in 'records'")
        if isinstance(payload, dict) and "records" in payload:
            batch = SyncBatch(**payload)
        elif isinstance(payload, list):
            batch = SyncBatch(records=[Patient(**item) for item in payload])
        else:
            raise HTTPException(status_code=400, detail="Invalid records payload")
    else:
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")
        if isinstance(body, dict) and "records" in body:
            batch = SyncBatch(**body)
        elif isinstance(body, list):
            batch = SyncBatch(records=[Patient(**item) for item in body])
        else:
            raise HTTPException(status_code=400, detail="Body must be a list of records or {records: [...]} ")

    created = 0
    updated = 0
    results: List[Dict[str, Any]] = []

    for record in batch.records:
        doc_ref = db.collection("patients").document(record.patient_local_id)
        doc_snapshot = doc_ref.get()
        exists = doc_snapshot.exists

        hear_score = get_hear_score(record.audio)
        risk_score = round(min(10.0, hear_score * 10), 1)
        triage_status = record.status.triage_status if record.status else None
        ai_result = AIResult(
            hear_embedding_id=str(uuid.uuid4()),
            hear_score=hear_score,
            medgemini_summary=get_medgemini_summary(risk_score, triage_status),
            risk_score=risk_score,
            risk_level=get_risk_level(risk_score),
        )

        record.synced_at = _utc_now()
        record.ai = ai_result

        doc_ref.set(record.model_dump(), merge=True)

        if exists:
            updated += 1
        else:
            created += 1

        results.append(
            {
                "patient_local_id": record.patient_local_id,
                "status": "updated" if exists else "created",
            }
        )

    return {
        "created": created,
        "updated": updated,
        "total": len(batch.records),
        "results": results,
    }


@app.get("/health")
async def health_check():
    return {"status": "ok", "time": _utc_now()}
