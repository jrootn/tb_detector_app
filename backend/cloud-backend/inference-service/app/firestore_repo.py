from __future__ import annotations

from typing import Any, Dict, Optional

from google.cloud import firestore
from google.cloud.firestore_v1.base_transaction import BaseTransaction

from .config import settings


db = firestore.Client(project=settings.project_id, database=settings.firestore_db)


def patient_ref(patient_id: str):
    return db.collection("patients").document(patient_id)


@firestore.transactional
def mark_processing_if_needed(txn: BaseTransaction, patient_id: str, target_model_version: str) -> Dict[str, Any]:
    ref = patient_ref(patient_id)
    snap = ref.get(transaction=txn)
    if not snap.exists:
        return {"status": "NOT_FOUND", "doc": None}

    doc = snap.to_dict() or {}
    ai = doc.get("ai", {}) if isinstance(doc.get("ai"), dict) else {}

    if ai.get("model_version") == target_model_version and ai.get("inference_status") == "SUCCESS":
        return {"status": "SKIP_ALREADY_DONE", "doc": doc}

    if ai.get("model_version") == target_model_version and ai.get("inference_status") == "PROCESSING":
        return {"status": "SKIP_IN_PROGRESS", "doc": doc}

    txn.update(
        ref,
        {
            "ai.model_version": target_model_version,
            "ai.inference_status": "PROCESSING",
            "ai.processing_started_at": firestore.SERVER_TIMESTAMP,
            "ai.error_message": firestore.DELETE_FIELD,
        },
    )
    return {"status": "PROCESSING_CLAIMED", "doc": doc}


def get_patient(patient_id: str) -> Optional[Dict[str, Any]]:
    snap = patient_ref(patient_id).get()
    if not snap.exists:
        return None
    return snap.to_dict() or {}


def write_success(patient_id: str, payload: Dict[str, Any]) -> None:
    patient_ref(patient_id).update(
        {
            "ai.hear_score": payload["hear_score"],
            "ai.risk_score": payload["risk_score"],
            "ai.risk_level": payload["risk_level"],
            "ai.medgemini_summary_en": payload["medgemini_summary_en"],
            "ai.medgemini_summary_hi": payload["medgemini_summary_hi"],
            "ai.medgemini_summary_i18n": {
                "en": payload["medgemini_summary_en"],
                "hi": payload["medgemini_summary_hi"],
            },
            # Backward compatibility for existing consumers that still read a single summary string.
            "ai.medgemini_summary": payload["medgemini_summary_en"],
            "ai.generated_at": firestore.SERVER_TIMESTAMP,
            "ai.model_version": payload["model_version"],
            "ai.inference_status": "SUCCESS",
            "ai.error_message": firestore.DELETE_FIELD,
        }
    )


def write_failure(patient_id: str, model_version: str, error_message: str) -> None:
    patient_ref(patient_id).set(
        {
            "ai": {
                "model_version": model_version,
                "inference_status": "FAILED",
                "error_message": error_message[:2000],
                "generated_at": firestore.SERVER_TIMESTAMP,
            }
        },
        merge=True,
    )
