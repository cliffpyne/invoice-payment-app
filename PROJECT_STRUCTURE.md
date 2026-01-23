# 📁 Project Structure

```
invoice-payment-app/
│
├── backend/                          # Node.js/Express backend
│   ├── server.js                     # Main server file with all API endpoints
│   ├── package.json                  # Backend dependencies
│   ├── .env.example                  # Environment variables template
│   └── .env                          # Your actual environment variables (create this)
│
├── frontend/                         # React frontend
│   ├── public/
│   │   └── index.html               # HTML template
│   ├── src/
│   │   ├── components/
│   │   │   ├── TransactionsView.js  # View all transactions component
│   │   │   └── InvoiceProcessor.js  # Process invoices component
│   │   ├── App.js                   # Main app component with navigation
│   │   ├── App.css                  # Application styles
│   │   └── index.js                 # React entry point
│   └── package.json                 # Frontend dependencies
│
├── README.md                         # Main documentation
├── QUICK_START.md                   # Quick start guide
├── DEPLOYMENT.md                    # Deployment instructions
├── sample_invoices.csv              # Sample data for testing
├── start.sh                         # Unix/Mac start script
├── start.bat                        # Windows start script
└── .gitignore                       # Git ignore rules
```

## 📄 File Descriptions

### Backend Files

**server.js**
- Main Express server
- Google Sheets API integration
- API endpoints for transactions and invoice processing
- Payment allocation algorithm
- CSV parsing and generation

**package.json**
- Dependencies: express, cors, googleapis, multer, papaparse
- Scripts for starting the server

**.env**
- Contains sensitive configuration (not in git)
- Google service account private key
- Port configuration

### Frontend Files

**App.js**
- Main application component
- Tab navigation between views
- Layout and header

**TransactionsView.js**
- Displays all transactions from Google Sheets
- Date range filtering
- Transaction statistics
- Channel-based categorization

**InvoiceProcessor.js**
- Invoice CSV upload
- Date range selection for transactions
- Payment processing
- Results display with status badges
- CSV export functionality

**App.css**
- Modern, responsive styling
- Gradient backgrounds
- Card-based layouts
- Table styling
- Button styles and badges

## 🔄 Data Flow

1. **Transaction Fetching:**
   ```
   Google Sheets → Backend API → Frontend Display
   ```

2. **Invoice Processing:**
   ```
   Upload CSV → Parse Invoices → Fetch Transactions → 
   Match & Allocate → Display Results → Export CSV
   ```

## 🛠️ Key Technologies

### Backend
- **Express.js**: Web server framework
- **Google APIs**: Sheets integration
- **Multer**: File upload handling
- **PapaParse**: CSV processing
- **CORS**: Cross-origin requests

### Frontend
- **React**: UI framework
- **Axios**: HTTP client
- **PapaParse**: CSV parsing
- **CSS**: Custom styling

## 🔐 Security

- Service account credentials in .env (never committed)
- Read-only access to Google Sheets
- CORS enabled for frontend-backend communication
- No sensitive data in frontend code

## 📦 Dependencies

### Backend Dependencies
```json
{
  "express": "Web server",
  "cors": "Cross-origin support",
  "googleapis": "Google Sheets API",
  "multer": "File uploads",
  "papaparse": "CSV parsing",
  "dotenv": "Environment variables"
}
```

### Frontend Dependencies
```json
{
  "react": "UI framework",
  "axios": "API calls",
  "papaparse": "CSV parsing"
}
```

## 🚀 Development Workflow

1. Start backend server (port 5000)
2. Start frontend dev server (port 3000)
3. Frontend proxies API calls to backend
4. Hot reload for development

## 📊 API Structure

```
GET  /api/transactions           - Get all transactions
POST /api/transactions/filter    - Filter by date
POST /api/invoices/upload        - Upload invoices
POST /api/process-payments       - Process payments
POST /api/export-payments        - Export CSV
```

## 🧮 Payment Algorithm

```javascript
For each customer:
  1. Group their invoices
  2. Sort by date, then invoice number
  3. Sum their transaction amounts
  4. Allocate to invoices in order:
     - Pay first invoice fully if possible
     - Use remaining amount for next invoice
     - Continue until money runs out
  5. Record amount paid for each invoice
```

## 📝 Configuration Points

### Backend Configuration
- **Port**: Default 5000, change in .env
- **Sheet ID**: In server.js (line with SPREADSHEET_ID)
- **Sheet Names**: In fetchTransactions calls
- **Service Account**: Email in server.js

### Frontend Configuration
- **API Proxy**: In package.json
- **Port**: Default 3000 (auto-configured by React)

## 🔍 Debugging

### Backend Logs
```bash
cd backend
npm start
# Watch console for errors
```

### Frontend Logs
- Open browser DevTools (F12)
- Check Console tab for errors
- Check Network tab for API calls

### Common Issues
1. **Connection refused**: Backend not running
2. **403 Forbidden**: Service account lacks access
3. **Parse errors**: CSV format incorrect
4. **No data**: Check sheet names and structure

## 🎯 Customization Points

### Adding New Channels
1. Add new sheet name to fetchTransactions
2. Add new badge style in App.css
3. Update stats calculation

### Changing Output Format
1. Modify processInvoicePayments function
2. Update CSV columns in export

### Adding Features
1. Create new component in frontend/src/components
2. Add route in App.js
3. Create API endpoint in server.js if needed

## 📈 Scaling Considerations

- **Large datasets**: Implement pagination
- **Multiple users**: Add authentication
- **High traffic**: Use caching, load balancing
- **Data growth**: Optimize queries, indexing
