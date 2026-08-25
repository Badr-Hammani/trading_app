@echo off
REM XAUUSD Command Center — double-click this file.
REM
REM Windows will not run a .ps1 by double-click, so this wrapper starts
REM PowerShell for you with the execution policy relaxed for this one run only.
REM Nothing is changed permanently on your system by this file.

setlocal

REM Run the .ps1 sitting next to this file, wherever the folder happens to be.
set "SCRIPT=%~dp0bootstrap.ps1"

if not exist "%SCRIPT%" (
    echo.
    echo   bootstrap.ps1 was not found next to this file.
    echo   Keep both files together in the same folder.
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*

endlocal
