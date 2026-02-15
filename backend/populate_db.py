import io
import math
import os
import random
import uuid
import wave
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import firebase_admin
from firebase_admin import auth, credentials, firestore
from google.cloud import storage


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _random_date_within(days: int) -> str:
    dt = datetime.now(timezone.utc) - timedelta(days=random.randint(0, days))
    return dt.isoformat()


# ----------------------
# Firebase initialization
# ----------------------
CRED_PATH = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
if not CRED_PATH:
    local_key = Path(__file__).with_name("serviceAccountKey.json")
    if local_key.exists():
        CRED_PATH = str(local_key)

if not firebase_admin._apps:
    if CRED_PATH:
        firebase_admin.initialize_app(credentials.Certificate(CRED_PATH))
    else:
        firebase_admin.initialize_app(credentials.ApplicationDefault())

db = firestore.client()

UPLOAD_DUMMY_MEDIA = os.environ.get("UPLOAD_DUMMY_MEDIA", "1") == "1"
STORAGE_BUCKET = os.environ.get("FIREBASE_STORAGE_BUCKET") or os.environ.get("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET")
PATIENT_COUNT = int(os.environ.get("PATIENT_COUNT", "120"))


def get_storage_bucket():
    if not UPLOAD_DUMMY_MEDIA:
        return None
    if not STORAGE_BUCKET:
        print("Dummy media upload skipped: FIREBASE_STORAGE_BUCKET/NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is not set.")
        return None
    client = storage.Client.from_service_account_json(CRED_PATH) if CRED_PATH else storage.Client()
    print(f"Uploading dummy media to bucket: {STORAGE_BUCKET}")
    return client.bucket(STORAGE_BUCKET)


def generate_wav_bytes(duration_sec: int = 4, sample_rate: int = 16000) -> bytes:
    frames = int(duration_sec * sample_rate)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00\x00" * frames)
    return buffer.getvalue()


def generate_pdf_bytes() -> bytes:
    return b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


def upload_blob(bucket, path: str, data: bytes, content_type: str) -> str:
    blob = bucket.blob(path)
    blob.upload_from_string(data, content_type=content_type)
    return f"gs://{bucket.name}/{path}"


@dataclass
class Facility:
    id: str
    name: str
    type: str
    parent_id: Optional[str]
    district: str
    state: str
    lat: float
    lng: float
    service_pincodes: List[str]


TU_ID = "TU_LKO_BKT_01"
FACILITIES: List[Facility] = [
    Facility(
        id=TU_ID,
        name="Bakshi Ka Talab Tuberculosis Unit",
        type="TU",
        parent_id=None,
        district="Lucknow",
        state="Uttar Pradesh",
        lat=26.9760,
        lng=80.8964,
        service_pincodes=[],
    ),
    Facility(
        id="PHC_LKO_BKT_A",
        name="PHC Alpha - BKT",
        type="PHC",
        parent_id=TU_ID,
        district="Lucknow",
        state="Uttar Pradesh",
        lat=26.9822,
        lng=80.8845,
        service_pincodes=["226201", "226202", "226203"],
    ),
    Facility(
        id="PHC_LKO_BKT_B",
        name="PHC Beta - BKT",
        type="PHC",
        parent_id=TU_ID,
        district="Lucknow",
        state="Uttar Pradesh",
        lat=26.9695,
        lng=80.9190,
        service_pincodes=["226021", "226022", "226026"],
    ),
]

PHC_BY_ID = {f.id: f for f in FACILITIES if f.type == "PHC"}

FIRST_NAMES = [
    "Ramesh", "Sunita", "Mohan", "Lakshmi", "Rajesh", "Geeta", "Vijay", "Priya",
    "Arjun", "Meera", "Anita", "Sita", "Amit", "Pooja", "Sanjay", "Kiran", "Deepak", "Neha",
]
LAST_NAMES = ["Kumar", "Devi", "Lal", "Prasad", "Singh", "Verma", "Yadav", "Sharma", "Thakur", "Gupta", "Rao", "Mishra"]

SYMPTOMS = ["COUGH", "FEVER_HIGH", "NIGHT_SWEATS", "WEIGHT_LOSS", "CHEST_PAIN"]
RISK_FACTORS = ["HISTORY_TB", "FAMILY_TB", "SMOKER", "DIABETES", "HIV"]
PHYSICAL_SIGNS = ["CHEST_PAIN", "SHORTNESS_OF_BREATH", "LOSS_OF_APPETITE", "EXTREME_FATIGUE"]
ANSWER_CHOICES = ["yes", "no", "dontKnow", "preferNotToSay"]

