@echo off
rem Start an agent-hub team in the folder you are in (C67). Put this folder on PATH.
rem Usage: hub-team [npm run team arguments]   e.g. hub-team --roles leader,deployer
rem agent-hub's folder: AGENT_HUB_DIR if set, else two levels above this file.
setlocal
set "PROJ=%CD%"
set "HUB=%AGENT_HUB_DIR%"
if "%HUB%"=="" set "HUB=%~dp0..\.."
for %%A in (%*) do if /I "%%~A"=="--project" set "PROJ="
pushd "%HUB%" || exit /b 1
if defined PROJ (
  call npm run team -- %* --project "%PROJ%"
) else (
  call npm run team -- %*
)
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
