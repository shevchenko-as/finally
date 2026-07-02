#Requires -Version 5.1
param(
    [switch]$Build
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectDir = Split-Path -Parent $ScriptDir
$ImageName = "finally"
$ContainerName = "finally"
$VolumeName = "finally-data"
$Port = 8000

Set-Location $ProjectDir

# Check if Docker is running
try {
    docker info 2>&1 | Out-Null
} catch {
    Write-Error "Docker is not running. Please start Docker Desktop and try again."
    exit 1
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker is not running. Please start Docker Desktop and try again."
    exit 1
}

# Create .env from .env.example if not present
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Warning ".env file not found. Created from .env.example."
        Write-Warning "Please edit .env and set your OPENROUTER_API_KEY before continuing."
    } else {
        Write-Error "Neither .env nor .env.example found. Cannot start."
        exit 1
    }
}

# Determine if we need to build
$ImageExists = docker image inspect $ImageName 2>&1
$NeedBuild = $Build -or ($LASTEXITCODE -ne 0)

if ($NeedBuild) {
    Write-Host "Building Docker image..." -ForegroundColor Cyan
    docker build -t $ImageName .
    if ($LASTEXITCODE -ne 0) { Write-Error "Build failed."; exit 1 }
    Write-Host "Image built." -ForegroundColor Green
}

# Stop and remove existing container if present
$existing = docker ps -a --format "{{.Names}}" | Where-Object { $_ -eq $ContainerName }
if ($existing) {
    Write-Host "Stopping existing container..." -ForegroundColor Yellow
    docker rm -f $ContainerName | Out-Null
}

# Run the container
Write-Host "Starting FinAlly..." -ForegroundColor Cyan
docker run -d `
    --name $ContainerName `
    -v "${VolumeName}:/app/db" `
    -p "${Port}:8000" `
    --env-file .env `
    $ImageName

if ($LASTEXITCODE -ne 0) { Write-Error "Failed to start container."; exit 1 }

# Wait for health check (up to 30s)
Write-Host "Waiting for FinAlly to become healthy..." -ForegroundColor Cyan
$MaxWait = 30
$Waited = 0
$Healthy = $false

while ($Waited -lt $MaxWait) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:${Port}/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            $Healthy = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 1
    $Waited++
}

if (-not $Healthy) {
    Write-Error "FinAlly did not become healthy within ${MaxWait}s. Check logs with: docker logs $ContainerName"
    exit 1
}

Write-Host "FinAlly is running at http://localhost:${Port}" -ForegroundColor Green
Start-Process "http://localhost:${Port}"