TRIAGE_STATUSES = [
    "AWAITING_DOCTOR",
    "TEST_PENDING",
    "ASSIGNED_TO_LAB",
    "LAB_DONE",
    "UNDER_TREATMENT",
    "CLEARED",
]

# Demo users based on NTEP-style hierarchy
ADMIN_PROFILES = [
    {"name": "Suresh Kumar", "email": "suresh.sts@indiatb.gov", "facility_id": TU_ID},
]

DOCTOR_PROFILES = [
    {"name": "Dr. Aditi Singh", "email": "aditi.doctor@indiatb.gov", "facility_id": "PHC_LKO_BKT_A"},
    {"name": "Dr. Vikas Mishra", "email": "vikas.doctor@indiatb.gov", "facility_id": "PHC_LKO_BKT_B"},
]

LAB_PROFILES = [
    {"name": "Lab Tech Rohan", "email": "rohan.lab@indiatb.gov", "facility_id": "PHC_LKO_BKT_A"},
    {"name": "Lab Tech Neelam", "email": "neelam.lab@indiatb.gov", "facility_id": "PHC_LKO_BKT_B"},
]

ASHA_PROFILES = [
    {"name": "ASHA Sunita - Mal", "email": "sunita.asha@indiatb.gov", "facility_id": "PHC_LKO_BKT_A", "village": "Mal"},
    {"name": "ASHA Anita - Itaunja", "email": "anita.asha@indiatb.gov", "facility_id": "PHC_LKO_BKT_A", "village": "Itaunja"},
    {"name": "ASHA Geeta - Mahona", "email": "geeta.asha@indiatb.gov", "facility_id": "PHC_LKO_BKT_A", "village": "Mahona"},
    {"name": "ASHA Pooja - Kakori", "email": "pooja.asha@indiatb.gov", "facility_id": "PHC_LKO_BKT_A", "village": "Kakori"},
    {"name": "ASHA Meera - Rahimabad", "email": "meera.asha@indiatb.gov", "facility_id": "PHC_LKO_BKT_A", "village": "Rahimabad"},
    {"name": "ASHA Sita - Bakshi Ka Talab", "email": "sita.asha@indiatb.gov", "facility_id": "PHC_LKO_BKT_B", "village": "Bakshi Ka Talab"},
    {"name": "ASHA Kiran - Alamnagar", "email": "kiran.asha@indiatb.gov", "facility_id": "PHC_LKO_BKT_B", "village": "Alamnagar"},
    {"name": "ASHA Neha - Chinhat", "email": "neha.asha@indiatb.gov", "facility_id": "PHC_LKO_BKT_B", "village": "Chinhat"},
    {"name": "ASHA Rekha - Para", "email": "rekha.asha@indiatb.gov", "facility_id": "PHC_LKO_BKT_B", "village": "Para"},
    {"name": "ASHA Kavita - Sarojini Nagar", "email": "kavita.asha@indiatb.gov", "facility_id": "PHC_LKO_BKT_B", "village": "Sarojini Nagar"},
]


def generate_nearby_coords(lat: float, lng: float, radius_km: float = 5.0) -> Dict[str, float]:
    r = radius_km / 111.0
    u = random.random()
    v = random.random()
    w = r * math.sqrt(u)
    t = 2 * math.pi * v
    x = w * math.cos(t)
    y = w * math.sin(t)
    return {"lat": lat + x, "lng": lng + (y / math.cos(math.radians(lat)))}


def ensure_facilities() -> None:
    for facility in FACILITIES:
        data = {
            "name": facility.name,
            "type": facility.type,
            "parent_id": facility.parent_id,
            "district": facility.district,
            "state": facility.state,
            "location": {"latitude": facility.lat, "longitude": facility.lng},
            "service_pincodes": facility.service_pincodes,
            "updated_at": _utc_now(),
        }
        db.collection("facilities").document(facility.id).set(data, merge=True)


