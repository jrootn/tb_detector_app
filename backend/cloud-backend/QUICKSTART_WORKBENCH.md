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
- Firebase authenticated (`firebase login` or `npx firebase-tools login`).
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
firebase functions:list --project "$PROJECT_ID" || npx firebase-tools functions:list --project "$PROJECT_ID"
```

You should see: `onPatientWriteEnqueueInference`.
If deploying only this function for this repository codebase, use:
`--only functions:tb-inference-triggers:onPatientWriteEnqueueInference`.
If you maintain `functions/.env` manually, do not use reserved keys like
`GCLOUD_PROJECT` or `FUNCTION_REGION`; use `APP_PROJECT_ID` and `APP_FUNCTION_REGION`.

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

## 5) Backfill existing patient docs

If you already have patient docs and want to trigger inference for all eligible records:

```bash
cd /home/jroot/TB-medgemma
python backend/cloud-backend/backfill_inference_requests.py --limit 500 --target-model-version medgemma-4b-it-v1   # dry-run
python backend/cloud-backend/backfill_inference_requests.py --apply --target-model-version medgemma-4b-it-v1        # execute
```

Eligibility rule: the document must contain at least one `audio[]` item with `storage_path` or `storage_uri`.

## Notes

- The service now runs with the real HEAR + classical + MedGemma pipeline.
- Make sure model files exist in GCS at the configured prefixes (or local mounted paths), otherwise startup will fail fast.
- `WARM_LOAD_ON_STARTUP=0` is recommended for Cloud Run so health checks pass quickly; first inference request will take longer while models load.
- Scale-to-zero is already configured (`--min-instances=0`).
