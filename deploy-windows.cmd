@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 이상을 먼저 설치한 후 다시 실행해 주세요.
  pause
  exit /b 1
)
call npm install
if errorlevel 1 goto error
call npm run check
if errorlevel 1 goto error
call npm test
if errorlevel 1 goto error
call npm run setup
if errorlevel 1 goto error
pause
exit /b 0
:error
echo 오류가 발생했습니다. 위 내용을 확인해 주세요.
pause
exit /b 1
