const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Papa = require('papaparse');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Google Sheets configuration
const SPREADSHEET_ID = '1N3ZxahtaFBX0iK3cijDraDmyZM8573PVVf8D-WVqicE';
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com';

// 🔥 NEW: Minimum date filter - January 1, 2026
const MIN_DATE_TIMESTAMP = new Date('2026-01-01T00:00:00+03:00').getTime();

// Initialize Google Sheets API
async function getGoogleSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      client_email: SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      project_id: 'lmp-sms-sync',
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

// Parse dates in MM/DD/YYYY format or "22 Jan 2026, 05:16 pm (EAT)" format
function parseEATDateTime(rawDate) {
  if (!rawDate) return { display: null, timestamp: null, dateOnly: null, timeOnly: null };

  try {
    // Check if it's MM/DD/YYYY format (e.g., "01/23/2026")
    const mmddyyyyPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
    const mmddyyyyMatch = rawDate.match(mmddyyyyPattern);
    
    if (mmddyyyyMatch) {
      const [, month, day, year] = mmddyyyyMatch;
      const parsed = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00+03:00`);
      
      if (isNaN(parsed)) {
        console.warn('Failed to parse MM/DD/YYYY date:', rawDate);
        return { display: rawDate, timestamp: null, dateOnly: rawDate, timeOnly: null };
      }
      
      return {
        display: rawDate,
        timestamp: parsed.getTime(),
        dateOnly: rawDate,
        timeOnly: '00:00'
      };
    }
    
    // Original format: "22 Jan 2026, 05:16 pm (EAT)"
    const parts = rawDate.split(',').map(s => s.trim());
    
    if (parts.length < 2) {
      // No time, just date
      const dateOnly = parts[0]; // "22 Jan 2026"
      const parsed = new Date(`${dateOnly} 00:00:00 GMT+0300`);
      
      return {
        display: dateOnly,
        timestamp: parsed.getTime(),
        dateOnly: dateOnly,
        timeOnly: '00:00'
      };
    }

    const datePart = parts[0]; // "22 Jan 2026"
    const timePart = parts[1].replace(/\s*\(EAT\)/, '').trim(); // "05:16 pm"

    // Parse to EAT timezone (GMT+3) to avoid date shifts
    const dateTimeStr = `${datePart} ${timePart} GMT+0300`;
    const parsed = new Date(dateTimeStr);

    if (isNaN(parsed)) {
      console.warn('Failed to parse date:', rawDate);
      return { display: rawDate, timestamp: null, dateOnly: datePart, timeOnly: null };
    }

    // Extract time in HH:mm format
    const hours = String(parsed.getHours()).padStart(2, '0');
    const minutes = String(parsed.getMinutes()).padStart(2, '0');
    const timeOnly = `${hours}:${minutes}`;

    return {
      display: `${datePart}, ${timePart}`,
      timestamp: parsed.getTime(),
      dateOnly: datePart,
      timeOnly: timeOnly,
      iso: parsed.toISOString()
    };

  } catch (error) {
    console.error('Error parsing date:', rawDate, error);
    return { display: rawDate, timestamp: null, dateOnly: null, timeOnly: null };
  }
}

// 🔥 UPDATED: Fetch transactions with DATE FILTER (only Jan 1, 2026+)
async function fetchTransactions(sheetName, channel) {
  try {
    const sheets = await getGoogleSheetsClient();

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:H`,
      majorDimension: 'ROWS',
    });

    const rows = data.values || [];
    const results = [];
    let filteredCount = 0;
    let tooOldCount = 0;

    console.log(`📊 Processing ${rows.length} rows from ${sheetName}...`);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Parse DateTime with TIME support
      const dateTime = parseEATDateTime(row[2]);

      // 🔥 NEW: Filter out messages before Jan 1, 2026
      // Safety check: Only filter if we have a valid timestamp
      if (dateTime.timestamp) {
        if (dateTime.timestamp < MIN_DATE_TIMESTAMP) {
          tooOldCount++;
          continue; // Skip this row - too old
        }
      } else {
        // No valid timestamp - log warning but keep the row
        console.warn(`⚠️ Row ${i + 2} has invalid date: ${row[2]}`);
      }

      filteredCount++;

      results.push({
        id: row[7] || `${channel}-${i + 1}`,
        channel,

        paymentChannel: row[1] || null,
        transactionMessage: row[3] || null,

        customerPhone: row[4] || null,
        customerName: row[5] || null,
        contractName: row[5] || null,

        amount: row[6] ? Number(row[6]) : null,

        // NEW: Full DateTime info
        receivedRaw: row[2], // "22 Jan 2026, 05:16 pm (EAT)" or "01/23/2026"
        receivedDate: dateTime.dateOnly, // "22 Jan 2026" or "01/23/2026"
        receivedTime: dateTime.timeOnly, // "17:16" (24-hour format)
        receivedDateTime: dateTime.display, // "22 Jan 2026, 05:16 pm" or "01/23/2026"
        receivedTimestamp: dateTime.timestamp, // Unix timestamp for filtering

        transactionId: row[7] || null,
      });
    }

    console.log(`✅ ${sheetName}: Fetched ${filteredCount} rows (${tooOldCount} filtered as too old)`);

    return results;

  } catch (error) {
    console.error(`❌ Error fetching from ${sheetName}:`, error);
    throw error;
  }
}

// API Routes

// Get all transactions (🔥 NOW FILTERED: Only Jan 1, 2026+)
app.get('/api/transactions', async (req, res) => {
  try {
    console.log('🔍 Fetching transactions from all channels...');
    
    const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
    const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
    const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

    const allTransactions = [
      ...bodaTransactions,
      ...iphoneTransactions,
      ...lipaTransactions,
    ];

    console.log(`✅ Total transactions returned: ${allTransactions.length}`);

    res.json({
      success: true,
      data: allTransactions,
      count: allTransactions.length,
      minDate: '2026-01-01', // 🔥 NEW: Show filter applied
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching transactions',
      error: error.message,
    });
  }
});

// Filter transactions by DATE + TIME range
app.post('/api/transactions/filter', async (req, res) => {
  try {
    const { startDate, endDate, startTime, endTime, channel } = req.body;

    const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
    const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
    const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

    let allTransactions = [
      ...bodaTransactions,
      ...iphoneTransactions,
      ...lipaTransactions,
    ];

    // Filter by DATE + TIME range
    if (startDate && endDate) {
      const startTimeStr = startTime || '00:00';
      const endTimeStr = endTime || '23:59';
      
      // Create timestamps in EAT (GMT+3) to avoid date shifts
      const startTimestamp = new Date(`${startDate} ${startTimeStr}:00 GMT+0300`).getTime();
      const endTimestamp = new Date(`${endDate} ${endTimeStr}:59 GMT+0300`).getTime();
      
      console.log('=== DateTime Filter ===');
      console.log('Start:', new Date(startTimestamp).toISOString());
      console.log('End:', new Date(endTimestamp).toISOString());
      console.log('Total transactions before filter:', allTransactions.length);
      
      allTransactions = allTransactions.filter(transaction => {
        if (!transaction.receivedTimestamp) return false;
        
        const isInRange = transaction.receivedTimestamp >= startTimestamp && 
                         transaction.receivedTimestamp <= endTimestamp;
        
        if (isInRange) {
          console.log('✓ Matched:', {
            dateTime: transaction.receivedDateTime,
            customer: transaction.customerName || transaction.contractName,
            amount: transaction.amount
          });
        }
        
        return isInRange;
      });
      
      console.log('Total transactions after filter:', allTransactions.length);
    }

    // Filter by channel
    if (channel && channel !== 'all') {
      console.log('Filtering by channel:', channel);
      allTransactions = allTransactions.filter(transaction => transaction.channel === channel);
      console.log('After channel filter:', allTransactions.length);
    }

    res.json({
      success: true,
      data: allTransactions,
      count: allTransactions.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error filtering transactions',
      error: error.message,
    });
  }
});

// Upload and parse invoices CSV
app.post('/api/invoices/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    const fileContent = req.file.buffer.toString('utf-8');
    
    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const invoices = results.data.map((row, index) => {
          // Extract and clean the amount - remove commas and parse
          const amountStr = (row['Amount'] || '0').toString().replace(/,/g, '');
          const amount = parseFloat(amountStr) || 0;
          
          return {
            id: index + 1,
            customerName: row['Customer'] || row['Customer Name'] || '',
            invoiceNumber: row['Invoice No'] || row['Invoice Number'] || '',
            amount: amount,
            invoiceDate: row['Invoice Date'] || row['Date'] || '',
            customerPhone: extractPhone(row['Customer'] || ''),
          };
        });

        console.log('\n📤 CSV Upload Summary:');
        console.log(`Total invoices: ${invoices.length}`);
        if (invoices.length > 0) {
          console.log('Sample invoice:', {
            customer: invoices[0].customerName,
            invoiceNo: invoices[0].invoiceNumber,
            amount: invoices[0].amount,
            date: invoices[0].invoiceDate
          });
        }

        res.json({
          success: true,
          data: invoices,
          count: invoices.length,
        });
      },
      error: (error) => {
        res.status(400).json({
          success: false,
          message: 'Error parsing CSV',
          error: error.message,
        });
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error processing file',
      error: error.message,
    });
  }
});

// Process invoice payments
app.post('/api/process-payments', async (req, res) => {
  try {
    const { invoices, startDate, endDate, startTime, endTime, channel } = req.body;

    console.log('\n🔍 Fetching transactions for payment processing...');
    console.log('Date range:', startDate, 'to', endDate);
    console.log('Time range:', startTime || '00:00', 'to', endTime || '23:59');
    console.log('Channel:', channel || 'all');

    const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
    const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
    const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

    let allTransactions = [
      ...bodaTransactions,
      ...iphoneTransactions,
      ...lipaTransactions,
    ];

    console.log(`📊 Total transactions fetched: ${allTransactions.length}`);

    // 🔥 CRITICAL: Filter by DATE + TIME range
    if (startDate && endDate) {
      const startTimeStr = startTime || '00:00';
      const endTimeStr = endTime || '23:59';
      
      const startTimestamp = new Date(`${startDate} ${startTimeStr}:00 GMT+0300`).getTime();
      const endTimestamp = new Date(`${endDate} ${endTimeStr}:59 GMT+0300`).getTime();
      
      console.log('\n⏰ Applying DateTime Filter:');
      console.log('Start:', new Date(startTimestamp).toISOString());
      console.log('End:', new Date(endTimestamp).toISOString());
      
      const beforeFilterCount = allTransactions.length;
      
      allTransactions = allTransactions.filter(transaction => {
        if (!transaction.receivedTimestamp) return false;
        return transaction.receivedTimestamp >= startTimestamp && 
               transaction.receivedTimestamp <= endTimestamp;
      });
      
      console.log(`✅ Filtered: ${beforeFilterCount} → ${allTransactions.length} transactions`);
    } else {
      console.warn('⚠️ WARNING: No date range provided! Using ALL transactions.');
    }

    // Filter by channel
    if (channel && channel !== 'all') {
      const beforeChannelFilter = allTransactions.length;
      allTransactions = allTransactions.filter(transaction => transaction.channel === channel);
      console.log(`📡 Channel filter (${channel}): ${beforeChannelFilter} → ${allTransactions.length} transactions`);
    }

    console.log(`\n💵 FINAL: Processing ${allTransactions.length} transactions for ${invoices.length} invoices`);

    // 🔥 CRITICAL: Only use the FILTERED transactions for payment processing
    const processedInvoices = processInvoicePayments(invoices, allTransactions);

    res.json({
      success: true,
      data: processedInvoices,
    });
  } catch (error) {
    console.error('❌ Error processing payments:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing payments',
      error: error.message,
    });
  }
});

// Helper function to extract phone
function extractPhone(customerName) {
  const phoneMatch = customerName.match(/\d{10,}/);
  return phoneMatch ? phoneMatch[0] : null;
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Invoice Payment API is running!',
    version: '2.1.0',
    features: ['DateTime filtering', 'EAT timezone support', 'Jan 1, 2026+ date filter', 'MM/DD/YYYY date format support'],
    minDate: '2026-01-01',
    dateFormats: ['MM/DD/YYYY', 'DD Mon YYYY, HH:mm am/pm (EAT)'],
    endpoints: {
      transactions: '/api/transactions',
      filter: '/api/transactions/filter',
      upload: '/api/invoices/upload',
      process: '/api/process-payments',
      export: '/api/export-payments'
    }
  });
});

// Export payments endpoint
app.post('/api/export-payments', (req, res) => {
  try {
    const { payments } = req.body;
    
    // Format data for QuickBooks with proper column names and casing
    const formattedPayments = payments.map(payment => ({
      'Payment Date': payment.paymentDate,
      'Customer': payment.customerName.toUpperCase(), // ✅ UPPERCASE
      'Payment Method': payment.paymentMethod,
      'Deposit To Account Name': payment.depositToAccountName,
      'Invoice No': payment.invoiceNo,
      'Journal No': payment.journalNo || '',
      'Amount': payment.amount,
      'Reference No': payment.referenceNo || '',
      'Memo': payment.memo || '',
      'Country Code': payment.countryCode || '',
      'Exchange Rate': payment.exchangeRate || '',
    }));
    
    const csv = Papa.unparse(formattedPayments, {
      header: true,
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=processed_payments.csv');
    res.send(csv);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error exporting payments',
      error: error.message,
    });
  }
});

// Main payment processing logic
function processInvoicePayments(invoices, transactions) {
  console.log('\n========================================');
  console.log('=== PAYMENT PROCESSING STARTED ===');
  console.log('=== TRANSACTION-BY-TRANSACTION MODE ===');
  console.log('========================================');
  console.log('📋 Invoices to process:', invoices.length);
  console.log('💵 Transactions available (WITHIN TIME FRAME):', transactions.length);
  
  const usedTransactions = new Set();
  // 🔥 NEW: Track total payments per invoice for accurate status
  const invoiceTotalPayments = new Map(); // invoiceNo -> total amount paid
  
  // Step 1: Group invoices by customer
  const invoicesByCustomer = {};
  
  invoices.forEach(invoice => {
    const key = invoice.customerPhone || invoice.customerName.toLowerCase().trim();
    if (!invoicesByCustomer[key]) {
      invoicesByCustomer[key] = [];
    }
    invoicesByCustomer[key].push(invoice);
  });

  console.log(`\n👥 Found ${Object.keys(invoicesByCustomer).length} unique customers with invoices`);

  // Step 2: Sort each customer's invoices by date (DESCENDING - newest first)
  Object.keys(invoicesByCustomer).forEach(customerKey => {
    invoicesByCustomer[customerKey].sort((a, b) => {
      const dateCompare = new Date(b.invoiceDate) - new Date(a.invoiceDate);
      if (dateCompare !== 0) return dateCompare;
      return b.invoiceNumber.localeCompare(a.invoiceNumber);
    });
    
    console.log(`\n📋 Customer: "${customerKey}"`);
    console.log(`   Total invoices: ${invoicesByCustomer[customerKey].length}`);
    console.log('   Invoices sorted (NEWEST → OLDEST):');
    invoicesByCustomer[customerKey].forEach((inv, idx) => {
      console.log(`      ${idx + 1}. Invoice #${inv.invoiceNumber} | Date: ${inv.invoiceDate} | Amount: TZS ${inv.amount.toLocaleString()}`);
    });
  });

  // Step 3: Group transactions by customer
  const transactionsByCustomer = {};
  const processedTransactionIds = new Set();
  
  transactions.forEach(transaction => {
    if (!transaction.amount) return;
    
    const transactionUniqueId = `${transaction.transactionId || transaction.id}_${transaction.receivedTimestamp}_${transaction.amount}`;
    
    if (processedTransactionIds.has(transactionUniqueId)) {
      console.warn(`⚠️ Skipping duplicate transaction: ${transaction.transactionId}`);
      return;
    }
    
    const keys = [
      transaction.customerPhone,
      transaction.contractName?.toLowerCase().trim(),
      transaction.customerName?.toLowerCase().trim()
    ].filter(Boolean);
    
    // 🔥 FIXED: ONLY add transaction if it matches a customer with invoices
    const matchedKey = keys.find(key => invoicesByCustomer[key]);
    
    if (matchedKey) {
      // ✅ This transaction matches a customer who has invoices
      if (!transactionsByCustomer[matchedKey]) {
        transactionsByCustomer[matchedKey] = [];
      }
      transactionsByCustomer[matchedKey].push(transaction);
      processedTransactionIds.add(transactionUniqueId);
      console.log(`   ✅ Matched transaction ${transaction.transactionId} to customer: ${matchedKey}`);
    } else {
      // ❌ No matching customer with invoices - this will be UNUSED
      console.log(`   ⚠️ Transaction ${transaction.transactionId} has no matching invoice customer - will be UNUSED`);
      // 🔥 DO NOT add to transactionsByCustomer - let it be unused!
    }
  });

  // Sort transactions by timestamp (oldest first - FIFO)
  Object.keys(transactionsByCustomer).forEach(customerKey => {
    transactionsByCustomer[customerKey].sort((a, b) => {
      return (a.receivedTimestamp || 0) - (b.receivedTimestamp || 0);
    });
  });

  console.log(`\n💰 Found ${Object.keys(transactionsByCustomer).length} unique customers with transactions`);

  // Step 4: Process transaction-by-transaction
  const processedPayments = [];

  Object.keys(invoicesByCustomer).forEach(customerKey => {
    const customerInvoices = invoicesByCustomer[customerKey];
    const customerTransactions = transactionsByCustomer[customerKey] || [];
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`💵 PROCESSING: "${customerKey}"`);
    console.log(`${'='.repeat(80)}`);
    console.log(`   Transactions: ${customerTransactions.length}`);
    console.log(`   Invoices: ${customerInvoices.length}`);
    
    if (customerTransactions.length === 0) {
      console.log(`   ⚠️ No transactions found - marking all invoices as UNPAID`);
      
      customerInvoices.forEach(invoice => {
        invoiceTotalPayments.set(invoice.invoiceNumber, 0);
        processedPayments.push({
          paymentDate: invoice.invoiceDate,
          customerName: invoice.customerName,
          paymentMethod: 'Cash',
          depositToAccountName: 'Kijichi Collection AC',
          invoiceNo: invoice.invoiceNumber,
          journalNo: '',
          invoiceAmount: invoice.amount,
          amount: 0,
          referenceNo: '',
          memo: '',
          countryCode: '',
          exchangeRate: '',
        });
      });
      return;
    }

    // Track remaining balance for each invoice
    const invoiceBalances = customerInvoices.map(inv => ({
      invoice: inv,
      remainingBalance: inv.amount,
      fullyPaid: false
    }));

    let currentInvoiceIndex = 0;

    // 🔥 Track payments by transaction for remainder appending
    const paymentsByTransaction = new Map(); // transactionId -> array of payment records

    // Process each transaction one by one
    customerTransactions.forEach((transaction, txIdx) => {
      let transactionAmount = transaction.amount;
      let transactionUsed = false;
      
      console.log(`\n   💳 Transaction ${txIdx + 1}/${customerTransactions.length}`);
      console.log(`      Amount: TZS ${transactionAmount.toLocaleString()}`);
      console.log(`      Date: ${transaction.receivedDateTime}`);
      console.log(`      ID: ${transaction.transactionId || 'N/A'}`);

      const originalTransactionAmount = transactionAmount; // 🔥 Track original amount
      const transactionPayments = []; // Track payments made by this transaction

      // Use this transaction to pay invoices
      while (transactionAmount > 0 && currentInvoiceIndex < invoiceBalances.length) {
        const currentInvoice = invoiceBalances[currentInvoiceIndex];
        
        if (currentInvoice.fullyPaid) {
          currentInvoiceIndex++;
          continue;
        }

        const amountToPay = Math.min(transactionAmount, currentInvoice.remainingBalance);
        
        console.log(`      → Paying Invoice #${currentInvoice.invoice.invoiceNumber}`);
        console.log(`         Remaining balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
        console.log(`         Paying: TZS ${amountToPay.toLocaleString()}`);

        // Format date as MM-DD-YYYY
        let formattedDate = transaction.receivedDateTime || transaction.receivedDate || currentInvoice.invoice.invoiceDate;
        const dateObj = new Date(formattedDate);
        if (!isNaN(dateObj.getTime())) {
          const month = String(dateObj.getMonth() + 1).padStart(2, '0');
          const day = String(dateObj.getDate()).padStart(2, '0');
          const year = dateObj.getFullYear();
          formattedDate = `${month}-${day}-${year}`;
        }

        // 🔥 Track total payment for this invoice
        const currentTotal = invoiceTotalPayments.get(currentInvoice.invoice.invoiceNumber) || 0;
        invoiceTotalPayments.set(currentInvoice.invoice.invoiceNumber, currentTotal + amountToPay);

        // Create payment record
        const paymentRecord = {
          paymentDate: formattedDate,
          customerName: currentInvoice.invoice.customerName,
          paymentMethod: 'Cash',
          depositToAccountName: 'Kijichi Collection AC',
          invoiceNo: currentInvoice.invoice.invoiceNumber,
          journalNo: '',
          invoiceAmount: currentInvoice.invoice.amount,
          amount: amountToPay,
          referenceNo: '',
          memo: transaction.transactionId || '',
          countryCode: '',
          exchangeRate: '',
        };

        processedPayments.push(paymentRecord);
        transactionPayments.push(paymentRecord); // Track for this transaction

        // Update balances
        currentInvoice.remainingBalance -= amountToPay;
        transactionAmount -= amountToPay;
        transactionUsed = true;

        console.log(`         New balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
        console.log(`         Transaction remaining: TZS ${transactionAmount.toLocaleString()}`);

        // Mark invoice as fully paid if balance <= 1 TZS
        if (currentInvoice.remainingBalance <= 1) {
          currentInvoice.fullyPaid = true;
          currentInvoice.remainingBalance = 0;
          console.log(`         ✅ Invoice #${currentInvoice.invoice.invoiceNumber} FULLY PAID!`);
          currentInvoiceIndex++;
        }
      }

      if (transactionUsed) {
        usedTransactions.add(transaction.transactionId || transaction.id);
      }

      // 🔥 NEW: If there's overpayment, add it to the FIRST (newest) invoice payment
      if (transactionAmount > 0 && transactionPayments.length > 0) {
        const usedAmount = originalTransactionAmount - transactionAmount;
        console.log(`      ⚠️ OVERPAYMENT REMAINDER: TZS ${transactionAmount.toLocaleString()}`);
        console.log(`         Transaction: TZS ${originalTransactionAmount.toLocaleString()}`);
        console.log(`         Used for invoices: TZS ${usedAmount.toLocaleString()}`);
        console.log(`         Remainder: TZS ${transactionAmount.toLocaleString()}`);
        console.log(`         → Adding remainder to FIRST (newest) invoice payment`);
        
        // Find the FIRST payment made by this transaction (newest invoice)
        const firstPayment = transactionPayments[0];
        
        // Find this payment in processedPayments and update it
        const paymentIndex = processedPayments.findIndex(p => p === firstPayment);
        
        if (paymentIndex !== -1) {
          const oldAmount = processedPayments[paymentIndex].amount;
          processedPayments[paymentIndex].amount += transactionAmount;
          
          console.log(`         ✅ Updated Invoice #${firstPayment.invoiceNo}:`);
          console.log(`            Old amount: TZS ${oldAmount.toLocaleString()}`);
          console.log(`            New amount: TZS ${processedPayments[paymentIndex].amount.toLocaleString()}`);
          console.log(`            Remainder added: TZS ${transactionAmount.toLocaleString()}`);
        }
      } else if (transactionAmount > 0) {
        console.log(`      ⚠️ Transaction has TZS ${transactionAmount.toLocaleString()} remaining but NO invoices paid`);
      }
    });

    // Mark any unpaid invoices
    invoiceBalances.forEach(invBalance => {
      if (!invBalance.fullyPaid && invBalance.remainingBalance > 0) {
        console.log(`   ❌ Invoice #${invBalance.invoice.invoiceNumber} UNPAID - Balance: TZS ${invBalance.remainingBalance.toLocaleString()}`);
        
        const hasPayment = processedPayments.some(p => p.invoiceNo === invBalance.invoice.invoiceNumber);
        if (!hasPayment) {
          invoiceTotalPayments.set(invBalance.invoice.invoiceNumber, 0);
          processedPayments.push({
            paymentDate: invBalance.invoice.invoiceDate,
            customerName: invBalance.invoice.customerName,
            paymentMethod: 'Cash',
            depositToAccountName: 'Kijichi Collection AC',
            invoiceNo: invBalance.invoice.invoiceNumber,
            journalNo: '',
            invoiceAmount: invBalance.invoice.amount,
            amount: 0,
            referenceNo: '',
            memo: '',
            countryCode: '',
            exchangeRate: '',
          });
        }
      }
    });
  });

  // 🔥 Add UNUSED transactions at the end
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 CHECKING FOR UNUSED TRANSACTIONS`);
  console.log(`${'='.repeat(80)}`);
  
  const unusedTransactions = transactions.filter(transaction => {
    const txId = transaction.transactionId || transaction.id;
    return !usedTransactions.has(txId);
  });

  console.log(`✅ Used transactions: ${usedTransactions.size}`);
  console.log(`⚠️ Unused transactions: ${unusedTransactions.length}`);

  // 🔥 FIXED: Store REAL transaction amount instead of "UNUSED" string
  unusedTransactions.forEach(transaction => {
    let formattedDate = transaction.receivedDateTime || transaction.receivedDate || '';
    const dateObj = new Date(formattedDate);
    if (!isNaN(dateObj.getTime())) {
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      const year = dateObj.getFullYear();
      formattedDate = `${month}-${day}-${year}`;
    }

    console.log(`   💰 UNUSED: ${transaction.customerName || transaction.contractName} | TZS ${transaction.amount.toLocaleString()} | ID: ${transaction.transactionId}`);

    processedPayments.push({
      paymentDate: formattedDate,
      customerName: transaction.customerName || transaction.contractName || 'UNKNOWN',
      paymentMethod: 'Cash',
      depositToAccountName: 'Kijichi Collection AC',
      invoiceNo: 'UNUSED',
      journalNo: '',
      invoiceAmount: 0, // 🔥 No invoice amount since it's unused
      transactionAmount: transaction.amount, // 🔥 REAL transaction amount from Google Sheets
      amount: transaction.amount, // 🔥 Use the REAL transaction amount
      referenceNo: '',
      memo: transaction.transactionId || '',
      countryCode: '',
      exchangeRate: '',
      isUnused: true, // 🔥 Flag to identify unused transactions
    });
  });

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ PAYMENT PROCESSING COMPLETED`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Total payment records: ${processedPayments.length}`);
  console.log(`Used transactions: ${usedTransactions.size}`);
  console.log(`Unused transactions: ${unusedTransactions.length}`);
  
  const totalPaid = processedPayments
    .filter(p => typeof p.amount === 'number' && p.amount > 0 && !p.isUnused)
    .reduce((sum, p) => sum + p.amount, 0);
  
  const totalUnused = processedPayments
    .filter(p => p.isUnused)
    .reduce((sum, p) => sum + (p.transactionAmount || 0), 0);
  
  console.log(`Total amount paid (invoices only): TZS ${totalPaid.toLocaleString()}`);
  console.log(`Total unused amount (including remainders): TZS ${totalUnused.toLocaleString()}`);
  console.log(`\n`);
  
  // 🔥 Add metadata to help frontend determine status
  return processedPayments.map(payment => {
    if (payment.invoiceNo === 'UNUSED' || payment.invoiceNo === 'UNUSED-REMAINDER') {
      return payment;
    }
    
    const totalPaid = invoiceTotalPayments.get(payment.invoiceNo) || 0;
    const isFullyPaid = Math.abs(totalPaid - payment.invoiceAmount) <= 1;
    
    return {
      ...payment,
      isFullyPaid, // 🔥 Flag for frontend
      totalPaidForInvoice: totalPaid
    };
  });
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.path
  });
});

// Start server - bind to 0.0.0.0 for Render deployment
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📅 Filtering transactions from Jan 1, 2026 onwards`);
  console.log(`📆 Accepting date formats: MM/DD/YYYY and DD Mon YYYY`);
});

module.exports = { processInvoicePayments };

























// const express = require('express');
// const cors = require('cors');
// const multer = require('multer');
// const Papa = require('papaparse');
// const { google } = require('googleapis');
// require('dotenv').config();

// const app = express();
// const port = process.env.PORT || 5000;

// // Middleware
// app.use(cors({
//   origin: '*',
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
// }));
// app.use(express.json({ limit: '50mb' }));
// app.use(express.urlencoded({ limit: '50mb', extended: true }));

// // Configure multer for file uploads
// const upload = multer({ storage: multer.memoryStorage() });

// // Google Sheets configuration
// const SPREADSHEET_ID = '1N3ZxahtaFBX0iK3cijDraDmyZM8573PVVf8D-WVqicE';
// const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com';

// // 🔥 NEW: Minimum date filter - January 1, 2026
// const MIN_DATE_TIMESTAMP = new Date('2026-01-01T00:00:00+03:00').getTime();

// // Initialize Google Sheets API
// async function getGoogleSheetsClient() {
//   const auth = new google.auth.GoogleAuth({
//     credentials: {
//       type: 'service_account',
//       client_email: SERVICE_ACCOUNT_EMAIL,
//       private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
//       project_id: 'lmp-sms-sync',
//     },
//     scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
//   });

//   const client = await auth.getClient();
//   return google.sheets({ version: 'v4', auth: client });
// }

// // Parse dates in MM/DD/YYYY format or "22 Jan 2026, 05:16 pm (EAT)" format
// function parseEATDateTime(rawDate) {
//   if (!rawDate) return { display: null, timestamp: null, dateOnly: null, timeOnly: null };

