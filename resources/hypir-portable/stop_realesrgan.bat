@echo off
REM Real-ESRGAN PyTorch Portable stop (port 7869)

setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "PORT=7869"

echo [realesrgan] sending graceful shutdown
powershell -NoProfile -Command ^
  "try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:%PORT%/api/shutdown' -TimeoutSec 3 | Out-Null; Write-Host '[realesrgan] shutdown request sent' } catch { Write-Host '[realesrgan] graceful failed; force-killing' }"

timeout /t 2 /nobreak >nul

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
    echo [realesrgan] force-killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo [realesrgan] stopped
exit /b 0
