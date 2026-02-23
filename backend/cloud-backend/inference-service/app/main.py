from __future__ import annotations

import time
from typing import Any, Dict

from fastapi import FastAPI, HTTPException, Request

from .config import settings
from .firestore_repo import db, get_patient, mark_processing_if_needed, write_failure, write_success
from .inference_pipeline import run_tb_inference
from .logging_utils import get_logger, log_event
from .models import get_models
from .schemas import InferRequest, InferResponse
from .storage import cleanup_tmp_files, download_audio_files


app = FastAPI(title="TB Inference Service", version="1.0.0")
logger = get_logger("tb-inference-service")


@app.on_event("startup")
def on_startup() -> None:
    get_models()
    log_event(
        logger,
        "startup_complete",
        project_id=settings.project_id,
        model_version=settings.model_version,
        target_model_version=settings.target_model_version,
    )


@app.get("/healthz")
def healthz() -> Dict[str, Any]:
    return {
        "ok": True,
        "project_id": settings.project_id,
        "model_version": settings.model_version,
    }


@app.post("/internal/infer", response_model=InferResponse)
async def infer(req: InferRequest, request: Request) -> InferResponse:
    t0 = time.time()
    task_name = request.headers.get("X-CloudTasks-TaskName", "")
    retry_count = request.headers.get("X-CloudTasks-TaskRetryCount", "0")

    if req.target_model_version != settings.target_model_version:
        log_event(
            logger,
            "skip_target_version_mismatch",
            patient_id=req.patient_id,
            request_target=req.target_model_version,
            service_target=settings.target_model_version,
            task_name=task_name,
        )
        return InferResponse(
            ok=True,
            status="SKIP_TARGET_VERSION_MISMATCH",
            patient_id=req.patient_id,
            model_version=settings.model_version,
            detail="stale task target version",
        )

    txn = db.transaction()
    claim = mark_processing_if_needed(txn, req.patient_id, req.target_model_version)
    status = claim.get("status")

    if status == "NOT_FOUND":
        return InferResponse(
            ok=True,
            status="SKIP_NOT_FOUND",
            patient_id=req.patient_id,
            model_version=settings.model_version,
        )
    if status in {"SKIP_ALREADY_DONE", "SKIP_IN_PROGRESS"}:
        return InferResponse(
            ok=True,
            status=str(status),
            patient_id=req.patient_id,
            model_version=settings.model_version,
        )
    if status != "PROCESSING_CLAIMED":
        raise HTTPException(status_code=500, detail=f"Unknown claim status: {status}")

    patient_doc = claim.get("doc") or get_patient(req.patient_id)
    if not patient_doc:
        return InferResponse(
            ok=True,
            status="SKIP_NOT_FOUND_POST_CLAIM",
            patient_id=req.patient_id,
            model_version=settings.model_version,
        )

    tmp_paths = []
    try:
        tmp_paths, locations = download_audio_files(patient_doc)
        if not tmp_paths:
            raise RuntimeError("No downloadable audio found in patient audio metadata")

        models = get_models()
        ai_payload = run_tb_inference(
            patient_doc=patient_doc,
            audio_paths=tmp_paths,
            model_version=settings.model_version,
            model_bundle=models,
        )
        write_success(req.patient_id, ai_payload)

        log_event(
            logger,
            "inference_success",
            patient_id=req.patient_id,
            model_version=settings.model_version,
            risk_score=ai_payload.get("risk_score"),
            risk_level=ai_payload.get("risk_level"),
            audio_files=len(locations),
            retry_count=retry_count,
            task_name=task_name,
            latency_ms=int((time.time() - t0) * 1000),
        )

        return InferResponse(
            ok=True,
            status="SUCCESS",
            patient_id=req.patient_id,
            model_version=settings.model_version,
        )

    except Exception as exc:
        write_failure(req.patient_id, settings.model_version, str(exc))
        log_event(
            logger,
            "inference_failed",
            patient_id=req.patient_id,
            model_version=settings.model_version,
            retry_count=retry_count,
            task_name=task_name,
            error=str(exc),
        )
        raise HTTPException(status_code=500, detail="inference failed")
    finally:
        cleanup_tmp_files(tmp_paths)
