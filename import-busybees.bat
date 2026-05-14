@echo off
cd /d "%~dp0"

set "NODE_EXE=C:\Users\micro\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if "%~1"=="" (
  echo Drag your Busybees CSV file onto this import-busybees.bat file.
  echo Or run: import-busybees.bat "C:\path\to\file.csv"
  pause
  exit /b 1
)

"%NODE_EXE%" tools\import-busybees-file.js "%~1"
echo.
echo Import finished. Restart dashboard and refresh browser.
pause
