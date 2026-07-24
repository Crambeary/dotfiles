@echo off
setlocal EnableExtensions

if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" exit /b 0
if exist "%ProgramFiles%\PowerShell\7-preview\pwsh.exe" exit /b 0
if exist "%ProgramFiles(x86)%\PowerShell\7\pwsh.exe" exit /b 0
if exist "%ProgramFiles(x86)%\PowerShell\7-preview\pwsh.exe" exit /b 0
if exist "%LocalAppData%\Microsoft\WindowsApps\pwsh.exe" exit /b 0

where pwsh.exe >nul 2>nul
if not errorlevel 1 exit /b 0

where winget.exe >nul 2>nul
if errorlevel 1 (
  echo winget is required to install PowerShell 7. 1>&2
  exit /b 1
)

winget install --id Microsoft.PowerShell --source winget --accept-package-agreements --accept-source-agreements --silent
exit /b %errorlevel%