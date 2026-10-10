# ==============================================================================
# EDX Digital - Script de Deploy Automatizado no Google Cloud Run
# Pré-requisito: Google Cloud CLI instalada (gcloud auth login)
# ==============================================================================

param(
    [string]$ProjectId = "nexuscrm-d8e13",
    [string]$Region = "southamerica-east1",
    [string]$ServiceName = "nexus-crm-api"
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "🚀 Iniciando Deploy do EDX Digital no Google Cloud Run..." -ForegroundColor Yellow
Write-Host "📡 Projeto: $ProjectId | Região: $Region" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Configurar Projeto Ativo
gcloud config set project $ProjectId

# 2. Build da Imagem Docker Hardened com Cloud Build
Write-Host "📦 Gerando imagem de container segura no Artifact Registry..." -ForegroundColor Cyan
gcloud builds submit --tag "gcr.io/$ProjectId/$ServiceName`:latest" .

# 3. Deploy no Cloud Run com escalonamento automático e HTTPS nativo
Write-Host "⚡ Publicando serviço no Cloud Run..." -ForegroundColor Cyan
gcloud run deploy $ServiceName `
    --image "gcr.io/$ProjectId/$ServiceName`:latest" `
    --platform managed `
    --region $Region `
    --allow-unauthenticated `
    --port 3000 `
    --min-instances 0 `
    --max-instances 10 `
    --memory 512Mi `
    --cpu 1 `
    --set-env-vars NODE_ENV=production

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "✅ Deploy Concluído com Sucesso no Cloud Run!" -ForegroundColor Green
Write-Host "🌐 O endpoint do backend está ativo e seguro com HTTPS." -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Green
