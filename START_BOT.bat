@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title TCP Bridge Lab Launcher

echo.
echo ========================================
echo       TCP BRIDGE LAB - EASY START
echo ========================================
echo.

powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0scripts\easy-launch.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo The launcher could not start.
  echo Read the error above, fix it, and run this file again.
  echo.
  pause
)

exit /b %EXIT_CODE%