def create_user_entry(
    *,
    name: str,
    role: str,
    email: str,
    password: str,
    facility_id: str,
    village: Optional[str] = None,
) -> Tuple[str, Dict]:
    facility = next((f for f in FACILITIES if f.id == facility_id), None)
    if not facility:
        raise ValueError(f"Unknown facility_id: {facility_id}")

    location = generate_nearby_coords(facility.lat, facility.lng, 3.0 if role == "ASHA" else 1.0)
    phone = f"9{random.randint(100000000, 999999999)}"

    try:
        try:
            user = auth.create_user(email=email, password=password)
            uid = user.uid
        except auth.EmailAlreadyExistsError:
            user = auth.get_user_by_email(email)
            uid = user.uid

        user_data = {
            "name": name,
            "email": email,
            "role": role,
            "phone": phone,
            "assigned_center": facility.name,
            "facility_id": facility.id,
            "facility_name": facility.name,
            "facility_type": facility.type,
            "tu_id": TU_ID,
            "district": facility.district,
            "state": facility.state,
            "preferred_language": random.choice(["en", "hi"]),
            "location": {"latitude": location["lat"], "longitude": location["lng"]},
            "updated_at": _utc_now(),
        }

        if role == "ASHA":
            user_data["active_patients"] = random.randint(6, 20)
            user_data["village"] = village or ""
        elif role == "LAB_TECH":
            user_data["capacity_per_day"] = random.choice([30, 40, 50])
        elif role == "DOCTOR":
            user_data["capacity_per_day"] = random.choice([35, 45, 55])
        elif role == "ADMIN":
            user_data["supervision_scope"] = "BLOCK"

        db.collection("users").document(uid).set(user_data, merge=True)
        return uid, user_data
    except Exception as exc:
        print(f"Error creating user {email}: {exc}")
        raise


def calculate_risk_score(symptoms: List[Dict], risk_factors: List[str]) -> float:
    score = 0.0
    for s in symptoms:
        code = s.get("symptom_code")
        duration = s.get("duration_days", 0) or 0
        severity = s.get("severity")
        if code == "COUGH":
            score += 1.5
            if duration >= 21:
                score += 1.5
        if code == "FEVER_HIGH":
            score += 2.0
        if code == "NIGHT_SWEATS":
            score += 1.5
        if code == "WEIGHT_LOSS":
            score += 1.0
        if code == "CHEST_PAIN":
            score += 1.0
        if severity == "severe":
            score += 0.5

    if "HISTORY_TB" in risk_factors:
        score += 1.5
    if "HIV" in risk_factors:
        score += 1.5
    if "DIABETES" in risk_factors:
        score += 0.5
    if "SMOKER" in risk_factors:
        score += 0.3

    return round(min(score, 10.0), 1)


def generate_summary(risk_score: float, triage_status: str) -> str:
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


def make_workflow_events(created_at: str, status: str) -> List[Dict]:
    events = [
        {"code": "COLLECTED", "label": "Patient screened by ASHA", "at": created_at},
        {"code": "SYNCED", "label": "Record synced to cloud", "at": _utc_now()},
        {"code": "AI_ANALYSIS_DONE", "label": "AI triage summary generated", "at": _utc_now()},
    ]
    if status != "AWAITING_DOCTOR":
        events.append({"code": "DOCTOR_REVIEWED", "label": "Doctor reviewed case", "at": _utc_now()})
    if status in {"TEST_PENDING", "ASSIGNED_TO_LAB", "LAB_DONE", "UNDER_TREATMENT", "CLEARED"}:
        events.append({"code": "TEST_SCHEDULED", "label": "Diagnostic test pathway initiated", "at": _utc_now()})
    if status in {"LAB_DONE", "UNDER_TREATMENT", "CLEARED"}:
        events.append({"code": "TEST_DONE", "label": "Lab result captured", "at": _utc_now()})
    return events


