// cash.js — cash transactions, summaries and daily closures.
// Split mechanically from database.js; function bodies are unchanged.

const { auditLog, getCurrentUser, requireDatabase, requirePermission } = require('./core');
const { normalizeInvoiceDate } = require('./invoices');
const { getProfitLossReport } = require('./reports');

function createCashTransaction(payload = {}) {
  const db = requireDatabase();
  requirePermission('cash');
  const type = ['income', 'expense'].includes(String(payload.type)) ? String(payload.type) : '';
  const method = ['cash', 'card', 'bank', 'other'].includes(String(payload.method)) ? String(payload.method) : 'cash';
  const amount = Math.round(Number(payload.amount || 0));
  if (!type) throw new Error('نوع تراکنش صندوق معتبر نیست.');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('مبلغ تراکنش باید بیشتر از صفر باشد.');
  const date = normalizeInvoiceDate(payload.date);
  const result = db.prepare(`
    INSERT INTO cash_transactions (type, category, amount, method, date, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(type, String(payload.category || 'general').trim() || 'general', amount, method, date, String(payload.description || '').trim());
  const transaction = getCashTransaction(Number(result.lastInsertRowid));
  auditLog('cash.create', 'cash_transaction', transaction.id, { type, amount, category: transaction.category });
  return transaction;
}

function getCashTransaction(id) {
  const db = requireDatabase();
  const row = db.prepare('SELECT id, type, category, amount, method, date, description, reference_type AS referenceType, reference_id AS referenceId, created_at AS createdAt FROM cash_transactions WHERE id = ?').get(Number(id));
  if (!row) throw new Error('تراکنش صندوق پیدا نشد.');
  return row;
}

function listCashTransactions(payload = {}) {
  const db = requireDatabase();
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  const type = ['income', 'expense'].includes(String(payload.type)) ? String(payload.type) : '';
  return db.prepare(`
    SELECT id, type, category, amount, method, date, description,
      reference_type AS referenceType, reference_id AS referenceId, created_at AS createdAt
    FROM cash_transactions
    WHERE (? = '' OR date >= ?) AND (? = '' OR date <= ?) AND (? = '' OR type = ?)
    ORDER BY date DESC, id DESC LIMIT 500
  `).all(from, from, to, to, type, type);
}

function getCashSummary(payload = {}) {
  const db = requireDatabase();
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  const manual = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
    FROM cash_transactions WHERE (? = '' OR date >= ?) AND (? = '' OR date <= ?)
  `).get(from, from, to, to);
  const payments = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN ip.method IN ('cash','card','bank') AND s.status = 'active' THEN ip.amount ELSE 0 END), 0) AS salesIncome,
      COALESCE(SUM(CASE WHEN ip.method IN ('cash','card','bank') AND p.status = 'completed' THEN ip.amount ELSE 0 END), 0) AS purchaseExpense
    FROM invoice_payments ip
    LEFT JOIN sales s ON s.id = ip.sale_id
    LEFT JOIN purchases p ON p.id = ip.purchase_id
    WHERE (? = '' OR COALESCE(s.date, p.date, substr(ip.paid_at, 1, 10)) >= ?)
      AND (? = '' OR COALESCE(s.date, p.date, substr(ip.paid_at, 1, 10)) <= ?)
  `).get(from, from, to, to);
  const income = Number(manual.income || 0) + Number(payments.salesIncome || 0);
  const expense = Number(manual.expense || 0) + Number(payments.purchaseExpense || 0);
  return { income, expense, balance: income - expense, manualIncome: Number(manual.income || 0), manualExpense: Number(manual.expense || 0), salesIncome: Number(payments.salesIncome || 0), purchaseExpense: Number(payments.purchaseExpense || 0) };
}

function closeDailyAccount(payload = {}) {
  const db = requireDatabase();
  requirePermission('cash');
  const date = normalizeInvoiceDate(payload.date);
  const existing = db.prepare('SELECT id FROM daily_closures WHERE date = ?').get(date);
  if (existing) throw new Error('این روز قبلاً بسته شده است.');
  const cash = getCashSummary({ from: date, to: date });
  const profit = getProfitLossReport({ from: date, to: date });
  const previous = db.prepare('SELECT closing_balance AS closingBalance FROM daily_closures WHERE date < ? ORDER BY date DESC LIMIT 1').get(date);
  const openingBalance = Number(previous?.closingBalance || 0);
  const closingBalance = openingBalance + Number(cash.income || 0) - Number(cash.expense || 0);
  const result = db.prepare(`
    INSERT INTO daily_closures (date, user_id, opening_balance, cash_income, cash_expense, net_sales, profit_total, closing_balance, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(date, (getCurrentUser() || {}).id || null, openingBalance, cash.income, cash.expense, profit.netSales, profit.netProfit, closingBalance, String(payload.notes || '').trim());
  auditLog('daily.close', 'daily_closure', Number(result.lastInsertRowid), { date, closingBalance });
  return getDailyClosure(Number(result.lastInsertRowid));
}

function getDailyClosure(id) {
  const row = requireDatabase().prepare(`
    SELECT dc.id, dc.date, dc.user_id AS userId, dc.opening_balance AS openingBalance,
      dc.cash_income AS cashIncome, dc.cash_expense AS cashExpense,
      dc.net_sales AS netSales, dc.profit_total AS profitTotal,
      dc.closing_balance AS closingBalance, dc.notes, dc.created_at AS createdAt,
      COALESCE(u.display_name, u.username, 'سیستم') AS userName
    FROM daily_closures dc LEFT JOIN users u ON u.id = dc.user_id WHERE dc.id = ?
  `).get(Number(id));
  if (!row) throw new Error('بستن حساب روزانه پیدا نشد.');
  return row;
}

function listDailyClosures(payload = {}) {
  const db = requireDatabase();
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  return db.prepare(`
    SELECT dc.id, dc.date, dc.user_id AS userId, dc.opening_balance AS openingBalance,
      dc.cash_income AS cashIncome, dc.cash_expense AS cashExpense,
      dc.net_sales AS netSales, dc.profit_total AS profitTotal,
      dc.closing_balance AS closingBalance, dc.notes, dc.created_at AS createdAt,
      COALESCE(u.display_name, u.username, 'سیستم') AS userName
    FROM daily_closures dc LEFT JOIN users u ON u.id = dc.user_id
    WHERE (? = '' OR dc.date >= ?) AND (? = '' OR dc.date <= ?)
    ORDER BY dc.date DESC LIMIT 500
  `).all(from, from, to, to);
}

module.exports = { closeDailyAccount, createCashTransaction, getCashSummary, getCashTransaction, getDailyClosure, listCashTransactions, listDailyClosures };
