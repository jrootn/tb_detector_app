from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from google.cloud import storage

from .config import settings
from .logging_utils import get_logger, log_event


logger = get_logger("tb-inference-models")


# Set memory-related runtime flags before importing TensorFlow/Keras.
os.environ.setdefault("KERAS_BACKEND", "jax")
os.environ.setdefault("XLA_PYTHON_CLIENT_PREALLOCATE", "false")
os.environ.setdefault("TF_FORCE_GPU_ALLOW_GROWTH", "true")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")


@dataclass
class ModelBundle:
    meta_prep: Any = None
    clf_audio: Any = None
    clf_clinical: Any = None
    cal_supervisor: Any = None
    hear_serving: Any = None
    medgemma: Any = None
    loaded: bool = False


def _download_prefix(bucket_name: str, prefix: str, local_dir: str) -> int:
    if not bucket_name or not prefix:
        return 0

    client = storage.Client(project=settings.project_id)
    bucket = client.bucket(bucket_name)
    blobs = list(client.list_blobs(bucket, prefix=prefix))
    downloaded = 0

    for blob in blobs:
        if blob.name.endswith("/"):
            continue
        relative = blob.name[len(prefix) :].lstrip("/")
        if not relative:
            continue
        target = Path(local_dir) / relative
        target.parent.mkdir(parents=True, exist_ok=True)

        if target.exists() and target.stat().st_size > 0:
            continue
        blob.download_to_filename(str(target))
        downloaded += 1

    return downloaded


def _sync_model_artifacts() -> None:
    if not settings.sync_models_on_startup:
        log_event(logger, "model_sync_skipped", reason="disabled")
        return
    if not settings.gcs_model_bucket:
        log_event(logger, "model_sync_skipped", reason="missing_bucket")
        return

    total = 0
    total += _download_prefix(settings.gcs_model_bucket, settings.gcs_medgemma_prefix, settings.local_medgemma)
    total += _download_prefix(settings.gcs_model_bucket, settings.gcs_classical_prefix, settings.local_classical)
    total += _download_prefix(settings.gcs_model_bucket, settings.gcs_hear_prefix, settings.local_hear)
    log_event(logger, "model_sync_complete", downloaded_files=total)


def _safe_joblib_load(path: Path) -> Optional[Any]:
    if not path.exists():
        return None
    try:
        import joblib

        return joblib.load(path)
    except Exception as exc:
        log_event(logger, "model_load_warning", model=str(path), error=str(exc))
        return None


@lru_cache(maxsize=1)
def get_models() -> ModelBundle:
    _sync_model_artifacts()

    import keras
    import keras_hub
    import tensorflow as tf

    keras.config.set_floatx("bfloat16")

    bundle = ModelBundle()
    classical_dir = Path(settings.local_classical)

    bundle.meta_prep = _safe_joblib_load(classical_dir / "final_meta_preprocessor.pkl")
    bundle.clf_audio = _safe_joblib_load(classical_dir / "final_audio_expert.pkl")
    bundle.clf_clinical = _safe_joblib_load(classical_dir / "final_clinical_expert.pkl")
    bundle.cal_supervisor = _safe_joblib_load(classical_dir / "final_calibrated_supervisor.pkl")

    # Fail fast before loading heavier HEAR/LLM artifacts if classical models are unavailable.
    missing_classical = []
    if bundle.meta_prep is None:
        missing_classical.append("meta_preprocessor")
    if bundle.clf_audio is None:
        missing_classical.append("audio_expert")
    if bundle.clf_clinical is None:
        missing_classical.append("clinical_expert")
    if bundle.cal_supervisor is None:
        missing_classical.append("calibrated_supervisor")
    if missing_classical:
        raise RuntimeError(
            "Classical model components missing or failed to load: "
            + ", ".join(missing_classical)
            + ". Ensure required ML dependencies (e.g. lightgbm) are installed."
        )

    hear_path = Path(settings.local_hear)
    if hear_path.exists():
        try:
            hear_model = tf.saved_model.load(str(hear_path))
            bundle.hear_serving = hear_model.signatures["serving_default"]
        except Exception as exc:
            log_event(logger, "model_load_warning", model="hear_serving", error=str(exc))

    medgemma_path = Path(settings.local_medgemma)
    if medgemma_path.exists():
        try:
            bundle.medgemma = keras_hub.models.CausalLM.from_preset(str(medgemma_path), dtype="bfloat16")
            bundle.medgemma.compile(sampler=keras_hub.samplers.TopPSampler(p=0.9, temperature=0.2))
            # Warmup call
            _ = bundle.medgemma.generate("Warmup prompt.", max_length=10)
        except Exception as exc:
            log_event(logger, "model_load_warning", model="medgemma", error=str(exc))

    missing = []
    if bundle.hear_serving is None:
        missing.append("hear_serving")
    if bundle.medgemma is None:
        missing.append("medgemma")

    if missing:
        raise RuntimeError(f"Required model components missing or failed to load: {', '.join(missing)}")

    bundle.loaded = True
    log_event(
        logger,
        "model_bundle_ready",
        loaded=bundle.loaded,
        local_classical=settings.local_classical,
        local_medgemma=settings.local_medgemma,
        local_hear=settings.local_hear,
    )

    return bundle
