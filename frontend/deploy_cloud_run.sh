#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-medgemini-tb-triage}"
REGION="${REGION:-us-east4}"
SERVICE_NAME="${SERVICE_NAME:-tb-frontend}"
AR_REPO="${AR_REPO:-tb-backend}"
API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-/api}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
ENV_FILE="$FRONTEND_DIR/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env var: $name"
    exit 1
  fi
}

require_var NEXT_PUBLIC_FIREBASE_API_KEY
require_var NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
require_var NEXT_PUBLIC_FIREBASE_PROJECT_ID
require_var NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
require_var NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
require_var NEXT_PUBLIC_FIREBASE_APP_ID
require_var NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID

IMAGE_TAG="$(date +%Y%m%d-%H%M%S)"
IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}:${IMAGE_TAG}"

echo "==> Setting project"
gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Enabling APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com >/dev/null

echo "==> Ensuring Artifact Registry repo: $AR_REPO"
if ! gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$AR_REPO" \
    --location="$REGION" \
    --repository-format=docker \
    --description="TB frontend/backend images"
fi

echo "==> Building image: $IMAGE_URI"
gcloud builds submit "$FRONTEND_DIR" \
  --config="$FRONTEND_DIR/cloudbuild.cloudrun.yaml" \
  --substitutions="_IMAGE=${IMAGE_URI},_NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY},_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN},_NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID},_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET},_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID},_NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID},_NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=${NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID},_NEXT_PUBLIC_API_BASE_URL=${API_BASE_URL}"

echo "==> Deploying Cloud Run service: $SERVICE_NAME"
gcloud run deploy "$SERVICE_NAME" \
  --region "$REGION" \
  --image "$IMAGE_URI" \
  --allow-unauthenticated \
  --min-instances=1 \
  --max-instances=3 \
  --concurrency=20 \
  --cpu=1 \
  --memory=1Gi \
  --timeout=300 \
  --port=8080 \
  --set-env-vars="NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY},NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN},NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID},NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET},NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID},NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID},NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=${NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID},NEXT_PUBLIC_API_BASE_URL=${API_BASE_URL}"

URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"
echo ""
echo "Frontend deployed."
echo "Public URL: $URL"
