@echo off
REM ===================================================================
REM  HYPIR Portable stop script
REM
REM  Tries graceful POST /api/shutdown first, then force-kills the
REM  process listening on the configured port if still up after 2s.
REM ===================================================================

setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "PORT=7865"

echo [hypir] sending graceful shutdown to http://127.0.0.1:%PORT%/api/shutdown
powershell -NoProfile -Command ^
  "try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:%PORT%/api/shutdown' -TimeoutSec 3 | Out-Null; Write-Host '[hypir] shutdown request sent' } catch { Write-Host '[hypir] graceful shutdown failed (server may already be stopped); will force-kill if needed' }"

REM give server some time to exit cleanly
timeout /t 2 /nobreak >nul

REM still listening? force-kill
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
    echo [hypir] force-killing PID %%a listening on %PORT%
    taskkill /F /PID %%a >nul 2>&1
)

echo [hypir] stopped
exit /b 0
