@echo off
chcp 65001 >nul
title Super Auto Pets - 局域网联机服务器
cd /d "%~dp0"

echo.
echo   ============================================
echo     Super Auto Pets - 局域网联机
echo   ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] 没有找到 Node.js
  echo.
  echo   联机功能需要 Node.js。请到 https://nodejs.org 下载安装
  echo   安装后重新双击本文件即可。
  echo.
  echo   ^(不装也能玩：直接双击 index.html 就是单机模式^)
  echo.
  pause
  exit /b 1
)

REM 启动服务器（默认端口 8000）。窗口别关，关了大家就掉线。
node server.js %*

echo.
echo   服务器已停止。
pause
