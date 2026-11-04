@echo off
chcp 65001 >nul
title 续禾杀 测试服务器（关掉这个窗口游戏就停了）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0share.ps1"
echo.
pause
