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
    where py >nul 2>&1
    if not errorlevel 1 (
        py -3 -m venv "%VENV_DIR%"
    ) else (
        where python >nul 2>&1
        if errorlevel 1 (
            echo [ERROR] Python 3.11 or newer was not found.
            pause
            exit /b 1
        )
        python -m venv "%VENV_DIR%"
    )
    if errorlevel 1 exit /b 1
)

"%VENV_PYTHON%" -X utf8 -m pip install --disable-pip-version-check --upgrade pip
if errorlevel 1 exit /b 1
"%VENV_PYTHON%" -X utf8 -m pip install --disable-pip-version-check -r "%ROOT_DIR%\requirements.txt"
if errorlevel 1 exit /b 1
"%VENV_PYTHON%" -X utf8 "%ROOT_DIR%\check_environment.py"
if errorlevel 1 exit /b 1
"%VENV_PYTHON%" -X utf8 "%ROOT_DIR%\encoding_audit.py"
if errorlevel 1 exit /b 1

echo Python dependencies were installed in: %VENV_DIR%
pause