//   try {
//     // Check if it's MM/DD/YYYY format (e.g., "01/23/2026")
//     const mmddyyyyPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
//     const mmddyyyyMatch = rawDate.match(mmddyyyyPattern);
    
//     if (mmddyyyyMatch) {
//       const [, month, day, year] = mmddyyyyMatch;
//       const parsed = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00+03:00`);
      
//       if (isNaN(parsed)) {
//         console.warn('Failed to parse MM/DD/YYYY date:', rawDate);
//         return { display: rawDate, timestamp: null, dateOnly: rawDate, timeOnly: null };
//       }
      
//       return {
//         display: rawDate,
//         timestamp: parsed.getTime(),
//         dateOnly: rawDate,
//         timeOnly: '00:00'
//       };
//     }
    
//     // Original format: "22 Jan 2026, 05:16 pm (EAT)"
//     const parts = rawDate.split(',').map(s => s.trim());
    
//     if (parts.length < 2) {
//       // No time, just date
//       const dateOnly = parts[0]; // "22 Jan 2026"
//       const parsed = new Date(`${dateOnly} 00:00:00 GMT+0300`);
      
//       return {
//         display: dateOnly,
//         timestamp: parsed.getTime(),
//         dateOnly: dateOnly,
//         timeOnly: '00:00'
//       };
//     }

//     const datePart = parts[0]; // "22 Jan 2026"
//     const timePart = parts[1].replace(/\s*\(EAT\)/, '').trim(); // "05:16 pm"

//     // Parse to EAT timezone (GMT+3) to avoid date shifts
//     const dateTimeStr = `${datePart} ${timePart} GMT+0300`;
//     const parsed = new Date(dateTimeStr);

//     if (isNaN(parsed)) {
//       console.warn('Failed to parse date:', rawDate);
//       return { display: rawDate, timestamp: null, dateOnly: datePart, timeOnly: null };
//     }

//     // Extract time in HH:mm format
//     const hours = String(parsed.getHours()).padStart(2, '0');
//     const minutes = String(parsed.getMinutes()).padStart(2, '0');
//     const timeOnly = `${hours}:${minutes}`;

//     return {
//       display: `${datePart}, ${timePart}`,
//       timestamp: parsed.getTime(),
//       dateOnly: datePart,
//       timeOnly: timeOnly,
//       iso: parsed.toISOString()
//     };

//   } catch (error) {
//     console.error('Error parsing date:', rawDate, error);
//     return { display: rawDate, timestamp: null, dateOnly: null, timeOnly: null };
//   }
// }

// // 🔥 UPDATED: Fetch transactions with DATE FILTER (only Jan 1, 2026+)
// async function fetchTransactions(sheetName, channel) {
//   try {
//     const sheets = await getGoogleSheetsClient();

//     const { data } = await sheets.spreadsheets.values.get({
//       spreadsheetId: SPREADSHEET_ID,
//       range: `${sheetName}!A2:H`,
//       majorDimension: 'ROWS',
//     });

//     const rows = data.values || [];
//     const results = [];
//     let filteredCount = 0;
//     let tooOldCount = 0;

//     console.log(`📊 Processing ${rows.length} rows from ${sheetName}...`);

//     for (let i = 0; i < rows.length; i++) {
//       const row = rows[i];

//       // Parse DateTime with TIME support
//       const dateTime = parseEATDateTime(row[2]);

//       // 🔥 NEW: Filter out messages before Jan 1, 2026
//       // Safety check: Only filter if we have a valid timestamp
//       if (dateTime.timestamp) {
//         if (dateTime.timestamp < MIN_DATE_TIMESTAMP) {
//           tooOldCount++;
//           continue; // Skip this row - too old
//         }
//       } else {
//         // No valid timestamp - log warning but keep the row
//         console.warn(`⚠️ Row ${i + 2} has invalid date: ${row[2]}`);
//       }

//       filteredCount++;

//       results.push({
//         id: row[7] || `${channel}-${i + 1}`,
//         channel,

//         paymentChannel: row[1] || null,
//         transactionMessage: row[3] || null,

//         customerPhone: row[4] || null,
//         customerName: row[5] || null,
//         contractName: row[5] || null,

//         amount: row[6] ? Number(row[6]) : null,

//         // NEW: Full DateTime info
//         receivedRaw: row[2], // "22 Jan 2026, 05:16 pm (EAT)" or "01/23/2026"
//         receivedDate: dateTime.dateOnly, // "22 Jan 2026" or "01/23/2026"
//         receivedTime: dateTime.timeOnly, // "17:16" (24-hour format)
//         receivedDateTime: dateTime.display, // "22 Jan 2026, 05:16 pm" or "01/23/2026"
//         receivedTimestamp: dateTime.timestamp, // Unix timestamp for filtering

//         transactionId: row[7] || null,
//       });
//     }

//     console.log(`✅ ${sheetName}: Fetched ${filteredCount} rows (${tooOldCount} filtered as too old)`);

//     return results;

//   } catch (error) {
//     console.error(`❌ Error fetching from ${sheetName}:`, error);
//     throw error;
//   }
// }

// // API Routes

// // Get all transactions (🔥 NOW FILTERED: Only Jan 1, 2026+)
// app.get('/api/transactions', async (req, res) => {
//   try {
//     console.log('🔍 Fetching transactions from all channels...');
    
//     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
//     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
//     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

//     const allTransactions = [
//       ...bodaTransactions,
//       ...iphoneTransactions,
//       ...lipaTransactions,
//     ];

//     console.log(`✅ Total transactions returned: ${allTransactions.length}`);

//     res.json({
//       success: true,
//       data: allTransactions,
//       count: allTransactions.length,
//       minDate: '2026-01-01', // 🔥 NEW: Show filter applied
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error fetching transactions',
//       error: error.message,
//     });
//   }
// });

// // Filter transactions by DATE + TIME range
// app.post('/api/transactions/filter', async (req, res) => {
//   try {
//     const { startDate, endDate, startTime, endTime, channel } = req.body;

//     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
//     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
//     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

//     let allTransactions = [
//       ...bodaTransactions,
//       ...iphoneTransactions,
//       ...lipaTransactions,
//     ];

//     // Filter by DATE + TIME range
//     if (startDate && endDate) {
//       const startTimeStr = startTime || '00:00';
//       const endTimeStr = endTime || '23:59';
      
//       // Create timestamps in EAT (GMT+3) to avoid date shifts
//       const startTimestamp = new Date(`${startDate} ${startTimeStr}:00 GMT+0300`).getTime();
//       const endTimestamp = new Date(`${endDate} ${endTimeStr}:59 GMT+0300`).getTime();
      
//       console.log('=== DateTime Filter ===');
//       console.log('Start:', new Date(startTimestamp).toISOString());
//       console.log('End:', new Date(endTimestamp).toISOString());
//       console.log('Total transactions before filter:', allTransactions.length);
      
//       allTransactions = allTransactions.filter(transaction => {
//         if (!transaction.receivedTimestamp) return false;
        
//         const isInRange = transaction.receivedTimestamp >= startTimestamp && 
//                          transaction.receivedTimestamp <= endTimestamp;
        
//         if (isInRange) {
//           console.log('✓ Matched:', {
//             dateTime: transaction.receivedDateTime,
//             customer: transaction.customerName || transaction.contractName,
//             amount: transaction.amount
//           });
//         }
        
//         return isInRange;
//       });
      
//       console.log('Total transactions after filter:', allTransactions.length);
//     }

//     // Filter by channel
//     if (channel && channel !== 'all') {
//       console.log('Filtering by channel:', channel);
//       allTransactions = allTransactions.filter(transaction => transaction.channel === channel);
//       console.log('After channel filter:', allTransactions.length);
//     }

//     res.json({
//       success: true,
//       data: allTransactions,
//       count: allTransactions.length,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error filtering transactions',
//       error: error.message,
//     });
//   }
// });

// // Upload and parse invoices CSV
// app.post('/api/invoices/upload', upload.single('file'), (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: 'No file uploaded',
//       });
//     }

//     const fileContent = req.file.buffer.toString('utf-8');
    
//     Papa.parse(fileContent, {
//       header: true,
//       skipEmptyLines: true,
//       complete: (results) => {
//         const invoices = results.data.map((row, index) => {
//           // Extract and clean the amount - remove commas and parse
//           const amountStr = (row['Amount'] || '0').toString().replace(/,/g, '');
//           const amount = parseFloat(amountStr) || 0;
          
//           return {
//             id: index + 1,
//             customerName: row['Customer'] || row['Customer Name'] || '',
//             invoiceNumber: row['Invoice No'] || row['Invoice Number'] || '',
//             amount: amount,
//             invoiceDate: row['Invoice Date'] || row['Date'] || '',
//             customerPhone: extractPhone(row['Customer'] || ''),
//           };
//         });

//         console.log('\n📤 CSV Upload Summary:');
//         console.log(`Total invoices: ${invoices.length}`);
//         if (invoices.length > 0) {
//           console.log('Sample invoice:', {
//             customer: invoices[0].customerName,
//             invoiceNo: invoices[0].invoiceNumber,
//             amount: invoices[0].amount,
//             date: invoices[0].invoiceDate
//           });
//         }

//         res.json({
//           success: true,
//           data: invoices,
//           count: invoices.length,
//         });
//       },
//       error: (error) => {
//         res.status(400).json({
//           success: false,
//           message: 'Error parsing CSV',
//           error: error.message,
//         });
//       },
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error processing file',
//       error: error.message,
//     });
//   }
// });

// // Process invoice payments
// app.post('/api/process-payments', async (req, res) => {
//   try {
//     const { invoices, startDate, endDate, startTime, endTime, channel } = req.body;

//     console.log('\n🔍 Fetching transactions for payment processing...');
//     console.log('Date range:', startDate, 'to', endDate);
//     console.log('Time range:', startTime || '00:00', 'to', endTime || '23:59');
//     console.log('Channel:', channel || 'all');

//     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
//     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
//     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

//     let allTransactions = [
//       ...bodaTransactions,
//       ...iphoneTransactions,
//       ...lipaTransactions,
//     ];

//     console.log(`📊 Total transactions fetched: ${allTransactions.length}`);

//     // 🔥 CRITICAL: Filter by DATE + TIME range
//     if (startDate && endDate) {
//       const startTimeStr = startTime || '00:00';
//       const endTimeStr = endTime || '23:59';
      
//       const startTimestamp = new Date(`${startDate} ${startTimeStr}:00 GMT+0300`).getTime();
//       const endTimestamp = new Date(`${endDate} ${endTimeStr}:59 GMT+0300`).getTime();
      
//       console.log('\n⏰ Applying DateTime Filter:');
//       console.log('Start:', new Date(startTimestamp).toISOString());
//       console.log('End:', new Date(endTimestamp).toISOString());
      
//       const beforeFilterCount = allTransactions.length;
      
//       allTransactions = allTransactions.filter(transaction => {
//         if (!transaction.receivedTimestamp) return false;
//         return transaction.receivedTimestamp >= startTimestamp && 
//                transaction.receivedTimestamp <= endTimestamp;
//       });
      
//       console.log(`✅ Filtered: ${beforeFilterCount} → ${allTransactions.length} transactions`);
//     } else {
//       console.warn('⚠️ WARNING: No date range provided! Using ALL transactions.');
//     }

//     // Filter by channel
//     if (channel && channel !== 'all') {
//       const beforeChannelFilter = allTransactions.length;
//       allTransactions = allTransactions.filter(transaction => transaction.channel === channel);
//       console.log(`📡 Channel filter (${channel}): ${beforeChannelFilter} → ${allTransactions.length} transactions`);
//     }

//     console.log(`\n💵 FINAL: Processing ${allTransactions.length} transactions for ${invoices.length} invoices`);

//     // 🔥 CRITICAL: Only use the FILTERED transactions for payment processing
//     const processedInvoices = processInvoicePayments(invoices, allTransactions);

//     res.json({
//       success: true,
//       data: processedInvoices,
//     });
//   } catch (error) {
//     console.error('❌ Error processing payments:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error processing payments',
//       error: error.message,
//     });
//   }
// });

// // Helper function to extract phone
// function extractPhone(customerName) {
//   const phoneMatch = customerName.match(/\d{10,}/);
//   return phoneMatch ? phoneMatch[0] : null;
// }

// // Health check endpoint
// app.get('/', (req, res) => {
//   res.json({
//     success: true,
//     message: 'Invoice Payment API is running!',
//     version: '2.1.0',
//     features: ['DateTime filtering', 'EAT timezone support', 'Jan 1, 2026+ date filter', 'MM/DD/YYYY date format support'],
//     minDate: '2026-01-01',
//     dateFormats: ['MM/DD/YYYY', 'DD Mon YYYY, HH:mm am/pm (EAT)'],
//     endpoints: {
//       transactions: '/api/transactions',
//       filter: '/api/transactions/filter',
//       upload: '/api/invoices/upload',
//       process: '/api/process-payments',
//       export: '/api/export-payments'
//     }
//   });
// });

// // Export payments endpoint
// app.post('/api/export-payments', (req, res) => {
//   try {
//     const { payments } = req.body;
    
//     // Format data for QuickBooks with proper column names and casing
//     const formattedPayments = payments.map(payment => ({
//       'Payment Date': payment.paymentDate,
//       'Customer': payment.customerName.toUpperCase(), // ✅ UPPERCASE
//       'Payment Method': payment.paymentMethod,
//       'Deposit To Account Name': payment.depositToAccountName,
//       'Invoice No': payment.invoiceNo,
//       'Journal No': payment.journalNo || '',
//       'Amount': payment.amount,
//       'Reference No': payment.referenceNo || '',
//       'Memo': payment.memo || '',
//       'Country Code': payment.countryCode || '',
//       'Exchange Rate': payment.exchangeRate || '',
//     }));
    
//     const csv = Papa.unparse(formattedPayments, {
//       header: true,
//     });

//     res.setHeader('Content-Type', 'text/csv');
//     res.setHeader('Content-Disposition', 'attachment; filename=processed_payments.csv');
//     res.send(csv);
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error exporting payments',
//       error: error.message,
//     });
//   }
// });

// // Main payment processing logic
// function processInvoicePayments(invoices, transactions) {
//   console.log('\n========================================');
//   console.log('=== PAYMENT PROCESSING STARTED ===');
//   console.log('=== TRANSACTION-BY-TRANSACTION MODE ===');
//   console.log('========================================');
//   console.log('📋 Invoices to process:', invoices.length);
//   console.log('💵 Transactions available (WITHIN TIME FRAME):', transactions.length);
  
//   const usedTransactions = new Set();
//   // 🔥 NEW: Track total payments per invoice for accurate status
//   const invoiceTotalPayments = new Map(); // invoiceNo -> total amount paid
  
//   // Step 1: Group invoices by customer
//   const invoicesByCustomer = {};
  
//   invoices.forEach(invoice => {
//     const key = invoice.customerPhone || invoice.customerName.toLowerCase().trim();
//     if (!invoicesByCustomer[key]) {
//       invoicesByCustomer[key] = [];
//     }
//     invoicesByCustomer[key].push(invoice);
//   });

//   console.log(`\n👥 Found ${Object.keys(invoicesByCustomer).length} unique customers with invoices`);

//   // Step 2: Sort each customer's invoices by date (DESCENDING - newest first)
//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     invoicesByCustomer[customerKey].sort((a, b) => {
//       const dateCompare = new Date(b.invoiceDate) - new Date(a.invoiceDate);
//       if (dateCompare !== 0) return dateCompare;
//       return b.invoiceNumber.localeCompare(a.invoiceNumber);
//     });
    
//     console.log(`\n📋 Customer: "${customerKey}"`);
//     console.log(`   Total invoices: ${invoicesByCustomer[customerKey].length}`);
//     console.log('   Invoices sorted (NEWEST → OLDEST):');
//     invoicesByCustomer[customerKey].forEach((inv, idx) => {
//       console.log(`      ${idx + 1}. Invoice #${inv.invoiceNumber} | Date: ${inv.invoiceDate} | Amount: TZS ${inv.amount.toLocaleString()}`);
//     });
//   });

//   // Step 3: Group transactions by customer
//   const transactionsByCustomer = {};
//   const processedTransactionIds = new Set();
  
//   transactions.forEach(transaction => {
//     if (!transaction.amount) return;
    
//     const transactionUniqueId = `${transaction.transactionId || transaction.id}_${transaction.receivedTimestamp}_${transaction.amount}`;
    
//     if (processedTransactionIds.has(transactionUniqueId)) {
//       console.warn(`⚠️ Skipping duplicate transaction: ${transaction.transactionId}`);
//       return;
//     }
    
//     const keys = [
//       transaction.customerPhone,
//       transaction.contractName?.toLowerCase().trim(),
//       transaction.customerName?.toLowerCase().trim()
//     ].filter(Boolean);
    
//     // 🔥 FIXED: ONLY add transaction if it matches a customer with invoices
//     const matchedKey = keys.find(key => invoicesByCustomer[key]);
    
//     if (matchedKey) {
//       // ✅ This transaction matches a customer who has invoices
//       if (!transactionsByCustomer[matchedKey]) {
//         transactionsByCustomer[matchedKey] = [];
//       }
//       transactionsByCustomer[matchedKey].push(transaction);
//       processedTransactionIds.add(transactionUniqueId);
//       console.log(`   ✅ Matched transaction ${transaction.transactionId} to customer: ${matchedKey}`);
//     } else {
//       // ❌ No matching customer with invoices - this will be UNUSED
//       console.log(`   ⚠️ Transaction ${transaction.transactionId} has no matching invoice customer - will be UNUSED`);
//       // 🔥 DO NOT add to transactionsByCustomer - let it be unused!
//     }
//   });

//   // Sort transactions by timestamp (oldest first - FIFO)
//   Object.keys(transactionsByCustomer).forEach(customerKey => {
//     transactionsByCustomer[customerKey].sort((a, b) => {
//       return (a.receivedTimestamp || 0) - (b.receivedTimestamp || 0);
//     });
//   });

//   console.log(`\n💰 Found ${Object.keys(transactionsByCustomer).length} unique customers with transactions`);

//   // Step 4: Process transaction-by-transaction
//   const processedPayments = [];

//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     const customerInvoices = invoicesByCustomer[customerKey];
//     const customerTransactions = transactionsByCustomer[customerKey] || [];
    
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`💵 PROCESSING: "${customerKey}"`);
//     console.log(`${'='.repeat(80)}`);
//     console.log(`   Transactions: ${customerTransactions.length}`);
//     console.log(`   Invoices: ${customerInvoices.length}`);
    
//     if (customerTransactions.length === 0) {
//       console.log(`   ⚠️ No transactions found - marking all invoices as UNPAID`);
      
//       customerInvoices.forEach(invoice => {
//         invoiceTotalPayments.set(invoice.invoiceNumber, 0);
//         processedPayments.push({
//           paymentDate: invoice.invoiceDate,
//           customerName: invoice.customerName,
//           paymentMethod: 'Cash',
//           depositToAccountName: 'Kijichi Collection AC',
//           invoiceNo: invoice.invoiceNumber,
//           journalNo: '',
//           invoiceAmount: invoice.amount,
//           amount: 0,
//           referenceNo: '',
//           memo: '',
//           countryCode: '',
//           exchangeRate: '',
//         });
//       });
//       return;
//     }

//     // Track remaining balance for each invoice
//     const invoiceBalances = customerInvoices.map(inv => ({
//       invoice: inv,
//       remainingBalance: inv.amount,
//       fullyPaid: false
//     }));

//     let currentInvoiceIndex = 0;

//     // 🔥 Track payments by transaction for remainder appending
//     const paymentsByTransaction = new Map(); // transactionId -> array of payment records

//     // Process each transaction one by one
//     customerTransactions.forEach((transaction, txIdx) => {
//       let transactionAmount = transaction.amount;
//       let transactionUsed = false;
      
//       console.log(`\n   💳 Transaction ${txIdx + 1}/${customerTransactions.length}`);
//       console.log(`      Amount: TZS ${transactionAmount.toLocaleString()}`);
//       console.log(`      Date: ${transaction.receivedDateTime}`);
//       console.log(`      ID: ${transaction.transactionId || 'N/A'}`);

//       const originalTransactionAmount = transactionAmount; // 🔥 Track original amount
//       const transactionPayments = []; // Track payments made by this transaction

//       // Use this transaction to pay invoices
//       while (transactionAmount > 0 && currentInvoiceIndex < invoiceBalances.length) {
//         const currentInvoice = invoiceBalances[currentInvoiceIndex];
        
//         if (currentInvoice.fullyPaid) {
//           currentInvoiceIndex++;
//           continue;
//         }

//         const amountToPay = Math.min(transactionAmount, currentInvoice.remainingBalance);
        
//         console.log(`      → Paying Invoice #${currentInvoice.invoice.invoiceNumber}`);
//         console.log(`         Remaining balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
//         console.log(`         Paying: TZS ${amountToPay.toLocaleString()}`);

//         // Format date as MM-DD-YYYY
//         let formattedDate = transaction.receivedDateTime || transaction.receivedDate || currentInvoice.invoice.invoiceDate;
//         const dateObj = new Date(formattedDate);
//         if (!isNaN(dateObj.getTime())) {
//           const month = String(dateObj.getMonth() + 1).padStart(2, '0');
//           const day = String(dateObj.getDate()).padStart(2, '0');
//           const year = dateObj.getFullYear();
//           formattedDate = `${month}-${day}-${year}`;
//         }

//         // 🔥 Track total payment for this invoice
//         const currentTotal = invoiceTotalPayments.get(currentInvoice.invoice.invoiceNumber) || 0;
//         invoiceTotalPayments.set(currentInvoice.invoice.invoiceNumber, currentTotal + amountToPay);

//         // Create payment record
//         const paymentRecord = {
//           paymentDate: formattedDate,
//           customerName: currentInvoice.invoice.customerName,
//           paymentMethod: 'Cash',
//           depositToAccountName: 'Kijichi Collection AC',
//           invoiceNo: currentInvoice.invoice.invoiceNumber,
//           journalNo: '',
//           invoiceAmount: currentInvoice.invoice.amount,
//           amount: amountToPay,
//           referenceNo: '',
//           memo: transaction.transactionId || '',
//           countryCode: '',
//           exchangeRate: '',
//         };

//         processedPayments.push(paymentRecord);
//         transactionPayments.push(paymentRecord); // Track for this transaction

//         // Update balances
//         currentInvoice.remainingBalance -= amountToPay;
//         transactionAmount -= amountToPay;
//         transactionUsed = true;

//         console.log(`         New balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
//         console.log(`         Transaction remaining: TZS ${transactionAmount.toLocaleString()}`);

//         // Mark invoice as fully paid if balance <= 1 TZS
//         if (currentInvoice.remainingBalance <= 1) {
//           currentInvoice.fullyPaid = true;
//           currentInvoice.remainingBalance = 0;
//           console.log(`         ✅ Invoice #${currentInvoice.invoice.invoiceNumber} FULLY PAID!`);
//           currentInvoiceIndex++;
//         }
//       }

//       if (transactionUsed) {
//         usedTransactions.add(transaction.transactionId || transaction.id);
//       }

//       // 🔥 NEW: If there's overpayment, add it to the FIRST (newest) invoice payment
//       if (transactionAmount > 0 && transactionPayments.length > 0) {
//         const usedAmount = originalTransactionAmount - transactionAmount;
//         console.log(`      ⚠️ OVERPAYMENT REMAINDER: TZS ${transactionAmount.toLocaleString()}`);
//         console.log(`         Transaction: TZS ${originalTransactionAmount.toLocaleString()}`);
//         console.log(`         Used for invoices: TZS ${usedAmount.toLocaleString()}`);
//         console.log(`         Remainder: TZS ${transactionAmount.toLocaleString()}`);
//         console.log(`         → Adding remainder to FIRST (newest) invoice payment`);
        
//         // Find the FIRST payment made by this transaction (newest invoice)
//         const firstPayment = transactionPayments[0];
        
//         // Find this payment in processedPayments and update it
//         const paymentIndex = processedPayments.findIndex(p => p === firstPayment);
        
//         if (paymentIndex !== -1) {
//           const oldAmount = processedPayments[paymentIndex].amount;
//           processedPayments[paymentIndex].amount += transactionAmount;
          
//           console.log(`         ✅ Updated Invoice #${firstPayment.invoiceNo}:`);
//           console.log(`            Old amount: TZS ${oldAmount.toLocaleString()}`);
//           console.log(`            New amount: TZS ${processedPayments[paymentIndex].amount.toLocaleString()}`);
//           console.log(`            Remainder added: TZS ${transactionAmount.toLocaleString()}`);
//         }
//       } else if (transactionAmount > 0) {
//         console.log(`      ⚠️ Transaction has TZS ${transactionAmount.toLocaleString()} remaining but NO invoices paid`);
//       }
//     });

//     // Mark any unpaid invoices
//     invoiceBalances.forEach(invBalance => {
//       if (!invBalance.fullyPaid && invBalance.remainingBalance > 0) {
//         console.log(`   ❌ Invoice #${invBalance.invoice.invoiceNumber} UNPAID - Balance: TZS ${invBalance.remainingBalance.toLocaleString()}`);
        
//         const hasPayment = processedPayments.some(p => p.invoiceNo === invBalance.invoice.invoiceNumber);
//         if (!hasPayment) {
//           invoiceTotalPayments.set(invBalance.invoice.invoiceNumber, 0);
//           processedPayments.push({
//             paymentDate: invBalance.invoice.invoiceDate,
//             customerName: invBalance.invoice.customerName,
//             paymentMethod: 'Cash',
//             depositToAccountName: 'Kijichi Collection AC',
//             invoiceNo: invBalance.invoice.invoiceNumber,
//             journalNo: '',
//             invoiceAmount: invBalance.invoice.amount,
//             amount: 0,
//             referenceNo: '',
//             memo: '',
//             countryCode: '',
//             exchangeRate: '',
//           });
//         }
//       }
//     });
//   });

//   // 🔥 Add UNUSED transactions at the end
//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`🔍 CHECKING FOR UNUSED TRANSACTIONS`);
//   console.log(`${'='.repeat(80)}`);
  
//   const unusedTransactions = transactions.filter(transaction => {
//     const txId = transaction.transactionId || transaction.id;
//     return !usedTransactions.has(txId);
//   });

//   console.log(`✅ Used transactions: ${usedTransactions.size}`);
//   console.log(`⚠️ Unused transactions: ${unusedTransactions.length}`);

//   // 🔥 FIXED: Store REAL transaction amount instead of "UNUSED" string
//   unusedTransactions.forEach(transaction => {
//     let formattedDate = transaction.receivedDateTime || transaction.receivedDate || '';
//     const dateObj = new Date(formattedDate);
//     if (!isNaN(dateObj.getTime())) {
//       const month = String(dateObj.getMonth() + 1).padStart(2, '0');
//       const day = String(dateObj.getDate()).padStart(2, '0');
//       const year = dateObj.getFullYear();
//       formattedDate = `${month}-${day}-${year}`;
//     }

//     console.log(`   💰 UNUSED: ${transaction.customerName || transaction.contractName} | TZS ${transaction.amount.toLocaleString()} | ID: ${transaction.transactionId}`);

//     processedPayments.push({
//       paymentDate: formattedDate,
//       customerName: transaction.customerName || transaction.contractName || 'UNKNOWN',
//       paymentMethod: 'Cash',
//       depositToAccountName: 'Kijichi Collection AC',
//       invoiceNo: 'UNUSED',
//       journalNo: '',
//       invoiceAmount: 0, // 🔥 No invoice amount since it's unused
//       transactionAmount: transaction.amount, // 🔥 REAL transaction amount from Google Sheets
//       amount: transaction.amount, // 🔥 Use the REAL transaction amount
//       referenceNo: '',
//       memo: transaction.transactionId || '',
//       countryCode: '',
//       exchangeRate: '',
//       isUnused: true, // 🔥 Flag to identify unused transactions
//     });
//   });

//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`✅ PAYMENT PROCESSING COMPLETED`);
//   console.log(`${'='.repeat(80)}`);
//   console.log(`Total payment records: ${processedPayments.length}`);
//   console.log(`Used transactions: ${usedTransactions.size}`);
//   console.log(`Unused transactions: ${unusedTransactions.length}`);
  
//   const totalPaid = processedPayments
//     .filter(p => typeof p.amount === 'number' && p.amount > 0 && !p.isUnused)
//     .reduce((sum, p) => sum + p.amount, 0);
  
//   const totalUnused = processedPayments
//     .filter(p => p.isUnused)
//     .reduce((sum, p) => sum + (p.transactionAmount || 0), 0);
  
//   console.log(`Total amount paid (invoices only): TZS ${totalPaid.toLocaleString()}`);
//   console.log(`Total unused amount (including remainders): TZS ${totalUnused.toLocaleString()}`);
//   console.log(`\n`);
  
//   // 🔥 Add metadata to help frontend determine status
//   return processedPayments.map(payment => {
//     if (payment.invoiceNo === 'UNUSED' || payment.invoiceNo === 'UNUSED-REMAINDER') {
//       return payment;
//     }
    
//     const totalPaid = invoiceTotalPayments.get(payment.invoiceNo) || 0;
//     const isFullyPaid = Math.abs(totalPaid - payment.invoiceAmount) <= 1;
    
//     return {
//       ...payment,
//       isFullyPaid, // 🔥 Flag for frontend
//       totalPaidForInvoice: totalPaid
//     };
//   });
// }

// // 404 handler
// app.use((req, res) => {
//   res.status(404).json({
//     success: false,
//     message: 'Endpoint not found',
//     path: req.path
//   });
// });

