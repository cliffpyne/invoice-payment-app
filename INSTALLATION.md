# 🎯 ONE-COMMAND INSTALLATION

## For Developers

If you have Node.js installed and want to get started immediately:

### Install Everything at Once

```bash
npm run install:all
```

This will install dependencies for both backend and frontend.

### Start Everything at Once

```bash
npm start
```

This will start both backend and frontend servers simultaneously.

---

## Manual Step-by-Step (If Above Doesn't Work)

### Step 1: Install Backend
```bash
cd backend
npm install
```

### Step 2: Install Frontend
```bash
cd frontend
npm install
```

### Step 3: Setup Environment
```bash
cd backend
cp .env.example .env
nano .env  # or use any text editor to add your Google key
```

### Step 4: Start Backend (Terminal 1)
```bash
cd backend
npm start
```

### Step 5: Start Frontend (Terminal 2)
```bash
cd frontend
npm start
```

---

## ✅ Verification

After starting both servers, you should see:

**Backend (Terminal 1):**
```
Server running on port 5000
```

**Frontend (Terminal 2):**
```
Compiled successfully!

You can now view the app in the browser.

  Local:            http://localhost:3000
```

---

## 🌐 Access the App

Open your browser and go to: **http://localhost:3000**

You should see the Invoice Payment System interface.

---

## 🐛 If Something Goes Wrong

### Port Already in Use
If you see "Port 5000 already in use":
```bash
# On Mac/Linux
lsof -ti:5000 | xargs kill -9

# On Windows
netstat -ano | findstr :5000
taskkill /PID <PID_NUMBER> /F
```

### Dependencies Won't Install
```bash
# Clear npm cache
npm cache clean --force

# Try again
npm install
```

### Can't Find Module
```bash
# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

---

## 📦 What Gets Installed

### Backend Dependencies (~50MB)
- express (web server)
- googleapis (Google Sheets access)
- cors (cross-origin support)
- multer (file uploads)
- papaparse (CSV processing)

### Frontend Dependencies (~200MB)
- react (UI framework)
- react-scripts (development tools)
- axios (API calls)

**Total Space Required:** ~250MB

---

## ⚡ Quick Commands Reference

```bash
# Install everything
npm run install:all

# Start both servers
npm start

# Start backend only
npm run start:backend

# Start frontend only
npm run start:frontend

# Build frontend for production
npm run build
```

---

## 🚀 Ready to Deploy?

See [DEPLOYMENT.md](DEPLOYMENT.md) for production deployment instructions.
