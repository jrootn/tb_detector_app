import argparse
import os
from pathlib import Path

import firebase_admin
from firebase_admin import auth, credentials, firestore


def init_firebase():
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not cred_path:
        local_key = Path(__file__).with_name("serviceAccountKey.json")
        if local_key.exists():
            cred_path = str(local_key)
    if not cred_path:
        raise SystemExit("Service account key not found")

    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(cred_path))


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a Firebase Auth user + Firestore user profile")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--role", required=True, choices=["ASHA", "DOCTOR", "LAB_TECH", "ADMIN"])
    parser.add_argument("--password", default="password123")
    parser.add_argument("--phone", default=None)
    parser.add_argument("--assigned_center", default="PHC_Nagpur_01")
    parser.add_argument("--facility_id", default=None)
    parser.add_argument("--facility_name", default=None)
    parser.add_argument("--tu_id", default=None)
    parser.add_argument("--lat", type=float, default=None)
    parser.add_argument("--lng", type=float, default=None)
    args = parser.parse_args()

    init_firebase()
    db = firestore.client()

    try:
        user = auth.create_user(email=args.email, password=args.password)
        uid = user.uid
        created = True
    except auth.EmailAlreadyExistsError:
        user = auth.get_user_by_email(args.email)
        uid = user.uid
        created = False

    user_data = {
        "name": args.name,
        "email": args.email,
        "role": args.role,
        "assigned_center": args.assigned_center,
        "phone": args.phone or "+919800000000",
    }
    if args.facility_id:
        user_data["facility_id"] = args.facility_id
    if args.facility_name:
        user_data["facility_name"] = args.facility_name
    if args.tu_id:
        user_data["tu_id"] = args.tu_id
    if args.lat is not None and args.lng is not None:
        user_data["location"] = {"latitude": args.lat, "longitude": args.lng}

    db.collection("users").document(uid).set(user_data, merge=True)

    print("Created" if created else "Updated", "user:")
    print("UID:", uid)
    print("Email:", args.email)
    print("Role:", args.role)


if __name__ == "__main__":
    main()