// // Start server - bind to 0.0.0.0 for Render deployment
// app.listen(port, '0.0.0.0', () => {
//   console.log(`🚀 Server running on port ${port}`);
//   console.log(`📅 Filtering transactions from Jan 1, 2026 onwards`);
//   console.log(`📆 Accepting date formats: MM/DD/YYYY and DD Mon YYYY`);
// });

// module.exports = { processInvoicePayments };








// hii inafaa brother
// const express = require('express');
// const cors = require('cors');
// const multer = require('multer');
// const Papa = require('papaparse');
// const { google } = require('googleapis');
// require('dotenv').config();

// const app = express();
// const port = process.env.PORT || 5000;

// // Middleware
// app.use(cors({
//   origin: '*',
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
// }));
// app.use(express.json({ limit: '50mb' }));
// app.use(express.urlencoded({ limit: '50mb', extended: true }));

// // Configure multer for file uploads
// const upload = multer({ storage: multer.memoryStorage() });

// // Google Sheets configuration
// const SPREADSHEET_ID = '1N3ZxahtaFBX0iK3cijDraDmyZM8573PVVf8D-WVqicE';
// const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com';

// // 🔥 NEW: Minimum date filter - January 1, 2026
// const MIN_DATE_TIMESTAMP = new Date('2026-01-01T00:00:00+03:00').getTime();

// // Initialize Google Sheets API
// async function getGoogleSheetsClient() {
//   const auth = new google.auth.GoogleAuth({
//     credentials: {
//       type: 'service_account',
//       client_email: SERVICE_ACCOUNT_EMAIL,
//       private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
//       project_id: 'lmp-sms-sync',
//     },
//     scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
//   });

//   const client = await auth.getClient();
//   return google.sheets({ version: 'v4', auth: client });
// }

// // Parse dates in MM/DD/YYYY format or "22 Jan 2026, 05:16 pm (EAT)" format
// function parseEATDateTime(rawDate) {
//   if (!rawDate) return { display: null, timestamp: null, dateOnly: null, timeOnly: null };

//   try {
//     // Check if it's MM/DD/YYYY format (e.g., "01/23/2026")
//     const mmddyyyyPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
//     const mmddyyyyMatch = rawDate.match(mmddyyyyPattern);
    
//     if (mmddyyyyMatch) {
//       const [, month, day, year] = mmddyyyyMatch;
//       const parsed = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00+03:00`);
      
//       if (isNaN(parsed)) {
//         console.warn('Failed to parse MM/DD/YYYY date:', rawDate);
//         return { display: rawDate, timestamp: null, dateOnly: rawDate, timeOnly: null };
//       }
      
//       return {
//         display: rawDate,
//         timestamp: parsed.getTime(),
//         dateOnly: rawDate,
//         timeOnly: '00:00'
//       };
//     }
    
//     // Original format: "22 Jan 2026, 05:16 pm (EAT)"
//     const parts = rawDate.split(',').map(s => s.trim());
    
//     if (parts.length < 2) {
//       // No time, just date
//       const dateOnly = parts[0]; // "22 Jan 2026"
//       const parsed = new Date(`${dateOnly} 00:00:00 GMT+0300`);
      
//       return {
//         display: dateOnly,
//         timestamp: parsed.getTime(),
//         dateOnly: dateOnly,
//         timeOnly: '00:00'
//       };
//     }

//     const datePart = parts[0]; // "22 Jan 2026"
//     const timePart = parts[1].replace(/\s*\(EAT\)/, '').trim(); // "05:16 pm"

//     // Parse to EAT timezone (GMT+3) to avoid date shifts
//     const dateTimeStr = `${datePart} ${timePart} GMT+0300`;
//     const parsed = new Date(dateTimeStr);

//     if (isNaN(parsed)) {
//       console.warn('Failed to parse date:', rawDate);
//       return { display: rawDate, timestamp: null, dateOnly: datePart, timeOnly: null };
//     }

//     // Extract time in HH:mm format
//     const hours = String(parsed.getHours()).padStart(2, '0');
//     const minutes = String(parsed.getMinutes()).padStart(2, '0');
//     const timeOnly = `${hours}:${minutes}`;

//     return {
//       display: `${datePart}, ${timePart}`,
//       timestamp: parsed.getTime(),
//       dateOnly: datePart,
//       timeOnly: timeOnly,
//       iso: parsed.toISOString()
//     };

//   } catch (error) {
//     console.error('Error parsing date:', rawDate, error);
//     return { display: rawDate, timestamp: null, dateOnly: null, timeOnly: null };
//   }
// }

// // 🔥 UPDATED: Fetch transactions with DATE FILTER (only Jan 1, 2026+)
// async function fetchTransactions(sheetName, channel) {
//   try {
//     const sheets = await getGoogleSheetsClient();

//     const { data } = await sheets.spreadsheets.values.get({
//       spreadsheetId: SPREADSHEET_ID,
//       range: `${sheetName}!A2:H`,
//       majorDimension: 'ROWS',
//     });

//     const rows = data.values || [];
//     const results = [];
//     let filteredCount = 0;
//     let tooOldCount = 0;

//     console.log(`📊 Processing ${rows.length} rows from ${sheetName}...`);

//     for (let i = 0; i < rows.length; i++) {
//       const row = rows[i];

//       // Parse DateTime with TIME support
//       const dateTime = parseEATDateTime(row[2]);

//       // 🔥 NEW: Filter out messages before Jan 1, 2026
//       // Safety check: Only filter if we have a valid timestamp
//       if (dateTime.timestamp) {
//         if (dateTime.timestamp < MIN_DATE_TIMESTAMP) {
//           tooOldCount++;
//           continue; // Skip this row - too old
//         }
//       } else {
//         // No valid timestamp - log warning but keep the row
//         console.warn(`⚠️ Row ${i + 2} has invalid date: ${row[2]}`);
//       }

//       filteredCount++;

//       results.push({
//         id: row[7] || `${channel}-${i + 1}`,
//         channel,

//         paymentChannel: row[1] || null,
//         transactionMessage: row[3] || null,

//         customerPhone: row[4] || null,
//         customerName: row[5] || null,
//         contractName: row[5] || null,

//         amount: row[6] ? Number(row[6]) : null,

//         // NEW: Full DateTime info
//         receivedRaw: row[2], // "22 Jan 2026, 05:16 pm (EAT)" or "01/23/2026"
//         receivedDate: dateTime.dateOnly, // "22 Jan 2026" or "01/23/2026"
//         receivedTime: dateTime.timeOnly, // "17:16" (24-hour format)
//         receivedDateTime: dateTime.display, // "22 Jan 2026, 05:16 pm" or "01/23/2026"
//         receivedTimestamp: dateTime.timestamp, // Unix timestamp for filtering

//         transactionId: row[7] || null,
//       });
//     }

//     console.log(`✅ ${sheetName}: Fetched ${filteredCount} rows (${tooOldCount} filtered as too old)`);

//     return results;

//   } catch (error) {
//     console.error(`❌ Error fetching from ${sheetName}:`, error);
//     throw error;
//   }
// }

// // API Routes

// // Get all transactions (🔥 NOW FILTERED: Only Jan 1, 2026+)
// app.get('/api/transactions', async (req, res) => {
//   try {
//     console.log('🔍 Fetching transactions from all channels...');
    
//     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
//     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
//     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

//     const allTransactions = [
//       ...bodaTransactions,
//       ...iphoneTransactions,
//       ...lipaTransactions,
//     ];

//     console.log(`✅ Total transactions returned: ${allTransactions.length}`);

//     res.json({
//       success: true,
//       data: allTransactions,
//       count: allTransactions.length,
//       minDate: '2026-01-01', // 🔥 NEW: Show filter applied
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error fetching transactions',
//       error: error.message,
//     });
//   }
// });

// // Filter transactions by DATE + TIME range
// app.post('/api/transactions/filter', async (req, res) => {
//   try {
//     const { startDate, endDate, startTime, endTime, channel } = req.body;

//     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
//     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
//     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

//     let allTransactions = [
//       ...bodaTransactions,
//       ...iphoneTransactions,
//       ...lipaTransactions,
//     ];

//     // Filter by DATE + TIME range
//     if (startDate && endDate) {
//       const startTimeStr = startTime || '00:00';
//       const endTimeStr = endTime || '23:59';
      
//       // Create timestamps in EAT (GMT+3) to avoid date shifts
//       const startTimestamp = new Date(`${startDate} ${startTimeStr}:00 GMT+0300`).getTime();
//       const endTimestamp = new Date(`${endDate} ${endTimeStr}:59 GMT+0300`).getTime();
      
//       console.log('=== DateTime Filter ===');
//       console.log('Start:', new Date(startTimestamp).toISOString());
//       console.log('End:', new Date(endTimestamp).toISOString());
//       console.log('Total transactions before filter:', allTransactions.length);
      
//       allTransactions = allTransactions.filter(transaction => {
//         if (!transaction.receivedTimestamp) return false;
        
//         const isInRange = transaction.receivedTimestamp >= startTimestamp && 
//                          transaction.receivedTimestamp <= endTimestamp;
        
//         if (isInRange) {
//           console.log('✓ Matched:', {
//             dateTime: transaction.receivedDateTime,
//             customer: transaction.customerName || transaction.contractName,
//             amount: transaction.amount
//           });
//         }
        
//         return isInRange;
//       });
      
//       console.log('Total transactions after filter:', allTransactions.length);
//     }

//     // Filter by channel
//     if (channel && channel !== 'all') {
//       console.log('Filtering by channel:', channel);
//       allTransactions = allTransactions.filter(transaction => transaction.channel === channel);
//       console.log('After channel filter:', allTransactions.length);
//     }

//     res.json({
//       success: true,
//       data: allTransactions,
//       count: allTransactions.length,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error filtering transactions',
//       error: error.message,
//     });
//   }
// });

// // Upload and parse invoices CSV
// app.post('/api/invoices/upload', upload.single('file'), (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: 'No file uploaded',
//       });
//     }

//     const fileContent = req.file.buffer.toString('utf-8');
    
//     Papa.parse(fileContent, {
//       header: true,
//       skipEmptyLines: true,
//       complete: (results) => {
//         const invoices = results.data.map((row, index) => {
//           // Extract and clean the amount - remove commas and parse
//           const amountStr = (row['Amount'] || '0').toString().replace(/,/g, '');
//           const amount = parseFloat(amountStr) || 0;
          
//           return {
//             id: index + 1,
//             customerName: row['Customer'] || row['Customer Name'] || '',
//             invoiceNumber: row['Invoice No'] || row['Invoice Number'] || '',
//             amount: amount,
//             invoiceDate: row['Invoice Date'] || row['Date'] || '',
//             customerPhone: extractPhone(row['Customer'] || ''),
//           };
//         });

//         console.log('\n📤 CSV Upload Summary:');
//         console.log(`Total invoices: ${invoices.length}`);
//         if (invoices.length > 0) {
//           console.log('Sample invoice:', {
//             customer: invoices[0].customerName,
//             invoiceNo: invoices[0].invoiceNumber,
//             amount: invoices[0].amount,
//             date: invoices[0].invoiceDate
//           });
//         }

//         res.json({
//           success: true,
//           data: invoices,
//           count: invoices.length,
//         });
//       },
//       error: (error) => {
//         res.status(400).json({
//           success: false,
//           message: 'Error parsing CSV',
//           error: error.message,
//         });
//       },
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error processing file',
//       error: error.message,
//     });
//   }
// });

// // Process invoice payments
// app.post('/api/process-payments', async (req, res) => {
//   try {
//     const { invoices, startDate, endDate, startTime, endTime, channel } = req.body;

//     console.log('\n🔍 Fetching transactions for payment processing...');
//     console.log('Date range:', startDate, 'to', endDate);
//     console.log('Time range:', startTime || '00:00', 'to', endTime || '23:59');
//     console.log('Channel:', channel || 'all');

//     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
//     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
//     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

//     let allTransactions = [
//       ...bodaTransactions,
//       ...iphoneTransactions,
//       ...lipaTransactions,
//     ];

//     console.log(`📊 Total transactions fetched: ${allTransactions.length}`);

//     // 🔥 CRITICAL: Filter by DATE + TIME range
//     if (startDate && endDate) {
//       const startTimeStr = startTime || '00:00';
//       const endTimeStr = endTime || '23:59';
      
//       const startTimestamp = new Date(`${startDate} ${startTimeStr}:00 GMT+0300`).getTime();
//       const endTimestamp = new Date(`${endDate} ${endTimeStr}:59 GMT+0300`).getTime();
      
//       console.log('\n⏰ Applying DateTime Filter:');
//       console.log('Start:', new Date(startTimestamp).toISOString());
//       console.log('End:', new Date(endTimestamp).toISOString());
      
//       const beforeFilterCount = allTransactions.length;
      
//       allTransactions = allTransactions.filter(transaction => {
//         if (!transaction.receivedTimestamp) return false;
//         return transaction.receivedTimestamp >= startTimestamp && 
//                transaction.receivedTimestamp <= endTimestamp;
//       });
      
//       console.log(`✅ Filtered: ${beforeFilterCount} → ${allTransactions.length} transactions`);
//     } else {
//       console.warn('⚠️ WARNING: No date range provided! Using ALL transactions.');
//     }

//     // Filter by channel
//     if (channel && channel !== 'all') {
//       const beforeChannelFilter = allTransactions.length;
//       allTransactions = allTransactions.filter(transaction => transaction.channel === channel);
//       console.log(`📡 Channel filter (${channel}): ${beforeChannelFilter} → ${allTransactions.length} transactions`);
//     }

//     console.log(`\n💵 FINAL: Processing ${allTransactions.length} transactions for ${invoices.length} invoices`);

//     // 🔥 CRITICAL: Only use the FILTERED transactions for payment processing
//     const processedInvoices = processInvoicePayments(invoices, allTransactions);

//     res.json({
//       success: true,
//       data: processedInvoices,
//     });
//   } catch (error) {
//     console.error('❌ Error processing payments:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error processing payments',
//       error: error.message,
//     });
//   }
// });

// // Helper function to extract phone
// function extractPhone(customerName) {
//   const phoneMatch = customerName.match(/\d{10,}/);
//   return phoneMatch ? phoneMatch[0] : null;
// }

// // Health check endpoint
// app.get('/', (req, res) => {
//   res.json({
//     success: true,
//     message: 'Invoice Payment API is running!',
//     version: '2.1.0',
//     features: ['DateTime filtering', 'EAT timezone support', 'Jan 1, 2026+ date filter', 'MM/DD/YYYY date format support'],
//     minDate: '2026-01-01',
//     dateFormats: ['MM/DD/YYYY', 'DD Mon YYYY, HH:mm am/pm (EAT)'],
//     endpoints: {
//       transactions: '/api/transactions',
//       filter: '/api/transactions/filter',
//       upload: '/api/invoices/upload',
//       process: '/api/process-payments',
//       export: '/api/export-payments'
//     }
//   });
// });

// // Export payments endpoint
// app.post('/api/export-payments', (req, res) => {
//   try {
//     const { payments } = req.body;
    
//     // Format data for QuickBooks with proper column names and casing
//     const formattedPayments = payments.map(payment => ({
//       'Payment Date': payment.paymentDate,
//       'Customer': payment.customerName.toUpperCase(), // ✅ UPPERCASE
//       'Payment Method': payment.paymentMethod,
//       'Deposit To Account Name': payment.depositToAccountName,
//       'Invoice No': payment.invoiceNo,
//       'Journal No': payment.journalNo || '',
//       'Amount': payment.amount,
//       'Reference No': payment.referenceNo || '',
//       'Memo': payment.memo || '',
//       'Country Code': payment.countryCode || '',
//       'Exchange Rate': payment.exchangeRate || '',
//     }));
    
//     const csv = Papa.unparse(formattedPayments, {
//       header: true,
//     });

//     res.setHeader('Content-Type', 'text/csv');
//     res.setHeader('Content-Disposition', 'attachment; filename=processed_payments.csv');
//     res.send(csv);
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error exporting payments',
//       error: error.message,
//     });
//   }
// });

// // Main payment processing logic
// function processInvoicePayments(invoices, transactions) {
//   console.log('\n========================================');
//   console.log('=== PAYMENT PROCESSING STARTED ===');
//   console.log('=== TRANSACTION-BY-TRANSACTION MODE ===');
//   console.log('========================================');
//   console.log('📋 Invoices to process:', invoices.length);
//   console.log('💵 Transactions available (WITHIN TIME FRAME):', transactions.length);
  
//   const usedTransactions = new Set();
//   // 🔥 NEW: Track total payments per invoice for accurate status
//   const invoiceTotalPayments = new Map(); // invoiceNo -> total amount paid
  
//   // Step 1: Group invoices by customer
//   const invoicesByCustomer = {};
  
//   invoices.forEach(invoice => {
//     const key = invoice.customerPhone || invoice.customerName.toLowerCase().trim();
//     if (!invoicesByCustomer[key]) {
//       invoicesByCustomer[key] = [];
//     }
//     invoicesByCustomer[key].push(invoice);
//   });

//   console.log(`\n👥 Found ${Object.keys(invoicesByCustomer).length} unique customers with invoices`);

//   // Step 2: Sort each customer's invoices by date (DESCENDING - newest first)
//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     invoicesByCustomer[customerKey].sort((a, b) => {
//       const dateCompare = new Date(b.invoiceDate) - new Date(a.invoiceDate);
//       if (dateCompare !== 0) return dateCompare;
//       return b.invoiceNumber.localeCompare(a.invoiceNumber);
//     });
    
//     console.log(`\n📋 Customer: "${customerKey}"`);
//     console.log(`   Total invoices: ${invoicesByCustomer[customerKey].length}`);
//     console.log('   Invoices sorted (NEWEST → OLDEST):');
//     invoicesByCustomer[customerKey].forEach((inv, idx) => {
//       console.log(`      ${idx + 1}. Invoice #${inv.invoiceNumber} | Date: ${inv.invoiceDate} | Amount: TZS ${inv.amount.toLocaleString()}`);
//     });
//   });

//   // Step 3: Group transactions by customer
//   const transactionsByCustomer = {};
//   const processedTransactionIds = new Set();
  
//   transactions.forEach(transaction => {
//     if (!transaction.amount) return;
    
//     const transactionUniqueId = `${transaction.transactionId || transaction.id}_${transaction.receivedTimestamp}_${transaction.amount}`;
    
//     if (processedTransactionIds.has(transactionUniqueId)) {
//       console.warn(`⚠️ Skipping duplicate transaction: ${transaction.transactionId}`);
//       return;
//     }
    
//     const keys = [
//       transaction.customerPhone,
//       transaction.contractName?.toLowerCase().trim(),
//       transaction.customerName?.toLowerCase().trim()
//     ].filter(Boolean);
    
//     const matchedKey = keys.find(key => invoicesByCustomer[key]);
    
//     if (matchedKey) {
//       if (!transactionsByCustomer[matchedKey]) {
//         transactionsByCustomer[matchedKey] = [];
//       }
//       transactionsByCustomer[matchedKey].push(transaction);
//       processedTransactionIds.add(transactionUniqueId);
//     } else {
//       const primaryKey = keys[0];
//       if (primaryKey) {
//         if (!transactionsByCustomer[primaryKey]) {
//           transactionsByCustomer[primaryKey] = [];
//         }
//         transactionsByCustomer[primaryKey].push(transaction);
//         processedTransactionIds.add(transactionUniqueId);
//       }
//     }
//   });

//   // Sort transactions by timestamp (oldest first - FIFO)
//   Object.keys(transactionsByCustomer).forEach(customerKey => {
//     transactionsByCustomer[customerKey].sort((a, b) => {
//       return (a.receivedTimestamp || 0) - (b.receivedTimestamp || 0);
//     });
//   });

//   console.log(`\n💰 Found ${Object.keys(transactionsByCustomer).length} unique customers with transactions`);

//   // Step 4: Process transaction-by-transaction
//   const processedPayments = [];

//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     const customerInvoices = invoicesByCustomer[customerKey];
//     const customerTransactions = transactionsByCustomer[customerKey] || [];
    
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`💵 PROCESSING: "${customerKey}"`);
//     console.log(`${'='.repeat(80)}`);
//     console.log(`   Transactions: ${customerTransactions.length}`);
//     console.log(`   Invoices: ${customerInvoices.length}`);
    
//     if (customerTransactions.length === 0) {
//       console.log(`   ⚠️ No transactions found - marking all invoices as UNPAID`);
      
//       customerInvoices.forEach(invoice => {
//         invoiceTotalPayments.set(invoice.invoiceNumber, 0);
//         processedPayments.push({
//           paymentDate: invoice.invoiceDate,
//           customerName: invoice.customerName,
//           paymentMethod: 'Cash',
//           depositToAccountName: 'Kijichi Collection AC',
//           invoiceNo: invoice.invoiceNumber,
//           journalNo: '',
//           invoiceAmount: invoice.amount,
//           amount: 0,
//           referenceNo: '',
//           memo: '',
//           countryCode: '',
//           exchangeRate: '',
//         });
//       });
//       return;
//     }

//     // Track remaining balance for each invoice
//     const invoiceBalances = customerInvoices.map(inv => ({
//       invoice: inv,
//       remainingBalance: inv.amount,
//       fullyPaid: false
//     }));

//     let currentInvoiceIndex = 0;

//     // Process each transaction one by one
//     customerTransactions.forEach((transaction, txIdx) => {
//       let transactionAmount = transaction.amount;
//       let transactionUsed = false;
      
//       console.log(`\n   💳 Transaction ${txIdx + 1}/${customerTransactions.length}`);
//       console.log(`      Amount: TZS ${transactionAmount.toLocaleString()}`);
//       console.log(`      Date: ${transaction.receivedDateTime}`);
//       console.log(`      ID: ${transaction.transactionId || 'N/A'}`);

//       // Use this transaction to pay invoices
//       while (transactionAmount > 0 && currentInvoiceIndex < invoiceBalances.length) {
//         const currentInvoice = invoiceBalances[currentInvoiceIndex];
        
//         if (currentInvoice.fullyPaid) {
//           currentInvoiceIndex++;
//           continue;
//         }

//         const amountToPay = Math.min(transactionAmount, currentInvoice.remainingBalance);
        
//         console.log(`      → Paying Invoice #${currentInvoice.invoice.invoiceNumber}`);
//         console.log(`         Remaining balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
//         console.log(`         Paying: TZS ${amountToPay.toLocaleString()}`);

//         // Format date as MM-DD-YYYY
//         let formattedDate = transaction.receivedDateTime || transaction.receivedDate || currentInvoice.invoice.invoiceDate;
//         const dateObj = new Date(formattedDate);
//         if (!isNaN(dateObj.getTime())) {
//           const month = String(dateObj.getMonth() + 1).padStart(2, '0');
//           const day = String(dateObj.getDate()).padStart(2, '0');
//           const year = dateObj.getFullYear();
//           formattedDate = `${month}-${day}-${year}`;
//         }

//         // 🔥 Track total payment for this invoice
//         const currentTotal = invoiceTotalPayments.get(currentInvoice.invoice.invoiceNumber) || 0;
//         invoiceTotalPayments.set(currentInvoice.invoice.invoiceNumber, currentTotal + amountToPay);

//         // Create payment record
//         processedPayments.push({
//           paymentDate: formattedDate,
//           customerName: currentInvoice.invoice.customerName,
//           paymentMethod: 'Cash',
//           depositToAccountName: 'Kijichi Collection AC',
//           invoiceNo: currentInvoice.invoice.invoiceNumber,
//           journalNo: '',
//           invoiceAmount: currentInvoice.invoice.amount,
//           amount: amountToPay,
//           referenceNo: '',
//           memo: transaction.transactionId || '',
//           countryCode: '',
//           exchangeRate: '',
//         });

//         // Update balances
//         currentInvoice.remainingBalance -= amountToPay;
//         transactionAmount -= amountToPay;
//         transactionUsed = true;

//         console.log(`         New balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
//         console.log(`         Transaction remaining: TZS ${transactionAmount.toLocaleString()}`);

//         // Mark invoice as fully paid if balance <= 1 TZS
//         if (currentInvoice.remainingBalance <= 1) {
//           currentInvoice.fullyPaid = true;
//           currentInvoice.remainingBalance = 0;
//           console.log(`         ✅ Invoice #${currentInvoice.invoice.invoiceNumber} FULLY PAID!`);
//           currentInvoiceIndex++;
//         }
//       }

//       if (transactionUsed) {
//         usedTransactions.add(transaction.transactionId || transaction.id);
//       }

//       if (transactionAmount > 0) {
//         console.log(`      ⚠️ Transaction has TZS ${transactionAmount.toLocaleString()} remaining (overpayment)`);
//       }
//     });

//     // Mark any unpaid invoices
//     invoiceBalances.forEach(invBalance => {
//       if (!invBalance.fullyPaid && invBalance.remainingBalance > 0) {
//         console.log(`   ❌ Invoice #${invBalance.invoice.invoiceNumber} UNPAID - Balance: TZS ${invBalance.remainingBalance.toLocaleString()}`);
        
//         const hasPayment = processedPayments.some(p => p.invoiceNo === invBalance.invoice.invoiceNumber);
//         if (!hasPayment) {
//           invoiceTotalPayments.set(invBalance.invoice.invoiceNumber, 0);
//           processedPayments.push({
//             paymentDate: invBalance.invoice.invoiceDate,
//             customerName: invBalance.invoice.customerName,
//             paymentMethod: 'Cash',
//             depositToAccountName: 'Kijichi Collection AC',
//             invoiceNo: invBalance.invoice.invoiceNumber,
//             journalNo: '',
//             invoiceAmount: invBalance.invoice.amount,
//             amount: 0,
//             referenceNo: '',
//             memo: '',
//             countryCode: '',
//             exchangeRate: '',
//           });
//         }
//       }
//     });
//   });

//   // 🔥 Add UNUSED transactions at the end
//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`🔍 CHECKING FOR UNUSED TRANSACTIONS`);
//   console.log(`${'='.repeat(80)}`);
  
//   const unusedTransactions = transactions.filter(transaction => {
//     const txId = transaction.transactionId || transaction.id;
//     return !usedTransactions.has(txId);
//   });

//   console.log(`✅ Used transactions: ${usedTransactions.size}`);
//   console.log(`⚠️ Unused transactions: ${unusedTransactions.length}`);

//   // 🔥 FIXED: Store REAL transaction amount instead of "UNUSED" string
//   unusedTransactions.forEach(transaction => {
//     let formattedDate = transaction.receivedDateTime || transaction.receivedDate || '';
//     const dateObj = new Date(formattedDate);
//     if (!isNaN(dateObj.getTime())) {
//       const month = String(dateObj.getMonth() + 1).padStart(2, '0');
//       const day = String(dateObj.getDate()).padStart(2, '0');
//       const year = dateObj.getFullYear();
//       formattedDate = `${month}-${day}-${year}`;
//     }

//     console.log(`   💰 UNUSED: ${transaction.customerName || transaction.contractName} | TZS ${transaction.amount.toLocaleString()} | ID: ${transaction.transactionId}`);

//     processedPayments.push({
//       paymentDate: formattedDate,
//       customerName: transaction.customerName || transaction.contractName || 'UNKNOWN',
//       paymentMethod: 'Cash',
//       depositToAccountName: 'Kijichi Collection AC',
//       invoiceNo: 'UNUSED',
//       journalNo: '',
//       invoiceAmount: 0, // 🔥 No invoice amount since it's unused
//       transactionAmount: transaction.amount, // 🔥 REAL transaction amount from Google Sheets
//       amount: transaction.amount, // 🔥 Use the REAL transaction amount
//       referenceNo: '',
//       memo: transaction.transactionId || '',
//       countryCode: '',
//       exchangeRate: '',
//       isUnused: true, // 🔥 Flag to identify unused transactions
//     });
//   });

//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`✅ PAYMENT PROCESSING COMPLETED`);
//   console.log(`${'='.repeat(80)}`);
//   console.log(`Total payment records: ${processedPayments.length}`);
//   console.log(`Used transactions: ${usedTransactions.size}`);
//   console.log(`Unused transactions: ${unusedTransactions.length}`);
  
//   const totalPaid = processedPayments
//     .filter(p => typeof p.amount === 'number' && p.amount > 0 && !p.isUnused)
//     .reduce((sum, p) => sum + p.amount, 0);
  
//   const totalUnused = processedPayments
//     .filter(p => p.isUnused)
//     .reduce((sum, p) => sum + (p.transactionAmount || 0), 0);
  
//   console.log(`Total amount paid (invoices only): TZS ${totalPaid.toLocaleString()}`);
//   console.log(`Total unused amount: TZS ${totalUnused.toLocaleString()}`);
//   console.log(`\n`);
  
//   // 🔥 Add metadata to help frontend determine status
//   return processedPayments.map(payment => {
//     if (payment.invoiceNo === 'UNUSED') {
//       return payment;
//     }
    
//     const totalPaid = invoiceTotalPayments.get(payment.invoiceNo) || 0;
//     const isFullyPaid = Math.abs(totalPaid - payment.invoiceAmount) <= 1;
    
//     return {
//       ...payment,
//       isFullyPaid, // 🔥 Flag for frontend
//       totalPaidForInvoice: totalPaid
//     };
//   });
// }

// // 404 handler
// app.use((req, res) => {
//   res.status(404).json({
//     success: false,
//     message: 'Endpoint not found',
//     path: req.path
//   });
// });

// // Start server - bind to 0.0.0.0 for Render deployment
// app.listen(port, '0.0.0.0', () => {
//   console.log(`🚀 Server running on port ${port}`);
//   console.log(`📅 Filtering transactions from Jan 1, 2026 onwards`);
//   console.log(`📆 Accepting date formats: MM/DD/YYYY and DD Mon YYYY`);
// });

