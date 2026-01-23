# 🎉 COMPLETE SETUP GUIDE - Invoice Payment System

## 📥 What You're Getting

A complete full-stack application with:
- ✅ React frontend with modern UI
- ✅ Node.js/Express backend with Google Sheets integration
- ✅ Automatic invoice payment processing
- ✅ CSV import/export functionality
- ✅ Multi-channel transaction tracking (BODA, LIPA, IPHONE)
- ✅ Ready to deploy

---

## 🚀 FASTEST WAY TO GET STARTED

### 1️⃣ Extract the Files

**You have two files - choose one:**
- `invoice-payment-app.zip` (for Windows users)
- `invoice-payment-app.tar.gz` (for Mac/Linux users)

**Extract:**
```bash
# On Mac/Linux
tar -xzf invoice-payment-app.tar.gz

# On Windows
# Right-click the .zip file and select "Extract All"
```

### 2️⃣ Install Node.js (if you haven't)

Download from: https://nodejs.org/
- Choose the LTS version (Long Term Support)
- Install with default settings

### 3️⃣ Get Your Google Credentials

**CRITICAL STEP - Don't Skip This!**

1. Go to: https://console.cloud.google.com
2. Find your service account: `sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com`
3. Click on it → "Keys" tab → "Add Key" → "Create new key" → JSON
4. Download the JSON file
5. Open it with a text editor
6. Find the `private_key` field (looks like: `"-----BEGIN PRIVATE KEY-----\n...`)
7. Copy EVERYTHING including the quotes and \n characters

### 4️⃣ Configure the Backend

1. Navigate to: `invoice-payment-app/backend/`
2. Create a file named `.env` (yes, just `.env` with the dot)
3. Add this content:

```
PORT=5000
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY_GOES_HERE\n-----END PRIVATE KEY-----\n"
```

**Replace `YOUR_KEY_GOES_HERE` with the key you copied**

### 5️⃣ Share the Google Sheet

**IMPORTANT: Give access to your service account**

1. Open: https://docs.google.com/spreadsheets/d/1N3ZxahtaFBX0iK3cijDraDmyZM8573PVVf8D-WVqicE
2. Click the green "Share" button
3. Enter: `sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com`
4. Permission: "Viewer"
5. Click "Send"

### 6️⃣ Start the Application

**Choose your method:**

#### Method A: Automatic (Easiest)

**On Windows:**
```
Double-click start.bat
```

**On Mac/Linux:**
```bash
cd invoice-payment-app
chmod +x start.sh
./start.sh
```

#### Method B: Manual (If automatic doesn't work)

**Open Terminal/Command Prompt #1:**
```bash
cd invoice-payment-app/backend
npm install
npm start
```

**Open Terminal/Command Prompt #2:**
```bash
cd invoice-payment-app/frontend
npm install
npm start
```

### 7️⃣ Access the Application

Your browser should open automatically to: **http://localhost:3000**

If not, just type that address into your browser.

---

## 🎯 USING THE APPLICATION

### View Transactions

1. Click "View Transactions" tab
2. You'll see all payments from your Google Sheets
3. Use date filters to narrow results
4. See statistics by channel (BODA, LIPA, IPHONE)

### Process Invoices

1. Click "Process Invoices" tab
2. Click the upload area and select your QuickBooks CSV
3. Select start and end dates for transactions
4. Click "Process Payments"
5. Review the results:
   - Green badge = Fully Paid
   - Yellow badge = Partially Paid
   - Red badge = Unpaid
6. Click "Download CSV" to get QuickBooks-ready file

### Invoice CSV Format

Your QuickBooks export should have these columns:
- Customer (or Customer Name)
- Invoice No (or Invoice Number)
- Amount
- Invoice Date (or Date)

**Example:**
```
Customer,Invoice No,Amount,Invoice Date
JOHN JOSEPH MAKOLE,679337,12000,2025-01-15
ALLY MOHAMEDI MSHAMU,678787,12500,2025-01-16
```

