import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict

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


def summarize(target_model_version: str) -> Dict[str, int]:
    db = init_firestore()
    docs = db.collection("patients").stream()

    total = 0
    with_audio_links = 0
    ai_success = 0
    failed = 0
    processing = 0

    for snap in docs:
        total += 1
        doc = snap.to_dict() or {}
        if not has_downloadable_audio(doc):
            continue

        with_audio_links += 1
        ai = doc.get("ai")
        if not isinstance(ai, dict):
            continue

        model_version = ai.get("model_version")
        status = ai.get("inference_status")

        if model_version == target_model_version and status == "SUCCESS":
            ai_success += 1
        elif model_version == target_model_version and status == "FAILED":
            failed += 1
        elif model_version == target_model_version and status == "PROCESSING":
            processing += 1

    pending = with_audio_links - ai_success - failed - processing
    if pending < 0:
        pending = 0

    return {
        "target_model_version": target_model_version,
        "total_patients": total,
        "with_audio_links": with_audio_links,
        "ai_success": ai_success,
        "failed": failed,
        "pending": pending,
        "processing": processing,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Report patient inference status counts from Firestore.")
    parser.add_argument(
        "--target-model-version",
        default=os.environ.get("TARGET_MODEL_VERSION", "medgemma-4b-it-v1"),
        help="Target model version for status accounting.",
    )
    args = parser.parse_args()

    report = summarize(args.target_model_version)
    print(json.dumps(report, indent=2))
