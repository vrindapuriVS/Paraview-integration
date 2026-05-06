@echo off
REM Batch script to start both backend and frontend together
REM Run this from the frontend project root directory

echo Starting ResearchPlatform Integration...
echo.

REM Check if backend directory exists
set BACKEND_PATH=C:\temp\ResearchPlatform1\ResearchPlatform\backend
if not exist "%BACKEND_PATH%" (
    echo ERROR: Backend directory not found at: %BACKEND_PATH%
    echo Please update the backend path in this script.
    pause
    exit /b 1
)

REM Start backend in a new window
echo Starting Backend (ResearchPlatform)...
start "Backend Server" cmd /k "cd /d "%BACKEND_PATH%" && python -m uvicorn app.main:app --reload --port 8000 --host 0.0.0.0"

REM Wait a bit for backend to start
echo Waiting for backend to initialize...
timeout /t 3 /nobreak >nul

REM Start frontend
echo Starting Frontend (Vortex AI)...
echo Frontend will be available at http://localhost:5173
echo.
echo Press Ctrl+C to stop both servers
echo.

npm start
