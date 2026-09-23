// reports.js — dashboard, notifications, sales and profit/loss reports.
// Split mechanically from database.js; function bodies are unchanged.

const { requireDatabase } = require('./core');
const { refreshInstallmentStatuses } = require('./payments');

function getDashboardSummary(payload = {}) {
  const db = requireDatabase();
  const requestedToday = String(payload.today || '').trim();
  const today = /^\d{4}-\d{2}-\d{2}$/.test(requestedToday)
    ? requestedToday
    : new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const weekStart = new Date(`${today}T00:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 1) % 7));
  const weekStartIso = weekStart.toISOString().slice(0, 10);
  const todaySales = db.prepare(
    "SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS count FROM sales WHERE status = 'active' AND date = ?"
  ).get(today);
  const monthSales = db.prepare(
    "SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE status = 'active' AND substr(date, 1, 7) = ?"
  ).get(month);
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayIso = yesterday.toISOString().slice(0, 10);
  const yesterdaySales = db.prepare(
    "SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE status = 'active' AND date = ?"
  ).get(yesterdayIso);
  const inventory = db.prepare('SELECT COALESCE(SUM(stock), 0) AS stock, COUNT(*) AS count FROM products WHERE is_active = 1').get();
  const inventoryValue = db.prepare(`
    SELECT COALESCE(SUM(stock * purchase_price), 0) AS purchaseValue,
      COALESCE(SUM(stock * CASE WHEN retail_price > 0 THEN retail_price ELSE sale_price END), 0) AS retailValue
    FROM products WHERE is_active = 1
  `).get();
  const lowStock = db.prepare(
    'SELECT COUNT(*) AS count FROM products WHERE is_active = 1 AND stock <= minimum_stock'
  ).get();
  const salesTrend = db.prepare(`
    SELECT s.date, COALESCE(SUM(s.total), 0) AS sales,
      COALESCE(SUM(s.total - s.tax - s.cost_total), 0) AS profit
    FROM sales s
    WHERE s.status = 'active' AND s.date >= ? AND s.date <= ?
    GROUP BY s.date ORDER BY s.date
  `).all(weekStartIso, today);
  const paymentBreakdown = db.prepare(`
    SELECT ip.method, COALESCE(SUM(ip.amount), 0) AS amount
    FROM invoice_payments ip
    LEFT JOIN sales s ON s.id = ip.sale_id
    LEFT JOIN purchases p ON p.id = ip.purchase_id
    WHERE (s.status = 'active' OR p.status = 'completed')
      AND COALESCE(substr(s.date, 1, 7), substr(p.date, 1, 7)) = ?
    GROUP BY ip.method ORDER BY amount DESC
  `).all(month);
  const topProducts = db.prepare(`
    SELECT p.name, COALESCE(SUM(si.quantity), 0) AS quantity,
      COALESCE(SUM(si.total), 0) AS netSales
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    JOIN products p ON p.id = si.product_id
    WHERE s.status = 'active' AND substr(s.date, 1, 7) = ?
    GROUP BY p.id, p.name ORDER BY quantity DESC, netSales DESC LIMIT 50
  `).all(month);
  const categorySales = db.prepare(`
    SELECT COALESCE(c.name, 'بدون دسته‌بندی') AS categoryName,
      COALESCE(SUM(si.total), 0) AS netSales,
      COALESCE(SUM(si.quantity), 0) AS quantity
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id AND s.status = 'active'
    JOIN products p ON p.id = si.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE substr(s.date, 1, 7) = ?
    GROUP BY c.id, c.name
    ORDER BY netSales DESC LIMIT 8
  `).all(month);
  const recentSales = db.prepare(`
    SELECT s.id, s.invoice_number AS invoiceNumber, s.date, s.source, s.total,
      s.paid_amount AS paidAmount, s.remaining_amount AS remainingAmount,
      COALESCE(s.party_name, '') AS partyName
    FROM sales s WHERE s.status = 'active'
    ORDER BY s.date DESC, s.id DESC LIMIT 50
  `).all();
  const topDebtors = db.prepare(`
    SELECT partyName, SUM(balance) AS balance FROM (
      SELECT COALESCE(NULLIF(TRIM(first_name || ' ' || COALESCE(last_name, '')), ''), code) AS partyName, balance
      FROM parties WHERE is_active = 1 AND balance > 0
      UNION ALL
      SELECT name AS partyName, balance FROM customers WHERE is_active = 1 AND balance > 0
      UNION ALL
      SELECT name AS partyName, balance FROM suppliers WHERE is_active = 1 AND balance > 0
    ) GROUP BY partyName ORDER BY balance DESC LIMIT 50
  `).all();
  const cashMonth = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
    FROM cash_transactions WHERE substr(date, 1, 7) = ?
  `).get(month);
  const monthProfit = db.prepare(`
    SELECT COALESCE(SUM(total - tax - cost_total), 0) AS profit
    FROM sales WHERE status = 'active' AND substr(date, 1, 7) = ?
  `).get(month);
  const receivables = db.prepare(`
    SELECT COALESCE(SUM(remaining_amount), 0) AS amount
    FROM sales WHERE status = 'active' AND remaining_amount > 0
  `).get();
  return {
    todaySales: Number(todaySales.total),
    todayCount: Number(todaySales.count),
    monthSales: Number(monthSales.total),
    yesterdaySales: Number(yesterdaySales.total),
    salesChangePct: Number(yesterdaySales.total) > 0
      ? Number(((Number(todaySales.total) - Number(yesterdaySales.total)) / Number(yesterdaySales.total) * 100).toFixed(1))
      : (Number(todaySales.total) > 0 ? 100 : 0),
    inventory: Number(inventory.stock),
    productCount: Number(inventory.count),
    inventoryValue: { purchase: Number(inventoryValue.purchaseValue), retail: Number(inventoryValue.retailValue) },
    lowStock: Number(lowStock.count),
    salesTrendStart: weekStartIso,
    salesTrendEnd: today,
    salesTrend: salesTrend.map((row) => ({ date: row.date, sales: Number(row.sales), profit: Number(row.profit) })),
    paymentBreakdown: paymentBreakdown.map((row) => ({ method: row.method, amount: Number(row.amount) })),
    topProducts: topProducts.map((row) => ({ name: row.name, quantity: Number(row.quantity), netSales: Number(row.netSales) })),
    categorySales: categorySales.map((row) => ({ categoryName: row.categoryName, quantity: Number(row.quantity), netSales: Number(row.netSales) })),
    recentSales: recentSales.map((row) => ({ ...row, total: Number(row.total), paidAmount: Number(row.paidAmount), remainingAmount: Number(row.remainingAmount) })),
    topDebtors: topDebtors.map((row) => ({ partyName: row.partyName, balance: Number(row.balance) })),
    cashMonth: { income: Number(cashMonth.income), expense: Number(cashMonth.expense) },
    monthProfit: Number(monthProfit.profit),
    receivables: Number(receivables.amount)
  };
}

