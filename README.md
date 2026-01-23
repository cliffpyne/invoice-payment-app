# 📊 Invoice Payment System

Automated payment reconciliation system for credit operations. This application fetches payment transactions from Google Sheets and processes invoice payments automatically.

## 🎯 Features

- **Multi-Channel Transaction Tracking**: Fetches payments from three channels (BODA, LIPA, IPHONE)
- **Google Sheets Integration**: Automatically syncs with your SMS payment tracking sheets
- **Invoice Processing**: Upload QuickBooks invoices and automatically match with payments
- **Smart Payment Allocation**: Groups invoices by customer and allocates payments in chronological order
- **Export to CSV**: Download processed payments in QuickBooks-compatible format
- **Real-time Dashboard**: View transaction statistics and payment status

## 🏗️ Architecture

### Backend (Node.js + Express)
- RESTful API for transaction and invoice management
- Google Sheets API integration
- CSV parsing and generation
- Smart payment matching algorithm

### Frontend (React)
- Modern, responsive UI
- Real-time transaction viewing with filtering
- Invoice upload and processing
- Payment results visualization

## 📋 Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Google Cloud service account with Sheets API access
- Access to the Google Sheets with payment data

## 🚀 Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd invoice-payment-app
```

### 2. Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file in the backend directory:

```env
PORT=5000
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
```

**Getting the Google Private Key:**

1. Go to Google Cloud Console (https://console.cloud.google.com)
2. Navigate to your project
3. Go to "IAM & Admin" > "Service Accounts"
4. Find the service account: `sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com`
5. Click on it and go to "Keys" tab
6. Click "Add Key" > "Create new key" > "JSON"
7. Download the JSON file
8. Copy the `private_key` value from the JSON file into your `.env` file

**Grant Sheet Access:**

Make sure the service account email has access to your Google Sheet:
1. Open your Google Sheet
2. Click "Share"
3. Add: `sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com`
4. Give "Viewer" permissions

### 3. Frontend Setup

```bash
cd ../frontend
npm install
```

### 4. Start the Application

**Terminal 1 - Backend:**
```bash
cd backend
npm start
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm start
```

The application will open at `http://localhost:3000`

## 📊 Google Sheets Structure

Your Google Sheets should have these tabs:

### DEV-BODA_LEDGER (BODA Channel)
Columns: ID | CHANNEL | RECEIVED DATE | TRANSACTION MESSAGE | SENDER CONTACTS | CONTRACT NAME | AMOUNT | TRANSACTION ID

### DEV-IPHONE_MIXX (IPHONE Channel)
Columns: ID | CHANNEL | RECEIVED DATE | TRANSACTION MESSAGE | SENDER CONTACTS | CONTRACT NAME | AMOUNT | TRANSACTION ID

### DEV-LIPA_MIXX (LIPA Channel)
Columns: ID | CHANNEL | RECEIVED DATE | TRANSACTION MESSAGE | SENDER CONTACTS | CONTRACT NAME | AMOUNT | TRANSACTION ID

## 💼 Usage

### Viewing Transactions

1. Navigate to the "View Transactions" tab
2. See all transactions from all channels
3. Use date filters to narrow down results
4. View statistics by channel

### Processing Invoices

1. Navigate to the "Process Invoices" tab
2. Click "Upload Invoices" and select your QuickBooks CSV file
3. Select the date range for transactions to use
4. Click "Process Payments"
5. Review the results showing:
   - Fully paid invoices
   - Partially paid invoices
   - Unpaid invoices
6. Click "Download CSV" to export for QuickBooks

### Invoice CSV Format

Your invoice CSV should have these columns:
- Customer (or Customer Name)
- Invoice No (or Invoice Number)
- Amount
- Invoice Date (or Date)

### Output Format

The processed payments CSV will have:
- Payment Date
- Customer
- Payment Method: Cash
- Deposit To Account Name: Kijichi Collection AC
- Invoice No
- Journal No (empty)
- Invoice Amount
- Amount (paid amount)
- Reference No (empty)
- Memo (Transaction ID)
- Country Code (empty)
- Exchange Rate (empty)

## 🔧 API Endpoints

### GET /api/transactions
Fetch all transactions from all channels

### POST /api/transactions/filter
Filter transactions by date range
```json
{
  "startDate": "2025-01-01",
  "endDate": "2025-01-31"
}
```

### POST /api/invoices/upload
Upload invoice CSV file (multipart/form-data)

### POST /api/process-payments
Process invoice payments
```json
{
  "invoices": [...],
  "startDate": "2025-01-01",
  "endDate": "2025-01-31"
}
```

### POST /api/export-payments
Export processed payments to CSV

## 🧮 Payment Logic

The system processes payments using this algorithm:

1. **Group**: Invoices are grouped by customer (matching by phone number or name)
2. **Sort**: Within each customer, invoices are sorted by:
   - Invoice date (ascending)
   - Invoice number (ascending) if dates are the same
3. **Allocate**: Customer transactions in the date range are summed and allocated:
   - First invoice gets paid completely if funds available
   - Remaining funds go to second invoice
   - Continue until all funds are allocated
4. **Record**: Each invoice records the amount paid (full, partial, or zero)

## 🐛 Troubleshooting

### "Failed to fetch transactions"
- Check that your `.env` file has the correct `GOOGLE_PRIVATE_KEY`
- Verify the service account has access to the Google Sheet
- Ensure the sheet ID in `server.js` is correct

### "No transactions found"
- Verify your Google Sheets tabs are named correctly:
  - `DEV-BODA_LEDGER`
  - `DEV-IPHONE_MIXX`
  - `DEV-LIPA_MIXX`
- Check that your sheets have data starting from row 2

### Payment matching issues
- Ensure customer phone numbers are consistent between invoices and transactions
- Check that transaction dates are in a parseable format
- Verify amounts are numeric

## 🔒 Security Notes

- Never commit your `.env` file to version control
- Keep your Google service account key secure
- Use environment variables for all sensitive data
- The service account should have read-only access to sheets

## 📞 Support

For issues or questions, contact your system administrator.

## 📄 License

Private - Internal Use Only

---

Built with ❤️ for Kijichi Collection System