// module.exports = { processInvoicePayments };




// const express = require('express');
// const cors = require('cors');
// const multer = require('multer');
// const Papa = require('papaparse');
// const { google } = require('googleapis');
// require('dotenv').config();


// const app = express();
// const port = process.env.PORT || 5000;


// // Middleware
// app.use(cors({
//   origin: '*',
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
// }));
// app.use(express.json({ limit: '50mb' }));
// app.use(express.urlencoded({ limit: '50mb', extended: true }));


// // Configure multer for file uploads
// const upload = multer({ storage: multer.memoryStorage() });


// // Google Sheets configuration
// const SPREADSHEET_ID = '1N3ZxahtaFBX0iK3cijDraDmyZM8573PVVf8D-WVqicE';
// const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com';


// // 🔥 NEW: Minimum date filter - January 1, 2026
// const MIN_DATE_TIMESTAMP = new Date('2026-01-01T00:00:00+03:00').getTime();


// // Initialize Google Sheets API
// async function getGoogleSheetsClient() {
//   const auth = new google.auth.GoogleAuth({
//     credentials: {
//       type: 'service_account',
//       client_email: SERVICE_ACCOUNT_EMAIL,
//       private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
//       project_id: 'lmp-sms-sync',
//     },
//     scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
//   });


//   const client = await auth.getClient();
//   return google.sheets({ version: 'v4', auth: client });
// }


// // Parse dates in MM/DD/YYYY format or "22 Jan 2026, 05:16 pm (EAT)" format
// function parseEATDateTime(rawDate) {
//   if (!rawDate) return { display: null, timestamp: null, dateOnly: null, timeOnly: null };


//   try {
//     // Check if it's MM/DD/YYYY format (e.g., "01/23/2026")
//     const mmddyyyyPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
//     const mmddyyyyMatch = rawDate.match(mmddyyyyPattern);
    
//     if (mmddyyyyMatch) {
//       const [, month, day, year] = mmddyyyyMatch;
//       const parsed = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00+03:00`);
      
//       if (isNaN(parsed)) {
//         console.warn('Failed to parse MM/DD/YYYY date:', rawDate);
//         return { display: rawDate, timestamp: null, dateOnly: rawDate, timeOnly: null };
//       }
      
//       return {
//         display: rawDate,
//         timestamp: parsed.getTime(),
//         dateOnly: rawDate,
//         timeOnly: '00:00'
//       };
//     }
    
//     // Original format: "22 Jan 2026, 05:16 pm (EAT)"
//     const parts = rawDate.split(',').map(s => s.trim());
    
//     if (parts.length < 2) {
//       // No time, just date
//       const dateOnly = parts[0]; // "22 Jan 2026"
//       const parsed = new Date(`${dateOnly} 00:00:00 GMT+0300`);
      
//       return {
//         display: dateOnly,
//         timestamp: parsed.getTime(),
//         dateOnly: dateOnly,
//         timeOnly: '00:00'
//       };
//     }


//     const datePart = parts[0]; // "22 Jan 2026"
//     const timePart = parts[1].replace(/\s*\(EAT\)/, '').trim(); // "05:16 pm"


//     // Parse to EAT timezone (GMT+3) to avoid date shifts
//     const dateTimeStr = `${datePart} ${timePart} GMT+0300`;
//     const parsed = new Date(dateTimeStr);


//     if (isNaN(parsed)) {
//       console.warn('Failed to parse date:', rawDate);
//       return { display: rawDate, timestamp: null, dateOnly: datePart, timeOnly: null };
//     }


//     // Extract time in HH:mm format
//     const hours = String(parsed.getHours()).padStart(2, '0');
//     const minutes = String(parsed.getMinutes()).padStart(2, '0');
//     const timeOnly = `${hours}:${minutes}`;


//     return {
//       display: `${datePart}, ${timePart}`,
//       timestamp: parsed.getTime(),
//       dateOnly: datePart,
//       timeOnly: timeOnly,
//       iso: parsed.toISOString()
//     };


//   } catch (error) {
//     console.error('Error parsing date:', rawDate, error);
//     return { display: rawDate, timestamp: null, dateOnly: null, timeOnly: null };
//   }
// }


// // 🔥 UPDATED: Fetch transactions with DATE FILTER (only Jan 1, 2026+)
// async function fetchTransactions(sheetName, channel) {
//   try {
//     const sheets = await getGoogleSheetsClient();


//     const { data } = await sheets.spreadsheets.values.get({
//       spreadsheetId: SPREADSHEET_ID,
//       range: `${sheetName}!A2:H`,
//       majorDimension: 'ROWS',
//     });


//     const rows = data.values || [];
//     const results = [];
//     let filteredCount = 0;
//     let tooOldCount = 0;


//     console.log(`📊 Processing ${rows.length} rows from ${sheetName}...`);


//     for (let i = 0; i < rows.length; i++) {
//       const row = rows[i];


//       // Parse DateTime with TIME support
//       const dateTime = parseEATDateTime(row[2]);


//       // 🔥 NEW: Filter out messages before Jan 1, 2026
//       // Safety check: Only filter if we have a valid timestamp
//       if (dateTime.timestamp) {
//         if (dateTime.timestamp < MIN_DATE_TIMESTAMP) {
//           tooOldCount++;
//           continue; // Skip this row - too old
//         }
//       } else {
//         // No valid timestamp - log warning but keep the row
//         console.warn(`⚠️ Row ${i + 2} has invalid date: ${row[2]}`);
//       }


//       filteredCount++;


//       results.push({
//         id: row[7] || `${channel}-${i + 1}`,
//         channel,


//         paymentChannel: row[1] || null,
//         transactionMessage: row[3] || null,


//         customerPhone: row[4] || null,
//         customerName: row[5] || null,
//         contractName: row[5] || null,


//         amount: row[6] ? Number(row[6]) : null,


//         // NEW: Full DateTime info
//         receivedRaw: row[2], // "22 Jan 2026, 05:16 pm (EAT)" or "01/23/2026"
//         receivedDate: dateTime.dateOnly, // "22 Jan 2026" or "01/23/2026"
//         receivedTime: dateTime.timeOnly, // "17:16" (24-hour format)
//         receivedDateTime: dateTime.display, // "22 Jan 2026, 05:16 pm" or "01/23/2026"
//         receivedTimestamp: dateTime.timestamp, // Unix timestamp for filtering


//         transactionId: row[7] || null,
//       });
//     }


//     console.log(`✅ ${sheetName}: Fetched ${filteredCount} rows (${tooOldCount} filtered as too old)`);


//     return results;


//   } catch (error) {
//     console.error(`❌ Error fetching from ${sheetName}:`, error);
//     throw error;
//   }
// }


// // API Routes


// // Get all transactions (🔥 NOW FILTERED: Only Jan 1, 2026+)
// app.get('/api/transactions', async (req, res) => {
//   try {
//     console.log('🔍 Fetching transactions from all channels...');
    
//     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
//     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
//     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');


//     const allTransactions = [
//       ...bodaTransactions,
//       ...iphoneTransactions,
//       ...lipaTransactions,
//     ];


//     console.log(`✅ Total transactions returned: ${allTransactions.length}`);


//     res.json({
//       success: true,
//       data: allTransactions,
//       count: allTransactions.length,
//       minDate: '2026-01-01', // 🔥 NEW: Show filter applied
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error fetching transactions',
//       error: error.message,
//     });
//   }
// });


// // Filter transactions by DATE + TIME range
// app.post('/api/transactions/filter', async (req, res) => {
//   try {
//     const { startDate, endDate, startTime, endTime, channel } = req.body;


//     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
//     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
//     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');


//     let allTransactions = [
//       ...bodaTransactions,
//       ...iphoneTransactions,
//       ...lipaTransactions,
//     ];


//     // Filter by DATE + TIME range
//     if (startDate && endDate) {
//       const startTimeStr = startTime || '00:00';
//       const endTimeStr = endTime || '23:59';
      
//       // Create timestamps in EAT (GMT+3) to avoid date shifts
//       const startTimestamp = new Date(`${startDate} ${startTimeStr}:00 GMT+0300`).getTime();
//       const endTimestamp = new Date(`${endDate} ${endTimeStr}:59 GMT+0300`).getTime();
      
//       console.log('=== DateTime Filter ===');
//       console.log('Start:', new Date(startTimestamp).toISOString());
//       console.log('End:', new Date(endTimestamp).toISOString());
//       console.log('Total transactions before filter:', allTransactions.length);
      
//       allTransactions = allTransactions.filter(transaction => {
//         if (!transaction.receivedTimestamp) return false;
        
//         const isInRange = transaction.receivedTimestamp >= startTimestamp && 
//                          transaction.receivedTimestamp <= endTimestamp;
        
//         if (isInRange) {
//           console.log('✓ Matched:', {
//             dateTime: transaction.receivedDateTime,
//             customer: transaction.customerName || transaction.contractName,
//             amount: transaction.amount
//           });
//         }
        
//         return isInRange;
//       });
      
//       console.log('Total transactions after filter:', allTransactions.length);
//     }


//     // Filter by channel
//     if (channel && channel !== 'all') {
//       console.log('Filtering by channel:', channel);
//       allTransactions = allTransactions.filter(transaction => transaction.channel === channel);
//       console.log('After channel filter:', allTransactions.length);
//     }


//     res.json({
//       success: true,
//       data: allTransactions,
//       count: allTransactions.length,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error filtering transactions',
//       error: error.message,
//     });
//   }
// });


// // Upload and parse invoices CSV
// app.post('/api/invoices/upload', upload.single('file'), (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: 'No file uploaded',
//       });
//     }


//     const fileContent = req.file.buffer.toString('utf-8');
    
//     Papa.parse(fileContent, {
//       header: true,
//       skipEmptyLines: true,
//       complete: (results) => {
//         const invoices = results.data.map((row, index) => {
//           // Extract and clean the amount - remove commas and parse
//           const amountStr = (row['Amount'] || '0').toString().replace(/,/g, '');
//           const amount = parseFloat(amountStr) || 0;
          
//           return {
//             id: index + 1,
//             customerName: row['Customer'] || row['Customer Name'] || '',
//             invoiceNumber: row['Invoice No'] || row['Invoice Number'] || '',
//             amount: amount,
//             invoiceDate: row['Invoice Date'] || row['Date'] || '',
//             customerPhone: extractPhone(row['Customer'] || ''),
//           };
//         });


//         console.log('\n📤 CSV Upload Summary:');
//         console.log(`Total invoices: ${invoices.length}`);
//         if (invoices.length > 0) {
//           console.log('Sample invoice:', {
//             customer: invoices[0].customerName,
//             invoiceNo: invoices[0].invoiceNumber,
//             amount: invoices[0].amount,
//             date: invoices[0].invoiceDate
//           });
//         }


//         res.json({
//           success: true,
//           data: invoices,
//           count: invoices.length,
//         });
//       },
//       error: (error) => {
//         res.status(400).json({
//           success: false,
//           message: 'Error parsing CSV',
//           error: error.message,
//         });
//       },
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error processing file',
//       error: error.message,
//     });
//   }
// });


// // Process invoice payments
// app.post('/api/process-payments', async (req, res) => {
//   try {
//     const { invoices, startDate, endDate, startTime, endTime, channel } = req.body;


//     console.log('\n🔍 Fetching transactions for payment processing...');
//     console.log('Date range:', startDate, 'to', endDate);
//     console.log('Time range:', startTime || '00:00', 'to', endTime || '23:59');
//     console.log('Channel:', channel || 'all');


//     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
//     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
//     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');


//     let allTransactions = [
//       ...bodaTransactions,
//       ...iphoneTransactions,
//       ...lipaTransactions,
//     ];


//     console.log(`📊 Total transactions fetched: ${allTransactions.length}`);


//     // 🔥 CRITICAL: Filter by DATE + TIME range
//     if (startDate && endDate) {
//       const startTimeStr = startTime || '00:00';
//       const endTimeStr = endTime || '23:59';
      
//       const startTimestamp = new Date(`${startDate} ${startTimeStr}:00 GMT+0300`).getTime();
//       const endTimestamp = new Date(`${endDate} ${endTimeStr}:59 GMT+0300`).getTime();
      
//       console.log('\n⏰ Applying DateTime Filter:');
//       console.log('Start:', new Date(startTimestamp).toISOString());
//       console.log('End:', new Date(endTimestamp).toISOString());
      
//       const beforeFilterCount = allTransactions.length;
      
//       allTransactions = allTransactions.filter(transaction => {
//         if (!transaction.receivedTimestamp) return false;
//         return transaction.receivedTimestamp >= startTimestamp && 
//                transaction.receivedTimestamp <= endTimestamp;
//       });
      
//       console.log(`✅ Filtered: ${beforeFilterCount} → ${allTransactions.length} transactions`);
//     } else {
//       console.warn('⚠️ WARNING: No date range provided! Using ALL transactions.');
//     }


//     // Filter by channel
//     if (channel && channel !== 'all') {
//       const beforeChannelFilter = allTransactions.length;
//       allTransactions = allTransactions.filter(transaction => transaction.channel === channel);
//       console.log(`📡 Channel filter (${channel}): ${beforeChannelFilter} → ${allTransactions.length} transactions`);
//     }


//     console.log(`\n💵 FINAL: Processing ${allTransactions.length} transactions for ${invoices.length} invoices`);


//     // 🔥 CRITICAL: Only use the FILTERED transactions for payment processing
//     const processedInvoices = processInvoicePayments(invoices, allTransactions);


//     res.json({
//       success: true,
//       data: processedInvoices,
//     });
//   } catch (error) {
//     console.error('❌ Error processing payments:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error processing payments',
//       error: error.message,
//     });
//   }
// });


// // Helper function to extract phone
// function extractPhone(customerName) {
//   const phoneMatch = customerName.match(/\d{10,}/);
//   return phoneMatch ? phoneMatch[0] : null;
// }


// // Health check endpoint
// app.get('/', (req, res) => {
//   res.json({
//     success: true,
//     message: 'Invoice Payment API is running!',
//     version: '2.1.0',
//     features: ['DateTime filtering', 'EAT timezone support', 'Jan 1, 2026+ date filter', 'MM/DD/YYYY date format support'],
//     minDate: '2026-01-01',
//     dateFormats: ['MM/DD/YYYY', 'DD Mon YYYY, HH:mm am/pm (EAT)'],
//     endpoints: {
//       transactions: '/api/transactions',
//       filter: '/api/transactions/filter',
//       upload: '/api/invoices/upload',
//       process: '/api/process-payments',
//       export: '/api/export-payments'
//     }
//   });
// });


// // Export payments endpoint
// app.post('/api/export-payments', (req, res) => {
//   try {
//     const { payments } = req.body;
    
//     // Format data for QuickBooks with proper column names and casing
//     const formattedPayments = payments.map(payment => ({
//       'Payment Date': payment.paymentDate,
//       'Customer': payment.customerName.toUpperCase(), // ✅ UPPERCASE
//       'Payment Method': payment.paymentMethod,
//       'Deposit To Account Name': payment.depositToAccountName,
//       'Invoice No': payment.invoiceNo,
//       'Journal No': payment.journalNo || '',
//       'Amount': payment.amount,
//       'Reference No': payment.referenceNo || '',
//       'Memo': payment.memo || '',
//       'Country Code': payment.countryCode || '',
//       'Exchange Rate': payment.exchangeRate || '',
//     }));
    
//     const csv = Papa.unparse(formattedPayments, {
//       header: true,
//     });


//     res.setHeader('Content-Type', 'text/csv');
//     res.setHeader('Content-Disposition', 'attachment; filename=processed_payments.csv');
//     res.send(csv);
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error exporting payments',
//       error: error.message,
//     });
//   }
// });


// // Main payment processing logic
// function processInvoicePayments(invoices, transactions) {
//   console.log('\n========================================');
//   console.log('=== PAYMENT PROCESSING STARTED ===');
//   console.log('=== TRANSACTION-BY-TRANSACTION MODE ===');
//   console.log('========================================');
//   console.log('📋 Invoices to process:', invoices.length);
//   console.log('💵 Transactions available (WITHIN TIME FRAME):', transactions.length);
  
//   const usedTransactions = new Set();
//   // 🔥 NEW: Track total payments per invoice for accurate status
//   const invoiceTotalPayments = new Map(); // invoiceNo -> total amount paid
  
//   // Step 1: Group invoices by customer
//   const invoicesByCustomer = {};
  
//   invoices.forEach(invoice => {
//     const key = invoice.customerPhone || invoice.customerName.toLowerCase().trim();
//     if (!invoicesByCustomer[key]) {
//       invoicesByCustomer[key] = [];
//     }
//     invoicesByCustomer[key].push(invoice);
//   });


//   console.log(`\n👥 Found ${Object.keys(invoicesByCustomer).length} unique customers with invoices`);


//   // Step 2: Sort each customer's invoices by date (DESCENDING - newest first)
//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     invoicesByCustomer[customerKey].sort((a, b) => {
//       const dateCompare = new Date(b.invoiceDate) - new Date(a.invoiceDate);
//       if (dateCompare !== 0) return dateCompare;
//       return b.invoiceNumber.localeCompare(a.invoiceNumber);
//     });
    
//     console.log(`\n📋 Customer: "${customerKey}"`);
//     console.log(`   Total invoices: ${invoicesByCustomer[customerKey].length}`);
//     console.log('   Invoices sorted (NEWEST → OLDEST):');
//     invoicesByCustomer[customerKey].forEach((inv, idx) => {
//       console.log(`      ${idx + 1}. Invoice #${inv.invoiceNumber} | Date: ${inv.invoiceDate} | Amount: TZS ${inv.amount.toLocaleString()}`);
//     });
//   });


//   // Step 3: Group transactions by customer
//   const transactionsByCustomer = {};
//   const processedTransactionIds = new Set();
  
//   transactions.forEach(transaction => {
//     if (!transaction.amount) return;
    
//     const transactionUniqueId = `${transaction.transactionId || transaction.id}_${transaction.receivedTimestamp}_${transaction.amount}`;
    
//     if (processedTransactionIds.has(transactionUniqueId)) {
//       console.warn(`⚠️ Skipping duplicate transaction: ${transaction.transactionId}`);
//       return;
//     }
    
//     const keys = [
//       transaction.customerPhone,
//       transaction.contractName?.toLowerCase().trim(),
//       transaction.customerName?.toLowerCase().trim()
//     ].filter(Boolean);
    
//     const matchedKey = keys.find(key => invoicesByCustomer[key]);
    
//     if (matchedKey) {
//       if (!transactionsByCustomer[matchedKey]) {
//         transactionsByCustomer[matchedKey] = [];
//       }
//       transactionsByCustomer[matchedKey].push(transaction);
//       processedTransactionIds.add(transactionUniqueId);
//     } else {
//       const primaryKey = keys[0];
//       if (primaryKey) {
//         if (!transactionsByCustomer[primaryKey]) {
//           transactionsByCustomer[primaryKey] = [];
//         }
//         transactionsByCustomer[primaryKey].push(transaction);
//         processedTransactionIds.add(transactionUniqueId);
//       }
//     }
//   });


//   // Sort transactions by timestamp (oldest first - FIFO)
//   Object.keys(transactionsByCustomer).forEach(customerKey => {
//     transactionsByCustomer[customerKey].sort((a, b) => {
//       return (a.receivedTimestamp || 0) - (b.receivedTimestamp || 0);
//     });
//   });


//   console.log(`\n💰 Found ${Object.keys(transactionsByCustomer).length} unique customers with transactions`);


//   // Step 4: Process transaction-by-transaction
//   const processedPayments = [];


//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     const customerInvoices = invoicesByCustomer[customerKey];
//     const customerTransactions = transactionsByCustomer[customerKey] || [];
    
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`💵 PROCESSING: "${customerKey}"`);
//     console.log(`${'='.repeat(80)}`);
//     console.log(`   Transactions: ${customerTransactions.length}`);
//     console.log(`   Invoices: ${customerInvoices.length}`);
    
//     if (customerTransactions.length === 0) {
//       console.log(`   ⚠️ No transactions found - marking all invoices as UNPAID`);
      
//       customerInvoices.forEach(invoice => {
//         invoiceTotalPayments.set(invoice.invoiceNumber, 0);
//         processedPayments.push({
//           paymentDate: invoice.invoiceDate,
//           customerName: invoice.customerName,
//           paymentMethod: 'Cash',
//           depositToAccountName: 'Kijichi Collection AC',
//           invoiceNo: invoice.invoiceNumber,
//           journalNo: '',
//           invoiceAmount: invoice.amount,
//           amount: 0,
//           referenceNo: '',
//           memo: '',
//           countryCode: '',
//           exchangeRate: '',
//         });
//       });
//       return;
//     }


//     // Track remaining balance for each invoice
//     const invoiceBalances = customerInvoices.map(inv => ({
//       invoice: inv,
//       remainingBalance: inv.amount,
//       fullyPaid: false
//     }));


//     let currentInvoiceIndex = 0;


//     // Process each transaction one by one
//     customerTransactions.forEach((transaction, txIdx) => {
//       let transactionAmount = transaction.amount;
//       let transactionUsed = false;
      
//       console.log(`\n   💳 Transaction ${txIdx + 1}/${customerTransactions.length}`);
//       console.log(`      Amount: TZS ${transactionAmount.toLocaleString()}`);
//       console.log(`      Date: ${transaction.receivedDateTime}`);
//       console.log(`      ID: ${transaction.transactionId || 'N/A'}`);


//       // Use this transaction to pay invoices
//       while (transactionAmount > 0 && currentInvoiceIndex < invoiceBalances.length) {
//         const currentInvoice = invoiceBalances[currentInvoiceIndex];
        
//         if (currentInvoice.fullyPaid) {
//           currentInvoiceIndex++;
//           continue;
//         }


//         const amountToPay = Math.min(transactionAmount, currentInvoice.remainingBalance);
        
//         console.log(`      → Paying Invoice #${currentInvoice.invoice.invoiceNumber}`);
//         console.log(`         Remaining balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
//         console.log(`         Paying: TZS ${amountToPay.toLocaleString()}`);


//         // Format date as MM-DD-YYYY
//         let formattedDate = transaction.receivedDateTime || transaction.receivedDate || currentInvoice.invoice.invoiceDate;
//         const dateObj = new Date(formattedDate);
//         if (!isNaN(dateObj.getTime())) {
//           const month = String(dateObj.getMonth() + 1).padStart(2, '0');
//           const day = String(dateObj.getDate()).padStart(2, '0');
//           const year = dateObj.getFullYear();
//           formattedDate = `${month}-${day}-${year}`;
//         }


//         // 🔥 Track total payment for this invoice
//         const currentTotal = invoiceTotalPayments.get(currentInvoice.invoice.invoiceNumber) || 0;
//         invoiceTotalPayments.set(currentInvoice.invoice.invoiceNumber, currentTotal + amountToPay);


//         // Create payment record
//         processedPayments.push({
//           paymentDate: formattedDate,
//           customerName: currentInvoice.invoice.customerName,
//           paymentMethod: 'Cash',
//           depositToAccountName: 'Kijichi Collection AC',
//           invoiceNo: currentInvoice.invoice.invoiceNumber,
//           journalNo: '',
//           invoiceAmount: currentInvoice.invoice.amount,
//           amount: amountToPay,
//           referenceNo: '',
//           memo: transaction.transactionId || '',
//           countryCode: '',
//           exchangeRate: '',
//         });


//         // Update balances
//         currentInvoice.remainingBalance -= amountToPay;
//         transactionAmount -= amountToPay;
//         transactionUsed = true;


//         console.log(`         New balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
//         console.log(`         Transaction remaining: TZS ${transactionAmount.toLocaleString()}`);


//         // Mark invoice as fully paid if balance <= 1 TZS
//         if (currentInvoice.remainingBalance <= 1) {
//           currentInvoice.fullyPaid = true;
//           currentInvoice.remainingBalance = 0;
//           console.log(`         ✅ Invoice #${currentInvoice.invoice.invoiceNumber} FULLY PAID!`);
//           currentInvoiceIndex++;
//         }
//       }


//       if (transactionUsed) {
//         usedTransactions.add(transaction.transactionId || transaction.id);
//       }


//       if (transactionAmount > 0) {
//         console.log(`      ⚠️ Transaction has TZS ${transactionAmount.toLocaleString()} remaining (overpayment)`);
//       }
//     });


//     // Mark any unpaid invoices
//     invoiceBalances.forEach(invBalance => {
//       if (!invBalance.fullyPaid && invBalance.remainingBalance > 0) {
//         console.log(`   ❌ Invoice #${invBalance.invoice.invoiceNumber} UNPAID - Balance: TZS ${invBalance.remainingBalance.toLocaleString()}`);
        
//         const hasPayment = processedPayments.some(p => p.invoiceNo === invBalance.invoice.invoiceNumber);
//         if (!hasPayment) {
//           invoiceTotalPayments.set(invBalance.invoice.invoiceNumber, 0);
//           processedPayments.push({
//             paymentDate: invBalance.invoice.invoiceDate,
//             customerName: invBalance.invoice.customerName,
//             paymentMethod: 'Cash',
//             depositToAccountName: 'Kijichi Collection AC',
//             invoiceNo: invBalance.invoice.invoiceNumber,
//             journalNo: '',
//             invoiceAmount: invBalance.invoice.amount,
//             amount: 0,
//             referenceNo: '',
//             memo: '',
//             countryCode: '',
//             exchangeRate: '',
//           });
//         }
//       }
//     });
//   });


//   // 🔥 Add UNUSED transactions at the end
//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`🔍 CHECKING FOR UNUSED TRANSACTIONS`);
//   console.log(`${'='.repeat(80)}`);
  
//   const unusedTransactions = transactions.filter(transaction => {
//     const txId = transaction.transactionId || transaction.id;
//     return !usedTransactions.has(txId);
//   });


//   console.log(`✅ Used transactions: ${usedTransactions.size}`);
//   console.log(`⚠️ Unused transactions: ${unusedTransactions.length}`);


//   // 🔥 FIXED: Store REAL transaction amount instead of "UNUSED" string
//   unusedTransactions.forEach(transaction => {
//     let formattedDate = transaction.receivedDateTime || transaction.receivedDate || '';
//     const dateObj = new Date(formattedDate);
//     if (!isNaN(dateObj.getTime())) {
//       const month = String(dateObj.getMonth() + 1).padStart(2, '0');
//       const day = String(dateObj.getDate()).padStart(2, '0');
//       const year = dateObj.getFullYear();
//       formattedDate = `${month}-${day}-${year}`;
//     }


//     console.log(`   💰 UNUSED: ${transaction.customerName || transaction.contractName} | TZS ${transaction.amount.toLocaleString()} | ID: ${transaction.transactionId}`);


//     processedPayments.push({
//       paymentDate: formattedDate,
//       customerName: transaction.customerName || transaction.contractName || 'UNKNOWN',
//       paymentMethod: 'Cash',
//       depositToAccountName: 'Kijichi Collection AC',
//       invoiceNo: 'UNUSED',
//       journalNo: '',
//       invoiceAmount: 0, // 🔥 No invoice amount since it's unused
//       transactionAmount: transaction.amount, // 🔥 REAL transaction amount from Google Sheets
//       amount: transaction.amount, // 🔥 Use the REAL transaction amount
//       referenceNo: '',
//       memo: transaction.transactionId || '',
//       countryCode: '',
//       exchangeRate: '',
//       isUnused: true, // 🔥 Flag to identify unused transactions
//     });
//   });


//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`✅ PAYMENT PROCESSING COMPLETED`);
//   console.log(`${'='.repeat(80)}`);
//   console.log(`Total payment records: ${processedPayments.length}`);
//   console.log(`Used transactions: ${usedTransactions.size}`);
//   console.log(`Unused transactions: ${unusedTransactions.length}`);
  
//   const totalPaid = processedPayments
//     .filter(p => typeof p.amount === 'number' && p.amount > 0 && !p.isUnused)
//     .reduce((sum, p) => sum + p.amount, 0);
  
//   const totalUnused = processedPayments
//     .filter(p => p.isUnused)
//     .reduce((sum, p) => sum + (p.transactionAmount || 0), 0);
  
//   console.log(`Total amount paid (invoices only): TZS ${totalPaid.toLocaleString()}`);
//   console.log(`Total unused amount: TZS ${totalUnused.toLocaleString()}`);
//   console.log(`\n`);
  
//   // 🔥 Add metadata to help frontend determine status
//   return processedPayments.map(payment => {
//     if (payment.invoiceNo === 'UNUSED') {
//       return payment;
//     }
    
//     const totalPaid = invoiceTotalPayments.get(payment.invoiceNo) || 0;
//     const isFullyPaid = Math.abs(totalPaid - payment.invoiceAmount) <= 1;
    
//     return {
//       ...payment,
//       isFullyPaid, // 🔥 Flag for frontend
//       totalPaidForInvoice: totalPaid
//     };
//   });
// }


// // 404 handler
// app.use((req, res) => {
//   res.status(404).json({
//     success: false,
//     message: 'Endpoint not found',
//     path: req.path
//   });
// });


// // Start server - bind to 0.0.0.0 for Render deployment
// app.listen(port, '0.0.0.0', () => {
//   console.log(`🚀 Server running on port ${port}`);
//   console.log(`📅 Filtering transactions from Jan 1, 2026 onwards`);
//   console.log(`📆 Accepting date formats: MM/DD/YYYY and DD Mon YYYY`);
// });


// module.exports = { processInvoicePayments };



