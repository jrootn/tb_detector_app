import argparse
import os
from pathlib import Path
from typing import Any, Dict, Tuple

import firebase_admin
from firebase_admin import credentials, firestore


def init_firestore() -> firestore.Client:
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not cred_path:
        local_key = Path(__file__).resolve().parents[1] / "serviceAccountKey.json"
        if local_key.exists():
            cred_path = str(local_key)

    if not firebase_admin._apps:
        if cred_path:
            firebase_admin.initialize_app(credentials.Certificate(cred_path))
        else:
            firebase_admin.initialize_app()
    return firestore.client()


def has_downloadable_audio(doc: Dict[str, Any]) -> bool:
    audio = doc.get("audio")
    if not isinstance(audio, list):
        return False
    for item in audio:
        if not isinstance(item, dict):
            continue
        path = item.get("storage_path")
        uri = item.get("storage_uri")
        if isinstance(path, str) and path.strip():
            return True
        if isinstance(uri, str) and uri.strip():
            return True
    return False


def has_ai_summary(doc: Dict[str, Any]) -> bool:
    ai = doc.get("ai")
    if not isinstance(ai, dict):
        return False
    if isinstance(ai.get("medgemini_summary_en"), str) and ai.get("medgemini_summary_en").strip():
        return True
    if isinstance(ai.get("medgemini_summary_hi"), str) and ai.get("medgemini_summary_hi").strip():
        return True
    i18n = ai.get("medgemini_summary_i18n")
    return isinstance(i18n, dict) and any(isinstance(v, str) and v.strip() for v in i18n.values())


def run(apply: bool, limit: int | None, force: bool) -> None:
    db = init_firestore()
    docs = db.collection("patients").stream()

    scanned = 0
    queued = 0
    skipped_no_audio = 0
    skipped_already_ai = 0
    examples: list[Tuple[str, str]] = []

    for snap in docs:
        if limit is not None and scanned >= limit:
            break
        scanned += 1

        data = snap.to_dict() or {}
        if not has_downloadable_audio(data):
            skipped_no_audio += 1
            if len(examples) < 5:
                examples.append((snap.id, "no_audio_link"))
            continue

        if not force and has_ai_summary(data):
            skipped_already_ai += 1
            continue

        queued += 1
        if apply:
            snap.reference.set(
                {
                    "inference_backfill": {
                        "requested_at": firestore.SERVER_TIMESTAMP,
                        "reason": "manual_backfill",
                    }
                },
                merge=True,
            )

    mode = "APPLY" if apply else "DRY-RUN"
    print(f"[{mode}] scanned={scanned} queued={queued} skipped_no_audio={skipped_no_audio} skipped_already_ai={skipped_already_ai}")
    if examples:
        print("sample_skips:")
        for doc_id, reason in examples:
            print(f"  - {doc_id}: {reason}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Trigger inference backfill by touching patient docs with valid audio links.")
    parser.add_argument("--apply", action="store_true", help="Apply updates. Without this flag, runs as dry-run.")
    parser.add_argument("--limit", type=int, default=None, help="Optional max docs to scan.")
    parser.add_argument("--force", action="store_true", help="Queue docs even if AI summary already exists.")
    args = parser.parse_args()

    run(apply=args.apply, limit=args.limit, force=args.force)
