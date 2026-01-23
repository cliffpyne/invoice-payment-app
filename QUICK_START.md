# 🚀 Quick Start Guide

## ⚡ Get Started in 5 Minutes

### Prerequisites
- Node.js installed (v16+) - [Download here](https://nodejs.org/)
- Google service account credentials

---

## 📝 Step 1: Get Your Google Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Find your service account: `sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com`
3. Go to "Keys" tab → "Add Key" → "Create new key" → Select "JSON"
4. Download the JSON file
5. Open it and copy the `private_key` value (it looks like `-----BEGIN PRIVATE KEY-----\n...`)

---

## 🔧 Step 2: Configure the Application

1. Navigate to the `backend` folder
2. Create a file named `.env`
3. Add this content:

```
PORT=5000
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nPASTE_YOUR_KEY_HERE\n-----END PRIVATE KEY-----\n"
```

**Important:** Replace `PASTE_YOUR_KEY_HERE` with your actual private key

---

## 🎯 Step 3: Grant Sheet Access

1. Open your Google Sheet: https://docs.google.com/spreadsheets/d/1N3ZxahtaFBX0iK3cijDraDmyZM8573PVVf8D-WVqicE
2. Click "Share" button
3. Add: `sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com`
4. Set permission to "Viewer"
5. Click "Send"

---

## 🚀 Step 4: Run the Application

### Option A: Automatic Start (Recommended)

**On Mac/Linux:**
```bash
./start.sh
```

**On Windows:**
```
start.bat
```

### Option B: Manual Start

**Terminal 1 - Backend:**
```bash
cd backend
npm install
npm start
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm install
npm start
```

---

## 🌐 Step 5: Access the Application

The application will automatically open in your browser at:
**http://localhost:3000**

If it doesn't open automatically, just copy that URL into your browser.

---

## 📊 Step 6: Start Using

### View Transactions
1. Click "View Transactions" tab
2. See all payments from your Google Sheets
3. Use date filters to narrow results

### Process Invoices
1. Click "Process Invoices" tab
2. Upload your QuickBooks invoice CSV
3. Select date range for transactions
4. Click "Process Payments"
5. Download the results CSV

---

## ❓ Troubleshooting

### "Failed to fetch transactions"
- Double-check your Google private key in `.env`
- Make sure the service account has access to the sheet
- Verify the sheet ID in `backend/server.js` is correct

### "Port already in use"
- Close other applications using port 5000 or 3000
- Or change the PORT in backend/.env

### Application won't start
- Make sure Node.js is installed: `node --version`
- Delete `node_modules` folders and run `npm install` again

---

## 📚 Need More Help?

- See [README.md](README.md) for detailed documentation
- See [DEPLOYMENT.md](DEPLOYMENT.md) for production deployment
- Check the backend logs in the terminal for errors

---

## 🎉 You're Ready!

The application is now running and ready to process your invoice payments!

**What's Next?**
1. Upload your first invoice CSV
2. Select a date range
3. Process payments
4. Download the results

Happy processing! 💰
