@echo off
cd /d "%~dp0"

set "NODE_EXE=C:\Users\micro\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "APP_PORT=4173"

if not exist "%NODE_EXE%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js is not installed or not available.
    echo Please install Node.js LTS from https://nodejs.org/
    pause
    exit /b 1
  )
  set "NODE_EXE=node"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-NetTCPConnection -LocalPort %APP_PORT% -State Listen -ErrorAction SilentlyContinue; if ($c) { $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"

start "Logistics Dashboard Server" /D "%~dp0" cmd /k "set PORT=%APP_PORT%&& echo Starting from %CD%&& C:\Users\micro\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe server.js && echo Server stopped. && pause"
timeout /t 2 >nul
start http://localhost:%APP_PORT%
