#!/usr/bin/env python3
import argparse
from typing import Dict, Optional

from google.cloud import firestore


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill patient asha_name/asha_phone_number from users collection.")
    parser.add_argument("--project", required=True, help="GCP project id")
    parser.add_argument("--dry-run", action="store_true", help="Show planned updates only")
    parser.add_argument("--limit", type=int, default=0, help="Optional max number of patient docs to update")
    return parser.parse_args()


def normalize_str(value: object) -> Optional[str]:
    if isinstance(value, str):
        v = value.strip()
        if v:
            return v
    return None


def main() -> None:
    args = parse_args()
    db = firestore.Client(project=args.project)

    print(f"[info] scanning users in project={args.project}")
    user_map: Dict[str, Dict[str, Optional[str]]] = {}
    for user_doc in db.collection("users").stream():
        data = user_doc.to_dict() or {}
        user_map[user_doc.id] = {
            "name": normalize_str(data.get("name")),
            "phone": normalize_str(data.get("phone")),
            "role": normalize_str(data.get("role")),
        }
    print(f"[info] users loaded={len(user_map)}")

    print("[info] scanning patients")
    patient_docs = list(db.collection("patients").stream())
    print(f"[info] total patients={len(patient_docs)}")

    planned = []
    skipped_missing_uid = 0
    skipped_missing_user = 0

    for snap in patient_docs:
        data = snap.to_dict() or {}
        asha_uid = normalize_str(data.get("asha_id")) or normalize_str(data.get("asha_worker_id"))
        if not asha_uid:
            skipped_missing_uid += 1
            continue

        user = user_map.get(asha_uid)
        if not user:
            skipped_missing_user += 1
            continue

        update = {}
        existing_name = normalize_str(data.get("asha_name"))
        existing_phone = normalize_str(data.get("asha_phone_number"))
        if not existing_name and user.get("name"):
            update["asha_name"] = user["name"]
        if not existing_phone and user.get("phone"):
            update["asha_phone_number"] = user["phone"]

        if update:
            planned.append((snap.reference, update))
            if args.limit and len(planned) >= args.limit:
                break

    print(f"[info] planned updates={len(planned)}")
    print(f"[info] skipped_missing_uid={skipped_missing_uid}")
    print(f"[info] skipped_missing_user={skipped_missing_user}")
    for ref, payload in planned[:20]:
        print(f"[plan] {ref.id} -> {payload}")
    if len(planned) > 20:
        print(f"[plan] ... and {len(planned) - 20} more")

    if args.dry_run:
        print("[done] dry-run only")
        return

    batch = db.batch()
    committed = 0
    for idx, (ref, payload) in enumerate(planned, start=1):
        batch.set(ref, payload, merge=True)
        if idx % 400 == 0:
            batch.commit()
            committed += 400
            batch = db.batch()
            print(f"[write] committed {committed}")

    remainder = len(planned) % 400
    if remainder:
        batch.commit()
        committed += remainder

    print(f"[done] updated={committed}")


if __name__ == "__main__":
    main()

