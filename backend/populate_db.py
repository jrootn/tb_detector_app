import io
import math
import os
import random
import uuid
import wave
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Tuple

import firebase_admin
from firebase_admin import auth, credentials, firestore, initialize_app
from google.cloud import storage


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _random_date_within(days: int) -> str:
    dt = datetime.now(timezone.utc) - timedelta(days=random.randint(0, days))
    return dt.isoformat()


# Firebase initialization
cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
if not cred_path:
    local_key = Path(__file__).with_name("serviceAccountKey.json")
    if local_key.exists():
        cred_path = str(local_key)
if cred_path:
    initialize_app(credentials.Certificate(cred_path))
else:
    initialize_app(credentials.ApplicationDefault())

db = firestore.client()

UPLOAD_DUMMY_MEDIA = os.environ.get("UPLOAD_DUMMY_MEDIA") == "1"
STORAGE_BUCKET = os.environ.get("FIREBASE_STORAGE_BUCKET") or os.environ.get("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET")


def get_storage_bucket():
    if not UPLOAD_DUMMY_MEDIA or not STORAGE_BUCKET:
        return None
    client = storage.Client.from_service_account_json(cred_path)
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
    return b\"%PDF-1.4\\n1 0 obj<<>>endobj\\ntrailer<<>>\\n%%EOF\"


def upload_blob(bucket, path: str, data: bytes, content_type: str) -> str:
    blob = bucket.blob(path)
    blob.upload_from_string(data, content_type=content_type)
    return f\"gs://{bucket.name}/{path}\"


FIRST_NAMES = [
    "Ramesh",
    "Sunita",
    "Mohan",
    "Lakshmi",
    "Rajesh",
    "Geeta",
    "Vijay",
    "Priya",
    "Arjun",
    "Meera",
    "Anita",
    "Sita",
    "Amit",
    "Pooja",
    "Sanjay",
    "Kiran",
    "Deepak",
    "Neha",
]

LAST_NAMES = [
    "Kumar",
    "Devi",
    "Lal",
    "Prasad",
    "Singh",
    "Verma",
    "Yadav",
    "Sharma",
    "Thakur",
    "Gupta",
    "Rao",
    "Mishra",
]

VILLAGES = [
    "Rampur",
    "Kishanganj",
    "Darbhanga",
    "Sitamarhi",
    "Madhubani",
    "Samastipur",
    "Muzaffarpur",
    "Begusarai",
    "Bhagalpur",
    "Patna",
    "Kamptee",
    "Kalmeshwar",
    "Hingna",
    "Bhandara",
]

SYMPTOMS = ["COUGH", "FEVER_HIGH", "NIGHT_SWEATS", "WEIGHT_LOSS", "CHEST_PAIN"]
RISK_FACTORS = ["HISTORY_TB", "FAMILY_TB", "SMOKER", "DIABETES", "HIV"]
PHYSICAL_SIGNS = ["CHEST_PAIN", "SHORTNESS_OF_BREATH", "LOSS_OF_APPETITE", "EXTREME_FATIGUE"]

# Central India (Nagpur) cluster for realistic maps
CENTER_LAT = 21.1458
CENTER_LNG = 79.0882
RADIUS_KM = 5.0

ANSWER_CHOICES = ["yes", "no", "dontKnow", "preferNotToSay"]

TRIAGE_STATUSES = [
    "AWAITING_DOCTOR",
    "TEST_PENDING",
    "ASSIGNED_TO_LAB",
    "LAB_DONE",
    "UNDER_TREATMENT",
    "CLEARED",
]

# Profiles for Auth + Firestore users
DOCTOR_PROFILES = [
    {"name": "Dr. Priya Sharma", "email_prefix": "priya"},
    {"name": "Dr. Amit Verma", "email_prefix": "amit"},
]

