# 📖 Complete User Guide - Invoice Payment System

## 🎯 What This System Does

This system **automatically matches customer payments to their invoices** by:
1. Fetching payment transactions from your Google Sheets
2. Uploading invoices from QuickBooks
3. Intelligently allocating payments to invoices
4. Generating a CSV ready for QuickBooks import

---
/
## 🧮 Payment Matching Logic (How It Works)

### Step-by-Step Process:

**STEP 1: Group Invoices by Customer**
```
Customer A has:
  - Invoice #001: TZS 50,000 (Date: Jan 10)
  - Invoice #002: TZS 30,000 (Date: Jan 12)

Customer B has:
  - Invoice #003: TZS 70,000 (Date: Jan 11)
```

**STEP 2: Sort Each Customer's Invoices**
- First by date (oldest first)
- Then by invoice number if dates are same

```
Customer A's sorted invoices:
  1. Invoice #001 (Jan 10) - Pay this FIRST
  2. Invoice #002 (Jan 12) - Pay this SECOND
```

**STEP 3: Find Customer's Payments**
```
Customer A received:
  - TZS 20,000 on Jan 11
  - TZS 40,000 on Jan 13
  TOTAL AVAILABLE: TZS 60,000
```

**STEP 4: Allocate Payments**
```
Available: TZS 60,000

Invoice #001 needs TZS 50,000:
  ✅ FULLY PAID: TZS 50,000
  Remaining: TZS 10,000

Invoice #002 needs TZS 30,000:
  ⚠️ PARTIALLY PAID: TZS 10,000
  Still Owed: TZS 20,000
```

### 🎯 Key Matching Rules:

1. **Customer Identification:**
   - System matches by phone number (best)
   - Falls back to customer name (case-insensitive)
   - **Important:** Names must match between invoices and transactions!

2. **Date Range:**
   - Only transactions within your selected date range are used
   - This lets you process specific periods (e.g., "last week's payments")

3. **Sequential Payment:**
   - Always pays oldest invoice first
   - Newer invoices only get paid if money remains
   - NO invoice gets money until previous ones are satisfied

4. **Partial Payments:**
   - If money runs out mid-invoice, that invoice is marked "Partially Paid"
   - You'll see exactly how much was paid vs. how much is still owed

---

## 📄 Invoice CSV Format (CRITICAL!)

### Required Columns:

Your CSV **MUST** have these exact column names (case-sensitive):

| Column Name | Alternative | Example | Notes |
|-------------|-------------|---------|-------|
| `Customer` | `Customer Name` | JOHN JOSEPH MAKOLE | Full customer name |
| `Invoice No` | `Invoice Number` | 679337 | Unique invoice ID |
| `Amount` | - | 12000 | Invoice amount (no currency symbol) |
| `Invoice Date` | `Date` | 2025-01-15 | Format: YYYY-MM-DD or MM-DD-YYYY |

### ✅ CORRECT Format Example:

```csv
Customer,Invoice No,Amount,Invoice Date
JOHN JOSEPH MAKOLE,679337,12000,2025-01-15
ALLY MOHAMEDI MSHAMU,678787,12500,2025-01-16
ROGERS PETER CHACHA,679390,12500,2025-01-16
```

### ❌ WRONG Format Examples:

```csv
Name,InvoiceNumber,Price,Date  ← Wrong column names!
```

```csv
Customer,Invoice No,Amount,Invoice Date
John,679337,"TZS 12,000",15-Jan-2025  ← Has currency symbol!
```

### 📥 Download Template

Click the **"Download Template CSV"** button in the app to get a correctly formatted example!

---

## 📊 Google Sheets Structure

Your transactions come from 3 Google Sheets tabs:

### DEV-BODA_LEDGER (Boda Channel)
- Receives: M-PESA + MIXX BY YAS
- Contains motorcycle loan payments

### DEV-IPHONE_MIXX (iPhone Channel)
- Receives: MIXX BY YAS only
- iPhone device transactions

### DEV-LIPA_MIXX (Lipa Channel)
- Receives: MIXX BY YAS only
- Lipa number transactions

