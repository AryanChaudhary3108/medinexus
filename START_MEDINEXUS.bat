@echo off
setlocal EnableExtensions EnableDelayedExpansion

title MediNexus Launcher
color 0A

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "VENV=%BACKEND%\venv"
set "VENV_PY=%VENV%\Scripts\python.exe"
set "VENV_UVICORN=%VENV%\Scripts\uvicorn.exe"
set "PORT_FRONTEND=5500"
set "PORT_BACKEND=8000"

cls
echo.
echo  ============================================================
echo       __  __          _ _   _   _                      
echo      ^|  \/  ^| ___  __^| ^| ^| ^| ^| ^| ____ _  __  _ _  ___
echo      ^| ^|\/^| ^|/ _ \/ _` ^| ^| ^| ^| ^|/ / _` ^|/ / ^| ' \(_-^<
echo      ^|_^|  ^|_^|\___/\__,_^| ^|_^| ^|___/\__,_^|\_\ ^|_^||_/__/
echo  ============================================================
echo          One-Click Launcher for Windows
echo  ============================================================
echo.

REM ── Step 1: Resolve Python ──────────────────────────────────────
set "PY_BIN="
set "PY_ARGS="

where python >nul 2>nul
if not errorlevel 1 (
  set "PY_BIN=python"
  goto :python_found
)

where py >nul 2>nul
if not errorlevel 1 (
  set "PY_BIN=py"
  set "PY_ARGS=-3"
  goto :python_found
)

echo  [ERROR] Python not found in PATH.
echo  Install Python 3.10+ from https://python.org and try again.
echo.
pause
exit /b 1

:python_found
echo  [OK] Python found: %PY_BIN%

REM ── Step 2: Check / Create venv ─────────────────────────────────
if not exist "%VENV%\Scripts\activate.bat" (
  echo  [INFO] No virtual environment found. Creating one now...
  pushd "%BACKEND%"
  %PY_BIN% %PY_ARGS% -m venv venv
  if errorlevel 1 (
    popd
    echo  [ERROR] Failed to create virtual environment.
    pause
    exit /b 1
  )
  popd
  echo  [OK] Virtual environment created.

  REM Install dependencies on first run
  echo  [INFO] Installing backend dependencies (this may take a minute)...
  "%VENV_PY%" -m pip install --upgrade pip --quiet
  "%VENV_PY%" -m pip install fastapi uvicorn qdrant-client fastembed groq --quiet
  if errorlevel 1 (
    echo  [ERROR] Dependency installation failed.
    pause
    exit /b 1
  )
  echo  [OK] Dependencies installed.
) else (
  echo  [OK] Virtual environment ready.
)

REM ── Step 3: GROQ API Key check ──────────────────────────────────
if "%GROQ_API_KEY%"=="" (
  echo.
  echo  [WARN] GROQ_API_KEY is not set in your environment.
  echo  [WARN] The AI companion features may not work until it is set.
  echo.
  set /p "GROQ_API_KEY=  Enter your GROQ API key (or press Enter to skip): "
  echo.
)

REM ── Step 4: Launch Backend ──────────────────────────────────────
echo  [INFO] Starting Backend  ^>^>  http://localhost:%PORT_BACKEND%
start "MediNexus - Backend (FastAPI)" cmd /k ^
  "title MediNexus Backend ^& color 0B ^& echo. ^& echo  [MediNexus] Backend running on http://localhost:%PORT_BACKEND% ^& echo  Press Ctrl+C to stop. ^& echo. ^& cd /d "%BACKEND%" ^& set GROQ_API_KEY=%GROQ_API_KEY% ^& "%VENV_UVICORN%" main:app --reload --host 0.0.0.0 --port %PORT_BACKEND%"

REM Give the backend a moment to initialise before launching frontend
timeout /t 2 /nobreak >nul

REM ── Step 5: Launch Frontend ─────────────────────────────────────
echo  [INFO] Starting Frontend  ^>^>  http://localhost:%PORT_FRONTEND%
start "MediNexus - Frontend (HTTP Server)" cmd /k ^
  "title MediNexus Frontend ^& color 0E ^& echo. ^& echo  [MediNexus] Frontend running on http://localhost:%PORT_FRONTEND% ^& echo  Press Ctrl+C to stop. ^& echo. ^& cd /d "%ROOT%" ^& %PY_BIN% %PY_ARGS% -m http.server %PORT_FRONTEND%"

REM Give the frontend server a second to start
timeout /t 2 /nobreak >nul

REM ── Step 6: Open browser ────────────────────────────────────────
echo  [INFO] Opening app in your browser...
start "" "http://localhost:%PORT_FRONTEND%/index.html"

echo.
echo  ============================================================
echo   MediNexus is now running!
echo.
echo   Frontend : http://localhost:%PORT_FRONTEND%/index.html
echo   Backend  : http://localhost:%PORT_BACKEND%/docs
echo.
echo   Close the two terminal windows to stop the servers.
echo  ============================================================
echo.
pause