ASHA_PROFILES = [
    {"name": "Sita Devi", "email_prefix": "sita"},
    {"name": "Anita Kumari", "email_prefix": "anita"},
    {"name": "Geeta Verma", "email_prefix": "geeta"},
    {"name": "Sunita Rao", "email_prefix": "sunita"},
]

LAB_PROFILES = [
    {"name": "Central Diagnostics", "email_prefix": "lab.central", "offset": (0.01, 0.01)},
    {"name": "Rural Pathology Unit", "email_prefix": "lab.rural", "offset": (-0.02, -0.01)},
]


def generate_nearby_coords(lat: float, lng: float, radius_km: float) -> Dict[str, float]:
    r = radius_km / 111.0
    u = random.random()
    v = random.random()
    w = r * math.sqrt(u)
    t = 2 * math.pi * v
    x = w * math.cos(t)
    y = w * math.sin(t)
    return {"lat": lat + x, "lng": lng + (y / math.cos(math.radians(lat)))}


def create_user_entry(
    profile: Dict[str, str],
    role: str,
    email: str,
    password: str,
    location: Dict[str, float],
) -> Tuple[str, Dict]:
    try:
        try:
            user = auth.create_user(email=email, password=password)
            uid = user.uid
        except auth.EmailAlreadyExistsError:
            user = auth.get_user_by_email(email)
            uid = user.uid

        user_data = {
            "name": profile["name"],
            "email": email,
            "role": role,
            "assigned_center": "PHC_Nagpur_01",
            "phone": f"+9198{random.randint(10000000, 99999999)}",
            "location": {"latitude": location["lat"], "longitude": location["lng"]},
        }

        if role == "ASHA":
            user_data["active_patients"] = random.randint(2, 12)
        elif role == "LAB_TECH":
            user_data["capacity_per_day"] = 50

        db.collection("users").document(uid).set(user_data)
        return uid, user_data
    except Exception as e:
        print(f"Error creating {profile['name']}: {e}")
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

    # Default: awaiting doctor
    if risk_score >= 8:
        return "High TB suspicion. Urgent evaluation and testing recommended."
    if risk_score >= 5:
        return "Moderate TB risk. Expedite diagnostics and follow-up."
    return "Low TB risk. Monitor symptoms and advise follow-up if worsening."


