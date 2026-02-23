from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import unquote, urlparse

from google.cloud import storage

from .config import settings


storage_client = storage.Client(project=settings.project_id)


@dataclass
class AudioLocation:
    bucket: str
    blob_path: str


def _from_gs_uri(uri: str) -> Optional[AudioLocation]:
    parsed = urlparse(uri)
    if parsed.scheme != "gs":
        return None
    return AudioLocation(bucket=parsed.netloc, blob_path=parsed.path.lstrip("/"))


def _from_storage_googleapis_url(url: str) -> Optional[AudioLocation]:
    parsed = urlparse(url)
    if parsed.netloc != "storage.googleapis.com":
        return None
    path = parsed.path.lstrip("/")
    if "/" not in path:
        return None
    bucket, blob_path = path.split("/", 1)
    return AudioLocation(bucket=bucket, blob_path=blob_path)


def _from_firebase_download_url(url: str) -> Optional[AudioLocation]:
    # Example: https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encoded-path>?alt=media
    parsed = urlparse(url)
    if "firebasestorage.googleapis.com" not in parsed.netloc:
        return None
    parts = parsed.path.split("/")
    try:
        b_idx = parts.index("b")
        o_idx = parts.index("o")
    except ValueError:
        return None
    if len(parts) <= b_idx + 1 or len(parts) <= o_idx + 1:
        return None
    bucket = parts[b_idx + 1]
    encoded_blob = "/".join(parts[o_idx + 1 :])
    blob_path = unquote(encoded_blob)
    return AudioLocation(bucket=bucket, blob_path=blob_path)


def resolve_audio_location(audio_entry: Dict[str, Any]) -> Optional[AudioLocation]:
    raw_uri = audio_entry.get("storage_uri") or audio_entry.get("storage_path")
    if not raw_uri or not isinstance(raw_uri, str):
        return None

    if raw_uri.startswith("gs://"):
        return _from_gs_uri(raw_uri)
    if raw_uri.startswith("http://") or raw_uri.startswith("https://"):
        return _from_storage_googleapis_url(raw_uri) or _from_firebase_download_url(raw_uri)

    # Treat plain path as object path inside configured default bucket.
    return AudioLocation(bucket=settings.storage_bucket, blob_path=raw_uri.lstrip("/"))


def collect_audio_locations(patient_doc: Dict[str, Any]) -> List[AudioLocation]:
    audio_entries = patient_doc.get("audio", [])
    if not isinstance(audio_entries, list):
        return []

    locations: List[AudioLocation] = []
    for entry in audio_entries:
        if not isinstance(entry, dict):
            continue
        loc = resolve_audio_location(entry)
        if loc and loc.blob_path:
            locations.append(loc)
    return locations


def download_audio_to_tmp(location: AudioLocation) -> str:
    fd, tmp_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)

    bucket = storage_client.bucket(location.bucket)
    blob = bucket.blob(location.blob_path)
    blob.download_to_filename(tmp_path)
    return tmp_path


def download_audio_files(patient_doc: Dict[str, Any]) -> Tuple[List[str], List[AudioLocation]]:
    locations = collect_audio_locations(patient_doc)
    paths = [download_audio_to_tmp(loc) for loc in locations]
    return paths, locations


def cleanup_tmp_files(paths: List[str]) -> None:
    for path in paths:
        try:
            os.remove(path)
        except OSError:
            pass
