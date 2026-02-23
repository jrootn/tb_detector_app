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


def _ai_state(doc: Dict[str, Any]) -> Dict[str, Any]:
    ai = doc.get("ai")
    if not isinstance(ai, dict):
        return {}
    return ai


def is_already_successful(doc: Dict[str, Any], target_model_version: str) -> bool:
    ai = _ai_state(doc)
    return ai.get("model_version") == target_model_version and ai.get("inference_status") == "SUCCESS"


def is_in_progress(doc: Dict[str, Any], target_model_version: str) -> bool:
    ai = _ai_state(doc)
    return ai.get("model_version") == target_model_version and ai.get("inference_status") == "PROCESSING"


def run(apply: bool, limit: int | None, force: bool, target_model_version: str) -> None:
    db = init_firestore()
    docs = db.collection("patients").stream()

    scanned = 0
    queued = 0
    skipped_no_audio = 0
    skipped_already_success = 0
    skipped_in_progress = 0
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

        if not force and is_already_successful(data, target_model_version):
            skipped_already_success += 1
            continue

        if is_in_progress(data, target_model_version):
            skipped_in_progress += 1
            continue

        queued += 1
        if apply:
            snap.reference.set(
                {
                    "inference_backfill": {
                        "requested_at": firestore.SERVER_TIMESTAMP,
                        "reason": "manual_backfill",
                        "target_model_version": target_model_version,
                    }
                },
                merge=True,
            )

    mode = "APPLY" if apply else "DRY-RUN"
    print(
        f"[{mode}] scanned={scanned} queued={queued} skipped_no_audio={skipped_no_audio} "
        f"skipped_already_success={skipped_already_success} skipped_in_progress={skipped_in_progress}"
    )
    if examples:
        print("sample_skips:")
        for doc_id, reason in examples:
            print(f"  - {doc_id}: {reason}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Trigger inference backfill by touching patient docs with valid audio links.")
    parser.add_argument("--apply", action="store_true", help="Apply updates. Without this flag, runs as dry-run.")
    parser.add_argument("--limit", type=int, default=None, help="Optional max docs to scan.")
    parser.add_argument(
        "--target-model-version",
        default=os.environ.get("TARGET_MODEL_VERSION", "medgemma-4b-it-v1"),
        help="Model version to consider as already complete (default: TARGET_MODEL_VERSION env or medgemma-4b-it-v1).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Queue docs even when ai.model_version already matches target with SUCCESS.",
    )
    args = parser.parse_args()

    run(
        apply=args.apply,
        limit=args.limit,
        force=args.force,
        target_model_version=args.target_model_version,
    )