def build_patient(
    idx: int,
    asha_users: List[Tuple[str, Dict]],
    used_sample_ids: set,
    bucket,
) -> Dict:
    first = random.choice(FIRST_NAMES)
    last = random.choice(LAST_NAMES)
    name = f"{first} {last} {idx + 1}"
    village = random.choice(VILLAGES)
    age = random.randint(18, 70)
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

    coords = generate_nearby_coords(CENTER_LAT, CENTER_LNG, RADIUS_KM)
    lat = round(coords["lat"], 4)
    lng = round(coords["lng"], 4)

    risk_factor_answers = {key: random.choice(ANSWER_CHOICES) for key in RISK_FACTORS}
    risk_factors_positive = [key for key, val in risk_factor_answers.items() if val == "yes"]

    patient_local_id = f"local-{idx}-{uuid.uuid4().hex[:6]}"
    sample_id = f"TX-{random.randint(100, 999)}"
    while sample_id in used_sample_ids:
        sample_id = f"TX-{random.randint(100, 999)}"
    used_sample_ids.add(sample_id)
    asha_uid, asha_profile = random.choice(asha_users)

    triage_status = random.choices(
        TRIAGE_STATUSES,
        weights=[30, 20, 15, 10, 10, 15],
        k=1,
    )[0]
    risk_score = calculate_risk_score(symptoms, risk_factors_positive)

    audio_uri = None
    if bucket:
        audio_path = f"asha_uploads/{asha_uid}/{patient_local_id}/audio-{uuid.uuid4().hex}.wav"
        audio_uri = upload_blob(bucket, audio_path, generate_wav_bytes(4), "audio/wav")

    report_uri = None
    if bucket and triage_status in {"LAB_DONE", "UNDER_TREATMENT", "CLEARED"}:
        report_path = f"lab_results/dummy/{patient_local_id}/report-{uuid.uuid4().hex}.pdf"
        report_uri = upload_blob(bucket, report_path, generate_pdf_bytes(), "application/pdf")

    patient = {
        "patient_local_id": patient_local_id,
        "device_id": f"device-{random.randint(100,999)}",
        "asha_id": asha_uid,
        "asha_worker_id": asha_uid,
        "asha_phone_number": asha_profile.get("phone"),
        "sample_id": sample_id,
        "created_at_offline": _random_date_within(20),
        "synced_at": _utc_now(),
        "demographics": {
            "name": name,
            "age": age,
            "gender": gender,
            "phone": f"+91 {random.randint(60000,99999)} {random.randint(10000,99999)}",
            "aadhar_last4": str(random.randint(1000,9999)),
            "address": f"House {random.randint(1,99)}, {village}",
            "village": village,
            "pincode": str(random.randint(800000, 899999)),
        },
        "gps": {
            "lat": lat,
            "lng": lng,
            "accuracy_m": random.randint(5, 30),
        },
        "vitals": {
            "weight_kg": round(random.uniform(40, 75), 1),
            "height_cm": random.randint(150, 180),
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
        "doctor_priority": random.random() < 0.1,
        "doctor_rank": random.randint(-5, 5),
        "status": {
            "triage_status": triage_status,
            "test_scheduled_date": None,
            "doctor_notes": None,
        },
        "lab_results": {
            "report_uri": report_uri,
            "uploaded_at": _utc_now() if report_uri else None,
            "uploaded_by": "dummy",
        } if report_uri else None,
    }
    return patient


def reset_collections() -> None:
    for collection_name in ["patients", "users"]:
        docs = db.collection(collection_name).stream()
        for doc in docs:
            doc.reference.delete()


def delete_auth_users() -> None:
    emails = []
    emails.extend([f"{p['email_prefix']}.doctor@indiatb.gov" for p in DOCTOR_PROFILES])
    emails.extend([f"{p['email_prefix']}.asha@indiatb.gov" for p in ASHA_PROFILES])
    emails.extend([f"{p['email_prefix']}@indiatb.gov" for p in LAB_PROFILES])

    for email in emails:
        try:
            user = auth.get_user_by_email(email)
            auth.delete_user(user.uid)
        except auth.UserNotFoundError:
            continue


def setup_database() -> None:
    print("Starting demo data setup...")

    if os.environ.get("RESET_DB") == "1":
        reset_collections()
        delete_auth_users()

    # Create users
    asha_users: List[Tuple[str, Dict]] = []

    for profile in DOCTOR_PROFILES:
        email = f"{profile['email_prefix']}.doctor@indiatb.gov"
        loc = {"lat": CENTER_LAT, "lng": CENTER_LNG}
        create_user_entry(profile, "DOCTOR", email, "password123", loc)

    for profile in ASHA_PROFILES:
        email = f"{profile['email_prefix']}.asha@indiatb.gov"
        loc = generate_nearby_coords(CENTER_LAT, CENTER_LNG, RADIUS_KM)
        uid, user_data = create_user_entry(profile, "ASHA", email, "password123", loc)
        asha_users.append((uid, user_data))

    for profile in LAB_PROFILES:
        email = f"{profile['email_prefix']}@indiatb.gov"
        loc = {"lat": CENTER_LAT + profile["offset"][0], "lng": CENTER_LNG + profile["offset"][1]}
        create_user_entry(profile, "LAB_TECH", email, "password123", loc)

    # Create patients
    collection = db.collection("patients")
    used_sample_ids: set = set()
    bucket = get_storage_bucket()
    for i in range(80):
        patient = build_patient(i, asha_users, used_sample_ids, bucket)
        collection.document(patient["patient_local_id"]).set(patient, merge=True)

    print("Demo data ready.")


if __name__ == "__main__":
    setup_database()
