@echo off
chcp 65001 >nul
cd /d "%~dp0"
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
node "node_modules\vite\bin\vite.js" build
if errorlevel 1 pause & exit /b 1
node "node_modules\electron-builder\cli.js" --win portable
pause
