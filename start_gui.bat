@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
where npm >nul 2>&1
if errorlevel 1 (
 echo [ERROR] Install Node.js 22 or later.
 pause
 exit /b 1
)
cd gui
if not exist node_modules (
 echo [IMAS_LaB_test] Installing JS dependencies...
 call npm ci
 if errorlevel 1 exit /b 1
)
echo [IMAS_LaB_test] Browser-only. No Python or remote server.
echo Open http://127.0.0.1:5173
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:5173"
call npm start
