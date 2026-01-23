#!/bin/bash

echo "🚀 Starting Invoice Payment System..."
echo ""

# Check if .env exists and has been configured
if ! grep -q "BEGIN PRIVATE KEY" backend/.env || grep -q "YOUR_KEY_HERE" backend/.env || grep -q "REPLACE_THIS" backend/.env; then
    echo "⚠️  WARNING: backend/.env may not be configured properly!"
    echo ""
    echo "Please edit backend/.env and add your Google service account private key"
    echo "Get it from: https://console.cloud.google.com"
    echo ""
    read -p "Press Enter if you've already configured it, or Ctrl+C to exit and configure..."
fi

# Check if node_modules exist
if [ ! -d "backend/node_modules" ]; then
    echo "❌ Backend dependencies not installed!"
    echo "Run: ./setup.sh first"
    exit 1
fi

if [ ! -d "frontend/node_modules" ]; then
    echo "❌ Frontend dependencies not installed!"
    echo "Run: ./setup.sh first"
    exit 1
fi

echo "✅ Starting backend on port 5000..."
cd backend
node server.js &
BACKEND_PID=$!
cd ..

echo "⏳ Waiting for backend to start..."
sleep 3

echo "✅ Starting frontend on port 3000..."
cd frontend
npm start &
FRONTEND_PID=$!
cd ..

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ Application is starting!"
echo ""
echo "Backend:  http://localhost:5000"
echo "Frontend: http://localhost:3000"
echo ""
echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo ""
echo "Press Ctrl+C to stop both services"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Stopping services..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    # Kill any remaining node processes
    pkill -f "node server.js" 2>/dev/null
    pkill -f "react-scripts" 2>/dev/null
    echo "✅ Services stopped"
    exit 0
}

# Set trap to cleanup on Ctrl+C
trap cleanup SIGINT SIGTERM

# Wait for user to stop
wait
