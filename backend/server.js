const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Papa = require('papaparse');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
// app.use(cors());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(express.json());

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Google Sheets configuration
const SPREADSHEET_ID = '1N3ZxahtaFBX0iK3cijDraDmyZM8573PVVf8D-WVqicE';
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com';

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

// // Fetch transactions from Google Sheets
// async function fetchTransactions(sheetName, channel) {
//   try {
//     const sheets = await getGoogleSheetsClient();
//     const response = await sheets.spreadsheets.values.get({
//       spreadsheetId: SPREADSHEET_ID,
//       range: `${sheetName}!A2:H`, // Adjust based on your sheet structure
//     });

//     const rows = response.data.values || [];
    
//     return rows.map((row, index) => {
//       // Parse date better - handle "22 Jan 2026, 06:23 pm (EAT)" format
//       let parsedDate = null;
//       if (row[2]) {
//         // Extract just the date part before the comma
//         const datePart = row[2].split(',')[0].trim(); // "22 Jan 2026"
//         parsedDate = new Date(datePart);
        
//         // If that fails, try the full string
//         if (isNaN(parsedDate)) {
//           parsedDate = new Date(row[2]);
//         }
        
//         // Format as YYYY-MM-DD for consistency
//         if (!isNaN(parsedDate)) {
//           parsedDate = parsedDate.toISOString().split('T')[0];
//         } else {
//           parsedDate = row[2]; // Keep original if parsing fails
//         }
//       }
      
//       return {
//         id: row[0] || `${channel}-${index + 1}`,
//         channel: channel,
//         customerName: row[5] || null, // CONTRACT NAME column
//         customerPhone: row[4] || null, // SENDER CONTACTS column
//         contractName: row[5] || null, // CONTRACT NAME column
//         amount: parseFloat(row[6]) || null, // AMOUNT column
//         receivedDate: parsedDate, // RECEIVED DATE - now properly parsed!
//         transactionId: row[7] || null, // TRANSACTION ID
//         transactionMessage: row[3] || null, // TRANSACTION MESSAGE
//         paymentChannel: row[1] || null, // CHANNEL (M-PESA or MIXX BY YAS)
//       };
//     });
//   } catch (error) {
//     console.error(`Error fetching from ${sheetName}:`, error);
//     throw error;
//   }
// }

