#Requires -Version 5.1

$ErrorActionPreference = "Stop"
$ContainerName = "finally"

# Check if Docker is running
try {
    docker info 2>&1 | Out-Null
} catch {
    Write-Error "Docker is not running."
    exit 1
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker is not running."
    exit 1
}

$existing = docker ps -a --format "{{.Names}}" | Where-Object { $_ -eq $ContainerName }
if ($existing) {
    Write-Host "Stopping FinAlly..." -ForegroundColor Yellow
    docker rm -f $ContainerName | Out-Null
    Write-Host "FinAlly stopped. Your data is preserved." -ForegroundColor Green
} else {
    Write-Host "No running container named '$ContainerName' found." -ForegroundColor Cyan
}