function listNotifications(payload = {}) {
  const db = requireDatabase();
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.today || ''))
    ? String(payload.today)
    : new Date().toISOString().slice(0, 10);
  const daysAhead = Math.max(0, Math.min(30, Number(payload.daysAhead ?? 7)));
  const horizonDate = new Date(`${today}T00:00:00Z`);
  horizonDate.setUTCDate(horizonDate.getUTCDate() + daysAhead);
  const horizon = horizonDate.toISOString().slice(0, 10);
  const alerts = [];
  const add = (alert) => alerts.push({ id: `${alert.type}-${alert.entityType || 'system'}-${alert.entityId || alert.date || alerts.length}`, ...alert });

  db.prepare(`
    SELECT ip.id, ip.amount, ip.check_number AS checkNumber, ip.due_date AS dueDate,
      COALESCE(s.invoice_number, p.invoice_number) AS invoiceNumber,
      COALESCE(s.party_name, p.party_name, '') AS partyName
    FROM invoice_payments ip
    LEFT JOIN sales s ON s.id = ip.sale_id
    LEFT JOIN purchases p ON p.id = ip.purchase_id
    WHERE ip.method = 'check' AND ip.check_status = 'pending'
      AND ip.due_date IS NOT NULL AND ip.due_date <= ?
    ORDER BY ip.due_date, ip.id LIMIT 100
  `).all(horizon).forEach((row) => {
    const overdue = row.dueDate < today;
    add({
      type: overdue ? 'check-overdue' : 'check-due',
      severity: overdue ? 'danger' : 'warning',
      title: overdue ? 'چک سررسیدگذشته' : 'چک نزدیک سررسید',
      message: `${row.checkNumber || 'بدون شماره'} · ${row.partyName || row.invoiceNumber || 'بدون طرف‌حساب'} · سررسید ${row.dueDate}`,
      entityType: 'check',
      entityId: row.id,
      date: row.dueDate,
      actionPage: 'checks'
    });
  });

  refreshInstallmentStatuses(db, null, today);
  db.prepare(`
    SELECT i.id, i.due_date AS dueDate, i.amount, i.paid_amount AS paidAmount,
      ip.invoice_kind AS invoiceKind, ip.invoice_id AS invoiceId,
      COALESCE(s.invoice_number, p.invoice_number) AS invoiceNumber,
      COALESCE(s.party_name, p.party_name, '') AS partyName
    FROM installments i
    JOIN installment_plans ip ON ip.id = i.plan_id
    LEFT JOIN sales s ON ip.invoice_kind = 'sale' AND s.id = ip.invoice_id
    LEFT JOIN purchases p ON ip.invoice_kind = 'purchase' AND p.id = ip.invoice_id
    WHERE ip.status = 'active' AND i.status IN ('pending', 'partial', 'overdue')
      AND i.due_date <= ?
    ORDER BY i.due_date, i.id LIMIT 100
  `).all(horizon).forEach((row) => {
    const overdue = row.dueDate < today;
    const remaining = Number(row.amount) - Number(row.paidAmount || 0);
    add({
      type: overdue ? 'installment-overdue' : 'installment-due',
      severity: overdue ? 'danger' : 'warning',
      title: overdue ? 'قسط معوق' : 'قسط نزدیک سررسید',
      message: `${row.invoiceNumber || 'بدون شماره'} · ${row.partyName || 'بدون طرف‌حساب'} · مانده ${remaining} · سررسید ${row.dueDate}`,
      entityType: 'installment',
      entityId: row.id,
      date: row.dueDate,
      actionPage: 'installments'
    });
  });

  db.prepare(`
    SELECT id, invoice_number AS invoiceNumber, remaining_amount AS remainingAmount,
      date, party_name AS partyName, 'sale' AS invoiceKind
    FROM sales WHERE status = 'active' AND remaining_amount > 0
    UNION ALL
    SELECT id, invoice_number AS invoiceNumber, remaining_amount AS remainingAmount,
      date, party_name AS partyName, 'purchase' AS invoiceKind
    FROM purchases WHERE status = 'completed' AND remaining_amount > 0
    ORDER BY date DESC, id DESC LIMIT 100
  `).all().forEach((row) => add({
    type: 'unpaid-invoice',
    severity: 'info',
    title: row.invoiceKind === 'sale' ? 'فاکتور فروش تسویه‌نشده' : 'فاکتور خرید تسویه‌نشده',
    message: `${row.invoiceNumber || 'بدون شماره'} · ${row.partyName || 'بدون طرف‌حساب'} · مانده ${row.remainingAmount}`,
    entityType: row.invoiceKind,
    entityId: row.id,
    date: row.date,
    actionPage: row.invoiceKind === 'sale' ? 'sales-invoices' : 'purchase-invoices'
  }));

  db.prepare(`
    SELECT id, name, stock, minimum_stock AS minimumStock
    FROM products
    WHERE is_active = 1 AND stock <= minimum_stock
    ORDER BY stock ASC, name LIMIT 100
  `).all().forEach((row) => add({
    type: 'low-stock',
    severity: Number(row.stock) < 0 ? 'danger' : 'warning',
    title: Number(row.stock) < 0 ? 'موجودی منفی' : 'موجودی کمتر از حداقل',
    message: `${row.name} · موجودی ${row.stock} از حداقل ${row.minimumStock}`,
    entityType: 'product',
    entityId: row.id,
    actionPage: 'inventory'
  }));

  const severityRank = { danger: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => (severityRank[a.severity] - severityRank[b.severity]) || String(a.date || '').localeCompare(String(b.date || '')));
  return {
    alerts,
    counts: {
      total: alerts.length,
      danger: alerts.filter((item) => item.severity === 'danger').length,
      warning: alerts.filter((item) => item.severity === 'warning').length,
      info: alerts.filter((item) => item.severity === 'info').length
    },
    generatedAt: new Date().toISOString()
  };
}

