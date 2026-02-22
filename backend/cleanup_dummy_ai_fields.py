import argparse
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import firebase_admin
from firebase_admin import credentials, firestore


DELETE = firestore.DELETE_FIELD


def init_firestore_client():
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not cred_path:
        local_key = Path(__file__).with_name("serviceAccountKey.json")
        if local_key.exists():
            cred_path = str(local_key)

    if not firebase_admin._apps:
        if cred_path:
            firebase_admin.initialize_app(credentials.Certificate(cred_path))
        else:
            firebase_admin.initialize_app(credentials.ApplicationDefault())
    return firestore.client()


def filter_workflow_events(events: Any) -> Optional[List[Dict[str, Any]]]:
    if not isinstance(events, list):
        return None

    filtered: List[Dict[str, Any]] = []
    changed = False
    for event in events:
        if not isinstance(event, dict):
            filtered.append(event)
            continue
        code = str(event.get("code", "")).upper()
        if code == "AI_ANALYSIS_DONE":
            changed = True
            continue
        filtered.append(event)

    if not changed:
        return None
    return filtered


def build_cleanup_updates(doc_data: Dict[str, Any], remove_fields: bool) -> Dict[str, Any]:
    updates: Dict[str, Any] = {}

    if remove_fields:
        if "ai" in doc_data:
            updates["ai"] = DELETE
        if "rank" in doc_data:
            updates["rank"] = DELETE
        if "doctor_priority" in doc_data:
            updates["doctor_priority"] = DELETE
        if "doctor_rank" in doc_data:
            updates["doctor_rank"] = DELETE

    status = doc_data.get("status")
    if isinstance(status, dict):
        filtered = filter_workflow_events(status.get("workflow_events"))
        if filtered is not None:
            if filtered:
                updates["status.workflow_events"] = filtered
            else:
                updates["status.workflow_events"] = DELETE

    return updates


def run_cleanup(apply: bool, limit: Optional[int], remove_fields: bool) -> None:
    db = init_firestore_client()
    docs = db.collection("patients").stream()

    scanned = 0
    updated = 0
    examples: List[str] = []

    for snap in docs:
        if limit is not None and scanned >= limit:
            break
        scanned += 1

        data = snap.to_dict() or {}
        updates = build_cleanup_updates(data, remove_fields=remove_fields)
        if not updates:
            continue

        updated += 1
        if len(examples) < 10:
            examples.append(snap.id)

        if apply:
            snap.reference.update(updates)

    mode = "APPLY" if apply else "DRY-RUN"
    print(f"[{mode}] scanned={scanned} would_update={updated}")
    if examples:
        print("sample_docs:", ", ".join(examples))


def main() -> None:
    parser = argparse.ArgumentParser(description="Remove dummy AI/rank fields and AI workflow events from patient docs.")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write updates. Without this flag, script runs in dry-run mode.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional max number of patient docs to scan.",
    )
    parser.add_argument(
        "--keep-ai-fields",
        action="store_true",
        help="Only remove AI workflow events and keep ai/rank/doctor fields untouched.",
    )
    args = parser.parse_args()

    run_cleanup(apply=args.apply, limit=args.limit, remove_fields=not args.keep_ai_fields)


if __name__ == "__main__":
    main()