def build_patient(
    idx: int,
    asha_users: List[Tuple[str, Dict]],
    doctor_by_facility: Dict[str, List[str]],
    lab_by_facility: Dict[str, List[str]],
    used_sample_ids: set,
    used_names: set,
    bucket,
) -> Dict:
    asha_uid, asha_profile = random.choice(asha_users)
    facility_id = asha_profile.get("facility_id", "")
    facility = PHC_BY_ID[facility_id]

    doctor_uid = random.choice(doctor_by_facility[facility_id])
    lab_uid = random.choice(lab_by_facility[facility_id])

    first = random.choice(FIRST_NAMES)
    last = random.choice(LAST_NAMES)
    name = f"{first} {last}"
    attempts = 0
    while name in used_names and attempts < 15:
        first = random.choice(FIRST_NAMES)
        last = random.choice(LAST_NAMES)
        name = f"{first} {last}"
        attempts += 1
    if name in used_names:
        name = f"{first} {last} {idx + 1}"
    used_names.add(name)

    age = random.randint(18, 72)
    gender = random.choice(["male", "female", "other"])

    symptom_count = random.randint(1, 3)
    symptoms: List[Dict] = []
    for _ in range(symptom_count):
        symptoms.append(
            {
                "symptom_code": random.choice(SYMPTOMS),
                "severity": random.choice(["mild", "moderate", "severe"]),
                "duration_days": random.randint(3, 60),
            }
        )

    coords = generate_nearby_coords(facility.lat, facility.lng, 4.5)
    lat = round(coords["lat"], 5)
    lng = round(coords["lng"], 5)

    risk_factor_answers = {key: random.choice(ANSWER_CHOICES) for key in RISK_FACTORS}
    risk_factors_positive = [key for key, val in risk_factor_answers.items() if val == "yes"]

    patient_local_id = f"local-{idx + 1}-{uuid.uuid4().hex[:6]}"
    sample_id = f"TX-{random.randint(100, 999)}"
    while sample_id in used_sample_ids:
        sample_id = f"TX-{random.randint(100, 999)}"
    used_sample_ids.add(sample_id)

    triage_status = random.choices(
        TRIAGE_STATUSES,
        weights=[35, 20, 18, 8, 7, 12],
        k=1,
    )[0]
    risk_score = calculate_risk_score(symptoms, risk_factors_positive)
    ai_rank_score = round(max(0.0, min(100.0, risk_score * 10 + random.uniform(-4.0, 4.0))), 2)

    created_at = _random_date_within(25)

    audio_uri = None
    if bucket:
        audio_path = f"asha_uploads/{asha_uid}/{patient_local_id}/audio-{uuid.uuid4().hex}.wav"
        audio_uri = upload_blob(bucket, audio_path, generate_wav_bytes(4), "audio/wav")

    report_uri = None
    if bucket and triage_status in {"LAB_DONE", "UNDER_TREATMENT", "CLEARED"}:
        report_path = f"lab_results/{lab_uid}/{patient_local_id}/report-{uuid.uuid4().hex}.pdf"
        report_uri = upload_blob(bucket, report_path, generate_pdf_bytes(), "application/pdf")

    return {
        "patient_local_id": patient_local_id,
        "device_id": f"device-{random.randint(100, 999)}",
        "asha_id": asha_uid,
        "asha_worker_id": asha_uid,
        "asha_phone_number": asha_profile.get("phone"),
        "sample_id": sample_id,
        "created_at_offline": created_at,
        "synced_at": _utc_now(),
        "facility_id": facility_id,
        "facility_name": facility.name,
        "tu_id": TU_ID,
        "assignment_mode": "FACILITY_TAGGING",
        "assigned_doctor_id": doctor_uid,
        "assigned_lab_tech_id": lab_uid,
        "demographics": {
            "name": name,
            "age": age,
            "gender": gender,
            "phone": f"9{random.randint(100000000, 999999999)}",
            "aadhar_last4": str(random.randint(1000, 9999)),
            "address": f"House {random.randint(1, 99)}, {asha_profile.get('village') or facility.name}",
            "village": asha_profile.get("village") or facility.name,
            "pincode": random.choice(facility.service_pincodes),
        },
        "gps": {"lat": lat, "lng": lng, "accuracy_m": random.randint(5, 30)},
        "vitals": {
            "weight_kg": round(random.uniform(40, 78), 1),
            "height_cm": random.randint(150, 182),
        },
        "symptoms": symptoms,
        "clinical": {
            "cough_duration_days": random.randint(1, 90),
            "cough_nature": random.choice(["DRY", "WET", "BLOOD_STAINED"]),
            "fever_history": random.choice(["NONE", "LOW_GRADE", "HIGH_GRADE"]),
            "physical_signs": random.sample(PHYSICAL_SIGNS, random.randint(0, 3)),
            "risk_factors": risk_factors_positive,
            "risk_factor_answers": risk_factor_answers,
            "other_observations": "" if random.random() > 0.5 else "Follow-up recommended.",
        },
        "audio": [
            {
                "audio_file_id": str(uuid.uuid4()),
                "file_name": "cough.wav",
                "mime_type": "audio/wav",
                "duration_sec": round(random.uniform(2.0, 6.0), 1),
                "storage_uri": audio_uri,
                "uploaded_at": _utc_now(),
            }
        ],
        "ai": {
            "hear_embedding_id": str(uuid.uuid4()),
            "hear_score": round(random.uniform(0.2, 0.95), 2),
            "medgemini_summary": generate_summary(risk_score, triage_status),
            "risk_score": risk_score,
            "risk_level": "HIGH" if risk_score >= 7.0 else "MEDIUM" if risk_score >= 4.0 else "LOW",
        },
        "rank": {
            "ai_rank_score": ai_rank_score,
            "doctor_rank_override": None,
            "effective_rank": ai_rank_score,
            "rank_updated_at": _utc_now(),
        },
        "doctor_priority": random.random() < 0.12,
        "doctor_rank": int(ai_rank_score),
        "status": {
            "triage_status": triage_status,
            "workflow_events": make_workflow_events(created_at, triage_status),
            "test_scheduled_date": None,
            "doctor_notes": None,
        },
        "lab_results": {
            "report_uri": report_uri,
            "uploaded_at": _utc_now() if report_uri else None,
            "uploaded_by": lab_uid if report_uri else None,
        }
        if report_uri
        else None,
    }


