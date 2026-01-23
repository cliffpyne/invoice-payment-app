import React, { useState } from 'react';
import './App.css';
import TransactionsView from './components/TransactionsView';
import InvoiceProcessor from './components/InvoiceProcessor';

function App() {
  const [activeTab, setActiveTab] = useState('transactions');

  return (
    <div className="App">
      <header className="app-header">
        <h1>📊 Invoice Payment System</h1>
        <p className="subtitle">Automated payment reconciliation for credit systems</p>
      </header>

      <nav className="tab-navigation">
        <button
          className={`tab-button ${activeTab === 'transactions' ? 'active' : ''}`}
          onClick={() => setActiveTab('transactions')}
        >
          📋 View Transactions
        </button>
        <button
          className={`tab-button ${activeTab === 'processor' ? 'active' : ''}`}
          onClick={() => setActiveTab('processor')}
        >
          💰 Process Invoices
        </button>
      </nav>

      <main className="main-content">
        {activeTab === 'transactions' && <TransactionsView />}
        {activeTab === 'processor' && <InvoiceProcessor />}
      </main>

      <footer className="app-footer">
        <p>Kijichi Collection System © 2025</p>
      </footer>
    </div>
  );
}

export default App;
