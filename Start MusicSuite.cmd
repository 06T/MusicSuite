@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 or newer, then run this launcher again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm install
  if errorlevel 1 goto failure
)
node -e "if (Number(process.versions.node.split('.')[0]) < 24) { console.error('MusicSuite needs Node.js 24 or newer.'); process.exit(1); }"
if errorlevel 1 goto failure
call npm run build
if errorlevel 1 goto failure
node scripts/launch.mjs
if errorlevel 1 goto failure
exit /b 0
:failure
echo MusicSuite could not start. See the error above.
pause
exit /b 1
