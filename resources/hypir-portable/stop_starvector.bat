@echo off
REM StarVector Portable stop (port 7867)

setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "PORT=7867"

echo [starvector] sending graceful shutdown to http://127.0.0.1:%PORT%/api/shutdown
powershell -NoProfile -Command ^
  "try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:%PORT%/api/shutdown' -TimeoutSec 3 | Out-Null; Write-Host '[starvector] shutdown request sent' } catch { Write-Host '[starvector] graceful failed; will force-kill if still up' }"

timeout /t 2 /nobreak >nul

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
    echo [starvector] force-killing PID %%a listening on %PORT%
    taskkill /F /PID %%a >nul 2>&1
)

echo [starvector] stopped
exit /b 0
