@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0\cs2-parser.exe" "%~dp0\resources\app.asar\cli.js" %*
endlocal