// const express = require('express');
// const cors = require('cors');
// const multer = require('multer');
// const Papa = require('papaparse');
// const { google } = require('googleapis');
// require('dotenv').config();

// const app = express();
// const port = process.env.PORT || 5000;

// // Middleware
// app.use(cors({
//   origin: '*',
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
// }));
// app.use(express.json({ limit: '50mb' }));
// app.use(express.urlencoded({ limit: '50mb', extended: true }));

// // Configure multer for file uploads
// const upload = multer({ storage: multer.memoryStorage() });

// // Google Sheets configuration
// const SPREADSHEET_ID = '1N3ZxahtaFBX0iK3cijDraDmyZM8573PVVf8D-WVqicE';
// const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com';

// // 🔥 NEW: Minimum date filter - January 1, 2026
// const MIN_DATE_TIMESTAMP = new Date('2026-01-01T00:00:00+03:00').getTime();

// // Initialize Google Sheets API
// async function getGoogleSheetsClient() {
//   const auth = new google.auth.GoogleAuth({
//     credentials: {
//       type: 'service_account',
//       client_email: SERVICE_ACCOUNT_EMAIL,
//       private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
//       project_id: 'lmp-sms-sync',
//     },
//     scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
//   });

//   const client = await auth.getClient();
//   return google.sheets({ version: 'v4', auth: client });
// }

// // Parse dates in MM/DD/YYYY format or "22 Jan 2026, 05:16 pm (EAT)" format
// function parseEATDateTime(rawDate) {
//   if (!rawDate) return { display: null, timestamp: null, dateOnly: null, timeOnly: null };

//   try {
//     // Check if it's MM/DD/YYYY format (e.g., "01/23/2026")
//     const mmddyyyyPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
//     const mmddyyyyMatch = rawDate.match(mmddyyyyPattern);
    
//     if (mmddyyyyMatch) {
//       const [, month, day, year] = mmddyyyyMatch;
//       const parsed = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00+03:00`);
      
//       if (isNaN(parsed)) {
//         console.warn('Failed to parse MM/DD/YYYY date:', rawDate);
//         return { display: rawDate, timestamp: null, dateOnly: rawDate, timeOnly: null };
//       }
      
//       return {
//         display: rawDate,
//         timestamp: parsed.getTime(),
//         dateOnly: rawDate,
//         timeOnly: '00:00'
//       };
//     }
    
//     // Original format: "22 Jan 2026, 05:16 pm (EAT)"
//     const parts = rawDate.split(',').map(s => s.trim());
    
//     if (parts.length < 2) {
//       // No time, just date
//       const dateOnly = parts[0]; // "22 Jan 2026"
//       const parsed = new Date(`${dateOnly} 00:00:00 GMT+0300`);
      
//       return {
//         display: dateOnly,
//         timestamp: parsed.getTime(),
//         dateOnly: dateOnly,
//         timeOnly: '00:00'
//       };
//     }

//     const datePart = parts[0]; // "22 Jan 2026"
//     const timePart = parts[1].replace(/\s*\(EAT\)/, '').trim(); // "05:16 pm"

//     // Parse to EAT timezone (GMT+3) to avoid date shifts
//     const dateTimeStr = `${datePart} ${timePart} GMT+0300`;
//     const parsed = new Date(dateTimeStr);

//     if (isNaN(parsed)) {
//       console.warn('Failed to parse date:', rawDate);
//       return { display: rawDate, timestamp: null, dateOnly: datePart, timeOnly: null };
//     }

//     // Extract time in HH:mm format
//     const hours = String(parsed.getHours()).padStart(2, '0');
//     const minutes = String(parsed.getMinutes()).padStart(2, '0');
//     const timeOnly = `${hours}:${minutes}`;

//     return {
//       display: `${datePart}, ${timePart}`,
//       timestamp: parsed.getTime(),
//       dateOnly: datePart,
//       timeOnly: timeOnly,
//       iso: parsed.toISOString()
//     };

//   } catch (error) {
//     console.error('Error parsing date:', rawDate, error);
//     return { display: rawDate, timestamp: null, dateOnly: null, timeOnly: null };
//   }
// }

// // 🔥 UPDATED: Fetch transactions with DATE FILTER (only Jan 1, 2026+)
// async function fetchTransactions(sheetName, channel) {
//   try {
//     const sheets = await getGoogleSheetsClient();

//     const { data } = await sheets.spreadsheets.values.get({
//       spreadsheetId: SPREADSHEET_ID,
//       range: `${sheetName}!A2:H`,
//       majorDimension: 'ROWS',
//     });

//     const rows = data.values || [];
//     const results = [];
//     let filteredCount = 0;
//     let tooOldCount = 0;

//     console.log(`📊 Processing ${rows.length} rows from ${sheetName}...`);

//     for (let i = 0; i < rows.length; i++) {
//       const row = rows[i];

//       // Parse DateTime with TIME support
//       const dateTime = parseEATDateTime(row[2]);

//       // 🔥 NEW: Filter out messages before Jan 1, 2026
//       // Safety check: Only filter if we have a valid timestamp
//       if (dateTime.timestamp) {
//         if (dateTime.timestamp < MIN_DATE_TIMESTAMP) {
//           tooOldCount++;
//           continue; // Skip this row - too old
//         }
//       } else {
//         // No valid timestamp - log warning but keep the row
//         console.warn(`⚠️ Row ${i + 2} has invalid date: ${row[2]}`);
//       }

//       filteredCount++;

//       results.push({
//         id: row[7] || `${channel}-${i + 1}`,
//         channel,

//         paymentChannel: row[1] || null,
//         transactionMessage: row[3] || null,

//         customerPhone: row[4] || null,
//         customerName: row[5] || null,
//         contractName: row[5] || null,

//         amount: row[6] ? Number(row[6]) : null,

//         // NEW: Full DateTime info
//         receivedRaw: row[2], // "22 Jan 2026, 05:16 pm (EAT)" or "01/23/2026"
//         receivedDate: dateTime.dateOnly, // "22 Jan 2026" or "01/23/2026"
//         receivedTime: dateTime.timeOnly, // "17:16" (24-hour format)
//         receivedDateTime: dateTime.display, // "22 Jan 2026, 05:16 pm" or "01/23/2026"
//         receivedTimestamp: dateTime.timestamp, // Unix timestamp for filtering

//         transactionId: row[7] || null,
//       });
//     }

//     console.log(`✅ ${sheetName}: Fetched ${filteredCount} rows (${tooOldCount} filtered as too old)`);

//     return results;

//   } catch (error) {
//     console.error(`❌ Error fetching from ${sheetName}:`, error);
//     throw error;
//   }
// }

// // API Routes

// // Get all transactions (🔥 NOW FILTERED: Only Jan 1, 2026+)
// app.get('/api/transactions', async (req, res) => {
//   try {
//     console.log('🔍 Fetching transactions from all channels...');
    
//     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
//     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
//     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

//     const allTransactions = [
//       ...bodaTransactions,
//       ...iphoneTransactions,
//       ...lipaTransactions,
//     ];

//     console.log(`✅ Total transactions returned: ${allTransactions.length}`);

//     res.json({
//       success: true,
//       data: allTransactions,
//       count: allTransactions.length,
//       minDate: '2026-01-01', // 🔥 NEW: Show filter applied
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error fetching transactions',
//       error: error.message,
//     });
//   }
// });

// // Filter transactions by DATE + TIME range
// app.post('/api/transactions/filter', async (req, res) => {
//   try {
//     const { startDate, endDate, startTime, endTime, channel } = req.body;

//     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
//     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
//     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

//     let allTransactions = [
//       ...bodaTransactions,
//       ...iphoneTransactions,
//       ...lipaTransactions,
//     ];

//     // Filter by DATE + TIME range
//     if (startDate && endDate) {
//       const startTimeStr = startTime || '00:00';
//       const endTimeStr = endTime || '23:59';
      
//       // Create timestamps in EAT (GMT+3) to avoid date shifts
//       const startTimestamp = new Date(`${startDate} ${startTimeStr}:00 GMT+0300`).getTime();
//       const endTimestamp = new Date(`${endDate} ${endTimeStr}:59 GMT+0300`).getTime();
      
//       console.log('=== DateTime Filter ===');
//       console.log('Start:', new Date(startTimestamp).toISOString());
//       console.log('End:', new Date(endTimestamp).toISOString());
//       console.log('Total transactions before filter:', allTransactions.length);
      
//       allTransactions = allTransactions.filter(transaction => {
//         if (!transaction.receivedTimestamp) return false;
        
//         const isInRange = transaction.receivedTimestamp >= startTimestamp && 
//                          transaction.receivedTimestamp <= endTimestamp;
        
//         if (isInRange) {
//           console.log('✓ Matched:', {
//             dateTime: transaction.receivedDateTime,
//             customer: transaction.customerName || transaction.contractName,
//             amount: transaction.amount
//           });
//         }
        
//         return isInRange;
//       });
      
//       console.log('Total transactions after filter:', allTransactions.length);
//     }

//     // Filter by channel
//     if (channel && channel !== 'all') {
//       console.log('Filtering by channel:', channel);
//       allTransactions = allTransactions.filter(transaction => transaction.channel === channel);
//       console.log('After channel filter:', allTransactions.length);
//     }

//     res.json({
//       success: true,
//       data: allTransactions,
//       count: allTransactions.length,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error filtering transactions',
//       error: error.message,
//     });
//   }
// });

// // Upload and parse invoices CSV
// app.post('/api/invoices/upload', upload.single('file'), (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: 'No file uploaded',
//       });
//     }

//     const fileContent = req.file.buffer.toString('utf-8');
    
//     Papa.parse(fileContent, {
//       header: true,
//       skipEmptyLines: true,
//       complete: (results) => {
//         const invoices = results.data.map((row, index) => {
//           // Extract and clean the amount - remove commas and parse
//           const amountStr = (row['Amount'] || '0').toString().replace(/,/g, '');
//           const amount = parseFloat(amountStr) || 0;
          
//           return {
//             id: index + 1,
//             customerName: row['Customer'] || row['Customer Name'] || '',
//             invoiceNumber: row['Invoice No'] || row['Invoice Number'] || '',
//             amount: amount,
//             invoiceDate: row['Invoice Date'] || row['Date'] || '',
//             customerPhone: extractPhone(row['Customer'] || ''),
//           };
//         });

//         console.log('\n📤 CSV Upload Summary:');
//         console.log(`Total invoices: ${invoices.length}`);
//         if (invoices.length > 0) {
//           console.log('Sample invoice:', {
//             customer: invoices[0].customerName,
//             invoiceNo: invoices[0].invoiceNumber,
//             amount: invoices[0].amount,
//             date: invoices[0].invoiceDate
//           });
//         }

//         res.json({
//           success: true,
//           data: invoices,
//           count: invoices.length,
//         });
//       },
//       error: (error) => {
//         res.status(400).json({
//           success: false,
//           message: 'Error parsing CSV',
//           error: error.message,
//         });
//       },
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error processing file',
//       error: error.message,
//     });
//   }
// });

// // Process invoice payments
// app.post('/api/process-payments', async (req, res) => {
//   try {
//     const { invoices, startDate, endDate, startTime, endTime, channel } = req.body;

//     console.log('\n🔍 Fetching transactions for payment processing...');
//     console.log('Date range:', startDate, 'to', endDate);
//     console.log('Time range:', startTime || '00:00', 'to', endTime || '23:59');
//     console.log('Channel:', channel || 'all');

//     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
//     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
//     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

//     let allTransactions = [
//       ...bodaTransactions,
//       ...iphoneTransactions,
//       ...lipaTransactions,
//     ];

//     console.log(`📊 Total transactions fetched: ${allTransactions.length}`);

//     // 🔥 CRITICAL: Filter by DATE + TIME range
//     if (startDate && endDate) {
//       const startTimeStr = startTime || '00:00';
//       const endTimeStr = endTime || '23:59';
      
//       const startTimestamp = new Date(`${startDate} ${startTimeStr}:00 GMT+0300`).getTime();
//       const endTimestamp = new Date(`${endDate} ${endTimeStr}:59 GMT+0300`).getTime();
      
//       console.log('\n⏰ Applying DateTime Filter:');
//       console.log('Start:', new Date(startTimestamp).toISOString());
//       console.log('End:', new Date(endTimestamp).toISOString());
      
//       const beforeFilterCount = allTransactions.length;
      
//       allTransactions = allTransactions.filter(transaction => {
//         if (!transaction.receivedTimestamp) return false;
//         return transaction.receivedTimestamp >= startTimestamp && 
//                transaction.receivedTimestamp <= endTimestamp;
//       });
      
//       console.log(`✅ Filtered: ${beforeFilterCount} → ${allTransactions.length} transactions`);
//     } else {
//       console.warn('⚠️ WARNING: No date range provided! Using ALL transactions.');
//     }

//     // Filter by channel
//     if (channel && channel !== 'all') {
//       const beforeChannelFilter = allTransactions.length;
//       allTransactions = allTransactions.filter(transaction => transaction.channel === channel);
//       console.log(`📡 Channel filter (${channel}): ${beforeChannelFilter} → ${allTransactions.length} transactions`);
//     }

//     console.log(`\n💵 FINAL: Processing ${allTransactions.length} transactions for ${invoices.length} invoices`);

//     // 🔥 CRITICAL: Only use the FILTERED transactions for payment processing
//     const processedInvoices = processInvoicePayments(invoices, allTransactions);

//     res.json({
//       success: true,
//       data: processedInvoices,
//     });
//   } catch (error) {
//     console.error('❌ Error processing payments:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error processing payments',
//       error: error.message,
//     });
//   }
// });

// // Helper function to extract phone
// function extractPhone(customerName) {
//   const phoneMatch = customerName.match(/\d{10,}/);
//   return phoneMatch ? phoneMatch[0] : null;
// }

// // Main payment processing logic
// function processInvoicePayments(invoices, transactions) {
//   console.log('\n========================================');
//   console.log('=== PAYMENT PROCESSING STARTED ===');
//   console.log('=== TRANSACTION-BY-TRANSACTION MODE ===');
//   console.log('========================================');
//   console.log('📋 Invoices to process:', invoices.length);
//   console.log('💵 Transactions available (WITHIN TIME FRAME):', transactions.length);
  
//   const usedTransactions = new Set();
//   // 🔥 NEW: Track total payments per invoice for accurate status
//   const invoiceTotalPayments = new Map(); // invoiceNo -> total amount paid
  
//   // Step 1: Group invoices by customer
//   const invoicesByCustomer = {};
  
//   invoices.forEach(invoice => {
//     const key = invoice.customerPhone || invoice.customerName.toLowerCase().trim();
//     if (!invoicesByCustomer[key]) {
//       invoicesByCustomer[key] = [];
//     }
//     invoicesByCustomer[key].push(invoice);
//   });

//   console.log(`\n👥 Found ${Object.keys(invoicesByCustomer).length} unique customers with invoices`);

//   // Step 2: Sort each customer's invoices by date (DESCENDING - newest first)
//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     invoicesByCustomer[customerKey].sort((a, b) => {
//       const dateCompare = new Date(b.invoiceDate) - new Date(a.invoiceDate);
//       if (dateCompare !== 0) return dateCompare;
//       return b.invoiceNumber.localeCompare(a.invoiceNumber);
//     });
    
//     console.log(`\n📋 Customer: "${customerKey}"`);
//     console.log(`   Total invoices: ${invoicesByCustomer[customerKey].length}`);
//     console.log('   Invoices sorted (NEWEST → OLDEST):');
//     invoicesByCustomer[customerKey].forEach((inv, idx) => {
//       console.log(`      ${idx + 1}. Invoice #${inv.invoiceNumber} | Date: ${inv.invoiceDate} | Amount: TZS ${inv.amount.toLocaleString()}`);
//     });
//   });

//   // Step 3: Group transactions by customer
//   const transactionsByCustomer = {};
//   const processedTransactionIds = new Set();
  
//   transactions.forEach(transaction => {
//     if (!transaction.amount) return;
    
//     const transactionUniqueId = `${transaction.transactionId || transaction.id}_${transaction.receivedTimestamp}_${transaction.amount}`;
    
//     if (processedTransactionIds.has(transactionUniqueId)) {
//       console.warn(`⚠️ Skipping duplicate transaction: ${transaction.transactionId}`);
//       return;
//     }
    
//     const keys = [
//       transaction.customerPhone,
//       transaction.contractName?.toLowerCase().trim(),
//       transaction.customerName?.toLowerCase().trim()
//     ].filter(Boolean);
    
//     const matchedKey = keys.find(key => invoicesByCustomer[key]);
    
//     if (matchedKey) {
//       if (!transactionsByCustomer[matchedKey]) {
//         transactionsByCustomer[matchedKey] = [];
//       }
//       transactionsByCustomer[matchedKey].push(transaction);
//       processedTransactionIds.add(transactionUniqueId);
//     } else {
//       const primaryKey = keys[0];
//       if (primaryKey) {
//         if (!transactionsByCustomer[primaryKey]) {
//           transactionsByCustomer[primaryKey] = [];
//         }
//         transactionsByCustomer[primaryKey].push(transaction);
//         processedTransactionIds.add(transactionUniqueId);
//       }
//     }
//   });

//   // Sort transactions by timestamp (oldest first - FIFO)
//   Object.keys(transactionsByCustomer).forEach(customerKey => {
//     transactionsByCustomer[customerKey].sort((a, b) => {
//       return (a.receivedTimestamp || 0) - (b.receivedTimestamp || 0);
//     });
//   });

//   console.log(`\n💰 Found ${Object.keys(transactionsByCustomer).length} unique customers with transactions`);

//   // Step 4: Process transaction-by-transaction
//   const processedPayments = [];

//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     const customerInvoices = invoicesByCustomer[customerKey];
//     const customerTransactions = transactionsByCustomer[customerKey] || [];
    
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`💵 PROCESSING: "${customerKey}"`);
//     console.log(`${'='.repeat(80)}`);
//     console.log(`   Transactions: ${customerTransactions.length}`);
//     console.log(`   Invoices: ${customerInvoices.length}`);
    
//     if (customerTransactions.length === 0) {
//       console.log(`   ⚠️ No transactions found - marking all invoices as UNPAID`);
      
//       customerInvoices.forEach(invoice => {
//         invoiceTotalPayments.set(invoice.invoiceNumber, 0);
//         processedPayments.push({
//           paymentDate: invoice.invoiceDate,
//           customerName: invoice.customerName,
//           paymentMethod: 'Cash',
//           depositToAccountName: 'Kijichi Collection AC',
//           invoiceNo: invoice.invoiceNumber,
//           journalNo: '',
//           invoiceAmount: invoice.amount,
//           amount: 0,
//           referenceNo: '',
//           memo: '',
//           countryCode: '',
//           exchangeRate: '',
//         });
//       });
//       return;
//     }

//     // Track remaining balance for each invoice
//     const invoiceBalances = customerInvoices.map(inv => ({
//       invoice: inv,
//       remainingBalance: inv.amount,
//       fullyPaid: false
//     }));

//     let currentInvoiceIndex = 0;

//     // Process each transaction one by one
//     customerTransactions.forEach((transaction, txIdx) => {
//       let transactionAmount = transaction.amount;
//       let transactionUsed = false;
      
//       console.log(`\n   💳 Transaction ${txIdx + 1}/${customerTransactions.length}`);
//       console.log(`      Amount: TZS ${transactionAmount.toLocaleString()}`);
//       console.log(`      Date: ${transaction.receivedDateTime}`);
//       console.log(`      ID: ${transaction.transactionId || 'N/A'}`);

//       // Use this transaction to pay invoices
//       while (transactionAmount > 0 && currentInvoiceIndex < invoiceBalances.length) {
//         const currentInvoice = invoiceBalances[currentInvoiceIndex];
        
//         if (currentInvoice.fullyPaid) {
//           currentInvoiceIndex++;
//           continue;
//         }

//         const amountToPay = Math.min(transactionAmount, currentInvoice.remainingBalance);
        
//         console.log(`      → Paying Invoice #${currentInvoice.invoice.invoiceNumber}`);
//         console.log(`         Remaining balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
//         console.log(`         Paying: TZS ${amountToPay.toLocaleString()}`);

//         // Format date as MM-DD-YYYY
//         let formattedDate = transaction.receivedDateTime || transaction.receivedDate || currentInvoice.invoice.invoiceDate;
//         const dateObj = new Date(formattedDate);
//         if (!isNaN(dateObj.getTime())) {
//           const month = String(dateObj.getMonth() + 1).padStart(2, '0');
//           const day = String(dateObj.getDate()).padStart(2, '0');
//           const year = dateObj.getFullYear();
//           formattedDate = `${month}-${day}-${year}`;
//         }

//         // 🔥 Track total payment for this invoice
//         const currentTotal = invoiceTotalPayments.get(currentInvoice.invoice.invoiceNumber) || 0;
//         invoiceTotalPayments.set(currentInvoice.invoice.invoiceNumber, currentTotal + amountToPay);

//         // Create payment record
//         processedPayments.push({
//           paymentDate: formattedDate,
//           customerName: currentInvoice.invoice.customerName,
//           paymentMethod: 'Cash',
//           depositToAccountName: 'Kijichi Collection AC',
//           invoiceNo: currentInvoice.invoice.invoiceNumber,
//           journalNo: '',
//           invoiceAmount: currentInvoice.invoice.amount,
//           amount: amountToPay,
//           referenceNo: '',
//           memo: transaction.transactionId || '',
//           countryCode: '',
//           exchangeRate: '',
//         });

//         // Update balances
//         currentInvoice.remainingBalance -= amountToPay;
//         transactionAmount -= amountToPay;
//         transactionUsed = true;

//         console.log(`         New balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
//         console.log(`         Transaction remaining: TZS ${transactionAmount.toLocaleString()}`);

//         // Mark invoice as fully paid if balance <= 1 TZS
//         if (currentInvoice.remainingBalance <= 1) {
//           currentInvoice.fullyPaid = true;
//           currentInvoice.remainingBalance = 0;
//           console.log(`         ✅ Invoice #${currentInvoice.invoice.invoiceNumber} FULLY PAID!`);
//           currentInvoiceIndex++;
//         }
//       }

//       if (transactionUsed) {
//         usedTransactions.add(transaction.transactionId || transaction.id);
//       }

//       if (transactionAmount > 0) {
//         console.log(`      ⚠️ Transaction has TZS ${transactionAmount.toLocaleString()} remaining (overpayment)`);
//       }
//     });

//     // Mark any unpaid invoices
//     invoiceBalances.forEach(invBalance => {
//       if (!invBalance.fullyPaid && invBalance.remainingBalance > 0) {
//         console.log(`   ❌ Invoice #${invBalance.invoice.invoiceNumber} UNPAID - Balance: TZS ${invBalance.remainingBalance.toLocaleString()}`);
        
//         const hasPayment = processedPayments.some(p => p.invoiceNo === invBalance.invoice.invoiceNumber);
//         if (!hasPayment) {
//           invoiceTotalPayments.set(invBalance.invoice.invoiceNumber, 0);
//           processedPayments.push({
//             paymentDate: invBalance.invoice.invoiceDate,
//             customerName: invBalance.invoice.customerName,
//             paymentMethod: 'Cash',
//             depositToAccountName: 'Kijichi Collection AC',
//             invoiceNo: invBalance.invoice.invoiceNumber,
//             journalNo: '',
//             invoiceAmount: invBalance.invoice.amount,
//             amount: 0,
//             referenceNo: '',
//             memo: '',
//             countryCode: '',
//             exchangeRate: '',
//           });
//         }
//       }
//     });
//   });

//   // 🔥 Add UNUSED transactions at the end
//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`🔍 CHECKING FOR UNUSED TRANSACTIONS`);
//   console.log(`${'='.repeat(80)}`);
  
//   const unusedTransactions = transactions.filter(transaction => {
//     const txId = transaction.transactionId || transaction.id;
//     return !usedTransactions.has(txId);
//   });

//   console.log(`✅ Used transactions: ${usedTransactions.size}`);
//   console.log(`⚠️ Unused transactions: ${unusedTransactions.length}`);

//   // 🔥 FIXED: Store REAL transaction amount instead of "UNUSED" string
//   unusedTransactions.forEach(transaction => {
//     let formattedDate = transaction.receivedDateTime || transaction.receivedDate || '';
//     const dateObj = new Date(formattedDate);
//     if (!isNaN(dateObj.getTime())) {
//       const month = String(dateObj.getMonth() + 1).padStart(2, '0');
//       const day = String(dateObj.getDate()).padStart(2, '0');
//       const year = dateObj.getFullYear();
//       formattedDate = `${month}-${day}-${year}`;
//     }

//     console.log(`   💰 UNUSED: ${transaction.customerName || transaction.contractName} | TZS ${transaction.amount.toLocaleString()} | ID: ${transaction.transactionId}`);

//     processedPayments.push({
//       paymentDate: formattedDate,
//       customerName: transaction.customerName || transaction.contractName || 'UNKNOWN',
//       paymentMethod: 'Cash',
//       depositToAccountName: 'Kijichi Collection AC',
//       invoiceNo: 'UNUSED',
//       journalNo: '',
//       invoiceAmount: 0, // 🔥 No invoice amount since it's unused
//       transactionAmount: transaction.amount, // 🔥 REAL transaction amount from Google Sheets
//       amount: transaction.amount, // 🔥 Use the REAL transaction amount
//       referenceNo: '',
//       memo: transaction.transactionId || '',
//       countryCode: '',
//       exchangeRate: '',
//       isUnused: true, // 🔥 Flag to identify unused transactions
//     });
//   });

//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`✅ PAYMENT PROCESSING COMPLETED`);
//   console.log(`${'='.repeat(80)}`);
//   console.log(`Total payment records: ${processedPayments.length}`);
//   console.log(`Used transactions: ${usedTransactions.size}`);
//   console.log(`Unused transactions: ${unusedTransactions.length}`);
  
//   const totalPaid = processedPayments
//     .filter(p => typeof p.amount === 'number' && p.amount > 0 && !p.isUnused)
//     .reduce((sum, p) => sum + p.amount, 0);
  
//   const totalUnused = processedPayments
//     .filter(p => p.isUnused)
//     .reduce((sum, p) => sum + (p.transactionAmount || 0), 0);
  
//   console.log(`Total amount paid (invoices only): TZS ${totalPaid.toLocaleString()}`);
//   console.log(`Total unused amount: TZS ${totalUnused.toLocaleString()}`);
//   console.log(`\n`);
  
//   // 🔥 Add metadata to help frontend determine status
//   return processedPayments.map(payment => {
//     if (payment.invoiceNo === 'UNUSED') {
//       return payment;
//     }
    
//     const totalPaid = invoiceTotalPayments.get(payment.invoiceNo) || 0;
//     const isFullyPaid = Math.abs(totalPaid - payment.invoiceAmount) <= 1;
    
//     return {
//       ...payment,
//       isFullyPaid, // 🔥 Flag for frontend
//       totalPaidForInvoice: totalPaid
//     };
//   });
// }

// // Start server - bind to 0.0.0.0 for Render deployment
// app.listen(port, '0.0.0.0', () => {
//   console.log(`✅ Server running on port ${port}`);
// });

// module.exports = { processInvoicePayments };



// // Generate CSV for download - FORMATTED FOR QUICKBOOKS
// app.post('/api/export-payments', (req, res) => {
//   try {
//     const { payments } = req.body;
    
//     // Format data for QuickBooks with proper column names and casing
//     const formattedPayments = payments.map(payment => ({
//       'Payment Date': payment.paymentDate,
//       'Customer': payment.customerName.toUpperCase(), // ✅ UPPERCASE
//       'Payment Method': payment.paymentMethod,
//       'Deposit To Account Name': payment.depositToAccountName,
//       'Invoice No': payment.invoiceNo,
//       'Journal No': payment.journalNo || '',
//       'Amount': payment.amount,
//       'Reference No': payment.referenceNo || '',
//       'Memo': payment.memo || '',
//       'Country Code': payment.countryCode || '',
//       'Exchange Rate': payment.exchangeRate || '',
//     }));
    
//     const csv = Papa.unparse(formattedPayments, {
//       header: true,
//     });

//     res.setHeader('Content-Type', 'text/csv');
//     res.setHeader('Content-Disposition', 'attachment; filename=processed_payments.csv');
//     res.send(csv);
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error exporting payments',
//       error: error.message,
//     });
//   }
// });



// // Health check endpoint
// app.get('/', (req, res) => {
//   res.json({
//     success: true,
//     message: 'Invoice Payment API is running!',
//     version: '2.1.0',
//     features: ['DateTime filtering', 'EAT timezone support', 'Jan 1, 2026+ date filter', 'MM/DD/YYYY date format support'],
//     minDate: '2026-01-01',
//     dateFormats: ['MM/DD/YYYY', 'DD Mon YYYY, HH:mm am/pm (EAT)'],
//     endpoints: {
//       transactions: '/api/transactions',
//       filter: '/api/transactions/filter',
//       upload: '/api/invoices/upload',
//       process: '/api/process-payments',
//       export: '/api/export-payments'
//     }
//   });
// });

// // 404 handler
// app.use((req, res) => {
//   res.status(404).json({
//     success: false,
//     message: 'Endpoint not found',
//     path: req.path
//   });
// });

// app.listen(port, () => {
//   console.log(`🚀 Server running on port ${port}`);
//   console.log(`📅 Filtering transactions from Jan 1, 2026 onwards`);
//   console.log(`📆 Accepting date formats: MM/DD/YYYY and DD Mon YYYY`);
// });









// const express = require('express');
// const cors = require('cors');
// const multer = require('multer');
// const Papa = require('papaparse');
// const { google } = require('googleapis');
// require('dotenv').config();