### Expected Sheet Columns:
```
Column A: ID (auto-numbered)
Column B: CHANNEL (M-PESA or MIXX BY YAS)
Column C: RECEIVED DATE
Column D: TRANSACTION MESSAGE
Column E: SENDER CONTACTS (phone number)
Column F: CONTRACT NAME (customer name)
Column G: AMOUNT
Column H: TRANSACTION ID
```

**The system reads from row 2 onwards** (row 1 is headers)

---

## 🎨 Using the Application

### Tab 1: View Transactions

**Features:**
- 📊 **Statistics Dashboard:** See total transactions, amounts by channel
- 📅 **Date Filtering:** Select date range to view specific period
- 🔽 **Sortable Columns:** Click any column header to sort
  - First click: Sort ascending (A→Z, 0→9, Old→New)
  - Second click: Sort descending (Z→A, 9→0, New→Old)
  - Arrow shows current sort direction (↑ ascending, ↓ descending)
- 💬 **Expandable Messages:** Click transaction message to expand/collapse
- 🔄 **Reset Filter:** Clear date filters to see all transactions

**Use Cases:**
- Check if a specific payment came through
- Verify transaction amounts
- Find transactions by date
- Sort by amount to find large payments
- Review transaction messages for details

### Tab 2: Process Invoices

**Step-by-Step:**

1. **Read the Payment Logic** (blue box at top)
   - Understand how the system works

2. **Review Format Guide** (click "Show Invoice Format Guide")
   - See required CSV structure
   - Download template if needed

3. **Upload Your Invoice CSV**
   - Click the upload area
   - Select your QuickBooks export
   - System validates and shows invoice count

4. **Select Transaction Date Range**
   - Start Date: Beginning of period
   - End Date: End of period
   - Only transactions in this range will be used for payment

5. **Click "Process Payments"**
   - System fetches transactions
   - Matches customers
   - Allocates payments
   - Shows results

6. **Review Results**
   - ✅ Green badge: Fully Paid
   - ⚠️ Yellow badge: Partially Paid
   - ❌ Red badge: Unpaid
   - See exact amounts paid vs. owed

7. **Download CSV**
   - Click "Download CSV"
   - Import into QuickBooks
   - File name: `processed_payments_YYYY-MM-DD.csv`

---

## 📤 Output CSV Format

The exported CSV has these columns ready for QuickBooks:

| Column | Content | Example |
|--------|---------|---------|
| Payment Date | From transaction | 2025-01-15 |
| Customer | From invoice | JOHN JOSEPH MAKOLE |
| Payment Method | Always "Cash" | Cash |
| Deposit To Account Name | Always "Kijichi Collection AC" | Kijichi Collection AC |
| Invoice No | From invoice | 679337 |
| Journal No | Empty | (blank) |
| Invoice Amount | Original invoice amount | 12000 |
| Amount | Amount actually paid | 12000 or less |
| Reference No | Empty | (blank) |
| Memo | Transaction ID | CLP3LX7D3011 |
| Country Code | Empty | (blank) |
| Exchange Rate | Empty | (blank) |

---

## 💡 Pro Tips

### For Best Results:

1. **Consistent Customer Names**
   - Use EXACT same names in invoices and Google Sheets
   - "JOHN DOE" ≠ "John Doe" ≠ "J. Doe"
   - System is case-insensitive but spelling must match

2. **Include Phone Numbers**
   - Phone matching is more reliable than name matching
   - Ensure transactions have phone numbers in "SENDER CONTACTS"

3. **Date Range Selection**
   - Choose specific periods (e.g., one week, one month)
   - Don't use huge date ranges unless necessary
   - This prevents accidentally allocating future payments to old invoices

4. **Regular Processing**
   - Process invoices weekly or bi-weekly
   - Don't let unpaid invoices accumulate
   - Easier to track and manage

5. **Verify Before QuickBooks**
   - Always review the results table
   - Check that amounts make sense
   - Verify customer names match
   - Download and spot-check the CSV

### Common Issues:

**Problem:** "No transactions found"
- **Solution:** Check date range, verify Google Sheets has data

**Problem:** "Customer has no payments"
- **Solution:** Check customer name spelling, verify phone number

**Problem:** "Invoice partially paid but should be full"
- **Solution:** Expand date range to include all relevant transactions

**Problem:** "Wrong customer matched"
- **Solution:** Ensure names/phones match exactly in both systems

---

