@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instala Node 22 o posterior para actualizar AdStop
  exit /b 1
)
call npm.cmd ci --no-audit --no-fund
if errorlevel 1 exit /b 1
call npm.cmd run filters:update
if errorlevel 1 exit /b 1
call npm.cmd test
if errorlevel 1 exit /b 1
call npm.cmd run build
if errorlevel 1 exit /b 1
call npm.cmd run package
if errorlevel 1 exit /b 1
echo AdStop actualizado. Recarga la extension desde la pagina de extensiones del navegador