We included a `sample_invoices.csv` file for testing!

---

## ❓ TROUBLESHOOTING

### "Failed to fetch transactions"

**Problem:** Can't connect to Google Sheets

**Solutions:**
1. Check your `.env` file has the correct private key
2. Make sure you shared the sheet with the service account
3. Verify the sheet ID in `backend/server.js` is correct (line 18)

### "Port already in use"

**Problem:** Another app is using port 5000 or 3000

**Solutions:**

**On Mac/Linux:**
```bash
# Kill process on port 5000
lsof -ti:5000 | xargs kill -9
```

**On Windows:**
```bash
# Find what's using port 5000
netstat -ano | findstr :5000
# Kill it (replace PID with the number you found)
taskkill /PID <PID> /F
```

Or change the PORT in `backend/.env` to something else like 5001

### Application won't start

**Problem:** Dependencies not installed

**Solution:**
```bash
# Delete everything and reinstall
cd backend
rm -rf node_modules package-lock.json
npm install

cd ../frontend
rm -rf node_modules package-lock.json
npm install
```

### Can't create .env file

**On Windows:**
- Open Notepad
- Type your config
- Save As → File name: `.env` (with quotes)
- Save as type: "All Files"

**On Mac:**
- Use TextEdit or any editor
- Make sure it's plain text (not RTF)
- Save as `.env`

### Transactions show but processing fails

**Problem:** Date format mismatch

**Solution:**
- Check your Google Sheets date format
- Should be: YYYY-MM-DD (e.g., 2025-01-22)
- Or MM-DD-YYYY (e.g., 01-22-2025)

---

## 🔐 SECURITY NOTES

- ⚠️ NEVER commit your `.env` file to git
- ⚠️ NEVER share your private key publicly
- ✅ The service account only has READ access (safe)
- ✅ All data stays on your computer unless you deploy

---

## 📁 FOLDER STRUCTURE

```
invoice-payment-app/
├── backend/              # Server code
│   ├── server.js        # Main API
│   ├── .env            # YOUR CREDENTIALS (create this)
│   └── package.json    # Dependencies
├── frontend/            # Website code
│   ├── src/            # React components
│   └── package.json    # Dependencies
├── README.md           # Full documentation
├── QUICK_START.md      # Quick guide
├── sample_invoices.csv # Test data
└── start.sh/bat        # Easy start scripts
```

---

## 🎓 LEARNING RESOURCES

**Never used Node.js before?**
- Node.js basics: https://nodejs.dev/learn
- npm commands: https://docs.npmjs.com/cli/v8/commands

**Want to customize?**
- React tutorial: https://react.dev/learn
- Express.js guide: https://expressjs.com/en/starter/installing.html

---

## 📞 NEED MORE HELP?

1. Check `README.md` for detailed docs
2. Check `DEPLOYMENT.md` for deploying to production
3. Check `PROJECT_STRUCTURE.md` to understand the code
4. Look at the sample files for examples

---

## ✅ VERIFICATION CHECKLIST

Before asking for help, verify:
- [ ] Node.js is installed (`node --version`)
- [ ] `.env` file exists in backend folder
- [ ] `.env` has your Google private key
- [ ] Service account has access to Google Sheet
- [ ] Both terminal windows show "running" or "compiled"
- [ ] You can open http://localhost:3000 in browser

---

## 🎉 SUCCESS!

If you see the Invoice Payment System interface in your browser, **you did it!** 🎊

Now you can:
1. View your transactions from Google Sheets
2. Upload invoices from QuickBooks
3. Process payments automatically
4. Export results back to QuickBooks

**Happy processing!** 💰📊

---

## 📚 Next Steps

- Read the full [README.md](README.md) for all features
- Check out [DEPLOYMENT.md](DEPLOYMENT.md) to deploy online
- Explore the code in [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)
- Customize the app for your needs

---

**Built with ❤️ for Kijichi Collection System**
