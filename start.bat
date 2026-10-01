@echo off
cd /d "%~dp0"
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
)
if not exist "native\InputBridge.exe" (
    echo Building InputBridge...
    call npm run build:bridge
)
npm start
