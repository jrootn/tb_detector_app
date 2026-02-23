#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f deploy.env ]]; then
  echo "Missing deploy.env. Run: cp deploy.env.example deploy.env"
  exit 1
fi

# shellcheck disable=SC1091
source deploy.env

required_vars=(
  PROJECT_ID REGION STORAGE_BUCKET TARGET_MODEL_VERSION MODEL_VERSION
  AR_REPO RUN_SERVICE QUEUE_NAME
  SA_FN_ENQUEUE SA_TASKS_INVOKER SA_INFERENCE
)
for v in "${required_vars[@]}"; do
  if [[ -z "${!v:-}" ]]; then
    echo "Missing env var: $v"
    exit 1
  fi
done

INFERENCE_CPU="${INFERENCE_CPU:-8}"
INFERENCE_MEMORY="${INFERENCE_MEMORY:-32Gi}"
INFERENCE_MAX_INSTANCES="${INFERENCE_MAX_INSTANCES:-3}"
INFERENCE_TIMEOUT="${INFERENCE_TIMEOUT:-3600}"
USE_GPU="${USE_GPU:-1}"
GPU_COUNT="${GPU_COUNT:-1}"
GPU_TYPE="${GPU_TYPE:-nvidia-l4}"
GPU_ZONAL_REDUNDANCY="${GPU_ZONAL_REDUNDANCY:-0}"

LOCAL_MEDGEMMA="${LOCAL_MEDGEMMA:-/models/medgemma}"
LOCAL_CLASSICAL="${LOCAL_CLASSICAL:-/models/classical}"
LOCAL_HEAR="${LOCAL_HEAR:-/models/hear}"
SYNC_MODELS_ON_STARTUP="${SYNC_MODELS_ON_STARTUP:-1}"
GCS_MODEL_BUCKET="${GCS_MODEL_BUCKET:-$STORAGE_BUCKET}"
GCS_MEDGEMMA_PREFIX="${GCS_MEDGEMMA_PREFIX:-models/medgemma}"
GCS_CLASSICAL_PREFIX="${GCS_CLASSICAL_PREFIX:-models/classical}"
GCS_HEAR_PREFIX="${GCS_HEAR_PREFIX:-models/Hear_model/hear_model_offline}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud not found"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found"
  exit 1
fi
if ! command -v firebase >/dev/null 2>&1; then
  echo "firebase CLI not found. Install: npm i -g firebase-tools"
  exit 1
fi

echo "==> Setting gcloud project"
gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Enabling required APIs"
gcloud services enable \
  run.googleapis.com \
  cloudtasks.googleapis.com \
  firestore.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  eventarc.googleapis.com \
  firebase.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com >/dev/null

create_sa_if_missing() {
  local name="$1"
  if gcloud iam service-accounts describe "${name}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1; then
    echo "Service account exists: $name"
  else
    gcloud iam service-accounts create "$name" --display-name="$name" >/dev/null
    echo "Created service account: $name"
  fi
}

echo "==> Ensuring service accounts"
create_sa_if_missing "$SA_FN_ENQUEUE"
create_sa_if_missing "$SA_TASKS_INVOKER"
create_sa_if_missing "$SA_INFERENCE"

bind_role() {
  local member="$1"
  local role="$2"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="$member" \
    --role="$role" >/dev/null
}

echo "==> Binding IAM roles"
bind_role "serviceAccount:${SA_FN_ENQUEUE}@${PROJECT_ID}.iam.gserviceaccount.com" "roles/cloudtasks.enqueuer"
bind_role "serviceAccount:${SA_FN_ENQUEUE}@${PROJECT_ID}.iam.gserviceaccount.com" "roles/logging.logWriter"

bind_role "serviceAccount:${SA_INFERENCE}@${PROJECT_ID}.iam.gserviceaccount.com" "roles/datastore.user"
bind_role "serviceAccount:${SA_INFERENCE}@${PROJECT_ID}.iam.gserviceaccount.com" "roles/storage.objectViewer"
bind_role "serviceAccount:${SA_INFERENCE}@${PROJECT_ID}.iam.gserviceaccount.com" "roles/logging.logWriter"
bind_role "serviceAccount:${SA_INFERENCE}@${PROJECT_ID}.iam.gserviceaccount.com" "roles/monitoring.metricWriter"

echo "==> Ensuring Artifact Registry repo"
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker \
  --location="$REGION" >/dev/null 2>&1 || true

