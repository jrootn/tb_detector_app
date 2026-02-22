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
from pydantic import BaseModel, ConfigDict, Field


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
_user_cache: Dict[str, Dict[str, Any]] = {}
_doctor_by_facility_cache: Dict[str, Optional[str]] = {}
_lab_by_facility_cache: Dict[str, Optional[str]] = {}
ENABLE_DUMMY_AI = os.environ.get("ENABLE_DUMMY_AI", "0") == "1"


def get_user_doc(uid: Optional[str]) -> Dict[str, Any]:
    if not uid:
        return {}
    if uid in _user_cache:
        return _user_cache[uid]
    snap = db.collection("users").document(uid).get()
    data = snap.to_dict() if snap.exists else {}
    _user_cache[uid] = data or {}
    return _user_cache[uid]


def get_assignee_for_facility(facility_id: Optional[str], role: str) -> Optional[str]:
    if not facility_id:
        return None
    cache = _doctor_by_facility_cache if role == "DOCTOR" else _lab_by_facility_cache
    if facility_id in cache:
        return cache[facility_id]

    query_result = db.collection("users").where("role", "==", role).stream()
    selected_uid = None
    for doc_snapshot in query_result:
        data = doc_snapshot.to_dict() or {}
        if data.get("facility_id") == facility_id:
            selected_uid = doc_snapshot.id
            break
    cache[facility_id] = selected_uid
    return selected_uid


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
    night_sweats: Optional[str] = None
    weight_loss: Optional[str] = None
    heart_rate_bpm: Optional[float] = None
    body_temperature_c: Optional[float] = None
    body_temperature_source_unit: Optional[str] = None
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
    model_config = ConfigDict(extra="allow")

    hear_embedding_id: Optional[str] = None
    hear_score: Optional[float] = None
    medgemini_summary: Optional[str] = None
    medgemini_summary_en: Optional[str] = None
    medgemini_summary_hi: Optional[str] = None
    medgemini_summary_i18n: Optional[Dict[str, str]] = None
    risk_score: Optional[float] = None
    risk_level: Optional[str] = None


class Status(BaseModel):
    triage_status: Optional[str] = None
    test_scheduled_date: Optional[str] = None
    doctor_notes: Optional[str] = None


class Patient(BaseModel):
    model_config = ConfigDict(extra="allow")

    patient_local_id: str
    device_id: str
    asha_worker_id: str
    asha_id: Optional[str] = None
    sample_id: Optional[str] = None
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
    if triage_status in {"AI_TRIAGED", "TEST_QUEUED"}:
        return "AI triage completed. Keep this case in testing queue based on risk and capacity."
    if triage_status == "LAB_DONE":
        return "Lab result is ready. Doctor should finalize mandatory follow-up actions."
    if triage_status == "DOCTOR_FINALIZED":
        return "Doctor finalized action plan. ASHA should execute mandatory follow-up tasks."
    if triage_status == "ASHA_ACTION_IN_PROGRESS":
        return "ASHA follow-up is in progress. Track adherence and household screening."
    if triage_status == "CLOSED":
        return "Case workflow closed. Continue routine surveillance where needed."

    if risk_score >= 8:
        return "High TB suspicion. Prioritize this case in test queue and rapid review."
    if risk_score >= 5:
        return "Moderate TB risk. Keep in active testing queue and monitor."
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

        record.synced_at = _utc_now()
        if not record.asha_id:
            record.asha_id = record.asha_worker_id
        if ENABLE_DUMMY_AI:
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
            record.ai = ai_result

        asha_doc = get_user_doc(record.asha_id or record.asha_worker_id)
        facility_id = asha_doc.get("facility_id")
        tu_id = asha_doc.get("tu_id")
        facility_name = asha_doc.get("facility_name")
        assigned_doctor_id = get_assignee_for_facility(facility_id, "DOCTOR")
        assigned_lab_tech_id = get_assignee_for_facility(facility_id, "LAB_TECH")

        payload = record.model_dump()
        if asha_doc.get("name"):
            payload["asha_name"] = asha_doc.get("name")
        if asha_doc.get("phone"):
            payload["asha_phone_number"] = asha_doc.get("phone")
        if facility_id:
            payload["facility_id"] = facility_id
            payload["facility_name"] = facility_name
            payload["tu_id"] = tu_id
            payload["assignment_mode"] = "FACILITY_TAGGING"
            payload["assigned_doctor_id"] = assigned_doctor_id
            payload["assigned_lab_tech_id"] = assigned_lab_tech_id

        doc_ref.set(payload, merge=True)

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