// const app = express();
// const port = process.env.PORT || 5000;
// // please over please just for testing bro 
// // Middleware
// app.use(cors({
//   origin: '*',
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
// }));
// app.use(express.json({ limit: '50mb' })); // Increased limit for large CSV uploads
// app.use(express.urlencoded({ limit: '50mb', extended: true }));

// // Configure multer for file uploads
// const upload = multer({ storage: multer.memoryStorage() });

// // Google Sheets configuration
// const SPREADSHEET_ID = '1N3ZxahtaFBX0iK3cijDraDmyZM8573PVVf8D-WVqicE';
// const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com';

// // 🔥 NEW: Minimum date filter - January 1, 2026
// const MIN_DATE_TIMESTAMP = new Date('2026-01-01T00:00:00+03:00').getTime();

// // Initialize Google Sheets API
// async function getGoogleSheetsClient() {
//   const auth = new google.auth.GoogleAuth({
//     credentials: {
//       type: 'service_account',
//       client_email: SERVICE_ACCOUNT_EMAIL,
//       private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
//       project_id: 'lmp-sms-sync',
//     },
//     scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
//   });

//   const client = await auth.getClient();
//   return google.sheets({ version: 'v4', auth: client });
// }

// // Parse dates in MM/DD/YYYY format or "22 Jan 2026, 05:16 pm (EAT)" format
// function parseEATDateTime(rawDate) {
//   if (!rawDate) return { display: null, timestamp: null, dateOnly: null, timeOnly: null };

//   try {
//     // Check if it's MM/DD/YYYY format (e.g., "01/23/2026")
//     const mmddyyyyPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
//     const mmddyyyyMatch = rawDate.match(mmddyyyyPattern);
    
//     if (mmddyyyyMatch) {
//       const [, month, day, year] = mmddyyyyMatch;
//       const parsed = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00+03:00`);
      
//       if (isNaN(parsed)) {
//         console.warn('Failed to parse MM/DD/YYYY date:', rawDate);
//         return { display: rawDate, timestamp: null, dateOnly: rawDate, timeOnly: null };
//       }
      
//       return {
//         display: rawDate,
//         timestamp: parsed.getTime(),
//         dateOnly: rawDate,
//         timeOnly: '00:00'
//       };
//     }
    
//     // Original format: "22 Jan 2026, 05:16 pm (EAT)"
//     const parts = rawDate.split(',').map(s => s.trim());
    
//     if (parts.length < 2) {
//       // No time, just date
//       const dateOnly = parts[0]; // "22 Jan 2026"
//       const parsed = new Date(`${dateOnly} 00:00:00 GMT+0300`);
      
//       return {
//         display: dateOnly,
//         timestamp: parsed.getTime(),
//         dateOnly: dateOnly,
//         timeOnly: '00:00'
//       };
//     }

//     const datePart = parts[0]; // "22 Jan 2026"
//     const timePart = parts[1].replace(/\s*\(EAT\)/, '').trim(); // "05:16 pm"

//     // Parse to EAT timezone (GMT+3) to avoid date shifts
//     const dateTimeStr = `${datePart} ${timePart} GMT+0300`;
//     const parsed = new Date(dateTimeStr);

//     if (isNaN(parsed)) {
//       console.warn('Failed to parse date:', rawDate);
//       return { display: rawDate, timestamp: null, dateOnly: datePart, timeOnly: null };
//     }

//     // Extract time in HH:mm format
//     const hours = String(parsed.getHours()).padStart(2, '0');
//     const minutes = String(parsed.getMinutes()).padStart(2, '0');
//     const timeOnly = `${hours}:${minutes}`;

//     return {
//       display: `${datePart}, ${timePart}`,
//       timestamp: parsed.getTime(),
//       dateOnly: datePart,
//       timeOnly: timeOnly,
//       iso: parsed.toISOString()
//     };

//   } catch (error) {
//     console.error('Error parsing date:', rawDate, error);
//     return { display: rawDate, timestamp: null, dateOnly: null, timeOnly: null };
//   }
// }

// // 🔥 UPDATED: Fetch transactions with DATE FILTER (only Jan 1, 2026+)
// async function fetchTransactions(sheetName, channel) {
//   try {
//     const sheets = await getGoogleSheetsClient();

//     const { data } = await sheets.spreadsheets.values.get({
//       spreadsheetId: SPREADSHEET_ID,
//       range: `${sheetName}!A2:H`,
//       majorDimension: 'ROWS',
//     });

//     const rows = data.values || [];
//     const results = [];
//     let filteredCount = 0;
//     let tooOldCount = 0;

//     console.log(`📊 Processing ${rows.length} rows from ${sheetName}...`);

//     for (let i = 0; i < rows.length; i++) {
//       const row = rows[i];

//       // Parse DateTime with TIME support
//       const dateTime = parseEATDateTime(row[2]);

//       // 🔥 NEW: Filter out messages before Jan 1, 2026
//       // Safety check: Only filter if we have a valid timestamp
//       if (dateTime.timestamp) {
//         if (dateTime.timestamp < MIN_DATE_TIMESTAMP) {
//           tooOldCount++;
//           continue; // Skip this row - too old
//         }
//       } else {
//         // No valid timestamp - log warning but keep the row
//         console.warn(`⚠️ Row ${i + 2} has invalid date: ${row[2]}`);
//       }

//       filteredCount++;

//       results.push({
//         id: row[7] || `${channel}-${i + 1}`,
//         channel,

//         paymentChannel: row[1] || null,
//         transactionMessage: row[3] || null,

//         customerPhone: row[4] || null,
//         customerName: row[5] || null,
//         contractName: row[5] || null,

//         amount: row[6] ? Number(row[6]) : null,

//         // NEW: Full DateTime info
//         receivedRaw: row[2], // "22 Jan 2026, 05:16 pm (EAT)" or "01/23/2026"
//         receivedDate: dateTime.dateOnly, // "22 Jan 2026" or "01/23/2026"
//         receivedTime: dateTime.timeOnly, // "17:16" (24-hour format)
//         receivedDateTime: dateTime.display, // "22 Jan 2026, 05:16 pm" or "01/23/2026"
//         receivedTimestamp: dateTime.timestamp, // Unix timestamp for filtering

//         transactionId: row[7] || null,
//       });
//     }

//     console.log(`✅ ${sheetName}: Fetched ${filteredCount} rows (${tooOldCount} filtered as too old)`);

//     return results;

//   } catch (error) {
//     console.error(`❌ Error fetching from ${sheetName}:`, error);
//     throw error;
//   }
// }

// // API Routes

// // Get all transactions (🔥 NOW FILTERED: Only Jan 1, 2026+)
// app.get('/api/transactions', async (req, res) => {
//   try {
//     console.log('🔍 Fetching transactions from all channels...');
    
//     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
//     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
//     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

//     const allTransactions = [
//       ...bodaTransactions,
//       ...iphoneTransactions,
//       ...lipaTransactions,
//     ];

//     console.log(`✅ Total transactions returned: ${allTransactions.length}`);

//     res.json({
//       success: true,
//       data: allTransactions,
//       count: allTransactions.length,
//       minDate: '2026-01-01', // 🔥 NEW: Show filter applied
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error fetching transactions',
//       error: error.message,
//     });
//   }
// });

// // Filter transactions by DATE + TIME range
// app.post('/api/transactions/filter', async (req, res) => {
//   try {
//     const { startDate, endDate, startTime, endTime, channel } = req.body;

//     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
//     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
//     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

//     let allTransactions = [
//       ...bodaTransactions,
//       ...iphoneTransactions,
//       ...lipaTransactions,
//     ];

//     // Filter by DATE + TIME range
//     if (startDate && endDate) {
//       const startTimeStr = startTime || '00:00';
//       const endTimeStr = endTime || '23:59';
      
//       // Create timestamps in EAT (GMT+3) to avoid date shifts
//       const startTimestamp = new Date(`${startDate} ${startTimeStr}:00 GMT+0300`).getTime();
//       const endTimestamp = new Date(`${endDate} ${endTimeStr}:59 GMT+0300`).getTime();
      
//       console.log('=== DateTime Filter ===');
//       console.log('Start:', new Date(startTimestamp).toISOString());
//       console.log('End:', new Date(endTimestamp).toISOString());
//       console.log('Total transactions before filter:', allTransactions.length);
      
//       allTransactions = allTransactions.filter(transaction => {
//         if (!transaction.receivedTimestamp) return false;
        
//         const isInRange = transaction.receivedTimestamp >= startTimestamp && 
//                          transaction.receivedTimestamp <= endTimestamp;
        
//         if (isInRange) {
//           console.log('✓ Matched:', {
//             dateTime: transaction.receivedDateTime,
//             customer: transaction.customerName || transaction.contractName,
//             amount: transaction.amount
//           });
//         }
        
//         return isInRange;
//       });
      
//       console.log('Total transactions after filter:', allTransactions.length);
//     }

//     // Filter by channel
//     if (channel && channel !== 'all') {
//       console.log('Filtering by channel:', channel);
//       allTransactions = allTransactions.filter(transaction => transaction.channel === channel);
//       console.log('After channel filter:', allTransactions.length);
//     }

//     res.json({
//       success: true,
//       data: allTransactions,
//       count: allTransactions.length,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error filtering transactions',
//       error: error.message,
//     });
//   }
// });

// // Upload and parse invoices CSV
// app.post('/api/invoices/upload', upload.single('file'), (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: 'No file uploaded',
//       });
//     }

//     const fileContent = req.file.buffer.toString('utf-8');
    
//     Papa.parse(fileContent, {
//       header: true,
//       skipEmptyLines: true,
//       complete: (results) => {
//         const invoices = results.data.map((row, index) => {
//           // Extract and clean the amount - remove commas and parse
//           const amountStr = (row['Amount'] || '0').toString().replace(/,/g, '');
//           const amount = parseFloat(amountStr) || 0;
          
//           return {
//             id: index + 1,
//             customerName: row['Customer'] || row['Customer Name'] || '',
//             invoiceNumber: row['Invoice No'] || row['Invoice Number'] || '',
//             amount: amount,
//             invoiceDate: row['Invoice Date'] || row['Date'] || '',
//             customerPhone: extractPhone(row['Customer'] || ''),
//           };
//         });

//         console.log('\n📤 CSV Upload Summary:');
//         console.log(`Total invoices: ${invoices.length}`);
//         if (invoices.length > 0) {
//           console.log('Sample invoice:', {
//             customer: invoices[0].customerName,
//             invoiceNo: invoices[0].invoiceNumber,
//             amount: invoices[0].amount,
//             date: invoices[0].invoiceDate
//           });
//         }

//         res.json({
//           success: true,
//           data: invoices,
//           count: invoices.length,
//         });
//       },
//       error: (error) => {
//         res.status(400).json({
//           success: false,
//           message: 'Error parsing CSV',
//           error: error.message,
//         });
//       },
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error processing file',
//       error: error.message,
//     });
//   }
// });

// // Process invoice payments
// app.post('/api/process-payments', async (req, res) => {
//   try {
//     const { invoices, startDate, endDate, startTime, endTime, channel } = req.body;

//     console.log('\n🔍 Fetching transactions for payment processing...');
//     console.log('Date range:', startDate, 'to', endDate);
//     console.log('Time range:', startTime || '00:00', 'to', endTime || '23:59');
//     console.log('Channel:', channel || 'all');

//     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
//     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
//     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

//     let allTransactions = [
//       ...bodaTransactions,
//       ...iphoneTransactions,
//       ...lipaTransactions,
//     ];

//     console.log(`📊 Total transactions fetched: ${allTransactions.length}`);

//     // 🔥 CRITICAL: Filter by DATE + TIME range
//     if (startDate && endDate) {
//       const startTimeStr = startTime || '00:00';
//       const endTimeStr = endTime || '23:59';
      
//       const startTimestamp = new Date(`${startDate} ${startTimeStr}:00 GMT+0300`).getTime();
//       const endTimestamp = new Date(`${endDate} ${endTimeStr}:59 GMT+0300`).getTime();
      
//       console.log('\n⏰ Applying DateTime Filter:');
//       console.log('Start:', new Date(startTimestamp).toISOString());
//       console.log('End:', new Date(endTimestamp).toISOString());
      
//       const beforeFilterCount = allTransactions.length;
      
//       allTransactions = allTransactions.filter(transaction => {
//         if (!transaction.receivedTimestamp) return false;
//         return transaction.receivedTimestamp >= startTimestamp && 
//                transaction.receivedTimestamp <= endTimestamp;
//       });
      
//       console.log(`✅ Filtered: ${beforeFilterCount} → ${allTransactions.length} transactions`);
//     } else {
//       console.warn('⚠️ WARNING: No date range provided! Using ALL transactions.');
//     }

//     // Filter by channel
//     if (channel && channel !== 'all') {
//       const beforeChannelFilter = allTransactions.length;
//       allTransactions = allTransactions.filter(transaction => transaction.channel === channel);
//       console.log(`📡 Channel filter (${channel}): ${beforeChannelFilter} → ${allTransactions.length} transactions`);
//     }

//     console.log(`\n💵 FINAL: Processing ${allTransactions.length} transactions for ${invoices.length} invoices`);

//     // 🔥 CRITICAL: Only use the FILTERED transactions for payment processing
//     const processedInvoices = processInvoicePayments(invoices, allTransactions);

//     res.json({
//       success: true,
//       data: processedInvoices,
//     });
//   } catch (error) {
//     console.error('❌ Error processing payments:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error processing payments',
//       error: error.message,
//     });
//   }
// });

// // Helper function to extract phone
// function extractPhone(customerName) {
//   const phoneMatch = customerName.match(/\d{10,}/);
//   return phoneMatch ? phoneMatch[0] : null;
// }

// // Main payment processing logic
// // UPDATED: Process payments transaction-by-transaction instead of sum-first
// // UPDATED: Process payments transaction-by-transaction instead of sum-first
// // remainder logic bro 
// // UPDATED: Process payments transaction-by-transaction AND track unused transactions



// // FIXED: Track invoice payment totals for accurate status detection

// function processInvoicePayments(invoices, transactions) {
//   console.log('\n========================================');
//   console.log('=== PAYMENT PROCESSING STARTED ===');
//   console.log('=== TRANSACTION-BY-TRANSACTION MODE ===');
//   console.log('========================================');
//   console.log('📋 Invoices to process:', invoices.length);
//   console.log('💵 Transactions available (WITHIN TIME FRAME):', transactions.length);
  
//   const usedTransactions = new Set();
//   // 🔥 NEW: Track total payments per invoice for accurate status
//   const invoiceTotalPayments = new Map(); // invoiceNo -> total amount paid
  
//   // Step 1: Group invoices by customer
//   const invoicesByCustomer = {};
  
//   invoices.forEach(invoice => {
//     const key = invoice.customerPhone || invoice.customerName.toLowerCase().trim();
//     if (!invoicesByCustomer[key]) {
//       invoicesByCustomer[key] = [];
//     }
//     invoicesByCustomer[key].push(invoice);
//   });

//   console.log(`\n👥 Found ${Object.keys(invoicesByCustomer).length} unique customers with invoices`);

//   // Step 2: Sort each customer's invoices by date (DESCENDING - newest first)
//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     invoicesByCustomer[customerKey].sort((a, b) => {
//       const dateCompare = new Date(b.invoiceDate) - new Date(a.invoiceDate);
//       if (dateCompare !== 0) return dateCompare;
//       return b.invoiceNumber.localeCompare(a.invoiceNumber);
//     });
    
//     console.log(`\n📋 Customer: "${customerKey}"`);
//     console.log(`   Total invoices: ${invoicesByCustomer[customerKey].length}`);
//     console.log('   Invoices sorted (NEWEST → OLDEST):');
//     invoicesByCustomer[customerKey].forEach((inv, idx) => {
//       console.log(`      ${idx + 1}. Invoice #${inv.invoiceNumber} | Date: ${inv.invoiceDate} | Amount: TZS ${inv.amount.toLocaleString()}`);
//     });
//   });

//   // Step 3: Group transactions by customer
//   const transactionsByCustomer = {};
//   const processedTransactionIds = new Set();
  
//   transactions.forEach(transaction => {
//     if (!transaction.amount) return;
    
//     const transactionUniqueId = `${transaction.transactionId || transaction.id}_${transaction.receivedTimestamp}_${transaction.amount}`;
    
//     if (processedTransactionIds.has(transactionUniqueId)) {
//       console.warn(`⚠️ Skipping duplicate transaction: ${transaction.transactionId}`);
//       return;
//     }
    
//     const keys = [
//       transaction.customerPhone,
//       transaction.contractName?.toLowerCase().trim(),
//       transaction.customerName?.toLowerCase().trim()
//     ].filter(Boolean);
    
//     const matchedKey = keys.find(key => invoicesByCustomer[key]);
    
//     if (matchedKey) {
//       if (!transactionsByCustomer[matchedKey]) {
//         transactionsByCustomer[matchedKey] = [];
//       }
//       transactionsByCustomer[matchedKey].push(transaction);
//       processedTransactionIds.add(transactionUniqueId);
//     } else {
//       const primaryKey = keys[0];
//       if (primaryKey) {
//         if (!transactionsByCustomer[primaryKey]) {
//           transactionsByCustomer[primaryKey] = [];
//         }
//         transactionsByCustomer[primaryKey].push(transaction);
//         processedTransactionIds.add(transactionUniqueId);
//       }
//     }
//   });

//   // Sort transactions by timestamp (oldest first - FIFO)
//   Object.keys(transactionsByCustomer).forEach(customerKey => {
//     transactionsByCustomer[customerKey].sort((a, b) => {
//       return (a.receivedTimestamp || 0) - (b.receivedTimestamp || 0);
//     });
//   });

//   console.log(`\n💰 Found ${Object.keys(transactionsByCustomer).length} unique customers with transactions`);

//   // Step 4: Process transaction-by-transaction
//   const processedPayments = [];

//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     const customerInvoices = invoicesByCustomer[customerKey];
//     const customerTransactions = transactionsByCustomer[customerKey] || [];
    
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`💵 PROCESSING: "${customerKey}"`);
//     console.log(`${'='.repeat(80)}`);
//     console.log(`   Transactions: ${customerTransactions.length}`);
//     console.log(`   Invoices: ${customerInvoices.length}`);
    
//     if (customerTransactions.length === 0) {
//       console.log(`   ⚠️ No transactions found - marking all invoices as UNPAID`);
      
//       customerInvoices.forEach(invoice => {
//         invoiceTotalPayments.set(invoice.invoiceNumber, 0);
//         processedPayments.push({
//           paymentDate: invoice.invoiceDate,
//           customerName: invoice.customerName,
//           paymentMethod: 'Cash',
//           depositToAccountName: 'Kijichi Collection AC',
//           invoiceNo: invoice.invoiceNumber,
//           journalNo: '',
//           invoiceAmount: invoice.amount,
//           amount: 0,
//           referenceNo: '',
//           memo: '',
//           countryCode: '',
//           exchangeRate: '',
//         });
//       });
//       return;
//     }

//     // Track remaining balance for each invoice
//     const invoiceBalances = customerInvoices.map(inv => ({
//       invoice: inv,
//       remainingBalance: inv.amount,
//       fullyPaid: false
//     }));

//     let currentInvoiceIndex = 0;

//     // Process each transaction one by one
//     customerTransactions.forEach((transaction, txIdx) => {
//       let transactionAmount = transaction.amount;
//       let transactionUsed = false;
      
//       console.log(`\n   💳 Transaction ${txIdx + 1}/${customerTransactions.length}`);
//       console.log(`      Amount: TZS ${transactionAmount.toLocaleString()}`);
//       console.log(`      Date: ${transaction.receivedDateTime}`);
//       console.log(`      ID: ${transaction.transactionId || 'N/A'}`);

//       // Use this transaction to pay invoices
//       while (transactionAmount > 0 && currentInvoiceIndex < invoiceBalances.length) {
//         const currentInvoice = invoiceBalances[currentInvoiceIndex];
        
//         if (currentInvoice.fullyPaid) {
//           currentInvoiceIndex++;
//           continue;
//         }

//         const amountToPay = Math.min(transactionAmount, currentInvoice.remainingBalance);
        
//         console.log(`      → Paying Invoice #${currentInvoice.invoice.invoiceNumber}`);
//         console.log(`         Remaining balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
//         console.log(`         Paying: TZS ${amountToPay.toLocaleString()}`);

//         // Format date as MM-DD-YYYY
//         let formattedDate = transaction.receivedDateTime || transaction.receivedDate || currentInvoice.invoice.invoiceDate;
//         const dateObj = new Date(formattedDate);
//         if (!isNaN(dateObj.getTime())) {
//           const month = String(dateObj.getMonth() + 1).padStart(2, '0');
//           const day = String(dateObj.getDate()).padStart(2, '0');
//           const year = dateObj.getFullYear();
//           formattedDate = `${month}-${day}-${year}`;
//         }

//         // 🔥 Track total payment for this invoice
//         const currentTotal = invoiceTotalPayments.get(currentInvoice.invoice.invoiceNumber) || 0;
//         invoiceTotalPayments.set(currentInvoice.invoice.invoiceNumber, currentTotal + amountToPay);

//         // Create payment record
//         processedPayments.push({
//           paymentDate: formattedDate,
//           customerName: currentInvoice.invoice.customerName,
//           paymentMethod: 'Cash',
//           depositToAccountName: 'Kijichi Collection AC',
//           invoiceNo: currentInvoice.invoice.invoiceNumber,
//           journalNo: '',
//           invoiceAmount: currentInvoice.invoice.amount,
//           amount: amountToPay,
//           referenceNo: '',
//           memo: transaction.transactionId || '',
//           countryCode: '',
//           exchangeRate: '',
//         });

//         // Update balances
//         currentInvoice.remainingBalance -= amountToPay;
//         transactionAmount -= amountToPay;
//         transactionUsed = true;

//         console.log(`         New balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
//         console.log(`         Transaction remaining: TZS ${transactionAmount.toLocaleString()}`);

//         // Mark invoice as fully paid if balance <= 1 TZS
//         if (currentInvoice.remainingBalance <= 1) {
//           currentInvoice.fullyPaid = true;
//           currentInvoice.remainingBalance = 0;
//           console.log(`         ✅ Invoice #${currentInvoice.invoice.invoiceNumber} FULLY PAID!`);
//           currentInvoiceIndex++;
//         }
//       }

//       if (transactionUsed) {
//         usedTransactions.add(transaction.transactionId || transaction.id);
//       }

//       if (transactionAmount > 0) {
//         console.log(`      ⚠️ Transaction has TZS ${transactionAmount.toLocaleString()} remaining (overpayment)`);
//       }
//     });

//     // Mark any unpaid invoices
//     invoiceBalances.forEach(invBalance => {
//       if (!invBalance.fullyPaid && invBalance.remainingBalance > 0) {
//         console.log(`   ❌ Invoice #${invBalance.invoice.invoiceNumber} UNPAID - Balance: TZS ${invBalance.remainingBalance.toLocaleString()}`);
        
//         const hasPayment = processedPayments.some(p => p.invoiceNo === invBalance.invoice.invoiceNumber);
//         if (!hasPayment) {
//           invoiceTotalPayments.set(invBalance.invoice.invoiceNumber, 0);
//           processedPayments.push({
//             paymentDate: invBalance.invoice.invoiceDate,
//             customerName: invBalance.invoice.customerName,
//             paymentMethod: 'Cash',
//             depositToAccountName: 'Kijichi Collection AC',
//             invoiceNo: invBalance.invoice.invoiceNumber,
//             journalNo: '',
//             invoiceAmount: invBalance.invoice.amount,
//             amount: 0,
//             referenceNo: '',
//             memo: '',
//             countryCode: '',
//             exchangeRate: '',
//           });
//         }
//       }
//     });
//   });

//   // 🔥 Add UNUSED transactions at the end
//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`🔍 CHECKING FOR UNUSED TRANSACTIONS`);
//   console.log(`${'='.repeat(80)}`);
  
//   const unusedTransactions = transactions.filter(transaction => {
//     const txId = transaction.transactionId || transaction.id;
//     return !usedTransactions.has(txId);
//   });

//   console.log(`✅ Used transactions: ${usedTransactions.size}`);
//   console.log(`⚠️ Unused transactions: ${unusedTransactions.length}`);

//   unusedTransactions.forEach(transaction => {
//     let formattedDate = transaction.receivedDateTime || transaction.receivedDate || '';
//     const dateObj = new Date(formattedDate);
//     if (!isNaN(dateObj.getTime())) {
//       const month = String(dateObj.getMonth() + 1).padStart(2, '0');
//       const day = String(dateObj.getDate()).padStart(2, '0');
//       const year = dateObj.getFullYear();
//       formattedDate = `${month}-${day}-${year}`;
//     }

//     console.log(`   💰 UNUSED: ${transaction.customerName || transaction.contractName} | TZS ${transaction.amount.toLocaleString()} | ID: ${transaction.transactionId}`);

//     processedPayments.push({
//       paymentDate: formattedDate,
//       customerName: transaction.customerName || transaction.contractName || 'UNKNOWN',
//       paymentMethod: 'Cash',
//       depositToAccountName: 'Kijichi Collection AC',
//       invoiceNo: 'UNUSED',
//       journalNo: '',
//       invoiceAmount: transaction.amount,
//       amount: 'UNUSED', // 🔥 String value for unused
//       referenceNo: '',
//       memo: transaction.transactionId || '',
//       countryCode: '',
//       exchangeRate: '',
//     });
//   });

//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`✅ PAYMENT PROCESSING COMPLETED`);
//   console.log(`${'='.repeat(80)}`);
//   console.log(`Total payment records: ${processedPayments.length}`);
//   console.log(`Used transactions: ${usedTransactions.size}`);
//   console.log(`Unused transactions: ${unusedTransactions.length}`);
  
//   const totalPaid = processedPayments
//     .filter(p => typeof p.amount === 'number' && p.amount > 0)
//     .reduce((sum, p) => sum + p.amount, 0);
  
//   console.log(`Total amount paid (invoices only): TZS ${totalPaid.toLocaleString()}`);
//   console.log(`\n`);
  
//   // 🔥 Add metadata to help frontend determine status
//   return processedPayments.map(payment => {
//     if (payment.invoiceNo === 'UNUSED') {
//       return payment;
//     }
    
//     const totalPaid = invoiceTotalPayments.get(payment.invoiceNo) || 0;
//     const isFullyPaid = Math.abs(totalPaid - payment.invoiceAmount) <= 1;
    
//     return {
//       ...payment,
//       isFullyPaid, // 🔥 Flag for frontend
//       totalPaidForInvoice: totalPaid
//     };
//   });
// }

// module.exports = { processInvoicePayments };


// UPDATED: Process payments transaction-by-transaction AND track unused transactions
// function processInvoicePayments(invoices, transactions) {
//   console.log('\n========================================');
//   console.log('=== PAYMENT PROCESSING STARTED ===');
//   console.log('=== TRANSACTION-BY-TRANSACTION MODE ===');
//   console.log('========================================');
//   console.log('📋 Invoices to process:', invoices.length);
//   console.log('💵 Transactions available (WITHIN TIME FRAME):', transactions.length);
  
//   // 🔥 NEW: Track which transactions are used
//   const usedTransactions = new Set();
  
//   // Step 1: Group invoices by customer (by phone or name)
//   const invoicesByCustomer = {};
  
//   invoices.forEach(invoice => {
//     const key = invoice.customerPhone || invoice.customerName.toLowerCase().trim();
//     if (!invoicesByCustomer[key]) {
//       invoicesByCustomer[key] = [];
//     }
//     invoicesByCustomer[key].push(invoice);
//   });

//   console.log(`\n👥 Found ${Object.keys(invoicesByCustomer).length} unique customers with invoices`);

//   // Step 2: Sort each customer's invoices by date (DESCENDING - newest first)
//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     invoicesByCustomer[customerKey].sort((a, b) => {
//       const dateCompare = new Date(b.invoiceDate) - new Date(a.invoiceDate);
//       if (dateCompare !== 0) return dateCompare;
//       return b.invoiceNumber.localeCompare(a.invoiceNumber);
//     });
    
//     console.log(`\n📋 Customer: "${customerKey}"`);
//     console.log(`   Total invoices: ${invoicesByCustomer[customerKey].length}`);
//     console.log('   Invoices sorted (NEWEST → OLDEST):');
//     invoicesByCustomer[customerKey].forEach((inv, idx) => {
//       console.log(`      ${idx + 1}. Invoice #${inv.invoiceNumber} | Date: ${inv.invoiceDate} | Amount: TZS ${inv.amount.toLocaleString()}`);
//     });
//   });

//   // Step 3: Group transactions by customer AND sort by timestamp
//   const transactionsByCustomer = {};
//   const processedTransactionIds = new Set();
  
//   transactions.forEach(transaction => {
//     if (!transaction.amount) return;
    
//     const transactionUniqueId = `${transaction.transactionId || transaction.id}_${transaction.receivedTimestamp}_${transaction.amount}`;
    
//     if (processedTransactionIds.has(transactionUniqueId)) {
//       console.warn(`⚠️ Skipping duplicate transaction: ${transaction.transactionId} for ${transaction.customerName || transaction.contractName}`);
//       return;
//     }
    
//     const keys = [
//       transaction.customerPhone,
//       transaction.contractName?.toLowerCase().trim(),
//       transaction.customerName?.toLowerCase().trim()
//     ].filter(Boolean);
    
//     const matchedKey = keys.find(key => invoicesByCustomer[key]);
    
