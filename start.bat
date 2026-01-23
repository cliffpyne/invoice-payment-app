@echo off
echo 🚀 Starting Invoice Payment System...
echo.

REM Check if backend node_modules exist
if not exist "backend\node_modules" (
    echo 📦 Installing backend dependencies...
    cd backend
    call npm install
    cd ..
)

REM Check if frontend node_modules exist
if not exist "frontend\node_modules" (
    echo 📦 Installing frontend dependencies...
    cd frontend
    call npm install
    cd ..
)

REM Check if .env exists
if not exist "backend\.env" (
    echo ⚠️  WARNING: backend\.env file not found!
    echo Please create backend\.env file with your Google credentials
    echo See backend\.env.example for reference
    pause
    exit /b 1
)

echo ✅ Dependencies installed
echo.
echo 🔧 Starting services...
echo.
echo Backend will run on: http://localhost:5000
echo Frontend will run on: http://localhost:3000
echo.
echo Press Ctrl+C to stop both services
echo.

REM Start backend
start cmd /k "cd backend && npm start"

REM Wait a bit for backend to start
timeout /t 3 /nobreak > nul

REM Start frontend
start cmd /k "cd frontend && npm start"

echo.
echo ✅ Both services are starting in separate windows
echo Close those windows to stop the services
pause
