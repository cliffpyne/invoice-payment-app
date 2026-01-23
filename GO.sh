#!/bin/bash

echo "🔥 INVOICE PAYMENT SYSTEM - ONE COMMAND SETUP & RUN"
echo "===================================================="
echo ""

# Install backend if needed
if [ ! -d "backend/node_modules" ]; then
    echo "📦 Installing backend dependencies..."
    cd backend && npm install --legacy-peer-deps && cd .. || exit 1
    echo "✅ Backend installed"
else
    echo "✅ Backend already installed"
fi

# Install frontend if needed
if [ ! -d "frontend/node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    cd frontend && npm install --legacy-peer-deps && cd .. || exit 1
    echo "✅ Frontend installed"
else
    echo "✅ Frontend already installed"
fi

echo ""
echo "🚀 STARTING APPLICATION..."
echo ""

# Start backend
cd backend
node server.js &
BACKEND_PID=$!
cd ..

sleep 3

# Start frontend
cd frontend
PORT=3000 npm start &
FRONTEND_PID=$!
cd ..

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ APPLICATION IS RUNNING!"
echo ""
echo "🌐 Open in browser: http://localhost:3000"
echo ""
echo "Backend:  http://localhost:5000 (PID: $BACKEND_PID)"
echo "Frontend: http://localhost:3000 (PID: $FRONTEND_PID)"
echo ""
echo "⚠️  IMPORTANT: Make sure backend/.env has your Google key!"
echo ""
echo "Press Ctrl+C to stop"
echo "═══════════════════════════════════════════════════════════"

# Cleanup function
cleanup() {
    echo ""
    echo "🛑 Stopping..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    pkill -f "node server.js" 2>/dev/null
    pkill -f "react-scripts" 2>/dev/null
    echo "✅ Stopped"
    exit 0
}

trap cleanup SIGINT SIGTERM
wait
