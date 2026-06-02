@echo off
cd /d "%~dp0"
echo 🐳 Docker Agent
echo ==============
echo.
if "%1"=="" (
  set "INPUT=Lista los contenedores activos y muestra informacion del sistema Docker"
) else (
  set "INPUT=%*"
)
npx ts-node src/index.ts "%INPUT%"
