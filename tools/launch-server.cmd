@echo off
cd /d "%~dp0\.."
set "NODE_EXE=C:\Users\micro\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
start "Logistics Dashboard Server" /D "%CD%" cmd /k ""%NODE_EXE%" "%CD%\server.js""
