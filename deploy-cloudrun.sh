#!/usr/bin/env bash
# ==============================================================================
# EDX Digital - Script Bash de Deploy no Google Cloud Run
# ==============================================================================
set -e

PROJECT_ID="${1:-nexuscrm-d8e13}"
REGION="${2:-southamerica-east1}"
SERVICE_NAME="${3:-nexus-crm-api}"

echo "=========================================================="
echo "🚀 Iniciando Deploy do EDX Digital no Google Cloud Run..."
echo "📡 Projeto: $PROJECT_ID | Região: $REGION"
echo "=========================================================="

gcloud config set project "$PROJECT_ID"
gcloud builds submit --tag "gcr.io/$PROJECT_ID/$SERVICE_NAME:latest" .

gcloud run deploy "$SERVICE_NAME" \
    --image "gcr.io/$PROJECT_ID/$SERVICE_NAME:latest" \
    --platform managed \
    --region "$REGION" \
    --allow-unauthenticated \
    --port 3000 \
    --min-instances 0 \
    --max-instances 10 \
    --memory 512Mi \
    --cpu 1 \
    --set-env-vars NODE_ENV=production

echo "=========================================================="
echo "✅ Deploy Concluído com Sucesso no Cloud Run!"
echo "=========================================================="
