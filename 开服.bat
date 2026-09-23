@echo off
REM ============================================================
REM  Super Auto Pets - LAN server launcher
REM
REM  IMPORTANT: this file must stay ASCII-only.
REM  cmd.exe reads .bat files using the system ANSI codepage (GBK on a
REM  Chinese Windows), NOT UTF-8. If this file contained UTF-8 Chinese,
REM  the trailing byte of a multi-byte character would be read as the
REM  second byte of a GBK pair and EAT THE LINE BREAK - which silently
REM  merged "node server.js" into the REM comment above it, so the
REM  server never started and the window closed instantly.
REM  All user-facing Chinese text is printed by server.js instead.
REM ============================================================

chcp 65001 >nul
title Super Auto Pets - LAN Server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 echo.
if errorlevel 1 echo   [X] Node.js not found.
if errorlevel 1 echo.
if errorlevel 1 echo   LAN multiplayer needs Node.js: https://nodejs.org
if errorlevel 1 echo   Install it, then double-click this file again.
if errorlevel 1 echo.
if errorlevel 1 echo   Single-player still works: just open index.html
if errorlevel 1 echo.
if errorlevel 1 pause
if errorlevel 1 exit /b 1

node server.js %*

echo.
echo   Server stopped.
pause
