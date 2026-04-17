@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "VENV=%BACKEND%\venv"
set "VENV_PY=%VENV%\Scripts\python.exe"
set "VENV_UVICORN=%VENV%\Scripts\uvicorn.exe"
set "PORT_FRONTEND=5500"
set "PORT_BACKEND=8000"

cd /d "%ROOT%"

if "%~1"=="" goto :help
if /I "%~1"=="help" goto :help
if /I "%~1"=="setup" goto :setup
if /I "%~1"=="initdb" goto :initdb
if /I "%~1"=="backend" goto :backend
if /I "%~1"=="frontend" goto :frontend
if /I "%~1"=="all" goto :all

echo Unknown command: %~1
echo.
goto :help

:resolve_python
set "PY_BIN="
set "PY_ARGS="

where python >nul 2>nul
if not errorlevel 1 (
  set "PY_BIN=python"
  goto :resolve_python_done
)

where py >nul 2>nul
if not errorlevel 1 (
  set "PY_BIN=py"
  set "PY_ARGS=-3"
  goto :resolve_python_done
)

echo [ERROR] Python is not available in PATH.
echo Install Python 3.10+ and try again.
exit /b 1

:resolve_python_done
exit /b 0

:setup
call :resolve_python
if errorlevel 1 exit /b 1

if not exist "%BACKEND%" (
  echo [ERROR] Backend folder not found: "%BACKEND%"
  exit /b 1
)

if not exist "%VENV%\Scripts\activate.bat" (
  echo [INFO] Creating virtual environment in backend\venv ...
  pushd "%BACKEND%"
  %PY_BIN% %PY_ARGS% -m venv venv
  if errorlevel 1 (
    popd
    echo [ERROR] Failed to create virtual environment.
    exit /b 1
  )
  popd
)

echo [INFO] Installing backend dependencies...
pushd "%BACKEND%"
"%VENV_PY%" -m pip install --upgrade pip
"%VENV_PY%" -m pip install fastapi uvicorn qdrant-client fastembed groq
if errorlevel 1 (
  popd
  echo [ERROR] Dependency installation failed.
  exit /b 1
)
popd

echo [OK] Backend setup complete.
exit /b 0

:initdb
call :resolve_python
if errorlevel 1 exit /b 1

if not exist "%VENV%\Scripts\activate.bat" (
  echo [INFO] Virtual environment not found. Running setup first...
  call :setup
  if errorlevel 1 exit /b 1
)

if not exist "%BACKEND%\init_db.py" (
  echo [ERROR] File not found: backend\init_db.py
  exit /b 1
)

echo [INFO] Initializing local Qdrant knowledge base...
pushd "%BACKEND%"
"%VENV_PY%" init_db.py
if errorlevel 1 (
  popd
  echo [ERROR] Database initialization failed.
  exit /b 1
)
popd

echo [OK] Qdrant knowledge base initialized.
exit /b 0

:backend
call :resolve_python
if errorlevel 1 exit /b 1

if not exist "%VENV%\Scripts\activate.bat" (
  echo [INFO] Virtual environment not found. Running setup first...
  call :setup
  if errorlevel 1 exit /b 1
)

if "%GROQ_API_KEY%"=="" (
  echo [WARN] GROQ_API_KEY is not set in this terminal session.
  echo [WARN] Set it before launching backend, for example:
  echo        set GROQ_API_KEY=your_key_here
  echo.
)

echo [INFO] Starting FastAPI backend on http://localhost:%PORT_BACKEND% ...
pushd "%BACKEND%"
"%VENV_UVICORN%" main:app --reload --host 0.0.0.0 --port %PORT_BACKEND%
popd
exit /b 0

:frontend
call :resolve_python
if errorlevel 1 exit /b 1

echo [INFO] Starting frontend static server on http://localhost:%PORT_FRONTEND% ...
%PY_BIN% %PY_ARGS% -m http.server %PORT_FRONTEND%
exit /b 0

:all
call :resolve_python
if errorlevel 1 exit /b 1

if not exist "%VENV%\Scripts\activate.bat" (
  echo [INFO] Virtual environment not found. Running setup first...
  call :setup
  if errorlevel 1 exit /b 1
)

echo [INFO] Launching frontend and backend in separate windows...
start "MediNexus Frontend" cmd /k "cd /d \"%ROOT%\" & %PY_BIN% %PY_ARGS% -m http.server %PORT_FRONTEND%"
start "MediNexus Backend" cmd /k "cd /d \"%BACKEND%\" & \"%VENV_UVICORN%\" main:app --reload --host 0.0.0.0 --port %PORT_BACKEND%"

echo [OK] Services started.
echo Frontend: http://localhost:%PORT_FRONTEND%/index.html
echo Backend:  http://localhost:%PORT_BACKEND%/docs
exit /b 0

:help
echo MediNexus Windows Launcher
echo.
echo Usage:
echo   run_medinexus.bat setup      - Create backend venv and install dependencies
echo   run_medinexus.bat initdb     - Build local Qdrant knowledge database
echo   run_medinexus.bat backend    - Start FastAPI backend server
echo   run_medinexus.bat frontend   - Start frontend static server
echo   run_medinexus.bat all        - Start frontend and backend in new terminal windows
echo   run_medinexus.bat help       - Show this help
exit /b 0
