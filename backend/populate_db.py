import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List

from firebase_admin import credentials, firestore, initialize_app


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


NAMES = [
    "Ramesh Kumar",
    "Sunita Devi",
    "Mohan Lal",
    "Lakshmi Prasad",
    "Rajesh Singh",
    "Geeta Kumari",
    "Vijay Yadav",
    "Priya Sharma",
    "Arjun Thakur",
    "Meera Gupta",
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
]

SYMPTOMS = ["COUGH", "FEVER_HIGH", "NIGHT_SWEATS", "WEIGHT_LOSS", "CHEST_PAIN"]
RISK_FACTORS = ["HISTORY_TB", "FAMILY_TB", "SMOKER", "DIABETES", "HIV"]
PHYSICAL_SIGNS = ["CHEST_PAIN", "SHORTNESS_OF_BREATH", "LOSS_OF_APPETITE", "EXTREME_FATIGUE"]

BIHAR_COORDS = [
    (25.5941, 85.1376),  # Patna
    (26.1542, 85.8918),  # Darbhanga
    (26.1197, 85.3910),  # Muzaffarpur
    (26.1009, 87.9500),  # Kishanganj
    (25.4182, 86.1272),  # Begusarai
    (26.5952, 85.4810),  # Sitamarhi
    (26.3508, 86.0712),  # Madhubani
    (25.6093, 85.1376),  # Patna South
    (25.2425, 86.9842),  # Bhagalpur
    (26.8467, 80.9462),  # Lucknow (UP border ref)
]

ANSWER_CHOICES = ["yes", "no", "dontKnow", "preferNotToSay"]


def build_patient(idx: int) -> Dict:
    name = random.choice(NAMES)
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

    base_lat, base_lng = random.choice(BIHAR_COORDS)
    lat = round(base_lat + random.uniform(-0.05, 0.05), 4)
    lng = round(base_lng + random.uniform(-0.05, 0.05), 4)

    risk_factor_answers = {key: random.choice(ANSWER_CHOICES) for key in RISK_FACTORS}
    risk_factors_positive = [key for key, val in risk_factor_answers.items() if val == "yes"]

    patient_local_id = f"local-{idx}-{uuid.uuid4().hex[:6]}"

    patient = {
        "patient_local_id": patient_local_id,
        "device_id": f"device-{random.randint(100,999)}",
        "asha_worker_id": f"ASHA-{random.randint(100,999)}",
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
                "storage_uri": None,
                "uploaded_at": _utc_now(),
            }
        ],
        "ai": {
            "hear_embedding_id": str(uuid.uuid4()),
            "hear_score": round(random.uniform(0.2, 0.95), 2),
            "medgemini_summary": "Mock summary for testing.",
            "risk_score": round(random.uniform(2.0, 9.5), 1),
            "risk_level": random.choice(["LOW", "MEDIUM", "HIGH"]),
        },
        "status": {
            "triage_status": random.choice(
                ["AWAITING_DOCTOR", "TEST_PENDING", "UNDER_TREATMENT", "CLEARED"]
            ),
            "test_scheduled_date": None,
            "doctor_notes": None,
        },
    }
    return patient


def main() -> None:
    collection = db.collection("patients")
    for i in range(50):
        patient = build_patient(i)
        collection.document(patient["patient_local_id"]).set(patient, merge=True)
    print("Inserted 50 dummy patients into Firestore.")


if __name__ == "__main__":
    main()
