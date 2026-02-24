import argparse
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud import storage

AUDIO_EXTENSIONS = (".wav", ".mp3", ".m4a", ".ogg", ".flac")


def init_clients(bucket_name: str) -> Tuple[firestore.Client, storage.Client, str]:
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

    db = firestore.client()

    if cred_path:
        storage_client = storage.Client.from_service_account_json(cred_path)
    else:
        storage_client = storage.Client()

    return db, storage_client, bucket_name


def _missing_audio_link(audio_entry: Dict[str, Any]) -> bool:
    path = audio_entry.get("storage_path")
    uri = audio_entry.get("storage_uri")
    has_path = isinstance(path, str) and bool(path.strip())
    has_uri = isinstance(uri, str) and bool(uri.strip())
    return not (has_path or has_uri)


def _find_bucket_audio(storage_client: storage.Client, bucket: str, prefixes: List[str]) -> Optional[str]:
    for prefix in prefixes:
        blobs = [
            b.name
            for b in storage_client.list_blobs(bucket, prefix=prefix)
            if not b.name.endswith("/") and b.name.lower().endswith(AUDIO_EXTENSIONS)
        ]
        if blobs:
            blobs.sort()
            return blobs[0]
    return None


def _all_bucket_audio(storage_client: storage.Client, bucket: str, prefix: str) -> List[str]:
    return sorted(
        [
            b.name
            for b in storage_client.list_blobs(bucket, prefix=prefix)
            if not b.name.endswith("/") and b.name.lower().endswith(AUDIO_EXTENSIONS)
        ]
    )


def _candidate_prefixes(doc: Dict[str, Any]) -> List[str]:
    patient_local_id = str(doc.get("patient_local_id") or "").strip()
    asha_id = str(doc.get("asha_id") or "").strip()
    asha_worker_id = str(doc.get("asha_worker_id") or "").strip()

    prefixes: List[str] = []
    if asha_id and patient_local_id:
        prefixes.append(f"asha_uploads/{asha_id}/{patient_local_id}/")
    if asha_worker_id and patient_local_id and asha_worker_id != asha_id:
        prefixes.append(f"asha_uploads/{asha_worker_id}/{patient_local_id}/")
    if patient_local_id:
        prefixes.append(f"asha_uploads/{patient_local_id}/")
    return prefixes


def run(
    bucket_name: str,
    apply: bool,
    limit: Optional[int],
    fallback_any_audio: bool,
    fallback_prefix: str,
) -> None:
    db, storage_client, bucket = init_clients(bucket_name)
    docs = list(db.collection("patients").stream())
    docs.sort(key=lambda s: s.id)

    fallback_pool: List[str] = []
    fallback_idx = 0
    used_paths = set()
    if fallback_any_audio:
        fallback_pool = _all_bucket_audio(storage_client, bucket, fallback_prefix)

    scanned = 0
    updated = 0
    skipped_no_audio_array = 0
    skipped_has_links = 0
    skipped_no_bucket_match = 0
    examples: List[str] = []

    for snap in docs:
        if limit is not None and scanned >= limit:
            break
        scanned += 1

        data = snap.to_dict() or {}
        audio = data.get("audio")
        if not isinstance(audio, list) or not audio:
            skipped_no_audio_array += 1
            continue

        needs_update = any(isinstance(a, dict) and _missing_audio_link(a) for a in audio)
        if not needs_update:
            skipped_has_links += 1
            continue

        blob_path = _find_bucket_audio(storage_client, bucket, _candidate_prefixes(data))
        if not blob_path and fallback_any_audio:
            while fallback_idx < len(fallback_pool) and fallback_pool[fallback_idx] in used_paths:
                fallback_idx += 1
            if fallback_idx < len(fallback_pool):
                blob_path = fallback_pool[fallback_idx]
                fallback_idx += 1
        if not blob_path:
            skipped_no_bucket_match += 1
            if len(examples) < 10:
                examples.append(f"{snap.id}: no_blob")
            continue
        used_paths.add(blob_path)

        updated_audio = []
        patched_any = False
        for item in audio:
            if not isinstance(item, dict):
                updated_audio.append(item)
                continue
            entry = dict(item)
            if _missing_audio_link(entry):
                entry["storage_path"] = blob_path
                entry["storage_uri"] = f"gs://{bucket}/{blob_path}"
                patched_any = True
            updated_audio.append(entry)

        if not patched_any:
            skipped_has_links += 1
            continue

        if apply:
            snap.reference.update({"audio": updated_audio})

        updated += 1
        if len(examples) < 10:
            examples.append(f"{snap.id}: {blob_path}")

    mode = "APPLY" if apply else "DRY-RUN"
    print(
        f"[{mode}] scanned={scanned} updated={updated} "
        f"skipped_no_audio_array={skipped_no_audio_array} skipped_has_links={skipped_has_links} skipped_no_bucket_match={skipped_no_bucket_match}"
    )
    if examples:
        print("sample:")
        for e in examples:
            print("  -", e)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill missing audio.storage_path/storage_uri from Firebase Storage.")
    parser.add_argument("--bucket", default="medgemini-tb-triage.firebasestorage.app")
    parser.add_argument("--apply", action="store_true", help="Write updates. Without this flag, dry-run only.")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--fallback-any-audio",
        action="store_true",
        help="If no direct patient match is found, assign next available audio from bucket prefix.",
    )
    parser.add_argument(
        "--fallback-prefix",
        default="asha_uploads/",
        help="Bucket prefix for fallback audio pool (default: asha_uploads/).",
    )
    args = parser.parse_args()

    run(
        bucket_name=args.bucket,
        apply=args.apply,
        limit=args.limit,
        fallback_any_audio=args.fallback_any_audio,
        fallback_prefix=args.fallback_prefix,
    )