def clear_collection(collection_name: str) -> None:
    docs = db.collection(collection_name).stream()
    for doc_snapshot in docs:
        doc_snapshot.reference.delete()


def reset_collections() -> None:
    for collection_name in ["patients", "users", "facilities"]:
        clear_collection(collection_name)


def delete_auth_users() -> None:
    emails = [
        *(p["email"] for p in ADMIN_PROFILES),
        *(p["email"] for p in DOCTOR_PROFILES),
        *(p["email"] for p in LAB_PROFILES),
        *(p["email"] for p in ASHA_PROFILES),
    ]

    for email in emails:
        try:
            user = auth.get_user_by_email(email)
            auth.delete_user(user.uid)
        except auth.UserNotFoundError:
            continue


def setup_database() -> None:
    print("Starting NTEP-style demo data setup...")

    if os.environ.get("RESET_DB") == "1":
        reset_collections()
        delete_auth_users()

    ensure_facilities()

    asha_users: List[Tuple[str, Dict]] = []
    doctor_by_facility: Dict[str, List[str]] = {k: [] for k in PHC_BY_ID.keys()}
    lab_by_facility: Dict[str, List[str]] = {k: [] for k in PHC_BY_ID.keys()}

    for profile in ADMIN_PROFILES:
        create_user_entry(
            name=profile["name"],
            role="ADMIN",
            email=profile["email"],
            password="password123",
            facility_id=profile["facility_id"],
        )

    for profile in DOCTOR_PROFILES:
        uid, _ = create_user_entry(
            name=profile["name"],
            role="DOCTOR",
            email=profile["email"],
            password="password123",
            facility_id=profile["facility_id"],
        )
        doctor_by_facility[profile["facility_id"]].append(uid)

    for profile in LAB_PROFILES:
        uid, _ = create_user_entry(
            name=profile["name"],
            role="LAB_TECH",
            email=profile["email"],
            password="password123",
            facility_id=profile["facility_id"],
        )
        lab_by_facility[profile["facility_id"]].append(uid)

    for profile in ASHA_PROFILES:
        uid, user_data = create_user_entry(
            name=profile["name"],
            role="ASHA",
            email=profile["email"],
            password="password123",
            facility_id=profile["facility_id"],
            village=profile.get("village"),
        )
        user_data["village"] = profile.get("village")
        asha_users.append((uid, user_data))

    bucket = get_storage_bucket()
    used_sample_ids: set = set()
    used_names: set = set()

    collection = db.collection("patients")
    for i in range(PATIENT_COUNT):
        patient = build_patient(i, asha_users, doctor_by_facility, lab_by_facility, used_sample_ids, used_names, bucket)
        collection.document(patient["patient_local_id"]).set(patient, merge=True)

    print("NTEP demo dataset ready.")
    print("Credentials (all password: password123)")
    print("- ADMIN:", ADMIN_PROFILES[0]["email"])
    print("- DOCTOR:", DOCTOR_PROFILES[0]["email"])
    print("- LAB:", LAB_PROFILES[0]["email"])
    print("- ASHA:", ASHA_PROFILES[0]["email"])


if __name__ == "__main__":
    setup_database()
