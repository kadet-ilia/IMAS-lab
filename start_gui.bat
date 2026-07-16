@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
set "ROOT_DIR=%CD%"
set "VENV_DIR=%ROOT_DIR%\.venv"
set "VENV_PYTHON=%VENV_DIR%\Scripts\python.exe"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

if not exist "%VENV_PYTHON%" (
    echo [IMAS] Creating an isolated Python environment...
    where py >nul 2>&1
    if not errorlevel 1 (
        py -3 -m venv "%VENV_DIR%"
    ) else (
        where python >nul 2>&1
        if errorlevel 1 (
            echo [ERROR] Python 3.11 or newer was not found.
            echo Install Python and enable the Add Python to PATH option.
            pause
            exit /b 1
        )
        python -m venv "%VENV_DIR%"
    )
    if errorlevel 1 (
        echo [ERROR] Failed to create the .venv environment.
        pause
        exit /b 1
    )
)

echo [IMAS] Checking and installing Python dependencies...
"%VENV_PYTHON%" -X utf8 -m pip install --disable-pip-version-check --upgrade pip
if errorlevel 1 goto :python_error
"%VENV_PYTHON%" -X utf8 -m pip install --disable-pip-version-check -r "%ROOT_DIR%\requirements.txt"
if errorlevel 1 goto :python_error
"%VENV_PYTHON%" -X utf8 "%ROOT_DIR%\check_environment.py"
if errorlevel 1 goto :python_error
"%VENV_PYTHON%" -X utf8 "%ROOT_DIR%\encoding_audit.py"
if errorlevel 1 goto :encoding_error

set "PYTHON=%VENV_PYTHON%"

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm was not found. Install Node.js 20.19 or newer.
    pause
    exit /b 1
)

cd /d "%ROOT_DIR%\gui"
if not exist node_modules (
    echo [IMAS] Installing interface dependencies...
    call npm ci
    if errorlevel 1 goto :node_error
)

echo [IMAS] Building the interface...
call npm run build
if errorlevel 1 goto :node_error

echo [IMAS] Starting: http://127.0.0.1:4173
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:4173"
call npm start
exit /b %errorlevel%

:python_error
echo.
echo [ERROR] Failed to prepare Python dependencies.
echo Check the network connection and run start_gui.bat again.
echo Diagnostic command: "%VENV_PYTHON%" -X utf8 "%ROOT_DIR%\check_environment.py"
pause
exit /b 1

:encoding_error
echo.
echo [ERROR] The project encoding audit failed.
echo Diagnostic command: "%VENV_PYTHON%" -X utf8 "%ROOT_DIR%\encoding_audit.py"
pause
exit /b 1

:node_error
echo.
echo [ERROR] Failed to install or build Node.js dependencies.
pause
exit /b 1
