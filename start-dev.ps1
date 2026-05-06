# PowerShell script to start both backend and frontend together
# Run this from the frontend project root directory

Write-Host "Starting ResearchPlatform Integration..." -ForegroundColor Cyan
Write-Host ""

# Check if backend directory exists
$backendPath = "C:\temp\ResearchPlatform1\ResearchPlatform\backend"
if (-not (Test-Path $backendPath)) {
    Write-Host "ERROR: Backend directory not found at: $backendPath" -ForegroundColor Red
    Write-Host "Please update the backend path in this script." -ForegroundColor Yellow
    exit 1
}

# Start backend in a new window
Write-Host "Starting Backend (ResearchPlatform)..." -ForegroundColor Green
$backendScript = @"
cd `"$backendPath`"
Write-Host `"Backend starting on http://localhost:8000`" -ForegroundColor Cyan
python -m uvicorn app.main:app --reload --port 8000 --host 0.0.0.0
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendScript

# Wait a bit for backend to start
Write-Host "Waiting for backend to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# Start frontend
Write-Host "Starting Frontend (Vortex AI)..." -ForegroundColor Green
Write-Host "Frontend will be available at http://localhost:5173" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Ctrl+C to stop both servers" -ForegroundColor Yellow
Write-Host ""

npm start
