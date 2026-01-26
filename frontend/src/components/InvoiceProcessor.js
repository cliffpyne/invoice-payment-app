import React, { useState } from 'react';
import axios from 'axios';
import Papa from 'papaparse';
import API_URL from '../config';

function InvoiceProcessor() {
  const [invoices, setInvoices] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('00:00');
  const [endTime, setEndTime] = useState('23:59');
  const [channel, setChannel] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [processedPayments, setProcessedPayments] = useState([]);
  const [fileName, setFileName] = useState('');
  const [showFormatGuide, setShowFormatGuide] = useState(false);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setFileName(file.name);
    setError(null);
    setSuccess(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const parsedInvoices = results.data.map((row, index) => ({
            id: index + 1,
            customerName: row['Customer'] || row['Customer Name'] || '',
            invoiceNumber: row['Invoice No'] || row['Invoice Number'] || '',
            amount: parseFloat(row['Amount']) || 0,
            invoiceDate: row['Invoice Date'] || row['Date'] || '',
          }));
          setInvoices(parsedInvoices);
          setSuccess(`Successfully loaded ${parsedInvoices.length} invoices`);
        },
        error: (error) => {
          setError('Error parsing CSV file: ' + error.message);
        },
      });
    };
    reader.readAsText(file);
  };

  const processPayments = async () => {
    if (invoices.length === 0) {
      setError('Please upload invoices first');
      return;
    }

    if (!startDate || !endDate) {
      setError('Please select date range for transactions');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await axios.post(`${API_URL}/api/process-payments`, {
        invoices,
        startDate,
        endDate,
        startTime,
        endTime,
        channel,
      });

      setProcessedPayments(response.data.data);
      setSuccess(
        `Successfully processed ${response.data.data.length} invoice payments`
      );
    } catch (err) {
      setError('Failed to process payments: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Quick time presets
  const setTodayMorning = () => {
    const today = new Date().toISOString().split('T')[0];
    setStartDate(today);
    setEndDate(today);
    setStartTime('00:00');
    setEndTime('12:00');
  };

  const setTodayAfternoon = () => {
    const today = new Date().toISOString().split('T')[0];
    setStartDate(today);
    setEndDate(today);
    setStartTime('12:00');
    setEndTime('23:59');
  };

  const setToday = () => {
    const today = new Date().toISOString().split('T')[0];
    setStartDate(today);
    setEndDate(today);
    setStartTime('00:00');
    setEndTime('23:59');
  };

  const downloadCSV = () => {
    if (processedPayments.length === 0) {
      setError('No processed payments to download');
      return;
    }

    const csv = Papa.unparse(processedPayments, {
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

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    a.download = `processed_payments_${timestamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const downloadTemplate = () => {
    const templateData = [
      {
        'Customer': 'JOHN DOE',
        'Invoice No': '123456',
        'Amount': '50000',
        'Invoice Date': '01/15/2026'
      },
      {
        'Customer': 'JANE SMITH',
        'Invoice No': '123457',
        'Amount': '75000',
        'Invoice Date': '01/16/2026'
      },
      {
        'Customer': 'MIKE JOHNSON',
        'Invoice No': '123458',
        'Amount': '30000',
        'Invoice Date': '01/17/2026'
      }
    ];

    const csv = Papa.unparse(templateData, { header: true });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'invoice_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const totalInvoiceAmount = invoices.reduce((sum, inv) => sum + inv.amount, 0);
  const totalPaidAmount = processedPayments.reduce(
    (sum, payment) => sum + payment.amount,
    0
  );
  const paidInvoices = processedPayments.filter((p) => p.amount > 0).length;
  const unpaidInvoices = processedPayments.filter((p) => p.amount === 0).length;

  return (
    <div>
      <div className="card">
        <h2>💰 Invoice Payment Processor</h2>
        <p style={{ color: '#666', marginBottom: '1rem' }}>
          Upload QuickBooks invoices and process payments using transactions from
          the selected date & time range
        </p>

        {/* Time-based Processing Info */}
        <div style={{ 
          background: '#fff3cd', 
          border: '2px solid #ffc107', 
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '1.5rem'
        }}>
          <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: '600', color: '#856404' }}>
            ⚡ <strong>NEW:</strong> Process payments multiple times per day! Use time filters to avoid duplicate processing.
            For example: Process morning payments (00:00-12:00), then afternoon payments (12:00-23:59) separately.
          </p>
        </div>

        {/* Payment Logic Explanation */}
        <div style={{ 
          background: '#f0f7ff', 
          border: '2px solid #667eea', 
          borderRadius: '8px',
          padding: '1.5rem',
          marginBottom: '2rem'
        }}>
          <h3 style={{ color: '#667eea', marginBottom: '1rem' }}>🧮 Payment Logic</h3>
          <ol style={{ marginLeft: '1.5rem', lineHeight: '1.8' }}>
            <li><strong>Groups invoices by customer</strong> (matching by phone or name)</li>
            <li><strong>Sorts invoices</strong> by date (newest first), then by invoice number</li>
            <li><strong>Sums customer transactions</strong> within selected DATE & TIME range</li>
            <li><strong>Allocates payments sequentially:</strong>
              <ul style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
                <li>Pays first invoice or newest invoice first completely if funds available</li>
                <li>Remaining funds go to second or older invoice</li>
                <li>Continues until all invoices are paid or funds run out</li>
              </ul>
            </li>
            <li><strong>Records result:</strong> Full payment, Partial payment, or Unpaid</li>
          </ol>
        </div>

        {/* Format Guide Toggle */}
        <div style={{ marginBottom: '2rem' }}>
          <button 
            className="button-secondary" 
            onClick={() => setShowFormatGuide(!showFormatGuide)}
            style={{ marginRight: '1rem' }}
          >
            {showFormatGuide ? '📋 Hide' : '📋 Show'} Invoice Format Guide
          </button>
          <button className="button-primary" onClick={downloadTemplate}>
            📥 Download Template CSV
          </button>
        </div>

        {/* Format Guide Content */}
        {showFormatGuide && (
          <div style={{
            background: '#fff9e6',
            border: '2px solid #f59e0b',
            borderRadius: '8px',
            padding: '1.5rem',
            marginBottom: '2rem'
          }}>
            <h3 style={{ color: '#f59e0b', marginBottom: '1rem' }}>📄 Required CSV Format</h3>
            <p style={{ marginBottom: '1rem' }}>
              Your invoice CSV file <strong>MUST</strong> have these exact column names:
            </p>
            
            <div style={{ 
              background: 'white', 
              padding: '1rem', 
              borderRadius: '6px',
              border: '1px solid #f59e0b',
              marginBottom: '1rem'
            }}>
              <table style={{ width: '100%', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ background: '#fef3c7' }}>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Column Name</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Alternative Name</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Example</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Required</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '0.5rem' }}><code>Customer</code></td>
                    <td style={{ padding: '0.5rem' }}><code>Customer Name</code></td>
                    <td style={{ padding: '0.5rem' }}>JOHN DOE</td>
                    <td style={{ padding: '0.5rem' }}>✅ Yes</td>
                  </tr>
                  <tr style={{ background: '#f7fafc' }}>
                    <td style={{ padding: '0.5rem' }}><code>Invoice No</code></td>
                    <td style={{ padding: '0.5rem' }}><code>Invoice Number</code></td>
                    <td style={{ padding: '0.5rem' }}>679337</td>
                    <td style={{ padding: '0.5rem' }}>✅ Yes</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '0.5rem' }}><code>Amount</code></td>
                    <td style={{ padding: '0.5rem' }}>-</td>
                    <td style={{ padding: '0.5rem' }}>12000</td>
                    <td style={{ padding: '0.5rem' }}>✅ Yes</td>
                  </tr>
                  <tr style={{ background: '#f7fafc' }}>
                    <td style={{ padding: '0.5rem' }}><code>Invoice Date</code></td>
                    <td style={{ padding: '0.5rem' }}><code>Date</code></td>
                    <td style={{ padding: '0.5rem' }}><strong>01/23/2026</strong> (MM/DD/YYYY)</td>
                    <td style={{ padding: '0.5rem' }}>✅ Yes</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ 
              background: '#fef3c7', 
              padding: '1rem', 
              borderRadius: '6px',
              marginBottom: '1rem',
              border: '2px solid #f59e0b'
            }}>
              <p style={{ margin: 0, fontSize: '0.95rem', fontWeight: '600', color: '#92400e' }}>
                📅 <strong>DATE FORMAT REQUIREMENT:</strong> Dates MUST be in <code>MM/DD/YYYY</code> format only!
              </p>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem', color: '#92400e' }}>
                ✅ Correct: <code>01/23/2026</code>, <code>12/31/2025</code><br/>
                ❌ Wrong: <code>2026-01-23</code>, <code>23/01/2026</code>, <code>Jan 23, 2026</code>
              </p>
            </div>

            <div style={{ 
              background: '#e0f2fe', 
              padding: '1rem', 
              borderRadius: '6px',
              marginBottom: '1rem'
            }}>
              <p style={{ margin: 0, fontSize: '0.9rem' }}>
                <strong>💡 Pro Tip:</strong> When exporting from QuickBooks, make sure to format the 
                "Invoice Date" column as <code>MM/DD/YYYY</code> before saving as CSV. Use the template 
                button above to download a correctly formatted example!
              </p>
            </div>

            <div style={{ 
              background: '#fee2e2', 
              padding: '1rem', 
              borderRadius: '6px'
            }}>
              <p style={{ margin: 0, fontSize: '0.9rem' }}>
                <strong>⚠️ Important:</strong> The system matches customers by phone number or name. 
                Make sure customer names in your CSV match the names in your Google Sheets transactions!
              </p>
            </div>
          </div>
        )}

        {error && <div className="error">{error}</div>}
        {success && <div className="success">{success}</div>}

        <div className="input-group">
          <label>📄 Upload Invoices (CSV)</label>
          <div className="file-upload-area">
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              style={{ cursor: 'pointer', display: 'block' }}
            >
              {fileName ? (
                <div>
                  <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📁</p>
                  <p style={{ fontWeight: '600', color: '#667eea' }}>
                    {fileName}
                  </p>
                  <p style={{ fontSize: '0.875rem', color: '#666' }}>
                    {invoices.length} invoices loaded
                  </p>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📤</p>
                  <p style={{ fontWeight: '600' }}>Click to upload CSV file</p>
                  <p style={{ fontSize: '0.875rem', color: '#666' }}>
                    Or drag and drop your file here
                  </p>
                </div>
              )}
            </label>
          </div>
        </div>

        {invoices.length > 0 && (
          <div className="stats-grid" style={{ marginTop: '1.5rem' }}>
            <div className="stat-card">
              <h3>{invoices.length}</h3>
              <p>Invoices Loaded</p>
            </div>
            <div className="stat-card">
              <h3>TZS {totalInvoiceAmount.toLocaleString()}</h3>
              <p>Total Invoice Amount</p>
            </div>
          </div>
        )}

        {/* Quick Time Presets */}
        <div style={{ 
          background: '#f0f7ff', 
          padding: '1rem', 
          borderRadius: '8px',
          marginTop: '1.5rem',
          marginBottom: '1rem',
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap'
        }}>
          <span style={{ fontWeight: '600', marginRight: '0.5rem' }}>⚡ Quick Time Ranges:</span>
          <button 
            onClick={setToday}
            style={{
              padding: '0.5rem 1rem',
              background: 'white',
              border: '2px solid #667eea',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: '600',
              color: '#667eea'
            }}
          >
            📅 Today (All)
          </button>
          <button 
            onClick={setTodayMorning}
            style={{
              padding: '0.5rem 1rem',
              background: 'white',
              border: '2px solid #f59e0b',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: '600',
              color: '#f59e0b'
            }}
          >
            🌅 Morning
          </button>
          <button 
            onClick={setTodayAfternoon}
            style={{
              padding: '0.5rem 1rem',
              background: 'white',
              border: '2px solid #f59e0b',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: '600',
              color: '#f59e0b'
            }}
          >
            🌆 Afternoon
          </button>
        </div>

        <div className="date-range-picker" style={{ marginTop: '1rem' }}>
          <div className="input-group">
            <label>📅 Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label>🕐 Start Time</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '2px solid #e0e0e0',
                borderRadius: '8px',
                fontSize: '1rem'
              }}
            />
          </div>
          <div className="input-group">
            <label>📅 End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label>🕐 End Time</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '2px solid #e0e0e0',
                borderRadius: '8px',
                fontSize: '1rem'
              }}
            />
          </div>
          <div className="input-group">
            <label>📡 Payment Channel</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '2px solid #e0e0e0',
                borderRadius: '8px',
                fontSize: '1rem',
                backgroundColor: 'white',
                cursor: 'pointer'
              }}
            >
              <option value="all">All Channels</option>
              <option value="boda">BODA (M-PESA + MIXX)</option>
              <option value="lipa">LIPA (MIXX only)</option>
              <option value="iphone">IPHONE (MIXX only)</option>
            </select>
          </div>
        </div>

        <div className="action-buttons">
          <button
            className="button-primary"
            onClick={processPayments}
            disabled={loading || invoices.length === 0}
          >
            {loading ? '⏳ Processing...' : '✅ Process Payments'}
          </button>
          {processedPayments.length > 0 && (
            <button className="button-secondary" onClick={downloadCSV}>
              💾 Download CSV
            </button>
          )}
        </div>
      </div>

      {processedPayments.length > 0 && (
        <div className="card">
          <h3>📊 Payment Results</h3>

          <div className="stats-grid">
            <div className="stat-card">
              <h3>{processedPayments.length}</h3>
              <p>Total Invoices</p>
            </div>
            <div className="stat-card">
              <h3>{paidInvoices}</h3>
              <p>Paid Invoices</p>
            </div>
            <div className="stat-card">
              <h3>{unpaidInvoices}</h3>
              <p>Unpaid Invoices</p>
            </div>
            <div className="stat-card">
              <h3>TZS {totalPaidAmount.toLocaleString()}</h3>
              <p>Total Amount Paid</p>
            </div>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Payment Date</th>
                  <th>Customer</th>
                  <th>Invoice No</th>
                  <th>Invoice Amount</th>
                  <th>Amount Paid</th>
                  <th>Status</th>
                  <th>Memo</th>
                </tr>
              </thead>
              <tbody>
                {processedPayments.map((payment, index) => (
                  <tr key={index}>
                    <td>{payment.paymentDate}</td>
                    <td>{payment.customerName}</td>
                    <td>{payment.invoiceNo}</td>
                    <td>TZS {payment.invoiceAmount.toLocaleString()}</td>
                    <td>TZS {payment.amount.toLocaleString()}</td>
                    <td>
                      {payment.amount === 0 ? (
                        <span
                          className="badge"
                          style={{ background: '#fee', color: '#c33' }}
                        >
                          Unpaid
                        </span>
                      ) : payment.amount >= payment.invoiceAmount ? (
                        <span
                          className="badge"
                          style={{ background: '#efe', color: '#363' }}
                        >
                          Fully Paid
                        </span>
                      ) : (
                        <span
                          className="badge"
                          style={{ background: '#fef3c7', color: '#92400e' }}
                        >
                          Partially Paid
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.875rem' }}>{payment.memo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default InvoiceProcessor;





// import React, { useState } from 'react';
// import axios from 'axios';
// import Papa from 'papaparse';
// import API_URL from '../config';

// function InvoiceProcessor() {
//   const [invoices, setInvoices] = useState([]);
//   const [startDate, setStartDate] = useState('');
//   const [endDate, setEndDate] = useState('');
//   const [startTime, setStartTime] = useState('00:00');
//   const [endTime, setEndTime] = useState('23:59');
//   const [channel, setChannel] = useState('all');
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState(null);
//   const [success, setSuccess] = useState(null);
//   const [processedPayments, setProcessedPayments] = useState([]);
//   const [fileName, setFileName] = useState('');
//   const [showFormatGuide, setShowFormatGuide] = useState(false);

//   const handleFileUpload = (event) => {
//     const file = event.target.files[0];
//     if (!file) return;

//     setFileName(file.name);
//     setError(null);
//     setSuccess(null);

//     const reader = new FileReader();
//     reader.onload = (e) => {
//       const text = e.target.result;
//       Papa.parse(text, {
//         header: true,
//         skipEmptyLines: true,
//         complete: (results) => {
//           const parsedInvoices = results.data.map((row, index) => ({
//             id: index + 1,
//             customerName: row['Customer'] || row['Customer Name'] || '',
//             invoiceNumber: row['Invoice No'] || row['Invoice Number'] || '',
//             amount: parseFloat(row['Amount']) || 0,
//             invoiceDate: row['Invoice Date'] || row['Date'] || '',
//           }));
//           setInvoices(parsedInvoices);
//           setSuccess(`Successfully loaded ${parsedInvoices.length} invoices`);
//         },
//         error: (error) => {
//           setError('Error parsing CSV file: ' + error.message);
//         },
//       });
//     };
//     reader.readAsText(file);
//   };

//   const processPayments = async () => {
//     if (invoices.length === 0) {
//       setError('Please upload invoices first');
//       return;
//     }

//     if (!startDate || !endDate) {
//       setError('Please select date range for transactions');
//       return;
//     }

//     setLoading(true);
//     setError(null);
//     setSuccess(null);

//     try {
//       const response = await axios.post(`${API_URL}/api/process-payments`, {
//         invoices,
//         startDate,
//         endDate,
//         startTime,
//         endTime,
//         channel,
//       });

//       setProcessedPayments(response.data.data);
//       setSuccess(
//         `Successfully processed ${response.data.data.length} invoice payments`
//       );
//     } catch (err) {
//       setError('Failed to process payments: ' + err.message);
//     } finally {
//       setLoading(false);
//     }
//   };

//   // Quick time presets
//   const setTodayMorning = () => {
//     const today = new Date().toISOString().split('T')[0];
//     setStartDate(today);
//     setEndDate(today);
//     setStartTime('00:00');
//     setEndTime('12:00');
//   };

//   const setTodayAfternoon = () => {
//     const today = new Date().toISOString().split('T')[0];
//     setStartDate(today);
//     setEndDate(today);
//     setStartTime('12:00');
//     setEndTime('23:59');
//   };

//   const setToday = () => {
//     const today = new Date().toISOString().split('T')[0];
//     setStartDate(today);
//     setEndDate(today);
//     setStartTime('00:00');
//     setEndTime('23:59');
//   };

//   const downloadCSV = () => {
//     if (processedPayments.length === 0) {
//       setError('No processed payments to download');
//       return;
//     }

//     const csv = Papa.unparse(processedPayments, {
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

//     const blob = new Blob([csv], { type: 'text/csv' });
//     const url = window.URL.createObjectURL(blob);
//     const a = document.createElement('a');
//     a.href = url;
//     const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
//     a.download = `processed_payments_${timestamp}.csv`;
//     document.body.appendChild(a);
//     a.click();
//     document.body.removeChild(a);
//     window.URL.revokeObjectURL(url);
//   };

//   const downloadTemplate = () => {
//     const templateData = [
//       {
//         'Customer': 'JOHN DOE',
//         'Invoice No': '123456',
//         'Amount': '50000',
//         'Invoice Date': '2025-01-15'
//       },
//       {
//         'Customer': 'JANE SMITH',
//         'Invoice No': '123457',
//         'Amount': '75000',
//         'Invoice Date': '2025-01-16'
//       },
//       {
//         'Customer': 'MIKE JOHNSON',
//         'Invoice No': '123458',
//         'Amount': '30000',
//         'Invoice Date': '2025-01-17'
//       }
//     ];

//     const csv = Papa.unparse(templateData, { header: true });
//     const blob = new Blob([csv], { type: 'text/csv' });
//     const url = window.URL.createObjectURL(blob);
//     const a = document.createElement('a');
//     a.href = url;
//     a.download = 'invoice_template.csv';
//     document.body.appendChild(a);
//     a.click();
//     document.body.removeChild(a);
//     window.URL.revokeObjectURL(url);
//   };

//   const totalInvoiceAmount = invoices.reduce((sum, inv) => sum + inv.amount, 0);
//   const totalPaidAmount = processedPayments.reduce(
//     (sum, payment) => sum + payment.amount,
//     0
//   );
//   const paidInvoices = processedPayments.filter((p) => p.amount > 0).length;
//   const unpaidInvoices = processedPayments.filter((p) => p.amount === 0).length;

//   return (
//     <div>
//       <div className="card">
//         <h2>💰 Invoice Payment Processor</h2>
//         <p style={{ color: '#666', marginBottom: '1rem' }}>
//           Upload QuickBooks invoices and process payments using transactions from
//           the selected date & time range
//         </p>

//         {/* Time-based Processing Info */}
//         <div style={{ 
//           background: '#fff3cd', 
//           border: '2px solid #ffc107', 
//           borderRadius: '8px',
//           padding: '1rem',
//           marginBottom: '1.5rem'
//         }}>
//           <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: '600', color: '#856404' }}>
//             ⚡ <strong>NEW:</strong> Process payments multiple times per day! Use time filters to avoid duplicate processing.
//             For example: Process morning payments (00:00-12:00), then afternoon payments (12:00-23:59) separately.
//           </p>
//         </div>

//         {/* Payment Logic Explanation */}
//         <div style={{ 
//           background: '#f0f7ff', 
//           border: '2px solid #667eea', 
//           borderRadius: '8px',
//           padding: '1.5rem',
//           marginBottom: '2rem'
//         }}>
//           <h3 style={{ color: '#667eea', marginBottom: '1rem' }}>🧮 Payment Logic</h3>
//           <ol style={{ marginLeft: '1.5rem', lineHeight: '1.8' }}>
//             <li><strong>Groups invoices by customer</strong> (matching by phone or name)</li>
//             <li><strong>Sorts invoices</strong> by date (newest first), then by invoice number</li>
//             <li><strong>Sums customer transactions</strong> within selected DATE & TIME range</li>
//             <li><strong>Allocates payments sequentially:</strong>
//               <ul style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
//                 <li>Pays first invoice or newest invoice first completely if funds available</li>
//                 <li>Remaining funds go to second or older invoice</li>
//                 <li>Continues until all invoices are paid or funds run out</li>
//               </ul>
//             </li>
//             <li><strong>Records result:</strong> Full payment, Partial payment, or Unpaid</li>
//           </ol>
//         </div>

//         {/* Format Guide Toggle */}
//         <div style={{ marginBottom: '2rem' }}>
//           <button 
//             className="button-secondary" 
//             onClick={() => setShowFormatGuide(!showFormatGuide)}
//             style={{ marginRight: '1rem' }}
//           >
//             {showFormatGuide ? '📋 Hide' : '📋 Show'} Invoice Format Guide
//           </button>
//           <button className="button-primary" onClick={downloadTemplate}>
//             📥 Download Template CSV
//           </button>
//         </div>

//         {/* Format Guide Content */}
//         {showFormatGuide && (
//           <div style={{
//             background: '#fff9e6',
//             border: '2px solid #f59e0b',
//             borderRadius: '8px',
//             padding: '1.5rem',
//             marginBottom: '2rem'
//           }}>
//             <h3 style={{ color: '#f59e0b', marginBottom: '1rem' }}>📄 Required CSV Format</h3>
//             <p style={{ marginBottom: '1rem' }}>
//               Your invoice CSV file <strong>MUST</strong> have these exact column names:
//             </p>
            
//             <div style={{ 
//               background: 'white', 
//               padding: '1rem', 
//               borderRadius: '6px',
//               border: '1px solid #f59e0b',
//               marginBottom: '1rem'
//             }}>
//               <table style={{ width: '100%', fontSize: '0.9rem' }}>
//                 <thead>
//                   <tr style={{ background: '#fef3c7' }}>
//                     <th style={{ padding: '0.5rem', textAlign: 'left' }}>Column Name</th>
//                     <th style={{ padding: '0.5rem', textAlign: 'left' }}>Alternative Name</th>
//                     <th style={{ padding: '0.5rem', textAlign: 'left' }}>Example</th>
//                     <th style={{ padding: '0.5rem', textAlign: 'left' }}>Required</th>
//                   </tr>
//                 </thead>
//                 <tbody>
//                   <tr>
//                     <td style={{ padding: '0.5rem' }}><code>Customer</code></td>
//                     <td style={{ padding: '0.5rem' }}><code>Customer Name</code></td>
//                     <td style={{ padding: '0.5rem' }}>JOHN DOE</td>
//                     <td style={{ padding: '0.5rem' }}>✅ Yes</td>
//                   </tr>
//                   <tr style={{ background: '#f7fafc' }}>
//                     <td style={{ padding: '0.5rem' }}><code>Invoice No</code></td>
//                     <td style={{ padding: '0.5rem' }}><code>Invoice Number</code></td>
//                     <td style={{ padding: '0.5rem' }}>679337</td>
//                     <td style={{ padding: '0.5rem' }}>✅ Yes</td>
//                   </tr>
//                   <tr>
//                     <td style={{ padding: '0.5rem' }}><code>Amount</code></td>
//                     <td style={{ padding: '0.5rem' }}>-</td>
//                     <td style={{ padding: '0.5rem' }}>12000</td>
//                     <td style={{ padding: '0.5rem' }}>✅ Yes</td>
//                   </tr>
//                   <tr style={{ background: '#f7fafc' }}>
//                     <td style={{ padding: '0.5rem' }}><code>Invoice Date</code></td>
//                     <td style={{ padding: '0.5rem' }}><code>Date</code></td>
//                     <td style={{ padding: '0.5rem' }}>2025-01-15</td>
//                     <td style={{ padding: '0.5rem' }}>✅ Yes</td>
//                   </tr>
//                 </tbody>
//               </table>
//             </div>

//             <div style={{ 
//               background: '#e0f2fe', 
//               padding: '1rem', 
//               borderRadius: '6px',
//               marginBottom: '1rem'
//             }}>
//               <p style={{ margin: 0, fontSize: '0.9rem' }}>
//                 <strong>💡 Pro Tip:</strong> Export your invoices from QuickBooks as CSV. 
//                 Make sure the columns match the names above. Use the template button above 
//                 to download a correctly formatted example!
//               </p>
//             </div>

//             <div style={{ 
//               background: '#fee2e2', 
//               padding: '1rem', 
//               borderRadius: '6px'
//             }}>
//               <p style={{ margin: 0, fontSize: '0.9rem' }}>
//                 <strong>⚠️ Important:</strong> The system matches customers by phone number or name. 
//                 Make sure customer names in your CSV match the names in your Google Sheets transactions!
//               </p>
//             </div>
//           </div>
//         )}

//         {error && <div className="error">{error}</div>}
//         {success && <div className="success">{success}</div>}

//         <div className="input-group">
//           <label>📄 Upload Invoices (CSV)</label>
//           <div className="file-upload-area">
//             <input
//               type="file"
//               accept=".csv"
//               onChange={handleFileUpload}
//               style={{ display: 'none' }}
//               id="file-upload"
//             />
//             <label
//               htmlFor="file-upload"
//               style={{ cursor: 'pointer', display: 'block' }}
//             >
//               {fileName ? (
//                 <div>
//                   <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📁</p>
//                   <p style={{ fontWeight: '600', color: '#667eea' }}>
//                     {fileName}
//                   </p>
//                   <p style={{ fontSize: '0.875rem', color: '#666' }}>
//                     {invoices.length} invoices loaded
//                   </p>
//                 </div>
//               ) : (
//                 <div>
//                   <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📤</p>
//                   <p style={{ fontWeight: '600' }}>Click to upload CSV file</p>
//                   <p style={{ fontSize: '0.875rem', color: '#666' }}>
//                     Or drag and drop your file here
//                   </p>
//                 </div>
//               )}
//             </label>
//           </div>
//         </div>

//         {invoices.length > 0 && (
//           <div className="stats-grid" style={{ marginTop: '1.5rem' }}>
//             <div className="stat-card">
//               <h3>{invoices.length}</h3>
//               <p>Invoices Loaded</p>
//             </div>
//             <div className="stat-card">
//               <h3>TZS {totalInvoiceAmount.toLocaleString()}</h3>
//               <p>Total Invoice Amount</p>
//             </div>
//           </div>
//         )}

//         {/* Quick Time Presets */}
//         <div style={{ 
//           background: '#f0f7ff', 
//           padding: '1rem', 
//           borderRadius: '8px',
//           marginTop: '1.5rem',
//           marginBottom: '1rem',
//           display: 'flex',
//           gap: '0.5rem',
//           flexWrap: 'wrap'
//         }}>
//           <span style={{ fontWeight: '600', marginRight: '0.5rem' }}>⚡ Quick Time Ranges:</span>
//           <button 
//             onClick={setToday}
//             style={{
//               padding: '0.5rem 1rem',
//               background: 'white',
//               border: '2px solid #667eea',
//               borderRadius: '6px',
//               cursor: 'pointer',
//               fontSize: '0.9rem',
//               fontWeight: '600',
//               color: '#667eea'
//             }}
//           >
//             📅 Today (All)
//           </button>
//           <button 
//             onClick={setTodayMorning}
//             style={{
//               padding: '0.5rem 1rem',
//               background: 'white',
//               border: '2px solid #f59e0b',
//               borderRadius: '6px',
//               cursor: 'pointer',
//               fontSize: '0.9rem',
//               fontWeight: '600',
//               color: '#f59e0b'
//             }}
//           >
//             🌅 Morning
//           </button>
//           <button 
//             onClick={setTodayAfternoon}
//             style={{
//               padding: '0.5rem 1rem',
//               background: 'white',
//               border: '2px solid #f59e0b',
//               borderRadius: '6px',
//               cursor: 'pointer',
//               fontSize: '0.9rem',
//               fontWeight: '600',
//               color: '#f59e0b'
//             }}
//           >
//             🌆 Afternoon
//           </button>
//         </div>

//         <div className="date-range-picker" style={{ marginTop: '1rem' }}>
//           <div className="input-group">
//             <label>📅 Start Date</label>
//             <input
//               type="date"
//               value={startDate}
//               onChange={(e) => setStartDate(e.target.value)}
//             />
//           </div>
//           <div className="input-group">
//             <label>🕐 Start Time</label>
//             <input
//               type="time"
//               value={startTime}
//               onChange={(e) => setStartTime(e.target.value)}
//               style={{
//                 width: '100%',
//                 padding: '0.75rem',
//                 border: '2px solid #e0e0e0',
//                 borderRadius: '8px',
//                 fontSize: '1rem'
//               }}
//             />
//           </div>
//           <div className="input-group">
//             <label>📅 End Date</label>
//             <input
//               type="date"
//               value={endDate}
//               onChange={(e) => setEndDate(e.target.value)}
//             />
//           </div>
//           <div className="input-group">
//             <label>🕐 End Time</label>
//             <input
//               type="time"
//               value={endTime}
//               onChange={(e) => setEndTime(e.target.value)}
//               style={{
//                 width: '100%',
//                 padding: '0.75rem',
//                 border: '2px solid #e0e0e0',
//                 borderRadius: '8px',
//                 fontSize: '1rem'
//               }}
//             />
//           </div>
//           <div className="input-group">
//             <label>📡 Payment Channel</label>
//             <select
//               value={channel}
//               onChange={(e) => setChannel(e.target.value)}
//               style={{
//                 width: '100%',
//                 padding: '0.75rem',
//                 border: '2px solid #e0e0e0',
//                 borderRadius: '8px',
//                 fontSize: '1rem',
//                 backgroundColor: 'white',
//                 cursor: 'pointer'
//               }}
//             >
//               <option value="all">All Channels</option>
//               <option value="boda">BODA (M-PESA + MIXX)</option>
//               <option value="lipa">LIPA (MIXX only)</option>
//               <option value="iphone">IPHONE (MIXX only)</option>
//             </select>
//           </div>
//         </div>

//         <div className="action-buttons">
//           <button
//             className="button-primary"
//             onClick={processPayments}
//             disabled={loading || invoices.length === 0}
//           >
//             {loading ? '⏳ Processing...' : '✅ Process Payments'}
//           </button>
//           {processedPayments.length > 0 && (
//             <button className="button-secondary" onClick={downloadCSV}>
//               💾 Download CSV
//             </button>
//           )}
//         </div>
//       </div>

//       {processedPayments.length > 0 && (
//         <div className="card">
//           <h3>📊 Payment Results</h3>

//           <div className="stats-grid">
//             <div className="stat-card">
//               <h3>{processedPayments.length}</h3>
//               <p>Total Invoices</p>
//             </div>
//             <div className="stat-card">
//               <h3>{paidInvoices}</h3>
//               <p>Paid Invoices</p>
//             </div>
//             <div className="stat-card">
//               <h3>{unpaidInvoices}</h3>
//               <p>Unpaid Invoices</p>
//             </div>
//             <div className="stat-card">
//               <h3>TZS {totalPaidAmount.toLocaleString()}</h3>
//               <p>Total Amount Paid</p>
//             </div>
//           </div>

//           <div className="table-container">
//             <table>
//               <thead>
//                 <tr>
//                   <th>Payment Date</th>
//                   <th>Customer</th>
//                   <th>Invoice No</th>
//                   <th>Invoice Amount</th>
//                   <th>Amount Paid</th>
//                   <th>Status</th>
//                   <th>Memo</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {processedPayments.map((payment, index) => (
//                   <tr key={index}>
//                     <td>{payment.paymentDate}</td>
//                     <td>{payment.customerName}</td>
//                     <td>{payment.invoiceNo}</td>
//                     <td>TZS {payment.invoiceAmount.toLocaleString()}</td>
//                     <td>TZS {payment.amount.toLocaleString()}</td>
//                     <td>
//                       {payment.amount === 0 ? (
//                         <span
//                           className="badge"
//                           style={{ background: '#fee', color: '#c33' }}
//                         >
//                           Unpaid
//                         </span>
//                       ) : payment.amount >= payment.invoiceAmount ? (
//                         <span
//                           className="badge"
//                           style={{ background: '#efe', color: '#363' }}
//                         >
//                           Fully Paid
//                         </span>
//                       ) : (
//                         <span
//                           className="badge"
//                           style={{ background: '#fef3c7', color: '#92400e' }}
//                         >
//                           Partially Paid
//                         </span>
//                       )}
//                     </td>
//                     <td style={{ fontSize: '0.875rem' }}>{payment.memo}</td>
//                   </tr>
//                 ))}
//               </tbody>
//             </table>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// }

// export default InvoiceProcessor;