//     if (matchedKey) {
//       if (!transactionsByCustomer[matchedKey]) {
//         transactionsByCustomer[matchedKey] = [];
//       }
//       transactionsByCustomer[matchedKey].push(transaction);
//       processedTransactionIds.add(transactionUniqueId);
//     } else {
//       const primaryKey = keys[0];
//       if (primaryKey) {
//         if (!transactionsByCustomer[primaryKey]) {
//           transactionsByCustomer[primaryKey] = [];
//         }
//         transactionsByCustomer[primaryKey].push(transaction);
//         processedTransactionIds.add(transactionUniqueId);
//       }
//     }
//   });

//   // Sort transactions by timestamp (oldest first - FIFO)
//   Object.keys(transactionsByCustomer).forEach(customerKey => {
//     transactionsByCustomer[customerKey].sort((a, b) => {
//       return (a.receivedTimestamp || 0) - (b.receivedTimestamp || 0);
//     });
//   });

//   console.log(`\n💰 Found ${Object.keys(transactionsByCustomer).length} unique customers with transactions`);

//   // Step 4: Process transaction-by-transaction
//   const processedPayments = [];

//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     const customerInvoices = invoicesByCustomer[customerKey];
//     const customerTransactions = transactionsByCustomer[customerKey] || [];
    
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`💵 PROCESSING: "${customerKey}"`);
//     console.log(`${'='.repeat(80)}`);
//     console.log(`   Transactions: ${customerTransactions.length}`);
//     console.log(`   Invoices: ${customerInvoices.length}`);
    
//     if (customerTransactions.length === 0) {
//       console.log(`   ⚠️ No transactions found - marking all invoices as UNPAID`);
      
//       // Mark all invoices as unpaid
//       customerInvoices.forEach(invoice => {
//         processedPayments.push({
//           paymentDate: invoice.invoiceDate,
//           customerName: invoice.customerName,
//           paymentMethod: 'Cash',
//           depositToAccountName: 'Kijichi Collection AC',
//           invoiceNo: invoice.invoiceNumber,
//           journalNo: '',
//           invoiceAmount: invoice.amount,
//           amount: 0,
//           referenceNo: '',
//           memo: '',
//           countryCode: '',
//           exchangeRate: '',
//         });
//       });
//       return;
//     }

//     // Track remaining balance for each invoice
//     const invoiceBalances = customerInvoices.map(inv => ({
//       invoice: inv,
//       remainingBalance: inv.amount,
//       fullyPaid: false
//     }));

//     let currentInvoiceIndex = 0;

//     // Process each transaction one by one
//     customerTransactions.forEach((transaction, txIdx) => {
//       let transactionAmount = transaction.amount;
//       let transactionUsed = false; // 🔥 NEW: Track if transaction is used
      
//       console.log(`\n   💳 Transaction ${txIdx + 1}/${customerTransactions.length}`);
//       console.log(`      Amount: TZS ${transactionAmount.toLocaleString()}`);
//       console.log(`      Date: ${transaction.receivedDateTime}`);
//       console.log(`      ID: ${transaction.transactionId || 'N/A'}`);

//       // Use this transaction to pay invoices
//       while (transactionAmount > 0 && currentInvoiceIndex < invoiceBalances.length) {
//         const currentInvoice = invoiceBalances[currentInvoiceIndex];
        
//         if (currentInvoice.fullyPaid) {
//           currentInvoiceIndex++;
//           continue;
//         }

//         const amountToPay = Math.min(transactionAmount, currentInvoice.remainingBalance);
        
//         console.log(`      → Paying Invoice #${currentInvoice.invoice.invoiceNumber}`);
//         console.log(`         Remaining balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
//         console.log(`         Paying: TZS ${amountToPay.toLocaleString()}`);

//         // Format date as MM-DD-YYYY for QuickBooks
//         let formattedDate = transaction.receivedDateTime || transaction.receivedDate || currentInvoice.invoice.invoiceDate;
//         const dateObj = new Date(formattedDate);
//         if (!isNaN(dateObj.getTime())) {
//           const month = String(dateObj.getMonth() + 1).padStart(2, '0');
//           const day = String(dateObj.getDate()).padStart(2, '0');
//           const year = dateObj.getFullYear();
//           formattedDate = `${month}-${day}-${year}`;
//         }

//         // Create payment record for this transaction portion
//         processedPayments.push({
//           paymentDate: formattedDate,
//           customerName: currentInvoice.invoice.customerName,
//           paymentMethod: 'Cash',
//           depositToAccountName: 'Kijichi Collection AC',
//           invoiceNo: currentInvoice.invoice.invoiceNumber,
//           journalNo: '',
//           invoiceAmount: currentInvoice.invoice.amount,
//           amount: amountToPay,
//           referenceNo: '',
//           memo: transaction.transactionId || '',
//           countryCode: '',
//           exchangeRate: '',
//         });

//         // Update balances
//         currentInvoice.remainingBalance -= amountToPay;
//         transactionAmount -= amountToPay;
//         transactionUsed = true; // 🔥 Mark transaction as used

//         console.log(`         New balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
//         console.log(`         Transaction remaining: TZS ${transactionAmount.toLocaleString()}`);

//         // Mark invoice as fully paid if balance is 0 or nearly 0 (within 1 TZS tolerance)
//         if (currentInvoice.remainingBalance <= 1) {
//           currentInvoice.fullyPaid = true;
//           currentInvoice.remainingBalance = 0; // Set to exactly 0
//           console.log(`         ✅ Invoice #${currentInvoice.invoice.invoiceNumber} FULLY PAID!`);
//           currentInvoiceIndex++;
//         }
//       }

//       // 🔥 NEW: Mark transaction as used if any amount was applied
//       if (transactionUsed) {
//         usedTransactions.add(transaction.transactionId || transaction.id);
//       }

//       if (transactionAmount > 0) {
//         console.log(`      ⚠️ Transaction has TZS ${transactionAmount.toLocaleString()} remaining (overpayment)`);
//       }
//     });

//     // Mark any unpaid invoices
//     invoiceBalances.forEach(invBalance => {
//       if (!invBalance.fullyPaid && invBalance.remainingBalance > 0) {
//         console.log(`   ❌ Invoice #${invBalance.invoice.invoiceNumber} UNPAID - Balance: TZS ${invBalance.remainingBalance.toLocaleString()}`);
        
//         // Only add unpaid record if no payment was made at all
//         const hasPayment = processedPayments.some(p => p.invoiceNo === invBalance.invoice.invoiceNumber);
//         if (!hasPayment) {
//           processedPayments.push({
//             paymentDate: invBalance.invoice.invoiceDate,
//             customerName: invBalance.invoice.customerName,
//             paymentMethod: 'Cash',
//             depositToAccountName: 'Kijichi Collection AC',
//             invoiceNo: invBalance.invoice.invoiceNumber,
//             journalNo: '',
//             invoiceAmount: invBalance.invoice.amount,
//             amount: 0,
//             referenceNo: '',
//             memo: '',
//             countryCode: '',
//             exchangeRate: '',
//           });
//         }
//       }
//     });
//   });

//   // 🔥 NEW: Add unused transactions to the output
//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`🔍 CHECKING FOR UNUSED TRANSACTIONS`);
//   console.log(`${'='.repeat(80)}`);
  
//   const unusedTransactions = transactions.filter(transaction => {
//     const txId = transaction.transactionId || transaction.id;
//     return !usedTransactions.has(txId);
//   });

//   console.log(`✅ Used transactions: ${usedTransactions.size}`);
//   console.log(`⚠️ Unused transactions: ${unusedTransactions.length}`);

//   unusedTransactions.forEach(transaction => {
//     // Format date as MM-DD-YYYY
//     let formattedDate = transaction.receivedDateTime || transaction.receivedDate || '';
//     const dateObj = new Date(formattedDate);
//     if (!isNaN(dateObj.getTime())) {
//       const month = String(dateObj.getMonth() + 1).padStart(2, '0');
//       const day = String(dateObj.getDate()).padStart(2, '0');
//       const year = dateObj.getFullYear();
//       formattedDate = `${month}-${day}-${year}`;
//     }

//     console.log(`   💰 UNUSED: ${transaction.customerName || transaction.contractName} | TZS ${transaction.amount.toLocaleString()} | ID: ${transaction.transactionId}`);

//     processedPayments.push({
//       paymentDate: formattedDate,
//       customerName: transaction.customerName || transaction.contractName || 'UNKNOWN',
//       paymentMethod: 'Cash',
//       depositToAccountName: 'Kijichi Collection AC',
//       invoiceNo: 'UNUSED',
//       journalNo: '',
//       invoiceAmount: transaction.amount,
//       amount: 'UNUSED', // 🔥 Mark as UNUSED in the amount field
//       referenceNo: '',
//       memo: transaction.transactionId || '',
//       countryCode: '',
//       exchangeRate: '',
//     });
//   });

//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`✅ PAYMENT PROCESSING COMPLETED`);
//   console.log(`${'='.repeat(80)}`);
//   console.log(`Total payment records: ${processedPayments.length}`);
//   console.log(`Used transactions: ${usedTransactions.size}`);
//   console.log(`Unused transactions: ${unusedTransactions.length}`);
//   console.log(`Total amount paid: TZS ${processedPayments.filter(p => typeof p.amount === 'number').reduce((sum, p) => sum + p.amount, 0).toLocaleString()}`);
//   console.log(`\n`);
  
//   return processedPayments;
// }






// function processInvoicePayments(invoices, transactions) {
//   console.log('\n========================================');
//   console.log('=== PAYMENT PROCESSING STARTED ===');
//   console.log('=== TRANSACTION-BY-TRANSACTION MODE ===');
//   console.log('========================================');
//   console.log('📋 Invoices to process:', invoices.length);
//   console.log('💵 Transactions available (WITHIN TIME FRAME):', transactions.length);
  
//   // 🔥 NEW: Track which transactions are used
//   const usedTransactions = new Set();
  
//   // Step 1: Group invoices by customer (by phone or name)
//   const invoicesByCustomer = {};
  
//   invoices.forEach(invoice => {
//     const key = invoice.customerPhone || invoice.customerName.toLowerCase().trim();
//     if (!invoicesByCustomer[key]) {
//       invoicesByCustomer[key] = [];
//     }
//     invoicesByCustomer[key].push(invoice);
//   });

//   console.log(`\n👥 Found ${Object.keys(invoicesByCustomer).length} unique customers with invoices`);

//   // Step 2: Sort each customer's invoices by date (DESCENDING - newest first)
//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     invoicesByCustomer[customerKey].sort((a, b) => {
//       const dateCompare = new Date(b.invoiceDate) - new Date(a.invoiceDate);
//       if (dateCompare !== 0) return dateCompare;
//       return b.invoiceNumber.localeCompare(a.invoiceNumber);
//     });
    
//     console.log(`\n📋 Customer: "${customerKey}"`);
//     console.log(`   Total invoices: ${invoicesByCustomer[customerKey].length}`);
//     console.log('   Invoices sorted (NEWEST → OLDEST):');
//     invoicesByCustomer[customerKey].forEach((inv, idx) => {
//       console.log(`      ${idx + 1}. Invoice #${inv.invoiceNumber} | Date: ${inv.invoiceDate} | Amount: TZS ${inv.amount.toLocaleString()}`);
//     });
//   });

//   // Step 3: Group transactions by customer AND sort by timestamp
//   const transactionsByCustomer = {};
//   const processedTransactionIds = new Set();
  
//   transactions.forEach(transaction => {
//     if (!transaction.amount) return;
    
//     const transactionUniqueId = `${transaction.transactionId || transaction.id}_${transaction.receivedTimestamp}_${transaction.amount}`;
    
//     if (processedTransactionIds.has(transactionUniqueId)) {
//       console.warn(`⚠️ Skipping duplicate transaction: ${transaction.transactionId} for ${transaction.customerName || transaction.contractName}`);
//       return;
//     }
    
//     const keys = [
//       transaction.customerPhone,
//       transaction.contractName?.toLowerCase().trim(),
//       transaction.customerName?.toLowerCase().trim()
//     ].filter(Boolean);
    
//     const matchedKey = keys.find(key => invoicesByCustomer[key]);
    
//     if (matchedKey) {
//       if (!transactionsByCustomer[matchedKey]) {
//         transactionsByCustomer[matchedKey] = [];
//       }
//       transactionsByCustomer[matchedKey].push(transaction);
//       processedTransactionIds.add(transactionUniqueId);
//     } else {
//       const primaryKey = keys[0];
//       if (primaryKey) {
//         if (!transactionsByCustomer[primaryKey]) {
//           transactionsByCustomer[primaryKey] = [];
//         }
//         transactionsByCustomer[primaryKey].push(transaction);
//         processedTransactionIds.add(transactionUniqueId);
//       }
//     }
//   });

//   // Sort transactions by timestamp (oldest first - FIFO)
//   Object.keys(transactionsByCustomer).forEach(customerKey => {
//     transactionsByCustomer[customerKey].sort((a, b) => {
//       return (a.receivedTimestamp || 0) - (b.receivedTimestamp || 0);
//     });
//   });

//   console.log(`\n💰 Found ${Object.keys(transactionsByCustomer).length} unique customers with transactions`);

//   // Step 4: Process transaction-by-transaction
//   const processedPayments = [];

//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     const customerInvoices = invoicesByCustomer[customerKey];
//     const customerTransactions = transactionsByCustomer[customerKey] || [];
    
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`💵 PROCESSING: "${customerKey}"`);
//     console.log(`${'='.repeat(80)}`);
//     console.log(`   Transactions: ${customerTransactions.length}`);
//     console.log(`   Invoices: ${customerInvoices.length}`);
    
//     if (customerTransactions.length === 0) {
//       console.log(`   ⚠️ No transactions found - marking all invoices as UNPAID`);
      
//       // Mark all invoices as unpaid
//       customerInvoices.forEach(invoice => {
//         processedPayments.push({
//           paymentDate: invoice.invoiceDate,
//           customerName: invoice.customerName,
//           paymentMethod: 'Cash',
//           depositToAccountName: 'Kijichi Collection AC',
//           invoiceNo: invoice.invoiceNumber,
//           journalNo: '',
//           invoiceAmount: invoice.amount,
//           amount: 0,
//           referenceNo: '',
//           memo: '',
//           countryCode: '',
//           exchangeRate: '',
//         });
//       });
//       return;
//     }

//     // Track remaining balance for each invoice
//     const invoiceBalances = customerInvoices.map(inv => ({
//       invoice: inv,
//       remainingBalance: inv.amount,
//       fullyPaid: false
//     }));

//     let currentInvoiceIndex = 0;

//     // Process each transaction one by one
//     customerTransactions.forEach((transaction, txIdx) => {
//       let transactionAmount = transaction.amount;
//       let transactionUsed = false; // 🔥 NEW: Track if transaction is used
      
//       console.log(`\n   💳 Transaction ${txIdx + 1}/${customerTransactions.length}`);
//       console.log(`      Amount: TZS ${transactionAmount.toLocaleString()}`);
//       console.log(`      Date: ${transaction.receivedDateTime}`);
//       console.log(`      ID: ${transaction.transactionId || 'N/A'}`);

//       // Use this transaction to pay invoices
//       while (transactionAmount > 0 && currentInvoiceIndex < invoiceBalances.length) {
//         const currentInvoice = invoiceBalances[currentInvoiceIndex];
        
//         if (currentInvoice.fullyPaid) {
//           currentInvoiceIndex++;
//           continue;
//         }

//         const amountToPay = Math.min(transactionAmount, currentInvoice.remainingBalance);
        
//         console.log(`      → Paying Invoice #${currentInvoice.invoice.invoiceNumber}`);
//         console.log(`         Remaining balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
//         console.log(`         Paying: TZS ${amountToPay.toLocaleString()}`);

//         // Format date as MM-DD-YYYY for QuickBooks
//         let formattedDate = transaction.receivedDateTime || transaction.receivedDate || currentInvoice.invoice.invoiceDate;
//         const dateObj = new Date(formattedDate);
//         if (!isNaN(dateObj.getTime())) {
//           const month = String(dateObj.getMonth() + 1).padStart(2, '0');
//           const day = String(dateObj.getDate()).padStart(2, '0');
//           const year = dateObj.getFullYear();
//           formattedDate = `${month}-${day}-${year}`;
//         }

//         // Create payment record for this transaction portion
//         processedPayments.push({
//           paymentDate: formattedDate,
//           customerName: currentInvoice.invoice.customerName,
//           paymentMethod: 'Cash',
//           depositToAccountName: 'Kijichi Collection AC',
//           invoiceNo: currentInvoice.invoice.invoiceNumber,
//           journalNo: '',
//           invoiceAmount: currentInvoice.invoice.amount,
//           amount: amountToPay,
//           referenceNo: '',
//           memo: transaction.transactionId || '',
//           countryCode: '',
//           exchangeRate: '',
//         });

//         // Update balances
//         currentInvoice.remainingBalance -= amountToPay;
//         transactionAmount -= amountToPay;
//         transactionUsed = true; // 🔥 Mark transaction as used

//         console.log(`         New balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
//         console.log(`         Transaction remaining: TZS ${transactionAmount.toLocaleString()}`);

//         // Mark invoice as fully paid if balance is 0
//         if (currentInvoice.remainingBalance <= 0) {
//           currentInvoice.fullyPaid = true;
//           console.log(`         ✅ Invoice #${currentInvoice.invoice.invoiceNumber} FULLY PAID!`);
//           currentInvoiceIndex++;
//         }
//       }

//       // 🔥 NEW: Mark transaction as used if any amount was applied
//       if (transactionUsed) {
//         usedTransactions.add(transaction.transactionId || transaction.id);
//       }

//       if (transactionAmount > 0) {
//         console.log(`      ⚠️ Transaction has TZS ${transactionAmount.toLocaleString()} remaining (overpayment)`);
//       }
//     });

//     // Mark any unpaid invoices
//     invoiceBalances.forEach(invBalance => {
//       if (!invBalance.fullyPaid && invBalance.remainingBalance > 0) {
//         console.log(`   ❌ Invoice #${invBalance.invoice.invoiceNumber} UNPAID - Balance: TZS ${invBalance.remainingBalance.toLocaleString()}`);
        
//         // Only add unpaid record if no payment was made at all
//         const hasPayment = processedPayments.some(p => p.invoiceNo === invBalance.invoice.invoiceNumber);
//         if (!hasPayment) {
//           processedPayments.push({
//             paymentDate: invBalance.invoice.invoiceDate,
//             customerName: invBalance.invoice.customerName,
//             paymentMethod: 'Cash',
//             depositToAccountName: 'Kijichi Collection AC',
//             invoiceNo: invBalance.invoice.invoiceNumber,
//             journalNo: '',
//             invoiceAmount: invBalance.invoice.amount,
//             amount: 0,
//             referenceNo: '',
//             memo: '',
//             countryCode: '',
//             exchangeRate: '',
//           });
//         }
//       }
//     });
//   });

//   // 🔥 NEW: Add unused transactions to the output
//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`🔍 CHECKING FOR UNUSED TRANSACTIONS`);
//   console.log(`${'='.repeat(80)}`);
  
//   const unusedTransactions = transactions.filter(transaction => {
//     const txId = transaction.transactionId || transaction.id;
//     return !usedTransactions.has(txId);
//   });

//   console.log(`✅ Used transactions: ${usedTransactions.size}`);
//   console.log(`⚠️ Unused transactions: ${unusedTransactions.length}`);

//   unusedTransactions.forEach(transaction => {
//     // Format date as MM-DD-YYYY
//     let formattedDate = transaction.receivedDateTime || transaction.receivedDate || '';
//     const dateObj = new Date(formattedDate);
//     if (!isNaN(dateObj.getTime())) {
//       const month = String(dateObj.getMonth() + 1).padStart(2, '0');
//       const day = String(dateObj.getDate()).padStart(2, '0');
//       const year = dateObj.getFullYear();
//       formattedDate = `${month}-${day}-${year}`;
//     }

//     console.log(`   💰 UNUSED: ${transaction.customerName || transaction.contractName} | TZS ${transaction.amount.toLocaleString()} | ID: ${transaction.transactionId}`);

//     processedPayments.push({
//       paymentDate: formattedDate,
//       customerName: transaction.customerName || transaction.contractName || 'UNKNOWN',
//       paymentMethod: 'Cash',
//       depositToAccountName: 'Kijichi Collection AC',
//       invoiceNo: 'UNUSED',
//       journalNo: '',
//       invoiceAmount: transaction.amount,
//       amount: 'UNUSED', // 🔥 Mark as UNUSED in the amount field
//       referenceNo: '',
//       memo: transaction.transactionId || '',
//       countryCode: '',
//       exchangeRate: '',
//     });
//   });

//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`✅ PAYMENT PROCESSING COMPLETED`);
//   console.log(`${'='.repeat(80)}`);
//   console.log(`Total payment records: ${processedPayments.length}`);
//   console.log(`Used transactions: ${usedTransactions.size}`);
//   console.log(`Unused transactions: ${unusedTransactions.length}`);
//   console.log(`Total amount paid: TZS ${processedPayments.filter(p => typeof p.amount === 'number').reduce((sum, p) => sum + p.amount, 0).toLocaleString()}`);
//   console.log(`\n`);
  
//   return processedPayments;
// }


// function processInvoicePayments(invoices, transactions) {
//   console.log('\n========================================');
//   console.log('=== PAYMENT PROCESSING STARTED ===');
//   console.log('=== TRANSACTION-BY-TRANSACTION MODE ===');
//   console.log('========================================');
//   console.log('📋 Invoices to process:', invoices.length);
//   console.log('💵 Transactions available (WITHIN TIME FRAME):', transactions.length);
  
//   // Step 1: Group invoices by customer (by phone or name)
//   const invoicesByCustomer = {};
  
//   invoices.forEach(invoice => {
//     const key = invoice.customerPhone || invoice.customerName.toLowerCase().trim();
//     if (!invoicesByCustomer[key]) {
//       invoicesByCustomer[key] = [];
//     }
//     invoicesByCustomer[key].push(invoice);
//   });

//   console.log(`\n👥 Found ${Object.keys(invoicesByCustomer).length} unique customers with invoices`);

//   // Step 2: Sort each customer's invoices by date (DESCENDING - newest first)
//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     invoicesByCustomer[customerKey].sort((a, b) => {
//       const dateCompare = new Date(b.invoiceDate) - new Date(a.invoiceDate);
//       if (dateCompare !== 0) return dateCompare;
//       return b.invoiceNumber.localeCompare(a.invoiceNumber);
//     });
    
//     console.log(`\n📋 Customer: "${customerKey}"`);
//     console.log(`   Total invoices: ${invoicesByCustomer[customerKey].length}`);
//     console.log('   Invoices sorted (NEWEST → OLDEST):');
//     invoicesByCustomer[customerKey].forEach((inv, idx) => {
//       console.log(`      ${idx + 1}. Invoice #${inv.invoiceNumber} | Date: ${inv.invoiceDate} | Amount: TZS ${inv.amount.toLocaleString()}`);
//     });
//   });

//   // Step 3: Group transactions by customer AND sort by timestamp
//   const transactionsByCustomer = {};
//   const processedTransactionIds = new Set();
  
//   transactions.forEach(transaction => {
//     if (!transaction.amount) return;
    
//     const transactionUniqueId = `${transaction.transactionId || transaction.id}_${transaction.receivedTimestamp}_${transaction.amount}`;
    
//     if (processedTransactionIds.has(transactionUniqueId)) {
//       console.warn(`⚠️ Skipping duplicate transaction: ${transaction.transactionId} for ${transaction.customerName || transaction.contractName}`);
//       return;
//     }
    
//     const keys = [
//       transaction.customerPhone,
//       transaction.contractName?.toLowerCase().trim(),
//       transaction.customerName?.toLowerCase().trim()
//     ].filter(Boolean);
    
//     const matchedKey = keys.find(key => invoicesByCustomer[key]);
    
//     if (matchedKey) {
//       if (!transactionsByCustomer[matchedKey]) {
//         transactionsByCustomer[matchedKey] = [];
//       }
//       transactionsByCustomer[matchedKey].push(transaction);
//       processedTransactionIds.add(transactionUniqueId);
//     } else {
//       const primaryKey = keys[0];
//       if (primaryKey) {
//         if (!transactionsByCustomer[primaryKey]) {
//           transactionsByCustomer[primaryKey] = [];
//         }
//         transactionsByCustomer[primaryKey].push(transaction);
//         processedTransactionIds.add(transactionUniqueId);
//       }
//     }
//   });

//   // Sort transactions by timestamp (oldest first - FIFO)
//   Object.keys(transactionsByCustomer).forEach(customerKey => {
//     transactionsByCustomer[customerKey].sort((a, b) => {
//       return (a.receivedTimestamp || 0) - (b.receivedTimestamp || 0);
//     });
//   });

//   console.log(`\n💰 Found ${Object.keys(transactionsByCustomer).length} unique customers with transactions`);

//   // Step 4: 🔥 NEW LOGIC - Process transaction-by-transaction
//   const processedPayments = [];

//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     const customerInvoices = invoicesByCustomer[customerKey];
//     const customerTransactions = transactionsByCustomer[customerKey] || [];
    
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`💵 PROCESSING: "${customerKey}"`);
//     console.log(`${'='.repeat(80)}`);
//     console.log(`   Transactions: ${customerTransactions.length}`);
//     console.log(`   Invoices: ${customerInvoices.length}`);
    
//     if (customerTransactions.length === 0) {
//       console.log(`   ⚠️ No transactions found - marking all invoices as UNPAID`);
      
//       // Mark all invoices as unpaid
//       customerInvoices.forEach(invoice => {
//         processedPayments.push({
//           paymentDate: invoice.invoiceDate,
//           customerName: invoice.customerName,
//           paymentMethod: 'Cash',
//           depositToAccountName: 'Kijichi Collection AC',
//           invoiceNo: invoice.invoiceNumber,
//           journalNo: '',
//           invoiceAmount: invoice.amount,
//           amount: 0,
//           referenceNo: '',
//           memo: '',
//           countryCode: '',
//           exchangeRate: '',
//         });
//       });
//       return;
//     }

//     // 🔥 NEW: Track remaining balance for each invoice
//     const invoiceBalances = customerInvoices.map(inv => ({
//       invoice: inv,
//       remainingBalance: inv.amount,
//       fullyPaid: false
//     }));

//     let currentInvoiceIndex = 0;

//     // Process each transaction one by one
//     customerTransactions.forEach((transaction, txIdx) => {
//       let transactionAmount = transaction.amount;
      
//       console.log(`\n   💳 Transaction ${txIdx + 1}/${customerTransactions.length}`);
//       console.log(`      Amount: TZS ${transactionAmount.toLocaleString()}`);
//       console.log(`      Date: ${transaction.receivedDateTime}`);
//       console.log(`      ID: ${transaction.transactionId || 'N/A'}`);

//       // Use this transaction to pay invoices
//       while (transactionAmount > 0 && currentInvoiceIndex < invoiceBalances.length) {
//         const currentInvoice = invoiceBalances[currentInvoiceIndex];
        
//         if (currentInvoice.fullyPaid) {
//           currentInvoiceIndex++;
//           continue;
//         }

//         const amountToPay = Math.min(transactionAmount, currentInvoice.remainingBalance);
        
//         console.log(`      → Paying Invoice #${currentInvoice.invoice.invoiceNumber}`);
//         console.log(`         Remaining balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
//         console.log(`         Paying: TZS ${amountToPay.toLocaleString()}`);

//         // Format date as MM-DD-YYYY for QuickBooks
//         let formattedDate = transaction.receivedDateTime || transaction.receivedDate || currentInvoice.invoice.invoiceDate;
//         const dateObj = new Date(formattedDate);
//         if (!isNaN(dateObj.getTime())) {
//           const month = String(dateObj.getMonth() + 1).padStart(2, '0');
//           const day = String(dateObj.getDate()).padStart(2, '0');
//           const year = dateObj.getFullYear();
//           formattedDate = `${month}-${day}-${year}`;
//         }

//         // Create payment record for this transaction portion
//         processedPayments.push({
//           paymentDate: formattedDate,
//           customerName: currentInvoice.invoice.customerName,
//           paymentMethod: 'Cash',
//           depositToAccountName: 'Kijichi Collection AC',
//           invoiceNo: currentInvoice.invoice.invoiceNumber,
//           journalNo: '',
//           invoiceAmount: currentInvoice.invoice.amount,
//           amount: amountToPay,
//           referenceNo: '',
//           memo: transaction.transactionId || '',
//           countryCode: '',
//           exchangeRate: '',
//         });

//         // Update balances
//         currentInvoice.remainingBalance -= amountToPay;
//         transactionAmount -= amountToPay;

//         console.log(`         New balance: TZS ${currentInvoice.remainingBalance.toLocaleString()}`);
//         console.log(`         Transaction remaining: TZS ${transactionAmount.toLocaleString()}`);

//         // Mark invoice as fully paid if balance is 0
//         if (currentInvoice.remainingBalance <= 0) {
//           currentInvoice.fullyPaid = true;
//           console.log(`         ✅ Invoice #${currentInvoice.invoice.invoiceNumber} FULLY PAID!`);
//           currentInvoiceIndex++;
//         }
//       }

//       if (transactionAmount > 0) {
//         console.log(`      ⚠️ Transaction has TZS ${transactionAmount.toLocaleString()} remaining (overpayment)`);
//       }
//     });

//     // Mark any unpaid invoices
//     invoiceBalances.forEach(invBalance => {
//       if (!invBalance.fullyPaid && invBalance.remainingBalance > 0) {
//         console.log(`   ❌ Invoice #${invBalance.invoice.invoiceNumber} UNPAID - Balance: TZS ${invBalance.remainingBalance.toLocaleString()}`);
        
