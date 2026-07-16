@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -X utf8 encoding_audit.py
) else (
    where py >nul 2>&1
    if not errorlevel 1 (
        py -3 -X utf8 encoding_audit.py
    ) else (
        python -X utf8 encoding_audit.py
    )
)
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
exit /b %RC%