function getSalesReport(payload = {}) {
  const db = requireDatabase();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.from || '')) ? String(payload.from) : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.to || '')) ? String(payload.to) : '';
  const source = ['daily', 'invoice'].includes(String(payload.source || '')) ? String(payload.source) : '';
  const conditions = ["s.status = 'active'"];
  const params = [];
  if (from) { conditions.push('s.date >= ?'); params.push(from); }
  if (to) { conditions.push('s.date <= ?'); params.push(to); }
  if (source) { conditions.push('s.source = ?'); params.push(source); }
  const where = conditions.join(' AND ');
  const summary = db.prepare(`
    SELECT COUNT(*) AS invoiceCount,
      COALESCE(SUM(CASE WHEN s.source = 'daily' THEN 1 ELSE 0 END), 0) AS dailyCount,
      COALESCE(SUM(CASE WHEN s.source = 'invoice' THEN 1 ELSE 0 END), 0) AS formalCount,
      COALESCE(SUM(s.item_count), 0) AS itemCount,
      COALESCE(SUM(s.subtotal), 0) AS subtotal,
      COALESCE(SUM(s.discount), 0) AS discount,
      COALESCE(SUM(s.tax), 0) AS tax,
      COALESCE(SUM(s.total), 0) AS total,
      COALESCE(SUM(CASE WHEN s.total > s.tax THEN s.total - s.tax ELSE 0 END), 0) AS netSales,
      COALESCE(SUM(s.paid_amount), 0) AS paidAmount,
      COALESCE(SUM(s.remaining_amount), 0) AS remainingAmount,
      COALESCE(SUM(s.cost_total), 0) AS costTotal,
      COALESCE(SUM(CASE WHEN s.total > s.tax THEN s.total - s.tax ELSE 0 END - s.cost_total), 0) AS profitTotal
    FROM sales s WHERE ${where}
  `).get(...params);
  const byDate = db.prepare(`
    SELECT s.date,
      COUNT(*) AS invoiceCount,
      COALESCE(SUM(s.item_count), 0) AS itemCount,
      COALESCE(SUM(s.total), 0) AS total,
      COALESCE(SUM(CASE WHEN s.total > s.tax THEN s.total - s.tax ELSE 0 END), 0) AS netSales,
      COALESCE(SUM(s.cost_total), 0) AS costTotal,
      COALESCE(SUM(CASE WHEN s.total > s.tax THEN s.total - s.tax ELSE 0 END - s.cost_total), 0) AS profitTotal,
      COALESCE(SUM(CASE WHEN s.source = 'daily' THEN 1 ELSE 0 END), 0) AS dailyCount,
      COALESCE(SUM(CASE WHEN s.source = 'invoice' THEN 1 ELSE 0 END), 0) AS formalCount
    FROM sales s WHERE ${where}
    GROUP BY s.date ORDER BY s.date
  `).all(...params);
  const bySource = db.prepare(`
    SELECT s.source,
      COUNT(*) AS invoiceCount, COALESCE(SUM(s.total), 0) AS total,
      COALESCE(SUM(CASE WHEN s.total > s.tax THEN s.total - s.tax ELSE 0 END), 0) AS netSales,
      COALESCE(SUM(s.cost_total), 0) AS costTotal,
      COALESCE(SUM(CASE WHEN s.total > s.tax THEN s.total - s.tax ELSE 0 END - s.cost_total), 0) AS profitTotal
    FROM sales s WHERE ${where}
    GROUP BY s.source ORDER BY s.source
  `).all(...params);
  const byProduct = db.prepare(`
    WITH item_totals AS (
      SELECT sale_id, SUM(total) AS itemSubtotal
      FROM sale_items GROUP BY sale_id
    )
    SELECT p.id AS productId, p.name, p.code,
      COALESCE(c.name, '') AS categoryName,
      COALESCE(SUM(si.quantity), 0) AS quantity,
      COALESCE(SUM(si.total), 0) AS netSales,
      COALESCE(SUM(si.purchase_price * si.quantity), 0) AS costTotal,
      COALESCE(SUM(
        si.total - (si.purchase_price * si.quantity) -
        CASE WHEN it.itemSubtotal > 0
          THEN MIN(MAX(s.discount, 0), it.itemSubtotal) * si.total / it.itemSubtotal
          ELSE 0 END
      ), 0) AS profitTotal
    FROM sales s
    JOIN sale_items si ON si.sale_id = s.id
    JOIN products p ON p.id = si.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN item_totals it ON it.sale_id = s.id
    WHERE ${where}
    GROUP BY p.id, p.name, p.code, c.name
    ORDER BY quantity DESC, netSales DESC LIMIT 20
  `).all(...params);
  const byCustomer = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(s.party_name), ''), 'مشتری متفرقه') AS customerName,
      COUNT(*) AS invoiceCount, COALESCE(SUM(s.total), 0) AS total,
      COALESCE(SUM(CASE WHEN s.total > s.tax THEN s.total - s.tax ELSE 0 END - s.cost_total), 0) AS profitTotal
    FROM sales s WHERE ${where}
    GROUP BY customerName ORDER BY total DESC LIMIT 10
  `).all(...params);
  const castRows = (rows) => rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, typeof value === 'number' ? Number(value) : value])
  ));
  return {
    filters: { from, to, source },
    summary: castRows([summary])[0],
    byDate: castRows(byDate),
    bySource: castRows(bySource),
    byProduct: castRows(byProduct),
    byCustomer: castRows(byCustomer)
  };
}

function getProfitLossReport(payload = {}) {
  const db = requireDatabase();
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  const range = (column = 'date') => `(? = '' OR ${column} >= ?) AND (? = '' OR ${column} <= ?)`;
  const sales = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN total > tax THEN total - tax ELSE 0 END), 0) AS netSales,
      COALESCE(SUM(cost_total), 0) AS costTotal, COUNT(*) AS invoiceCount
    FROM sales WHERE status = 'active' AND ${range('date')}
  `).get(from, from, to, to);
  const saleReturns = db.prepare(`
    SELECT COALESCE(SUM(sr.total), 0) AS total,
      COALESCE(SUM(sri.quantity * si.purchase_price), 0) AS costTotal
    FROM sales_returns sr
    JOIN sales_return_items sri ON sri.return_id = sr.id
    LEFT JOIN sale_items si ON si.id = sri.sale_item_id
    WHERE sr.status = 'completed' AND ${range('sr.date')}
  `).get(from, from, to, to);
  const manual = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expenses,
      COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS otherIncome
    FROM cash_transactions
    WHERE reference_type IS NULL AND ${range('date')}
  `).get(from, from, to, to);
  const netSales = Number(sales.netSales || 0) - Number(saleReturns.total || 0);
  const costTotal = Number(sales.costTotal || 0) - Number(saleReturns.costTotal || 0);
  const grossProfit = netSales - costTotal;
  const expenses = Number(manual.expenses || 0);
  const otherIncome = Number(manual.otherIncome || 0);
  const netProfit = grossProfit + otherIncome - expenses;
  const byDate = db.prepare(`
    WITH dates AS (
      SELECT date FROM sales WHERE status = 'active' AND ${range('date')}
      UNION SELECT date FROM cash_transactions WHERE reference_type IS NULL AND ${range('date')}
      UNION SELECT date FROM sales_returns WHERE status = 'completed' AND ${range('date')}
    )
    SELECT dates.date,
      COALESCE((SELECT SUM(CASE WHEN total > tax THEN total-tax ELSE 0 END) FROM sales WHERE status='active' AND sales.date=dates.date), 0)
        - COALESCE((SELECT SUM(total) FROM sales_returns WHERE status='completed' AND sales_returns.date=dates.date), 0) AS netSales,
      COALESCE((SELECT SUM(cost_total) FROM sales WHERE status='active' AND sales.date=dates.date), 0)
        - COALESCE((SELECT SUM(sri.quantity*si.purchase_price) FROM sales_return_items sri JOIN sales_returns sr ON sr.id=sri.return_id LEFT JOIN sale_items si ON si.id=sri.sale_item_id WHERE sr.status='completed' AND sr.date=dates.date), 0) AS costTotal,
      COALESCE((SELECT SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) FROM cash_transactions WHERE reference_type IS NULL AND cash_transactions.date=dates.date), 0) AS expenses,
      COALESCE((SELECT SUM(CASE WHEN type='income' THEN amount ELSE 0 END) FROM cash_transactions WHERE reference_type IS NULL AND cash_transactions.date=dates.date), 0) AS otherIncome
    FROM dates ORDER BY dates.date
  `).all(
    from, from, to, to,
    from, from, to, to,
    from, from, to, to
  );
  return {
    filters: { from, to },
    salesNet: Number(sales.netSales || 0),
    salesReturns: Number(saleReturns.total || 0),
    netSales,
    costTotal,
    returnsCost: Number(saleReturns.costTotal || 0),
    grossProfit,
    expenses,
    otherIncome,
    netProfit,
    invoiceCount: Number(sales.invoiceCount || 0),
    byDate: byDate.map((row) => ({
      ...row,
      netSales: Number(row.netSales || 0),
      costTotal: Number(row.costTotal || 0),
      expenses: Number(row.expenses || 0),
      otherIncome: Number(row.otherIncome || 0),
      grossProfit: Number(row.netSales || 0) - Number(row.costTotal || 0),
      netProfit: Number(row.netSales || 0) - Number(row.costTotal || 0) + Number(row.otherIncome || 0) - Number(row.expenses || 0)
    }))
  };
}

module.exports = { getDashboardSummary, getProfitLossReport, getSalesReport, listNotifications };
