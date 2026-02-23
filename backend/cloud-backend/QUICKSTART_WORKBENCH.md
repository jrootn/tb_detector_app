# Quickstart (GCP Workbench)

This is the simplest path to get your backend running end-to-end.

## What will be deployed

1. `tb-inference` Cloud Run service (private): runs `/internal/infer`.
2. Cloud Tasks queue: buffers and retries inference jobs.
3. Firebase Function v2 trigger: watches `patients/{patientId}` and enqueues tasks.

Frontend can continue as-is.

## 0) Prerequisites in Workbench terminal

- `gcloud` installed and authenticated.
- `node` + `npm` installed.
- `firebase-tools` installed (`npm i -g firebase-tools`) and logged in (`firebase login`).
- You have Firebase project + Firestore + Storage already enabled.

## 1) Fill deployment env

Copy and edit:

```bash
cd /home/jroot/TB-medgemma/backend/cloud-backend
cp deploy.env.example deploy.env
```

Edit `deploy.env` with your real values:

- `PROJECT_ID`
- `REGION`
- `STORAGE_BUCKET`
- `TARGET_MODEL_VERSION`
- `MODEL_VERSION`

## 2) Run one deployment script

```bash
cd /home/jroot/TB-medgemma/backend/cloud-backend
bash deploy_workbench.sh
```

This script will:

- enable required APIs
- create service accounts
- assign IAM roles
- create/update Cloud Tasks queue
- build/deploy Cloud Run inference service
- grant Cloud Run invoker to Cloud Tasks SA
- write `functions/.env` from your deploy env
- install/build/deploy Firebase Functions trigger

## 3) Verify

### Check function exists

```bash
firebase functions:list --project "$PROJECT_ID"
```

You should see: `onPatientWriteEnqueueInference`.

### Check Cloud Run health

```bash
SERVICE_URL=$(gcloud run services describe tb-inference --region "$REGION" --format='value(status.url)')
echo "$SERVICE_URL"
```

### Check queue

```bash
gcloud tasks queues describe tb-inference-queue --location "$REGION"
```

## 4) Smoke test flow

1. Create/update one patient doc in Firestore with:
- `status.triage_status` not equal to `DRAFT`
- `audio[]` containing `storage_path` or `storage_uri`
2. Wait ~10-60 sec.
3. Patient doc should get `ai.*` fields:
- `ai.inference_status` (`SUCCESS`/`FAILED`)
- `ai.model_version`
- `ai.medgemini_summary_en`, `ai.medgemini_summary_hi`, `ai.medgemini_summary_i18n`

## Notes

- Current `inference_pipeline.py` is a production-safe fallback pipeline (deterministic, no dummy random text), so deployment works immediately.
- Replace internals later with your full HEAR + classical + MedGemma logic in:
  - `inference-service/app/models.py`
  - `inference-service/app/inference_pipeline.py`
- Scale-to-zero is already configured (`--min-instances=0`).
