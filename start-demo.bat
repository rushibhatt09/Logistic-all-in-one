@echo off
cd /d "%~dp0"

set "NODE_EXE=C:\Users\micro\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "APP_PORT=4174"

if not exist "%NODE_EXE%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js not found. Please install from https://nodejs.org/
    pause
    exit /b 1
  )
  set "NODE_EXE=node"
)

echo.
echo  ====================================================
echo   Dermatouch DEMO  ^|  http://localhost:%APP_PORT%
echo   Original dashboard still runs on port 4173
echo  ====================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-NetTCPConnection -LocalPort %APP_PORT% -State Listen -ErrorAction SilentlyContinue; if ($c) { $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"

start "Dermatouch DEMO Server" /D "%~dp0" cmd /k "set PORT=%APP_PORT%&& echo [DEMO] Starting on port %APP_PORT%... && %NODE_EXE% server.js && pause"
timeout /t 2 >nul
start http://localhost:%APP_PORT%
