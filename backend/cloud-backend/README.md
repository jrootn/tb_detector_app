# Cloud Backend (Production Scaffold)

This folder contains a production-ready backend scaffold for TB inference in cloud:

- `inference-service/`: FastAPI service for model inference on Cloud Run.
- `functions/`: Firebase Functions v2 trigger that enqueues Cloud Tasks for inference.
- `deploy_workbench.sh`: one-command deployment script for GCP Workbench.
- `QUICKSTART_WORKBENCH.md`: copy-paste deployment guide.

## Architecture

1. Firestore write on `patients/{patientId}` triggers Function v2.
2. Trigger validates if inference is needed (`shouldEnqueue`).
3. Trigger enqueues deterministic Cloud Task (`patientId + modelVersion`).
4. Cloud Task calls private Cloud Run endpoint `/internal/infer` with OIDC token.
5. Inference service reads Firestore + audio files from Storage, runs inference, writes only `ai.*` fields.

## Key design points

- Idempotent processing by `ai.model_version` + `ai.inference_status`.
- No overwrite of non-AI patient fields.
- Retries handled by Cloud Tasks; endpoint returns 5xx only for transient/server failures.
- Supports both `audio[].storage_uri` and `audio[].storage_path`.
- Supports bilingual summaries: English + Hindi.

## Deploy order

1. Deploy `inference-service` to Cloud Run (private).
2. Create Cloud Tasks queue.
3. Deploy `functions` trigger with env vars pointing to Cloud Run URL and queue.

Or use the Workbench quickstart:

1. `cp deploy.env.example deploy.env`
2. Edit `deploy.env`
3. `bash deploy_workbench.sh`

## Notes

- `inference_pipeline.py` currently includes a deterministic clinical/audio fallback pipeline so the service runs end-to-end now.
- Replace fallback logic with your final HEAR + classical + MedGemma implementation in `app/inference_pipeline.py` and `app/models.py` when ready.
