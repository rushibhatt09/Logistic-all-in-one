@echo off
cd /d "%~dp0"

set "NODE_EXE=C:\Users\micro\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "APP_PORT=4173"

echo Closing old dashboard server...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"

timeout /t 1 >nul

if not exist "%NODE_EXE%" (
  echo Node.js runtime was not found.
  pause
  exit /b 1
)

echo Starting dashboard on http://localhost:%APP_PORT%
start "Logistics Dashboard Server" /D "%~dp0" cmd /k "set PORT=%APP_PORT%&& echo Starting from %CD%&& C:\Users\micro\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe server.js && echo Server stopped. && pause"
timeout /t 2 >nul
start http://localhost:%APP_PORT%