echo "==> Ensuring Cloud Tasks queue"
if gcloud tasks queues describe "$QUEUE_NAME" --location="$REGION" >/dev/null 2>&1; then
  echo "Queue exists: $QUEUE_NAME"
else
  gcloud tasks queues create "$QUEUE_NAME" \
    --location="$REGION" \
    --max-dispatches-per-second=1 \
    --max-concurrent-dispatches=1 \
    --max-attempts=5 \
    --min-backoff=30s \
    --max-backoff=600s \
    --max-retry-duration=3600s >/dev/null
  echo "Created queue: $QUEUE_NAME"
fi

IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$AR_REPO/tb-inference:$(date +%Y%m%d-%H%M%S)"

echo "==> Building inference image: $IMAGE"
gcloud builds submit "$SCRIPT_DIR/inference-service" --tag "$IMAGE" >/dev/null

echo "==> Deploying Cloud Run service: $RUN_SERVICE"
deploy_cmd=(
  gcloud run deploy "$RUN_SERVICE"
  --image="$IMAGE"
  --region="$REGION"
  --service-account="${SA_INFERENCE}@${PROJECT_ID}.iam.gserviceaccount.com"
  --no-allow-unauthenticated
  --ingress=internal-and-cloud-load-balancing
  --timeout="$INFERENCE_TIMEOUT"
  --concurrency=1
  --min-instances=0
  --max-instances="$INFERENCE_MAX_INSTANCES"
  --cpu="$INFERENCE_CPU"
  --memory="$INFERENCE_MEMORY"
  --set-env-vars="PROJECT_ID=$PROJECT_ID,GCP_REGION=$REGION,STORAGE_BUCKET=$STORAGE_BUCKET,TARGET_MODEL_VERSION=$TARGET_MODEL_VERSION,MODEL_VERSION=$MODEL_VERSION,LOCAL_MEDGEMMA=$LOCAL_MEDGEMMA,LOCAL_CLASSICAL=$LOCAL_CLASSICAL,LOCAL_HEAR=$LOCAL_HEAR,SYNC_MODELS_ON_STARTUP=$SYNC_MODELS_ON_STARTUP,GCS_MODEL_BUCKET=$GCS_MODEL_BUCKET,GCS_MEDGEMMA_PREFIX=$GCS_MEDGEMMA_PREFIX,GCS_CLASSICAL_PREFIX=$GCS_CLASSICAL_PREFIX,GCS_HEAR_PREFIX=$GCS_HEAR_PREFIX"
)

if [[ "$USE_GPU" == "1" ]]; then
  deploy_cmd+=(--gpu="$GPU_COUNT" --gpu-type="$GPU_TYPE")
  if [[ "$GPU_ZONAL_REDUNDANCY" == "1" ]]; then
    deploy_cmd+=(--gpu-zonal-redundancy)
  else
    deploy_cmd+=(--no-gpu-zonal-redundancy)
  fi
fi

"${deploy_cmd[@]}" >/dev/null

SERVICE_URL=$(gcloud run services describe "$RUN_SERVICE" --region "$REGION" --format='value(status.url)')
INFERENCE_URL="$SERVICE_URL/internal/infer"

echo "==> Granting Cloud Run invoker to Cloud Tasks SA"
gcloud run services add-iam-policy-binding "$RUN_SERVICE" \
  --region="$REGION" \
  --member="serviceAccount:${SA_TASKS_INVOKER}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.invoker" >/dev/null

echo "==> Writing functions/.env"
cat > "$SCRIPT_DIR/functions/.env" <<EOV
GCLOUD_PROJECT=$PROJECT_ID
FUNCTION_REGION=$REGION
TASKS_REGION=$REGION
INFERENCE_QUEUE_NAME=$QUEUE_NAME
INFERENCE_URL=$INFERENCE_URL
TASKS_INVOKER_SERVICE_ACCOUNT=${SA_TASKS_INVOKER}@${PROJECT_ID}.iam.gserviceaccount.com
TARGET_MODEL_VERSION=$TARGET_MODEL_VERSION
EOV

echo "==> Deploying Firebase Function trigger"
cd "$SCRIPT_DIR/functions"
npm ci >/dev/null
npm run build >/dev/null
firebase use "$PROJECT_ID" >/dev/null
firebase deploy --only functions:onPatientWriteEnqueueInference

echo ""
echo "Done."
echo "Cloud Run service URL: $SERVICE_URL"
echo "Inference endpoint: $INFERENCE_URL"
echo "Now create/update one patient doc with audio + triage_status to test end-to-end."
