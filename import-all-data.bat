@echo off
cd /d "%~dp0"

set "NODE_EXE=C:\Users\micro\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE_EXE%" (
  echo Node runtime not found.
  pause
  exit /b 1
)

"%NODE_EXE%" tools\import-folder.js
echo.
echo Import complete. Now run restart-dashboard.bat and refresh the browser.
pause
