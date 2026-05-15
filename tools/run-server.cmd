@echo off
cd /d "%~dp0\.."
set "PORT=4173"
"C:\Users\micro\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
