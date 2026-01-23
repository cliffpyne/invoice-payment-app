import React, { useState, useEffect } from 'react';
import axios from 'axios';
import API_URL from '../config';

function TransactionsView() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [expandedMessages, setExpandedMessages] = useState({});
  const [channel, setChannel] = useState('all'); 

  useEffect(() => {
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`${API_URL}/api/transactions`);
      setTransactions(response.data.data);
    } catch (err) {
      setError('Failed to fetch transactions: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const filterByDateRange = async () => {
    if (!startDate || !endDate) {
      alert('Please select both start and end dates');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await axios.post(`${API_URL}/api/transactions/filter`, {
        startDate,
        endDate,
        channel,
      });
      setTransactions(response.data.data);
    } catch (err) {
      setError('Failed to filter transactions: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const clearFilter = () => {
    setStartDate('');
    setEndDate('');
    setChannel('all');
    fetchTransactions();
  };

  // Sorting function
  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  // Get sorted transactions
  const getSortedTransactions = () => {
    if (!sortConfig.key) return transactions;

    return [...transactions].sort((a, b) => {
      let aValue = a[sortConfig.key];
      let bValue = b[sortConfig.key];

      // Handle null values
      if (!aValue) return 1;
      if (!bValue) return -1;

      // Handle different types
      if (sortConfig.key === 'amount') {
        aValue = parseFloat(aValue) || 0;
        bValue = parseFloat(bValue) || 0;
      } else if (sortConfig.key === 'receivedDate') {
        aValue = new Date(aValue);
        bValue = new Date(bValue);
      } else {
        aValue = aValue.toString().toLowerCase();
        bValue = bValue.toString().toLowerCase();
      }

      if (aValue < bValue) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  };

  // Toggle message expansion
  const toggleMessage = (id) => {
    setExpandedMessages(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Truncate message
  const truncateMessage = (message, id) => {
    if (!message) return '-';
    if (message.length <= 50) return message;
    if (expandedMessages[id]) return message;
    return message.substring(0, 50) + '...';
  };

  const sortedTransactions = getSortedTransactions();
  const totalAmount = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
  const channelCounts = {
    boda: transactions.filter(t => t.channel === 'boda').length,
    lipa: transactions.filter(t => t.channel === 'lipa').length,
    iphone: transactions.filter(t => t.channel === 'iphone').length,
  };

  const SortIcon = ({ columnKey }) => {
    if (sortConfig.key !== columnKey) {
      return <span style={{ opacity: 0.3, marginLeft: '5px' }}>⇅</span>;
    }
    return (
      <span style={{ marginLeft: '5px' }}>
        {sortConfig.direction === 'asc' ? '↑' : '↓'}
      </span>
    );
  };

  return (
    <div>
      <div className="card">
        <h2>📊 Transactions Overview</h2>

        <div className="stats-grid">
          <div className="stat-card">
            <h3>{transactions.length}</h3>
            <p>Total Transactions</p>
          </div>
          <div className="stat-card">
            <h3>TZS {totalAmount.toLocaleString()}</h3>
            <p>Total Amount</p>
          </div>
          <div className="stat-card">
            <h3>{channelCounts.boda}</h3>
            <p>Boda Channel</p>
          </div>
          <div className="stat-card">
            <h3>{channelCounts.lipa}</h3>
            <p>Lipa Channel</p>
          </div>
          <div className="stat-card">
            <h3>{channelCounts.iphone}</h3>
            <p>iPhone Channel</p>
          </div>
        </div>

        <div className="date-range-picker">
          <div className="input-group">
            <label>Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label>End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label>Channel</label>
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
              <option value="boda">BODA</option>
              <option value="lipa">LIPA</option>
              <option value="iphone">IPHONE</option>
            </select>
          </div>
          <div>
            <button className="button-primary" onClick={filterByDateRange}>
              🔍 Filter
            </button>
            <button
              className="button-secondary"
              onClick={clearFilter}
              style={{ marginLeft: '1rem' }}
            >
              🔄 Reset
            </button>
          </div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {loading ? (
        <div className="loading">Loading transactions...</div>
      ) : (
        <div className="card">
          <h3>Transaction Details ({transactions.length})</h3>
          <p style={{ color: '#666', marginBottom: '1rem', fontSize: '0.9rem' }}>
            💡 Click on column headers to sort. Click message to expand/collapse.
          </p>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th onClick={() => handleSort('id')} style={{ cursor: 'pointer' }}>
                    ID <SortIcon columnKey="id" />
                  </th>
                  <th onClick={() => handleSort('channel')} style={{ cursor: 'pointer' }}>
                    Channel <SortIcon columnKey="channel" />
                  </th>
                  <th onClick={() => handleSort('customerName')} style={{ cursor: 'pointer' }}>
                    Customer <SortIcon columnKey="customerName" />
                  </th>
                  <th onClick={() => handleSort('customerPhone')} style={{ cursor: 'pointer' }}>
                    Phone <SortIcon columnKey="customerPhone" />
                  </th>
                  <th onClick={() => handleSort('contractName')} style={{ cursor: 'pointer' }}>
                    Contract <SortIcon columnKey="contractName" />
                  </th>
                  <th onClick={() => handleSort('amount')} style={{ cursor: 'pointer' }}>
                    Amount <SortIcon columnKey="amount" />
                  </th>
                  <th onClick={() => handleSort('receivedDate')} style={{ cursor: 'pointer' }}>
                    Date <SortIcon columnKey="receivedDate" />
                  </th>
                  <th>Message</th>
                  <th>Transaction ID</th>
                </tr>
              </thead>
              <tbody>
                {sortedTransactions.length === 0 ? (
                  <tr>
                    <td colSpan="9" style={{ textAlign: 'center' }}>
                      No transactions found
                    </td>
                  </tr>
                ) : (
                  sortedTransactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td>{transaction.id}</td>
                      <td>
                        <span className={`badge badge-${transaction.channel}`}>
                          {transaction.channel.toUpperCase()}
                        </span>
                      </td>
                      <td>{transaction.customerName || '-'}</td>
                      <td>{transaction.customerPhone || '-'}</td>
                      <td>{transaction.contractName || '-'}</td>
                      <td style={{ fontWeight: '600' }}>
                        TZS {(transaction.amount || 0).toLocaleString()}
                      </td>
                      <td>{transaction.receivedDate || '-'}</td>
                      <td
                        onClick={() => toggleMessage(transaction.id)}
                        style={{
                          cursor: transaction.transactionMessage?.length > 50 ? 'pointer' : 'default',
                          fontSize: '0.85rem',
                          maxWidth: '200px',
                          color: expandedMessages[transaction.id] ? '#667eea' : '#666'
                        }}
                      >
                        {truncateMessage(transaction.transactionMessage, transaction.id)}
                        {transaction.transactionMessage?.length > 50 && (
                          <span style={{ 
                            marginLeft: '5px', 
                            color: '#667eea',
                            fontWeight: '600'
                          }}>
                            {expandedMessages[transaction.id] ? '▲' : '▼'}
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: '0.875rem' }}>
                        {transaction.transactionId || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default TransactionsView;
