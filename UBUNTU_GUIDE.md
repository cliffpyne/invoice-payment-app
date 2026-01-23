# 🚀 UBUNTU - READY TO RUN!

Brother! Here's exactly what to do on your Ubuntu machine:

## 🎯 FASTEST WAY (1 Command)

```bash
cd invoice-payment-app
./GO.sh
```

That's it! It will install everything and start the app!

---

## 📝 Step-by-Step (If You Want Control)

### Step 1: Download the app
You already have it! Just extract it.

### Step 2: Add Your Google Key

```bash
cd invoice-payment-app
nano backend/.env
```

Replace `YOUR_KEY_HERE` with your actual Google service account private key.

**How to get the key:**
1. Go to: https://console.cloud.google.com
2. Find service account: `sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com`
3. Keys tab → Add Key → Create new key → JSON
4. Download and open the JSON file
5. Copy the `private_key` value (everything including quotes and \n)

**Your .env should look like:**
```
PORT=5000
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhki...(your key here)...==\n-----END PRIVATE KEY-----\n"
```

Save with `Ctrl+X`, then `Y`, then `Enter`

### Step 3: Give Sheet Access

1. Open your sheet: https://docs.google.com/spreadsheets/d/1N3ZxahtaFBX0iK3cijDraDmyZM8573PVVf8D-WVqicE
2. Click "Share"
3. Add: `sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com`
4. Permission: "Viewer"
5. Send

### Step 4: Run Setup (Installs Everything)

```bash
./setup.sh
```

This installs all Node.js packages for backend and frontend.

### Step 5: Start the App

```bash
./run.sh
```

Or just use:
```bash
./GO.sh
```

---

## 🌐 Access Your App

Open browser and go to: **http://localhost:3000**

The app will open automatically in most cases!

---

## 🎮 Available Scripts

```bash
./GO.sh        # One command - installs + runs everything
./setup.sh     # Just install dependencies
./run.sh       # Just run (after setup)
./start.sh     # Alternative run script
```

---

## ⚡ Quick Commands Reference

```bash
# Stop the app (if running in background)
pkill -f "node server.js"
pkill -f "react-scripts"

# Check if it's running
ps aux | grep node

# Check what's using port 3000
lsof -i :3000

# Check what's using port 5000
lsof -i :5000

# View backend logs
cd backend && node server.js

# View frontend logs  
cd frontend && npm start
```

---

## 📊 Using the App

### View Transactions
1. Click "View Transactions" tab
2. See all your payments from Google Sheets
3. Filter by date range

### Process Invoices
1. Click "Process Invoices" tab
2. Upload your QuickBooks CSV
3. Select date range
4. Click "Process Payments"
5. Download the results

### Test with Sample Data
Use the included `sample_invoices.csv` file to test!

---

## ❓ Troubleshooting

### "Failed to fetch transactions"
```bash
# Check your .env file
cat backend/.env

# Make sure it has your real Google key
# Make sure service account has access to the sheet
```

### Port Already in Use
```bash
# Kill process on port 5000
lsof -ti:5000 | xargs kill -9

# Kill process on port 3000
lsof -ti:3000 | xargs kill -9
```

### Dependencies Won't Install
```bash
# Clear npm cache
npm cache clean --force

# Remove node_modules
rm -rf backend/node_modules frontend/node_modules

# Run setup again
./setup.sh
```

### Can't Access the App
```bash
# Check if backend is running
curl http://localhost:5000/api/transactions

# Check if frontend is running
curl http://localhost:3000
```

---

## 📁 Project Structure

```
invoice-payment-app/
├── GO.sh              # 🔥 ONE COMMAND TO RULE THEM ALL
├── setup.sh           # Install dependencies
├── run.sh             # Start the app
├── backend/           # Node.js API
│   ├── server.js      # Main server
│   ├── .env          # YOUR GOOGLE KEY HERE
│   └── package.json   # Dependencies
├── frontend/          # React UI
│   ├── src/          # Components
│   └── package.json   # Dependencies
└── sample_invoices.csv # Test data
```

---

## 🎯 What Each File Does

- **server.js** - Connects to Google Sheets, processes payments
- **.env** - Your Google credentials (KEEP SECRET!)
- **TransactionsView.js** - Shows all transactions
- **InvoiceProcessor.js** - Processes invoice payments

---

## 🔐 Security

- Never share your .env file
- Never commit .env to git
- Service account only has READ access to sheets (safe)
- All processing happens locally on your machine

---

## 💡 Pro Tips

1. **Bookmark** http://localhost:3000 in your browser
2. **Keep terminal open** to see logs
3. **Use sample_invoices.csv** to test first
4. **Check console (F12)** in browser if errors

---

## ✅ Verification Checklist

Before starting:
- [ ] Node.js installed (`node --version`)
- [ ] backend/.env file exists
- [ ] backend/.env has real Google key
- [ ] Service account has access to Google Sheet
- [ ] Ports 3000 and 5000 are free

After starting:
- [ ] Backend shows "Server running on port 5000"
- [ ] Frontend opens in browser
- [ ] Can see transactions in "View Transactions" tab
- [ ] Can upload and process invoices

---

## 🎉 YOU'RE READY BROTHER!

Just run:
```bash
./GO.sh
```

And start processing those invoices! 💰🔥

---

**Need help?** Check the other documentation files:
- SETUP_GUIDE.md - Detailed setup
- ARCHITECTURE.md - How it works
- DEPLOYMENT.md - Deploy to production
