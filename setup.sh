#!/bin/bash

echo "🚀 INVOICE PAYMENT SYSTEM - QUICK SETUP"
echo "========================================"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the invoice-payment-app directory"
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed!"
    echo "Install it with: sudo apt install nodejs npm"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo "✅ npm version: $(npm --version)"
echo ""

# Check if .env exists
if [ ! -f "backend/.env" ]; then
    echo "⚠️  WARNING: backend/.env file not found!"
    echo "Creating .env file with placeholder..."
    cp backend/.env.example backend/.env 2>/dev/null || cat > backend/.env << 'EOF'
PORT=5000
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY_HERE\n-----END PRIVATE KEY-----\n"
EOF
    echo ""
    echo "📝 IMPORTANT: Edit backend/.env and add your Google private key!"
    echo ""
    read -p "Press Enter to continue..."
fi

echo "📦 Installing backend dependencies..."
cd backend
npm install --legacy-peer-deps
if [ $? -ne 0 ]; then
    echo "❌ Backend installation failed!"
    exit 1
fi
cd ..
echo "✅ Backend dependencies installed"
echo ""

echo "📦 Installing frontend dependencies..."
cd frontend
npm install --legacy-peer-deps
if [ $? -ne 0 ]; then
    echo "❌ Frontend installation failed!"
    exit 1
fi
cd ..
echo "✅ Frontend dependencies installed"
echo ""

echo "✅ Setup complete!"
echo ""
echo "To start the application:"
echo "  1. Make sure backend/.env has your Google private key"
echo "  2. Run: ./run.sh"
echo ""
