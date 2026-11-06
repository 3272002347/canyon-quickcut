@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "dist\index.html" (
  if not exist "node_modules\vite\bin\vite.js" (
    echo 缺少运行文件，请使用打包后的便携版，或重新安装依赖。
    pause
    exit /b 1
  )
  node "node_modules\vite\bin\vite.js" build
  if errorlevel 1 pause & exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo 缺少 Electron 运行程序，请重新安装依赖。
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" "%~dp0"
exit /b 0