// FAST & SAFE Google Sheets fetcher (EAT + invoice-safe)
async function fetchTransactions(sheetName, channel) {
  try {
    const sheets = await getGoogleSheetsClient();

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:H`,
      majorDimension: 'ROWS',
    });

    const rows = data.values || [];
    const results = new Array(rows.length);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // ---- DATE NORMALIZATION ----
      let rawDate = row[2] || null;
      let dateLabel = null;
      let dateKey = null;

      if (rawDate) {
        // 1️⃣ Strip time + timezone fast
        dateLabel = rawDate.split(',')[0].trim();

        // 2️⃣ Normalize formats without UTC shift
        // Supports: "22 Jan 2026", "22/01/2026", "2026-01-22"
        const d = dateLabel.includes('/')
          ? dateLabel.split('/').reverse().join('-')
          : dateLabel;

        const parsed = new Date(`${d} 00:00:00 GMT+0300`);
        if (!isNaN(parsed)) {
          const y = parsed.getFullYear();
          const m = String(parsed.getMonth() + 1).padStart(2, '0');
          const day = String(parsed.getDate()).padStart(2, '0');
          dateKey = `${y}-${m}-${day}`;
        }
      }

      results[i] = {
        id: row[7] || `${channel}-${i + 1}`,
        channel,

        paymentChannel: row[1] || null,
        transactionMessage: row[3] || null,

        customerPhone: row[4] || null,
        customerName: row[5] || null,
        contractName: row[5] || null,

        amount: row[6] ? Number(row[6]) : null,

        receivedRaw: rawDate,
        receivedDate: dateLabel,
        receivedDateKey: dateKey,

        transactionId: row[7] || null,
      };
    }

    return results;

  } catch (error) {
    console.error(`❌ Error fetching from ${sheetName}:`, error);
    throw error;
  }
}


// API Routes

// Get all transactions from all sheets
app.get('/api/transactions', async (req, res) => {
  try {
    const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
    const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
    const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

    const allTransactions = [
      ...bodaTransactions,
      ...iphoneTransactions,
      ...lipaTransactions,
    ];

    res.json({
      success: true,
      data: allTransactions,
      count: allTransactions.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching transactions',
      error: error.message,
    });
  }
});

// Get transactions filtered by date range
app.post('/api/transactions/filter', async (req, res) => {
  try {
    const { startDate, endDate, channel } = req.body;

    const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
    const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
    const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

    let allTransactions = [
      ...bodaTransactions,
      ...iphoneTransactions,
      ...lipaTransactions,
    ];

    // Filter by date range if provided
    // Filter transactions by date range
    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      console.log('=== Payment Processing ===');
      console.log('Date range:', { startDate, endDate, start, end });
      console.log('Total transactions before filter:', allTransactions.length);
      
      allTransactions = allTransactions.filter(transaction => {
        if (!transaction.receivedDate) return false;
        const transDate = new Date(transaction.receivedDate);
        const isInRange = transDate >= start && transDate <= end;
        if (isInRange) {
          console.log('✓ Matched transaction:', {
            date: transaction.receivedDate,
            customer: transaction.customerName || transaction.contractName,
            amount: transaction.amount
          });
        }
        return isInRange;
      });
      
      console.log('Total transactions after filter:', allTransactions.length);
    }

    // Filter by channel if provided
    if (channel && channel !== 'all') {
      console.log('Filtering by channel:', channel);
      allTransactions = allTransactions.filter(transaction => {
        return transaction.channel === channel;
      });
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
        const invoices = results.data.map((row, index) => ({
          id: index + 1,
          customerName: row['Customer'] || row['Customer Name'] || '',
          invoiceNumber: row['Invoice No'] || row['Invoice Number'] || '',
          amount: parseFloat(row['Amount']) || 0,
          invoiceDate: row['Invoice Date'] || row['Date'] || '',
          customerPhone: extractPhone(row['Customer'] || ''),
        }));

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
      const { invoices, startDate, endDate, channel } = req.body;

    // Fetch transactions within date range
    const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
    const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
    const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

    let allTransactions = [
      ...bodaTransactions,
      ...iphoneTransactions,
      ...lipaTransactions,
    ];

    // Filter transactions by date range
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      allTransactions = allTransactions.filter(transaction => {
        if (!transaction.receivedDate) return false;
        const transDate = new Date(transaction.receivedDate);
        return transDate >= start && transDate <= end;
      });
    }

    if (channel && channel !== 'all') {
      console.log('Filtering by channel:', channel);
      allTransactions = allTransactions.filter(transaction => {
        return transaction.channel === channel;
      });
      console.log('After channel filter:', allTransactions.length);
    }

     console.log('Total transactions BEFORE date filter:', allTransactions.length);
    console.log('Sample transactions:', allTransactions.slice(0, 3).map(t => ({
      date: t.receivedDate,
      customer: t.contractName,
      amount: t.amount
    })));


    // Process payments
    const processedInvoices = processInvoicePayments(invoices, allTransactions);

    res.json({
      success: true,
      data: processedInvoices,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error processing payments',
      error: error.message,
    });
  }
});

// Helper function to extract phone from customer name
function extractPhone(customerName) {
  const phoneMatch = customerName.match(/\d{10,}/);
  return phoneMatch ? phoneMatch[0] : null;
}

// Main payment processing logic
// Main payment processing logic
function processInvoicePayments(invoices, transactions) {
  console.log('\n=== Processing Invoice Payments ===');
  console.log('Invoices to process:', invoices.length);
  console.log('Transactions available:', transactions.length);
  
  // Group invoices by customer
  const invoicesByCustomer = {};
  
  invoices.forEach(invoice => {
    const key = invoice.customerPhone || invoice.customerName.toLowerCase().trim();
    if (!invoicesByCustomer[key]) {
      invoicesByCustomer[key] = [];
    }
    invoicesByCustomer[key].push(invoice);
    console.log('Invoice grouped:', { customer: key, invoice: invoice.invoiceNumber });
  });

  console.log('\nCustomers with invoices:', Object.keys(invoicesByCustomer).length);

  // Sort invoices within each customer group by date, then by invoice number
  Object.keys(invoicesByCustomer).forEach(customerKey => {
    invoicesByCustomer[customerKey].sort((a, b) => {
      const dateCompare = new Date(a.invoiceDate) - new Date(b.invoiceDate);
      if (dateCompare !== 0) return dateCompare;
      return a.invoiceNumber.localeCompare(b.invoiceNumber);
    });
  });

  // Group transactions by customer
  const transactionsByCustomer = {};
  
  transactions.forEach(transaction => {
    if (!transaction.amount) return;
    
    // Try multiple matching strategies
    const keys = [
      transaction.customerPhone,
      transaction.contractName?.toLowerCase().trim(),
      transaction.customerName?.toLowerCase().trim()
    ].filter(Boolean);
    
    keys.forEach(key => {
      if (!transactionsByCustomer[key]) {
        transactionsByCustomer[key] = [];
      }
      transactionsByCustomer[key].push(transaction);
      console.log('Transaction grouped:', { customer: key, amount: transaction.amount });
    });
  });

  console.log('\nCustomers with transactions:', Object.keys(transactionsByCustomer).length);

  // Process payments
  const processedInvoices = [];

  Object.keys(invoicesByCustomer).forEach(customerKey => {
    const customerInvoices = invoicesByCustomer[customerKey];
    const customerTransactions = transactionsByCustomer[customerKey] || [];
    
    console.log(`\n--- Processing customer: ${customerKey} ---`);
    console.log(`Invoices: ${customerInvoices.length}, Transactions: ${customerTransactions.length}`);
    
    // Calculate total available payment
    let availableAmount = customerTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    console.log(`Total available: TZS ${availableAmount}`);
    
    customerInvoices.forEach(invoice => {
      const invoiceAmount = invoice.amount;
      let amountPaid = 0;
      
      if (availableAmount >= invoiceAmount) {
        amountPaid = invoiceAmount;
        availableAmount -= invoiceAmount;
      } else if (availableAmount > 0) {
        amountPaid = availableAmount;
        availableAmount = 0;
      }
      
      console.log(`Invoice ${invoice.invoiceNumber}: Amount ${invoiceAmount}, Paid ${amountPaid}`);
      
      // Find matching transaction for payment details
      const matchingTransaction = customerTransactions.find(t => t.amount > 0);
      
      processedInvoices.push({
        paymentDate: matchingTransaction?.receivedDate || invoice.invoiceDate,
        customerName: invoice.customerName,
        paymentMethod: 'Cash',
        depositToAccountName: 'Kijichi Collection AC',
        invoiceNo: invoice.invoiceNumber,
        journalNo: '',
        invoiceAmount: invoiceAmount,
        amount: amountPaid,
        referenceNo: '',
        memo: matchingTransaction?.transactionId || '',
        countryCode: '',
        exchangeRate: '',
      });
    });
  });

  console.log('\n=== Processing Complete ===');
  console.log('Processed invoices:', processedInvoices.length);

  return processedInvoices;
}

// Generate CSV for download
app.post('/api/export-payments', (req, res) => {
  try {
    const { payments } = req.body;
    
    const csv = Papa.unparse(payments, {
      columns: [
        'paymentDate',
        'customerName',
        'paymentMethod',
        'depositToAccountName',
        'invoiceNo',
        'journalNo',
        'invoiceAmount',
        'amount',
        'referenceNo',
        'memo',
        'countryCode',
        'exchangeRate',
      ],
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


// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Invoice Payment API is running!',
    version: '1.0.0',
    endpoints: {
      transactions: '/api/transactions',
      filter: '/api/transactions/filter',
      upload: '/api/invoices/upload',
      process: '/api/process-payments',
      export: '/api/export-payments'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.path
  });
});





app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
