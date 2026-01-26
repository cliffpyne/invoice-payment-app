const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Papa = require('papaparse');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;
// please over please just for testing bro 
// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
// app.use(express.json());
// here is my new code to accept more that 65,000 entities 
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
    const { invoices, startDate, endDate, startTime, endTime, channel } = req.body;

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
      
      const startTimestamp = new Date(`${startDate} ${startTimeStr}:00 GMT+0300`).getTime();
      const endTimestamp = new Date(`${endDate} ${endTimeStr}:59 GMT+0300`).getTime();
      
      allTransactions = allTransactions.filter(transaction => {
        if (!transaction.receivedTimestamp) return false;
        return transaction.receivedTimestamp >= startTimestamp && 
               transaction.receivedTimestamp <= endTimestamp;
      });
    }

    // Filter by channel
    if (channel && channel !== 'all') {
      allTransactions = allTransactions.filter(transaction => transaction.channel === channel);
    }

    console.log('Processing with', allTransactions.length, 'transactions');

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

// Helper function to extract phone
function extractPhone(customerName) {
  const phoneMatch = customerName.match(/\d{10,}/);
  return phoneMatch ? phoneMatch[0] : null;
}

// Main payment processing logic
function processInvoicePayments(invoices, transactions) {
  console.log('\n=== Processing Invoice Payments ===');
  console.log('Invoices to process:', invoices.length);
  console.log('Transactions available:', transactions.length);
  
  const invoicesByCustomer = {};
  
  invoices.forEach(invoice => {
    const key = invoice.customerPhone || invoice.customerName.toLowerCase().trim();
    if (!invoicesByCustomer[key]) {
      invoicesByCustomer[key] = [];
    }
    invoicesByCustomer[key].push(invoice);
  });

  Object.keys(invoicesByCustomer).forEach(customerKey => {
    invoicesByCustomer[customerKey].sort((a, b) => {
      // const dateCompare = new Date(a.invoiceDate) - new Date(b.invoiceDate);
      const dateCompare = new Date(b.invoiceDate) - new Date(a.invoiceDate);
      if (dateCompare !== 0) return dateCompare;
      return a.invoiceNumber.localeCompare(b.invoiceNumber);
    });
  });

  const transactionsByCustomer = {};
  
  transactions.forEach(transaction => {
    if (!transaction.amount) return;
    
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
    });
  });

  const processedInvoices = [];

  Object.keys(invoicesByCustomer).forEach(customerKey => {
    const customerInvoices = invoicesByCustomer[customerKey];
    const customerTransactions = transactionsByCustomer[customerKey] || [];
    
    let availableAmount = customerTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    
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
      
      const matchingTransaction = customerTransactions.find(t => t.amount > 0);
      
      processedInvoices.push({
        paymentDate: matchingTransaction?.receivedDateTime || matchingTransaction?.receivedDate || invoice.invoiceDate,
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

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.path
  });
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📅 Filtering transactions from Jan 1, 2026 onwards`);
  console.log(`📆 Accepting date formats: MM/DD/YYYY and DD Mon YYYY`);
});





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
// app.use(express.json());

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
//         const invoices = results.data.map((row, index) => ({
//           id: index + 1,
//           customerName: row['Customer'] || row['Customer Name'] || '',
//           invoiceNumber: row['Invoice No'] || row['Invoice Number'] || '',
//           amount: parseFloat(row['Amount']) || 0,
//           invoiceDate: row['Invoice Date'] || row['Date'] || '',
//           customerPhone: extractPhone(row['Customer'] || ''),
//         }));

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
      
//       const startTimestamp = new Date(`${startDate} ${startTimeStr}:00 GMT+0300`).getTime();
//       const endTimestamp = new Date(`${endDate} ${endTimeStr}:59 GMT+0300`).getTime();
      
//       allTransactions = allTransactions.filter(transaction => {
//         if (!transaction.receivedTimestamp) return false;
//         return transaction.receivedTimestamp >= startTimestamp && 
//                transaction.receivedTimestamp <= endTimestamp;
//       });
//     }

//     // Filter by channel
//     if (channel && channel !== 'all') {
//       allTransactions = allTransactions.filter(transaction => transaction.channel === channel);
//     }

//     console.log('Processing with', allTransactions.length, 'transactions');

//     const processedInvoices = processInvoicePayments(invoices, allTransactions);

//     res.json({
//       success: true,
//       data: processedInvoices,
//     });
//   } catch (error) {
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
//   console.log('\n=== Processing Invoice Payments ===');
//   console.log('Invoices to process:', invoices.length);
//   console.log('Transactions available:', transactions.length);
  
//   const invoicesByCustomer = {};
  
//   invoices.forEach(invoice => {
//     const key = invoice.customerPhone || invoice.customerName.toLowerCase().trim();
//     if (!invoicesByCustomer[key]) {
//       invoicesByCustomer[key] = [];
//     }
//     invoicesByCustomer[key].push(invoice);
//   });

//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     invoicesByCustomer[customerKey].sort((a, b) => {
//       // const dateCompare = new Date(a.invoiceDate) - new Date(b.invoiceDate);
//       const dateCompare = new Date(b.invoiceDate) - new Date(a.invoiceDate);
//       if (dateCompare !== 0) return dateCompare;
//       return a.invoiceNumber.localeCompare(b.invoiceNumber);
//     });
//   });

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

//   const processedInvoices = [];

//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     const customerInvoices = invoicesByCustomer[customerKey];
//     const customerTransactions = transactionsByCustomer[customerKey] || [];
    
//     let availableAmount = customerTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    
//     customerInvoices.forEach(invoice => {
//       const invoiceAmount = invoice.amount;
//       let amountPaid = 0;
      
//       if (availableAmount >= invoiceAmount) {
//         amountPaid = invoiceAmount;
//         availableAmount -= invoiceAmount;
//       } else if (availableAmount > 0) {
//         amountPaid = availableAmount;
//         availableAmount = 0;
//       }
      
//       const matchingTransaction = customerTransactions.find(t => t.amount > 0);
      
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

//   return processedInvoices;
// }

// // Generate CSV for download
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
// app.use(express.json());

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

// // Parse EAT DateTime from Google Sheets format: "22 Jan 2026, 05:16 pm (EAT)"
// function parseEATDateTime(rawDate) {
//   if (!rawDate) return { display: null, timestamp: null, dateOnly: null, timeOnly: null };

//   try {
//     // Example: "22 Jan 2026, 05:16 pm (EAT)"
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
//         receivedRaw: row[2], // "22 Jan 2026, 05:16 pm (EAT)"
//         receivedDate: dateTime.dateOnly, // "22 Jan 2026"
//         receivedTime: dateTime.timeOnly, // "17:16" (24-hour format)
//         receivedDateTime: dateTime.display, // "22 Jan 2026, 05:16 pm"
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
//         const invoices = results.data.map((row, index) => ({
//           id: index + 1,
//           customerName: row['Customer'] || row['Customer Name'] || '',
//           invoiceNumber: row['Invoice No'] || row['Invoice Number'] || '',
//           amount: parseFloat(row['Amount']) || 0,
//           invoiceDate: row['Invoice Date'] || row['Date'] || '',
//           customerPhone: extractPhone(row['Customer'] || ''),
//         }));

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
      
//       const startTimestamp = new Date(`${startDate} ${startTimeStr}:00 GMT+0300`).getTime();
//       const endTimestamp = new Date(`${endDate} ${endTimeStr}:59 GMT+0300`).getTime();
      
//       allTransactions = allTransactions.filter(transaction => {
//         if (!transaction.receivedTimestamp) return false;
//         return transaction.receivedTimestamp >= startTimestamp && 
//                transaction.receivedTimestamp <= endTimestamp;
//       });
//     }

//     // Filter by channel
//     if (channel && channel !== 'all') {
//       allTransactions = allTransactions.filter(transaction => transaction.channel === channel);
//     }

//     console.log('Processing with', allTransactions.length, 'transactions');

//     const processedInvoices = processInvoicePayments(invoices, allTransactions);

//     res.json({
//       success: true,
//       data: processedInvoices,
//     });
//   } catch (error) {
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
//   console.log('\n=== Processing Invoice Payments ===');
//   console.log('Invoices to process:', invoices.length);
//   console.log('Transactions available:', transactions.length);
  
//   const invoicesByCustomer = {};
  
//   invoices.forEach(invoice => {
//     const key = invoice.customerPhone || invoice.customerName.toLowerCase().trim();
//     if (!invoicesByCustomer[key]) {
//       invoicesByCustomer[key] = [];
//     }
//     invoicesByCustomer[key].push(invoice);
//   });

//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     invoicesByCustomer[customerKey].sort((a, b) => {
//       // const dateCompare = new Date(a.invoiceDate) - new Date(b.invoiceDate);
//       const dateCompare = new Date(b.invoiceDate) - new Date(a.invoiceDate);
//       if (dateCompare !== 0) return dateCompare;
//       return a.invoiceNumber.localeCompare(b.invoiceNumber);
//     });
//   });

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

//   const processedInvoices = [];

//   Object.keys(invoicesByCustomer).forEach(customerKey => {
//     const customerInvoices = invoicesByCustomer[customerKey];
//     const customerTransactions = transactionsByCustomer[customerKey] || [];
    
//     let availableAmount = customerTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    
//     customerInvoices.forEach(invoice => {
//       const invoiceAmount = invoice.amount;
//       let amountPaid = 0;
      
//       if (availableAmount >= invoiceAmount) {
//         amountPaid = invoiceAmount;
//         availableAmount -= invoiceAmount;
//       } else if (availableAmount > 0) {
//         amountPaid = availableAmount;
//         availableAmount = 0;
//       }
      
//       const matchingTransaction = customerTransactions.find(t => t.amount > 0);
      
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

//   return processedInvoices;
// }

// // Generate CSV for download
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

// // Health check endpoint
// app.get('/', (req, res) => {
//   res.json({
//     success: true,
//     message: 'Invoice Payment API is running!',
//     version: '2.0.1',
//     features: ['DateTime filtering', 'EAT timezone support', 'Jan 1, 2026+ date filter'],
//     minDate: '2026-01-01',
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
// });






// // const express = require('express');
// // const cors = require('cors');
// // const multer = require('multer');
// // const Papa = require('papaparse');
// // const { google } = require('googleapis');
// // require('dotenv').config();

// // const app = express();
// // const port = process.env.PORT || 5000;

// // // Middleware
// // app.use(cors({
// //   origin: '*',
// //   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
// // }));
// // app.use(express.json());

// // // Configure multer for file uploads
// // const upload = multer({ storage: multer.memoryStorage() });

// // // Google Sheets configuration
// // const SPREADSHEET_ID = '1N3ZxahtaFBX0iK3cijDraDmyZM8573PVVf8D-WVqicE';
// // const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com';

// // // Initialize Google Sheets API
// // async function getGoogleSheetsClient() {
// //   const auth = new google.auth.GoogleAuth({
// //     credentials: {
// //       type: 'service_account',
// //       client_email: SERVICE_ACCOUNT_EMAIL,
// //       private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
// //       project_id: 'lmp-sms-sync',
// //     },
// //     scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
// //   });

// //   const client = await auth.getClient();
// //   return google.sheets({ version: 'v4', auth: client });
// // }

// // // Parse EAT DateTime from Google Sheets format: "22 Jan 2026, 05:16 pm (EAT)"
// // function parseEATDateTime(rawDate) {
// //   if (!rawDate) return { display: null, timestamp: null, dateOnly: null, timeOnly: null };

// //   try {
// //     // Example: "22 Jan 2026, 05:16 pm (EAT)"
// //     const parts = rawDate.split(',').map(s => s.trim());
    
// //     if (parts.length < 2) {
// //       // No time, just date
// //       const dateOnly = parts[0]; // "22 Jan 2026"
// //       const parsed = new Date(`${dateOnly} 00:00:00 GMT+0300`);
      
// //       return {
// //         display: dateOnly,
// //         timestamp: parsed.getTime(),
// //         dateOnly: dateOnly,
// //         timeOnly: '00:00'
// //       };
// //     }

// //     const datePart = parts[0]; // "22 Jan 2026"
// //     const timePart = parts[1].replace(/\s*\(EAT\)/, '').trim(); // "05:16 pm"

// //     // Parse to EAT timezone (GMT+3) to avoid date shifts
// //     const dateTimeStr = `${datePart} ${timePart} GMT+0300`;
// //     const parsed = new Date(dateTimeStr);

// //     if (isNaN(parsed)) {
// //       console.warn('Failed to parse date:', rawDate);
// //       return { display: rawDate, timestamp: null, dateOnly: datePart, timeOnly: null };
// //     }

// //     // Extract time in HH:mm format
// //     const hours = String(parsed.getHours()).padStart(2, '0');
// //     const minutes = String(parsed.getMinutes()).padStart(2, '0');
// //     const timeOnly = `${hours}:${minutes}`;

// //     return {
// //       display: `${datePart}, ${timePart}`,
// //       timestamp: parsed.getTime(),
// //       dateOnly: datePart,
// //       timeOnly: timeOnly,
// //       iso: parsed.toISOString()
// //     };

// //   } catch (error) {
// //     console.error('Error parsing date:', rawDate, error);
// //     return { display: rawDate, timestamp: null, dateOnly: null, timeOnly: null };
// //   }
// // }

// // // Fetch transactions from Google Sheets with TIME support
// // async function fetchTransactions(sheetName, channel) {
// //   try {
// //     const sheets = await getGoogleSheetsClient();

// //     const { data } = await sheets.spreadsheets.values.get({
// //       spreadsheetId: SPREADSHEET_ID,
// //       range: `${sheetName}!A2:H`,
// //       majorDimension: 'ROWS',
// //     });

// //     const rows = data.values || [];
// //     const results = [];

// //     for (let i = 0; i < rows.length; i++) {
// //       const row = rows[i];

// //       // Parse DateTime with TIME support
// //       const dateTime = parseEATDateTime(row[2]);

// //       results.push({
// //         id: row[7] || `${channel}-${i + 1}`,
// //         channel,

// //         paymentChannel: row[1] || null,
// //         transactionMessage: row[3] || null,

// //         customerPhone: row[4] || null,
// //         customerName: row[5] || null,
// //         contractName: row[5] || null,

// //         amount: row[6] ? Number(row[6]) : null,

// //         // NEW: Full DateTime info
// //         receivedRaw: row[2], // "22 Jan 2026, 05:16 pm (EAT)"
// //         receivedDate: dateTime.dateOnly, // "22 Jan 2026"
// //         receivedTime: dateTime.timeOnly, // "17:16" (24-hour format)
// //         receivedDateTime: dateTime.display, // "22 Jan 2026, 05:16 pm"
// //         receivedTimestamp: dateTime.timestamp, // Unix timestamp for filtering

// //         transactionId: row[7] || null,
// //       });
// //     }

// //     return results;

// //   } catch (error) {
// //     console.error(`❌ Error fetching from ${sheetName}:`, error);
// //     throw error;
// //   }
// // }

// // // API Routes

// // // Get all transactions
// // app.get('/api/transactions', async (req, res) => {
// //   try {
// //     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
// //     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
// //     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

// //     const allTransactions = [
// //       ...bodaTransactions,
// //       ...iphoneTransactions,
// //       ...lipaTransactions,
// //     ];

// //     res.json({
// //       success: true,
// //       data: allTransactions,
// //       count: allTransactions.length,
// //     });
// //   } catch (error) {
// //     res.status(500).json({
// //       success: false,
// //       message: 'Error fetching transactions',
// //       error: error.message,
// //     });
// //   }
// // });

// // // Filter transactions by DATE + TIME range
// // app.post('/api/transactions/filter', async (req, res) => {
// //   try {
// //     const { startDate, endDate, startTime, endTime, channel } = req.body;

// //     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
// //     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
// //     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

// //     let allTransactions = [
// //       ...bodaTransactions,
// //       ...iphoneTransactions,
// //       ...lipaTransactions,
// //     ];

// //     // Filter by DATE + TIME range
// //     if (startDate && endDate) {
// //       const startTimeStr = startTime || '00:00';
// //       const endTimeStr = endTime || '23:59';
      
// //       // Create timestamps in EAT (GMT+3) to avoid date shifts
// //       const startTimestamp = new Date(`${startDate} ${startTimeStr}:00 GMT+0300`).getTime();
// //       const endTimestamp = new Date(`${endDate} ${endTimeStr}:59 GMT+0300`).getTime();
      
// //       console.log('=== DateTime Filter ===');
// //       console.log('Start:', new Date(startTimestamp).toISOString());
// //       console.log('End:', new Date(endTimestamp).toISOString());
// //       console.log('Total transactions before filter:', allTransactions.length);
      
// //       allTransactions = allTransactions.filter(transaction => {
// //         if (!transaction.receivedTimestamp) return false;
        
// //         const isInRange = transaction.receivedTimestamp >= startTimestamp && 
// //                          transaction.receivedTimestamp <= endTimestamp;
        
// //         if (isInRange) {
// //           console.log('✓ Matched:', {
// //             dateTime: transaction.receivedDateTime,
// //             customer: transaction.customerName || transaction.contractName,
// //             amount: transaction.amount
// //           });
// //         }
        
// //         return isInRange;
// //       });
      
// //       console.log('Total transactions after filter:', allTransactions.length);
// //     }

// //     // Filter by channel
// //     if (channel && channel !== 'all') {
// //       console.log('Filtering by channel:', channel);
// //       allTransactions = allTransactions.filter(transaction => transaction.channel === channel);
// //       console.log('After channel filter:', allTransactions.length);
// //     }

// //     res.json({
// //       success: true,
// //       data: allTransactions,
// //       count: allTransactions.length,
// //     });
// //   } catch (error) {
// //     res.status(500).json({
// //       success: false,
// //       message: 'Error filtering transactions',
// //       error: error.message,
// //     });
// //   }
// // });

// // // Upload and parse invoices CSV
// // app.post('/api/invoices/upload', upload.single('file'), (req, res) => {
// //   try {
// //     if (!req.file) {
// //       return res.status(400).json({
// //         success: false,
// //         message: 'No file uploaded',
// //       });
// //     }

// //     const fileContent = req.file.buffer.toString('utf-8');
    
// //     Papa.parse(fileContent, {
// //       header: true,
// //       skipEmptyLines: true,
// //       complete: (results) => {
// //         const invoices = results.data.map((row, index) => ({
// //           id: index + 1,
// //           customerName: row['Customer'] || row['Customer Name'] || '',
// //           invoiceNumber: row['Invoice No'] || row['Invoice Number'] || '',
// //           amount: parseFloat(row['Amount']) || 0,
// //           invoiceDate: row['Invoice Date'] || row['Date'] || '',
// //           customerPhone: extractPhone(row['Customer'] || ''),
// //         }));

// //         res.json({
// //           success: true,
// //           data: invoices,
// //           count: invoices.length,
// //         });
// //       },
// //       error: (error) => {
// //         res.status(400).json({
// //           success: false,
// //           message: 'Error parsing CSV',
// //           error: error.message,
// //         });
// //       },
// //     });
// //   } catch (error) {
// //     res.status(500).json({
// //       success: false,
// //       message: 'Error processing file',
// //       error: error.message,
// //     });
// //   }
// // });

// // // Process invoice payments
// // app.post('/api/process-payments', async (req, res) => {
// //   try {
// //     const { invoices, startDate, endDate, startTime, endTime, channel } = req.body;

// //     const bodaTransactions = await fetchTransactions('DEV-BODA_LEDGER', 'boda');
// //     const iphoneTransactions = await fetchTransactions('DEV-IPHONE_MIXX', 'iphone');
// //     const lipaTransactions = await fetchTransactions('DEV-LIPA_MIXX', 'lipa');

// //     let allTransactions = [
// //       ...bodaTransactions,
// //       ...iphoneTransactions,
// //       ...lipaTransactions,
// //     ];

// //     // Filter by DATE + TIME range
// //     if (startDate && endDate) {
// //       const startTimeStr = startTime || '00:00';
// //       const endTimeStr = endTime || '23:59';
      
// //       const startTimestamp = new Date(`${startDate} ${startTimeStr}:00 GMT+0300`).getTime();
// //       const endTimestamp = new Date(`${endDate} ${endTimeStr}:59 GMT+0300`).getTime();
      
// //       allTransactions = allTransactions.filter(transaction => {
// //         if (!transaction.receivedTimestamp) return false;
// //         return transaction.receivedTimestamp >= startTimestamp && 
// //                transaction.receivedTimestamp <= endTimestamp;
// //       });
// //     }

// //     // Filter by channel
// //     if (channel && channel !== 'all') {
// //       allTransactions = allTransactions.filter(transaction => transaction.channel === channel);
// //     }

// //     console.log('Processing with', allTransactions.length, 'transactions');

// //     const processedInvoices = processInvoicePayments(invoices, allTransactions);

// //     res.json({
// //       success: true,
// //       data: processedInvoices,
// //     });
// //   } catch (error) {
// //     res.status(500).json({
// //       success: false,
// //       message: 'Error processing payments',
// //       error: error.message,
// //     });
// //   }
// // });

// // // Helper function to extract phone
// // function extractPhone(customerName) {
// //   const phoneMatch = customerName.match(/\d{10,}/);
// //   return phoneMatch ? phoneMatch[0] : null;
// // }

// // // Main payment processing logic
// // function processInvoicePayments(invoices, transactions) {
// //   console.log('\n=== Processing Invoice Payments ===');
// //   console.log('Invoices to process:', invoices.length);
// //   console.log('Transactions available:', transactions.length);
  
// //   const invoicesByCustomer = {};
  
// //   invoices.forEach(invoice => {
// //     const key = invoice.customerPhone || invoice.customerName.toLowerCase().trim();
// //     if (!invoicesByCustomer[key]) {
// //       invoicesByCustomer[key] = [];
// //     }
// //     invoicesByCustomer[key].push(invoice);
// //   });

// //   Object.keys(invoicesByCustomer).forEach(customerKey => {
// //     invoicesByCustomer[customerKey].sort((a, b) => {
// //       const dateCompare = new Date(a.invoiceDate) - new Date(b.invoiceDate);
// //       if (dateCompare !== 0) return dateCompare;
// //       return a.invoiceNumber.localeCompare(b.invoiceNumber);
// //     });
// //   });

// //   const transactionsByCustomer = {};
  
// //   transactions.forEach(transaction => {
// //     if (!transaction.amount) return;
    
// //     const keys = [
// //       transaction.customerPhone,
// //       transaction.contractName?.toLowerCase().trim(),
// //       transaction.customerName?.toLowerCase().trim()
// //     ].filter(Boolean);
    
// //     keys.forEach(key => {
// //       if (!transactionsByCustomer[key]) {
// //         transactionsByCustomer[key] = [];
// //       }
// //       transactionsByCustomer[key].push(transaction);
// //     });
// //   });

// //   const processedInvoices = [];

// //   Object.keys(invoicesByCustomer).forEach(customerKey => {
// //     const customerInvoices = invoicesByCustomer[customerKey];
// //     const customerTransactions = transactionsByCustomer[customerKey] || [];
    
// //     let availableAmount = customerTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    
// //     customerInvoices.forEach(invoice => {
// //       const invoiceAmount = invoice.amount;
// //       let amountPaid = 0;
      
// //       if (availableAmount >= invoiceAmount) {
// //         amountPaid = invoiceAmount;
// //         availableAmount -= invoiceAmount;
// //       } else if (availableAmount > 0) {
// //         amountPaid = availableAmount;
// //         availableAmount = 0;
// //       }
      
// //       const matchingTransaction = customerTransactions.find(t => t.amount > 0);
      
// //       processedInvoices.push({
// //         paymentDate: matchingTransaction?.receivedDateTime || matchingTransaction?.receivedDate || invoice.invoiceDate,
// //         customerName: invoice.customerName,
// //         paymentMethod: 'Cash',
// //         depositToAccountName: 'Kijichi Collection AC',
// //         invoiceNo: invoice.invoiceNumber,
// //         journalNo: '',
// //         invoiceAmount: invoiceAmount,
// //         amount: amountPaid,
// //         referenceNo: '',
// //         memo: matchingTransaction?.transactionId || '',
// //         countryCode: '',
// //         exchangeRate: '',
// //       });
// //     });
// //   });

// //   return processedInvoices;
// // }

// // // Generate CSV for download
// // app.post('/api/export-payments', (req, res) => {
// //   try {
// //     const { payments } = req.body;
    
// //     const csv = Papa.unparse(payments, {
// //       columns: [
// //         'paymentDate',
// //         'customerName',
// //         'paymentMethod',
// //         'depositToAccountName',
// //         'invoiceNo',
// //         'journalNo',
// //         'invoiceAmount',
// //         'amount',
// //         'referenceNo',
// //         'memo',
// //         'countryCode',
// //         'exchangeRate',
// //       ],
// //       header: true,
// //     });

// //     res.setHeader('Content-Type', 'text/csv');
// //     res.setHeader('Content-Disposition', 'attachment; filename=processed_payments.csv');
// //     res.send(csv);
// //   } catch (error) {
// //     res.status(500).json({
// //       success: false,
// //       message: 'Error exporting payments',
// //       error: error.message,
// //     });
// //   }
// // });

// // // Health check endpoint
// // app.get('/', (req, res) => {
// //   res.json({
// //     success: true,
// //     message: 'Invoice Payment API is running!',
// //     version: '2.0.0',
// //     features: ['DateTime filtering', 'EAT timezone support'],
// //     endpoints: {
// //       transactions: '/api/transactions',
// //       filter: '/api/transactions/filter',
// //       upload: '/api/invoices/upload',
// //       process: '/api/process-payments',
// //       export: '/api/export-payments'
// //     }
// //   });
// // });

// // // 404 handler
// // app.use((req, res) => {
// //   res.status(404).json({
// //     success: false,
// //     message: 'Endpoint not found',
// //     path: req.path
// //   });
// // });

// // app.listen(port, () => {
// //   console.log(`Server running on port ${port}`);
// // });