//         // Only add unpaid record if no payment was made at all
//         const hasPayment = processedPayments.some(p => p.invoiceNo === invBalance.invoice.invoiceNumber);
//         if (!hasPayment) {
//           processedPayments.push({
//             paymentDate: invBalance.invoice.invoiceDate,
//             customerName: invBalance.invoice.customerName,
//             paymentMethod: 'Cash',
//             depositToAccountName: 'Kijichi Collection AC',
//             invoiceNo: invBalance.invoice.invoiceNumber,
//             journalNo: '',
//             invoiceAmount: invBalance.invoice.amount,
//             amount: 0,
//             referenceNo: '',
//             memo: '',
//             countryCode: '',
//             exchangeRate: '',
//           });
//         }
//       }
//     });
//   });

//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`✅ PAYMENT PROCESSING COMPLETED`);
//   console.log(`${'='.repeat(80)}`);
//   console.log(`Total payment records: ${processedPayments.length}`);
//   console.log(`Total amount paid: TZS ${processedPayments.reduce((sum, p) => sum + p.amount, 0).toLocaleString()}`);
//   console.log(`\n`);
  
//   return processedPayments;
// }




// Main payment processing logic - FIXED VERSION (NO DUPLICATES + OVERPAYMENT)
// function processInvoicePayments(invoices, transactions) {
//   console.log('\n========================================');
//   console.log('=== PAYMENT PROCESSING STARTED ===');
//   console.log('========================================');
//   console.log('📋 Invoices to process:', invoices.length);
//   console.log('💵 Transactions available (WITHIN TIME FRAME):', transactions.length);
  
//   // Step 1: Group invoices by customer (by phone or name)
//   const invoicesByCustomer = {};
  
//   invoices.forEach(invoice => {
//     const key = invoice.customerPhone || invoice.customerName.toLowerCase().trim();
//     if (!invoicesByCustomer[key]) {
//       invoicesByCustomer[key] = [];
//     }
//     invoicesByCustomer[key].push(invoice);
//   });

//   console.log(`\n👥 Found ${Object.keys(invoicesByCustomer).length} unique customers with invoices`);

//   // Step 2: Sort each customer's invoices by date (DESCENDING - newest/last invoice first)
//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     invoicesByCustomer[customerKey].sort((a, b) => {
//       // Sort by date descending (newest first)
//       const dateCompare = new Date(b.invoiceDate) - new Date(a.invoiceDate);
//       if (dateCompare !== 0) return dateCompare;
//       // If same date, sort by invoice number descending
//       return b.invoiceNumber.localeCompare(a.invoiceNumber);
//     });
    
//     console.log(`\n📋 Customer: "${customerKey}"`);
//     console.log(`   Total invoices: ${invoicesByCustomer[customerKey].length}`);
//     console.log('   Invoices sorted (NEWEST → OLDEST):');
//     invoicesByCustomer[customerKey].forEach((inv, idx) => {
//       console.log(`      ${idx + 1}. Invoice #${inv.invoiceNumber} | Date: ${inv.invoiceDate} | Amount: TZS ${inv.amount.toLocaleString()}`);
//     });
//   });

//   // Step 3: Group transactions by customer - FIXED TO PREVENT DUPLICATES
//   const transactionsByCustomer = {};
//   const processedTransactionIds = new Set();
  
//   transactions.forEach(transaction => {
//     if (!transaction.amount) return;
    
//     // Create unique identifier for this transaction
//     const transactionUniqueId = `${transaction.transactionId || transaction.id}_${transaction.receivedTimestamp}_${transaction.amount}`;
    
//     // Skip if we've already processed this exact transaction
//     if (processedTransactionIds.has(transactionUniqueId)) {
//       console.warn(`⚠️ Skipping duplicate transaction: ${transaction.transactionId} for ${transaction.customerName || transaction.contractName}`);
//       return;
//     }
    
//     const keys = [
//       transaction.customerPhone,
//       transaction.contractName?.toLowerCase().trim(),
//       transaction.customerName?.toLowerCase().trim()
//     ].filter(Boolean);
    
//     // Find FIRST matching customer key from invoices
//     const matchedKey = keys.find(key => invoicesByCustomer[key]);
    
//     if (matchedKey) {
//       // Customer has invoices - add transaction only once
//       if (!transactionsByCustomer[matchedKey]) {
//         transactionsByCustomer[matchedKey] = [];
//       }
//       transactionsByCustomer[matchedKey].push(transaction);
//       processedTransactionIds.add(transactionUniqueId);
//     } else {
//       // No matching invoices - still group but prevent duplicates
//       const primaryKey = keys[0]; // Use first available key
//       if (primaryKey) {
//         if (!transactionsByCustomer[primaryKey]) {
//           transactionsByCustomer[primaryKey] = [];
//         }
//         transactionsByCustomer[primaryKey].push(transaction);
//         processedTransactionIds.add(transactionUniqueId);
//       }
//     }
//   });

//   console.log(`\n💰 Found ${Object.keys(transactionsByCustomer).length} unique customers with transactions (in selected time frame)`);
  
//   // VERIFICATION: Check for any remaining duplicates
//   Object.keys(transactionsByCustomer).forEach(customerKey => {
//     const txns = transactionsByCustomer[customerKey];
//     const uniqueTxnIds = new Set(txns.map(t => t.transactionId));
    
//     if (txns.length !== uniqueTxnIds.size) {
//       console.error(`❌ ERROR: Customer "${customerKey}" still has ${txns.length} transactions but only ${uniqueTxnIds.size} unique IDs!`);
//     }
//   });

//   // Step 4: Process payments for each customer
//   const processedInvoices = [];

//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     const customerInvoices = invoicesByCustomer[customerKey];
//     const customerTransactions = transactionsByCustomer[customerKey] || [];
    
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`💵 PROCESSING: "${customerKey}"`);
//     console.log(`${'='.repeat(80)}`);
    
//     // Calculate total money available from this customer's transactions
//     let availableAmount = customerTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    
//     console.log(`   Transactions in selected time frame: ${customerTransactions.length}`);
//     if (customerTransactions.length > 0) {
//       console.log(`   Transaction details:`);
//       customerTransactions.forEach((t, idx) => {
//         console.log(`      ${idx + 1}. ${t.receivedDateTime} | TZS ${t.amount.toLocaleString()} | ID: ${t.transactionId || 'N/A'}`);
//       });
//     }
//     console.log(`   💰 TOTAL AVAILABLE: TZS ${availableAmount.toLocaleString()}`);
//     console.log(`   📋 Invoices to pay: ${customerInvoices.length}`);
//     console.log('');
    
//     // 🔥 NEW: Track the last paid invoice index
//     let lastPaidInvoiceIndex = -1;
    
//     // Pay invoices in order (newest first)
//     customerInvoices.forEach((invoice, idx) => {
//       const invoiceAmount = invoice.amount;
//       let amountPaid = 0;
      
//       // Pay this invoice with available funds
//       if (availableAmount >= invoiceAmount) {
//         // Full payment
//         amountPaid = invoiceAmount;
//         availableAmount -= invoiceAmount;
//         lastPaidInvoiceIndex = idx; // Track this as last paid invoice
//         console.log(`   ✅ Invoice ${idx + 1} (#${invoice.invoiceNumber}): FULLY PAID`);
//         console.log(`      Amount: TZS ${amountPaid.toLocaleString()} / ${invoiceAmount.toLocaleString()}`);
//         console.log(`      Remaining balance: TZS ${availableAmount.toLocaleString()}`);
//       } else if (availableAmount > 0) {
//         // Partial payment
//         amountPaid = availableAmount;
//         availableAmount = 0;
//         lastPaidInvoiceIndex = idx; // Track this as last paid invoice
//         console.log(`   ⚠️  Invoice ${idx + 1} (#${invoice.invoiceNumber}): PARTIALLY PAID`);
//         console.log(`      Amount: TZS ${amountPaid.toLocaleString()} / ${invoiceAmount.toLocaleString()}`);
//         console.log(`      Remaining balance: TZS 0 (DEPLETED)`);
//       } else {
//         // No payment
//         amountPaid = 0;
//         console.log(`   ❌ Invoice ${idx + 1} (#${invoice.invoiceNumber}): UNPAID`);
//         console.log(`      Amount: TZS 0 / ${invoiceAmount.toLocaleString()}`);
//         console.log(`      Remaining balance: TZS 0 (NO FUNDS)`);
//       }
      
//       // Get the first transaction for payment date reference
//       const matchingTransaction = customerTransactions.length > 0 ? customerTransactions[0] : null;
      

//       // 🔥 Format date as MM-DD-YYYY for QuickBooks
// let formattedDate = invoice.invoiceDate; // Default to invoice date
// if (matchingTransaction?.receivedDateTime) {
//   formattedDate = matchingTransaction.receivedDateTime;
// } else if (matchingTransaction?.receivedDate) {
//   formattedDate = matchingTransaction.receivedDate;
// }
// // Convert to MM-DD-YYYY format if not already
// const dateObj = new Date(formattedDate);
// if (!isNaN(dateObj.getTime())) {
//   const month = String(dateObj.getMonth() + 1).padStart(2, '0');
//   const day = String(dateObj.getDate()).padStart(2, '0');
//   const year = dateObj.getFullYear();
//   formattedDate = `${month}-${day}-${year}`;
// }

// processedInvoices.push({
//   paymentDate: formattedDate, // ✅ MM-DD-YYYY format
//   customerName: invoice.customerName, // Will be uppercased during export
//   paymentMethod: 'Cash',
//   depositToAccountName: 'Kijichi Collection AC',
//   invoiceNo: invoice.invoiceNumber,
//   journalNo: '',
//   invoiceAmount: invoiceAmount,
//   amount: amountPaid,
//   referenceNo: '',
//   memo: matchingTransaction?.transactionId || '',
//   countryCode: '',
//   exchangeRate: '',
// });
//     });
    
//     // 🔥 NEW: Add any remaining balance to the LAST PAID invoice
//     if (availableAmount > 0 && lastPaidInvoiceIndex >= 0) {
//       console.log(`\n   💰 OVERPAYMENT DETECTED!`);
//       console.log(`      Remaining funds: TZS ${availableAmount.toLocaleString()}`);
//       console.log(`      Adding to last paid invoice (#${customerInvoices[lastPaidInvoiceIndex].invoiceNumber})`);
      
//       // Find the last paid invoice in processedInvoices and add the remainder
//       const lastPaidInvoiceNo = customerInvoices[lastPaidInvoiceIndex].invoiceNumber;
//       const lastInvoiceRecord = processedInvoices.find(p => p.invoiceNo === lastPaidInvoiceNo);
      
//       if (lastInvoiceRecord) {
//         const originalAmount = lastInvoiceRecord.amount;
//         lastInvoiceRecord.amount += availableAmount;
//         console.log(`      Updated payment: TZS ${originalAmount.toLocaleString()} → TZS ${lastInvoiceRecord.amount.toLocaleString()}`);
//         console.log(`      ✅ Overpayment of TZS ${availableAmount.toLocaleString()} applied!`);
//         availableAmount = 0;
//       }
//     }
//   });

//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`✅ PAYMENT PROCESSING COMPLETED`);
//   console.log(`${'='.repeat(80)}`);
//   console.log(`Total invoices processed: ${processedInvoices.length}`);
//   console.log(`Total paid: TZS ${processedInvoices.reduce((sum, p) => sum + p.amount, 0).toLocaleString()}`);
//   console.log(`Total unpaid: ${processedInvoices.filter(p => p.amount === 0).length} invoices`);
//   console.log(`\n`);
  
//   return processedInvoices;
// }



// Main payment processing logic - FIXED VERSION (NO DUPLICATES)

// function processInvoicePayments(invoices, transactions) {
//   console.log('\n========================================');
//   console.log('=== PAYMENT PROCESSING STARTED ===');
//   console.log('========================================');
//   console.log('📋 Invoices to process:', invoices.length);
//   console.log('💵 Transactions available (WITHIN TIME FRAME):', transactions.length);
  
//   // Step 1: Group invoices by customer (by phone or name)
//   const invoicesByCustomer = {};
  
//   invoices.forEach(invoice => {
//     const key = invoice.customerPhone || invoice.customerName.toLowerCase().trim();
//     if (!invoicesByCustomer[key]) {
//       invoicesByCustomer[key] = [];
//     }
//     invoicesByCustomer[key].push(invoice);
//   });

//   console.log(`\n👥 Found ${Object.keys(invoicesByCustomer).length} unique customers with invoices`);

//   // Step 2: Sort each customer's invoices by date (DESCENDING - newest/last invoice first)
//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     invoicesByCustomer[customerKey].sort((a, b) => {
//       // Sort by date descending (newest first)
//       const dateCompare = new Date(b.invoiceDate) - new Date(a.invoiceDate);
//       if (dateCompare !== 0) return dateCompare;
//       // If same date, sort by invoice number descending
//       return b.invoiceNumber.localeCompare(a.invoiceNumber);
//     });
    
//     console.log(`\n📋 Customer: "${customerKey}"`);
//     console.log(`   Total invoices: ${invoicesByCustomer[customerKey].length}`);
//     console.log('   Invoices sorted (NEWEST → OLDEST):');
//     invoicesByCustomer[customerKey].forEach((inv, idx) => {
//       console.log(`      ${idx + 1}. Invoice #${inv.invoiceNumber} | Date: ${inv.invoiceDate} | Amount: TZS ${inv.amount.toLocaleString()}`);
//     });
//   });

//   // Step 3: Group transactions by customer - FIXED TO PREVENT DUPLICATES
//   const transactionsByCustomer = {};
//   const processedTransactionIds = new Set();
  
//   transactions.forEach(transaction => {
//     if (!transaction.amount) return;
    
//     // Create unique identifier for this transaction
//     const transactionUniqueId = `${transaction.transactionId || transaction.id}_${transaction.receivedTimestamp}_${transaction.amount}`;
    
//     // Skip if we've already processed this exact transaction
//     if (processedTransactionIds.has(transactionUniqueId)) {
//       console.warn(`⚠️ Skipping duplicate transaction: ${transaction.transactionId} for ${transaction.customerName || transaction.contractName}`);
//       return;
//     }
    
//     const keys = [
//       transaction.customerPhone,
//       transaction.contractName?.toLowerCase().trim(),
//       transaction.customerName?.toLowerCase().trim()
//     ].filter(Boolean);
    
//     // Find FIRST matching customer key from invoices
//     const matchedKey = keys.find(key => invoicesByCustomer[key]);
    
//     if (matchedKey) {
//       // Customer has invoices - add transaction only once
//       if (!transactionsByCustomer[matchedKey]) {
//         transactionsByCustomer[matchedKey] = [];
//       }
//       transactionsByCustomer[matchedKey].push(transaction);
//       processedTransactionIds.add(transactionUniqueId);
//     } else {
//       // No matching invoices - still group but prevent duplicates
//       const primaryKey = keys[0]; // Use first available key
//       if (primaryKey) {
//         if (!transactionsByCustomer[primaryKey]) {
//           transactionsByCustomer[primaryKey] = [];
//         }
//         transactionsByCustomer[primaryKey].push(transaction);
//         processedTransactionIds.add(transactionUniqueId);
//       }
//     }
//   });

//   console.log(`\n💰 Found ${Object.keys(transactionsByCustomer).length} unique customers with transactions (in selected time frame)`);
  
//   // VERIFICATION: Check for any remaining duplicates
//   Object.keys(transactionsByCustomer).forEach(customerKey => {
//     const txns = transactionsByCustomer[customerKey];
//     const uniqueTxnIds = new Set(txns.map(t => t.transactionId));
    
//     if (txns.length !== uniqueTxnIds.size) {
//       console.error(`❌ ERROR: Customer "${customerKey}" still has ${txns.length} transactions but only ${uniqueTxnIds.size} unique IDs!`);
//     }
//   });

//   // Step 4: Process payments for each customer
//   const processedInvoices = [];

//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     const customerInvoices = invoicesByCustomer[customerKey];
//     const customerTransactions = transactionsByCustomer[customerKey] || [];
    
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`💵 PROCESSING: "${customerKey}"`);
//     console.log(`${'='.repeat(80)}`);
    
//     // Calculate total money available from this customer's transactions
//     let availableAmount = customerTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    
//     console.log(`   Transactions in selected time frame: ${customerTransactions.length}`);
//     if (customerTransactions.length > 0) {
//       console.log(`   Transaction details:`);
//       customerTransactions.forEach((t, idx) => {
//         console.log(`      ${idx + 1}. ${t.receivedDateTime} | TZS ${t.amount.toLocaleString()} | ID: ${t.transactionId || 'N/A'}`);
//       });
//     }
//     console.log(`   💰 TOTAL AVAILABLE: TZS ${availableAmount.toLocaleString()}`);
//     console.log(`   📋 Invoices to pay: ${customerInvoices.length}`);
//     console.log('');
    
//     // Pay invoices in order (newest first)
//     customerInvoices.forEach((invoice, idx) => {
//       const invoiceAmount = invoice.amount;
//       let amountPaid = 0;
      
//       // Pay this invoice with available funds
//       if (availableAmount >= invoiceAmount) {
//         // Full payment
//         amountPaid = invoiceAmount;
//         availableAmount -= invoiceAmount;
//         console.log(`   ✅ Invoice ${idx + 1} (#${invoice.invoiceNumber}): FULLY PAID`);
//         console.log(`      Amount: TZS ${amountPaid.toLocaleString()} / ${invoiceAmount.toLocaleString()}`);
//         console.log(`      Remaining balance: TZS ${availableAmount.toLocaleString()}`);
//       } else if (availableAmount > 0) {
//         // Partial payment
//         amountPaid = availableAmount;
//         availableAmount = 0;
//         console.log(`   ⚠️  Invoice ${idx + 1} (#${invoice.invoiceNumber}): PARTIALLY PAID`);
//         console.log(`      Amount: TZS ${amountPaid.toLocaleString()} / ${invoiceAmount.toLocaleString()}`);
//         console.log(`      Remaining balance: TZS 0 (DEPLETED)`);
//       } else {
//         // No payment
//         amountPaid = 0;
//         console.log(`   ❌ Invoice ${idx + 1} (#${invoice.invoiceNumber}): UNPAID`);
//         console.log(`      Amount: TZS 0 / ${invoiceAmount.toLocaleString()}`);
//         console.log(`      Remaining balance: TZS 0 (NO FUNDS)`);
//       }
      
//       // Get the first transaction for payment date reference
//       const matchingTransaction = customerTransactions.length > 0 ? customerTransactions[0] : null;
      
//       processedInvoices.push({
//         paymentDate: matchingTransaction?.receivedDateTime || matchingTransaction?.receivedDate || invoice.invoiceDate,
//         customerName: invoice.customerName,
//         paymentMethod: 'Cash',
//         depositToAccountName: 'Kijichi Collection AC',
//         invoiceNo: invoice.invoiceNumber,
//         journalNo: '',
//         invoiceAmount: invoiceAmount,
//         amount: amountPaid,
//         referenceNo: '',
//         memo: matchingTransaction?.transactionId || '',
//         countryCode: '',
//         exchangeRate: '',
//       });
//     });
//   });

//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`✅ PAYMENT PROCESSING COMPLETED`);
//   console.log(`${'='.repeat(80)}`);
//   console.log(`Total invoices processed: ${processedInvoices.length}`);
//   console.log(`Total paid: TZS ${processedInvoices.reduce((sum, p) => sum + p.amount, 0).toLocaleString()}`);
//   console.log(`Total unpaid: ${processedInvoices.filter(p => p.amount === 0).length} invoices`);
//   console.log(`\n`);
  
//   return processedInvoices;
// }


// function processInvoicePayments(invoices, transactions) {
//   console.log('\n========================================');
//   console.log('=== PAYMENT PROCESSING STARTED ===');
//   console.log('========================================');
//   console.log('📋 Invoices to process:', invoices.length);
//   console.log('💵 Transactions available (WITHIN TIME FRAME):', transactions.length);
  
//   // Step 1: Group invoices by customer (by phone or name)
//   const invoicesByCustomer = {};
  
//   invoices.forEach(invoice => {
//     const key = invoice.customerPhone || invoice.customerName.toLowerCase().trim();
//     if (!invoicesByCustomer[key]) {
//       invoicesByCustomer[key] = [];
//     }
//     invoicesByCustomer[key].push(invoice);
//   });

//   console.log(`\n👥 Found ${Object.keys(invoicesByCustomer).length} unique customers with invoices`);

//   // Step 2: Sort each customer's invoices by date (DESCENDING - newest/last invoice first)
//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     invoicesByCustomer[customerKey].sort((a, b) => {
//       // Sort by date descending (newest first)
//       const dateCompare = new Date(b.invoiceDate) - new Date(a.invoiceDate);
//       if (dateCompare !== 0) return dateCompare;
//       // If same date, sort by invoice number descending
//       return b.invoiceNumber.localeCompare(a.invoiceNumber);
//     });
    
//     console.log(`\n📋 Customer: "${customerKey}"`);
//     console.log(`   Total invoices: ${invoicesByCustomer[customerKey].length}`);
//     console.log('   Invoices sorted (NEWEST → OLDEST):');
//     invoicesByCustomer[customerKey].forEach((inv, idx) => {
//       console.log(`      ${idx + 1}. Invoice #${inv.invoiceNumber} | Date: ${inv.invoiceDate} | Amount: TZS ${inv.amount.toLocaleString()}`);
//     });
//   });

//   // Step 3: Group transactions by customer
//   const transactionsByCustomer = {};
  
//   transactions.forEach(transaction => {
//     if (!transaction.amount) return;
    
//     const keys = [
//       transaction.customerPhone,
//       transaction.contractName?.toLowerCase().trim(),
//       transaction.customerName?.toLowerCase().trim()
//     ].filter(Boolean);
    
//     keys.forEach(key => {
//       if (!transactionsByCustomer[key]) {
//         transactionsByCustomer[key] = [];
//       }
//       transactionsByCustomer[key].push(transaction);
//     });
//   });

//   console.log(`\n💰 Found ${Object.keys(transactionsByCustomer).length} unique customers with transactions (in selected time frame)`);

//   // Step 4: Process payments for each customer
//   const processedInvoices = [];

//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     const customerInvoices = invoicesByCustomer[customerKey];
//     const customerTransactions = transactionsByCustomer[customerKey] || [];
    
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`💵 PROCESSING: "${customerKey}"`);
//     console.log(`${'='.repeat(80)}`);
    
//     // Calculate total money available from this customer's transactions
//     let availableAmount = customerTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    
//     console.log(`   Transactions in selected time frame: ${customerTransactions.length}`);
//     if (customerTransactions.length > 0) {
//       console.log(`   Transaction details:`);
//       customerTransactions.forEach((t, idx) => {
//         console.log(`      ${idx + 1}. ${t.receivedDateTime} | TZS ${t.amount.toLocaleString()} | ID: ${t.transactionId || 'N/A'}`);
//       });
//     }
//     console.log(`   💰 TOTAL AVAILABLE: TZS ${availableAmount.toLocaleString()}`);
//     console.log(`   📋 Invoices to pay: ${customerInvoices.length}`);
//     console.log('');
    
//     // Pay invoices in order (newest first)
//     customerInvoices.forEach((invoice, idx) => {
//       const invoiceAmount = invoice.amount;
//       let amountPaid = 0;
      
//       // Pay this invoice with available funds
//       if (availableAmount >= invoiceAmount) {
//         // Full payment
//         amountPaid = invoiceAmount;
//         availableAmount -= invoiceAmount;
//         console.log(`   ✅ Invoice ${idx + 1} (#${invoice.invoiceNumber}): FULLY PAID`);
//         console.log(`      Amount: TZS ${amountPaid.toLocaleString()} / ${invoiceAmount.toLocaleString()}`);
//         console.log(`      Remaining balance: TZS ${availableAmount.toLocaleString()}`);
//       } else if (availableAmount > 0) {
//         // Partial payment
//         amountPaid = availableAmount;
//         availableAmount = 0;
//         console.log(`   ⚠️  Invoice ${idx + 1} (#${invoice.invoiceNumber}): PARTIALLY PAID`);
//         console.log(`      Amount: TZS ${amountPaid.toLocaleString()} / ${invoiceAmount.toLocaleString()}`);
//         console.log(`      Remaining balance: TZS 0 (DEPLETED)`);
//       } else {
//         // No payment
//         amountPaid = 0;
//         console.log(`   ❌ Invoice ${idx + 1} (#${invoice.invoiceNumber}): UNPAID`);
//         console.log(`      Amount: TZS 0 / ${invoiceAmount.toLocaleString()}`);
//         console.log(`      Remaining balance: TZS 0 (NO FUNDS)`);
//       }
      
//       // Get the first transaction for payment date reference
//       const matchingTransaction = customerTransactions.length > 0 ? customerTransactions[0] : null;
      
//       processedInvoices.push({
//         paymentDate: matchingTransaction?.receivedDateTime || matchingTransaction?.receivedDate || invoice.invoiceDate,
//         customerName: invoice.customerName,
//         paymentMethod: 'Cash',
//         depositToAccountName: 'Kijichi Collection AC',
//         invoiceNo: invoice.invoiceNumber,
//         journalNo: '',
//         invoiceAmount: invoiceAmount, // Original invoice amount
//         amount: amountPaid, // Exact amount paid (can be 0, partial, or full)
//         referenceNo: '',
//         memo: matchingTransaction?.transactionId || '',
//         countryCode: '',
//         exchangeRate: '',
//       });
//     });
//   });

//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`✅ PAYMENT PROCESSING COMPLETED`);
//   console.log(`${'='.repeat(80)}`);
//   console.log(`Total invoices processed: ${processedInvoices.length}`);
//   console.log(`Total paid: TZS ${processedInvoices.reduce((sum, p) => sum + p.amount, 0).toLocaleString()}`);
//   console.log(`Total unpaid: ${processedInvoices.filter(p => p.amount === 0).length} invoices`);
//   console.log(`\n`);
  
//   return processedInvoices;
// }

// Generate CSV for download
// app.post('/api/export-payments', (req, res) => {
//   try {
//     const { payments } = req.body;
    
//     const csv = Papa.unparse(payments, {
//       columns: [
//         'paymentDate',
//         'customerName',
//         'paymentMethod',
//         'depositToAccountName',
//         'invoiceNo',
//         'journalNo',
//         'invoiceAmount',
//         'amount',
//         'referenceNo',
//         'memo',
//         'countryCode',
//         'exchangeRate',
//       ],
//       header: true,
//     });

//     res.setHeader('Content-Type', 'text/csv');
//     res.setHeader('Content-Disposition', 'attachment; filename=processed_payments.csv');
//     res.send(csv);
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error exporting payments',
//       error: error.message,
//     });
//   }
// });

// Generate CSV for download
// Generate CSV for download - FORMATTED FOR QUICKBOOKS
// app.post('/api/export-payments', (req, res) => {
//   try {
//     const { payments } = req.body;
    
//     // Format data for QuickBooks with proper column names and casing
//     const formattedPayments = payments.map(payment => ({
//       'Payment Date': payment.paymentDate,
//       'Customer': payment.customerName.toUpperCase(), // ✅ UPPERCASE
//       'Payment Method': payment.paymentMethod,
//       'Deposit To Account Name': payment.depositToAccountName,
//       'Invoice No': payment.invoiceNo,
//       'Journal No': payment.journalNo || '',
//       'Amount': payment.amount,
//       'Reference No': payment.referenceNo || '',
//       'Memo': payment.memo || '',
//       'Country Code': payment.countryCode || '',
//       'Exchange Rate': payment.exchangeRate || '',
//     }));
    
//     const csv = Papa.unparse(formattedPayments, {
//       header: true,
//     });

//     res.setHeader('Content-Type', 'text/csv');
//     res.setHeader('Content-Disposition', 'attachment; filename=processed_payments.csv');
//     res.send(csv);
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error exporting payments',
//       error: error.message,
//     });
//   }
// });



// app.post('/api/export-payments', (req, res) => {
//   try {
//     const { payments } = req.body;
    
//     const csv = Papa.unparse(payments, {
//       columns: [
//         'paymentDate',
//         'customerName',
//         'paymentMethod',
//         'depositToAccountName',
//         'invoiceNo',
//         'journalNo',
//         'amount',           // ✅ Only the amount paid, not invoiceAmount
//         'referenceNo',
//         'memo',
//         'countryCode',
//         'exchangeRate',
//       ],
//       header: true,
//     });

//     res.setHeader('Content-Type', 'text/csv');
//     res.setHeader('Content-Disposition', 'attachment; filename=processed_payments.csv');
//     res.send(csv);
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error exporting payments',
//       error: error.message,
//     });
//   }
// });

// Health check endpoint
// app.get('/', (req, res) => {
//   res.json({
//     success: true,
//     message: 'Invoice Payment API is running!',
//     version: '2.1.0',
//     features: ['DateTime filtering', 'EAT timezone support', 'Jan 1, 2026+ date filter', 'MM/DD/YYYY date format support'],
//     minDate: '2026-01-01',
//     dateFormats: ['MM/DD/YYYY', 'DD Mon YYYY, HH:mm am/pm (EAT)'],
//     endpoints: {
//       transactions: '/api/transactions',
//       filter: '/api/transactions/filter',
//       upload: '/api/invoices/upload',
//       process: '/api/process-payments',
//       export: '/api/export-payments'
//     }
//   });
// });

// // 404 handler
// app.use((req, res) => {
//   res.status(404).json({
//     success: false,
//     message: 'Endpoint not found',
//     path: req.path
//   });
// });

// app.listen(port, () => {
//   console.log(`🚀 Server running on port ${port}`);
//   console.log(`📅 Filtering transactions from Jan 1, 2026 onwards`);
//   console.log(`📆 Accepting date formats: MM/DD/YYYY and DD Mon YYYY`);
// });






