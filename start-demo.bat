@echo off
rem ---------------------------------------------------------------
rem  Shroom SDK - double-click this file to open the browser demo.
rem  (This file is ASCII-only on purpose: cmd.exe mis-parses batch
rem   files that contain non-ASCII characters.)
rem ---------------------------------------------------------------

rem Switch to this file's own folder, so it works no matter where
rem you double-click it from.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found.
  echo   Please install Node.js 18 or newer: https://nodejs.org
  echo.
  pause
  exit /b 1
)

node start.mjs

rem Keep the window open after exit so you can read any error.
echo.
pause