## 🔍 Sorting & Filtering

### Sortable Columns (Click to Sort):

**Transactions Tab:**
- ID
- Channel (boda/lipa/iphone)
- Customer Name
- Phone Number
- Contract Name
- Amount (numerical sort)
- Date (chronological sort)

**Invoice Results:**
- All columns can be sorted
- Payment status can be filtered visually

### Sort Indicators:
- ⇅ = Column is sortable, not currently sorted
- ↑ = Sorted ascending
- ↓ = Sorted descending

---

## 📱 Expandable Transaction Messages

**Why?**
- Transaction messages are often long (50+ characters)
- Full messages would make table too wide
- Click to expand only when you need to see full details

**How to Use:**
1. Look for messages with "..." at the end
2. Click the message text
3. Full message expands
4. Click again to collapse
5. Triangle icon (▼/▲) shows expand/collapse state

**What's in Messages:**
- Payment confirmation details
- Sender information
- Amount confirmations
- Transaction references

---

## 🎓 Example Workflow

### Typical Monthly Process:

**Monday Morning:**
1. Open application
2. Go to "View Transactions"
3. Set date filter: Jan 1 - Jan 31
4. Review transactions, verify all payments recorded
5. Sort by amount to spot any unusual transactions

**Monday Afternoon:**
1. Export invoices from QuickBooks for January
2. Go to "Process Invoices" tab
3. Download template to verify format
4. Upload QuickBooks export
5. Set dates: Jan 1 - Jan 31
6. Click "Process Payments"
7. Review results:
   - Check fully paid invoices (green)
   - Note partially paid invoices (yellow)
   - Follow up on unpaid invoices (red)
8. Download CSV
9. Import into QuickBooks

**Tuesday:**
1. Follow up with customers who have unpaid/partial invoices
2. Process again once new payments come in

---

## 🛡️ Data Safety

**What Gets Saved:**
- Nothing is permanently saved to the system
- All processing happens in memory
- Downloaded CSVs are saved to your computer

**What Doesn't Get Saved:**
- Uploaded invoices (processed then deleted)
- Google Sheets data is only read, never modified
- No database storage

**Privacy:**
- Google Sheets accessed via service account (read-only)
- No data sent to external servers
- All processing local to your server

---

## 📞 Troubleshooting

### "Failed to fetch transactions"
1. Check internet connection
2. Verify backend is running (port 5000)
3. Check .env file has correct Google key
4. Verify service account has sheet access

### "Error parsing CSV"
1. Download template and compare format
2. Ensure column names match exactly
3. Remove any currency symbols from amounts
4. Check date format (YYYY-MM-DD preferred)

### "No matching customers found"
1. Check customer name spelling
2. Verify phone numbers in transactions
3. Try expanding date range
4. Review Google Sheets for data quality

---

## 🎯 Quick Reference Card

### Must Remember:

✅ **DO:**
- Match customer names exactly
- Use correct CSV format
- Select appropriate date ranges
- Review results before importing
- Download results CSV
- Sort columns to find data quickly
- Expand messages when needed

❌ **DON'T:**
- Upload CSV with wrong columns
- Use very wide date ranges
- Forget to select date range
- Skip reviewing results
- Import without spot-checking

### Keyboard Shortcuts:

- **Ctrl+R**: Refresh transactions
- **Click header**: Sort column
- **Click message**: Expand/collapse
- **Esc**: Clear filters (in some browsers)

---

## 🚀 Success Metrics

**You're doing it right when:**
- ✅ 90%+ of invoices get fully paid
- ✅ Customer matching works first time
- ✅ Date ranges capture all relevant transactions
- ✅ Processing takes < 5 minutes
- ✅ QuickBooks import succeeds without errors
- ✅ You can explain payment logic to colleagues

---

## 📈 Advanced Features

### Multi-Invoice Customers:
System automatically handles customers with multiple invoices, paying oldest first.

### Partial Payment Tracking:
Every partially paid invoice shows exactly what remains unpaid.

### Channel Separation:
See which payment channel (BODA/LIPA/IPHONE) each transaction came from.

### Date-Aware Processing:
Won't accidentally use future payments for old invoices.

---

**Questions? Check the other documentation files or review the in-app guides!**

**Happy Processing! 💰✨**
