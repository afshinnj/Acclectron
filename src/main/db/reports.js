// reports.js — dashboard, notifications, sales and profit/loss reports.
// Split mechanically from database.js; function bodies are unchanged.

const { requireDatabase } = require('./core');
const { refreshInstallmentStatuses } = require('./payments');
const { buildSalesForecast } = require('../domain/forecast');
const { gregorianToJalali, jalaliMonthRangeIso, jalaliToGregorianIso, localDateIso } = require('../domain/dates');

function jalaliPeriodKey(isoDate, period) {
  if (period === 'day') return isoDate;
  if (period === 'week') {
    const start = new Date(`${isoDate}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 1) % 7));
    return start.toISOString().slice(0, 10);
  }
  const [year, month] = gregorianToJalali(...isoDate.split('-').map(Number));
  return period === 'year' ? String(year) : `${year}-${String(month).padStart(2, '0')}`;
}

function jalaliForecastPeriods(today, period) {
  const [currentYear, currentMonth] = gregorianToJalali(...today.split('-').map(Number));
  const count = period === 'year' ? 5 : 12;
  const periods = [];
  let start;
  if (period === 'year') {
    const firstYear = currentYear - count + 1;
    start = jalaliToGregorianIso(firstYear, 1, 1);
    for (let year = firstYear; year <= currentYear; year += 1) periods.push(String(year));
  } else {
    const firstMonthIndex = currentYear * 12 + currentMonth - count;
    const firstYear = Math.floor(firstMonthIndex / 12);
    const firstMonth = (firstMonthIndex % 12) + 1;
    start = jalaliToGregorianIso(firstYear, firstMonth, 1);
    for (let offset = 0; offset < count; offset += 1) {
      const monthIndex = firstMonthIndex + offset;
      periods.push(`${Math.floor(monthIndex / 12)}-${String((monthIndex % 12) + 1).padStart(2, '0')}`);
    }
  }
  return { from: start, periods };
}

function getDashboardSummary(payload = {}) {
  const db = requireDatabase();
  const requestedToday = String(payload.today || '').trim();
  const today = /^\d{4}-\d{2}-\d{2}$/.test(requestedToday)
    ? requestedToday
    : localDateIso();
  // "ماه جاری" follows the Jalali calendar the whole UI displays; stored
  // dates are Gregorian ISO, so the month is a [from, to] date range.
  const jalaliMonth = jalaliMonthRangeIso(today);
  const weekStart = new Date(`${today}T00:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 1) % 7));
  const weekStartIso = weekStart.toISOString().slice(0, 10);
  const todayReport = getSalesReport({ from: today, to: today });
  const monthReport = getSalesReport({ from: jalaliMonth.from, to: today });
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayIso = yesterday.toISOString().slice(0, 10);
  const yesterdayReport = getSalesReport({ from: yesterdayIso, to: yesterdayIso });
  const inventory = db.prepare(`SELECT COALESCE(u.symbol, u.name, 'واحد نامشخص') AS unitLabel,
      COALESCE(SUM(p.stock), 0) AS stock, COUNT(*) AS count
    FROM products p LEFT JOIN units u ON u.id = p.unit_id WHERE p.is_active = 1
    GROUP BY p.unit_id, u.symbol, u.name ORDER BY unitLabel`).all();
  const inventoryValue = db.prepare(`
    SELECT COALESCE(SUM(stock * purchase_price), 0) AS purchaseValue,
      COALESCE(SUM(stock * CASE WHEN retail_price > 0 THEN retail_price ELSE sale_price END), 0) AS retailValue
    FROM products WHERE is_active = 1
  `).get();
  const lowStock = db.prepare(
    'SELECT COUNT(*) AS count FROM products WHERE is_active = 1 AND stock <= minimum_stock'
  ).get();
  const weekReport = getSalesReport({ from: weekStartIso, to: today });
  // Receipts are attributed to the month they were collected, not the
  // invoice month; paid_at is UTC, so it is converted to the local date.
  const paymentBreakdown = db.prepare(`
    SELECT ip.method, COALESCE(SUM(ip.amount), 0) AS amount
    FROM invoice_payments ip
    LEFT JOIN sales s ON s.id = ip.sale_id
    LEFT JOIN purchases p ON p.id = ip.purchase_id
    WHERE s.status = 'active'
      AND date(ip.paid_at, 'localtime') BETWEEN ? AND ?
    GROUP BY ip.method ORDER BY amount DESC
  `).all(jalaliMonth.from, today);
  const recentSales = db.prepare(`
    SELECT s.id, s.invoice_number AS invoiceNumber, s.date, s.source, s.total,
      s.paid_amount AS paidAmount, s.remaining_amount AS remainingAmount,
      COALESCE(s.party_name, '') AS partyName
    FROM sales s WHERE s.status = 'active'
    ORDER BY s.created_at DESC, s.id DESC LIMIT 50
  `).all();
  const topDebtors = db.prepare(`
    SELECT partyName, accountType, SUM(balance) AS balance FROM (
      SELECT COALESCE(NULLIF(TRIM(first_name || ' ' || COALESCE(last_name, '')), ''), code) AS partyName, 'اشخاص' AS accountType, balance
      FROM parties WHERE is_active = 1 AND balance > 0
      UNION ALL
      SELECT name AS partyName, 'مشتری' AS accountType, balance FROM customers WHERE is_active = 1 AND balance > 0
      UNION ALL
      SELECT name AS partyName, 'تأمین‌کننده' AS accountType, balance FROM suppliers WHERE is_active = 1 AND balance > 0
    ) GROUP BY partyName, accountType ORDER BY balance DESC LIMIT 50
  `).all();
  const cashMonth = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
    FROM cash_transactions WHERE date >= ? AND date <= ?
  `).get(jalaliMonth.from, today);
  const receivables = db.prepare(`
    SELECT COALESCE(SUM(remaining_amount), 0) AS amount
    FROM sales WHERE status = 'active' AND remaining_amount > 0
  `).get();
  return {
    todaySales: Number(todayReport.summary.netSales),
    todayCount: Number(todayReport.summary.invoiceCount),
    monthSales: Number(monthReport.summary.netSales),
    yesterdaySales: Number(yesterdayReport.summary.netSales),
    salesChangePct: Number(yesterdayReport.summary.netSales) > 0
      ? Number(((Number(todayReport.summary.netSales) - Number(yesterdayReport.summary.netSales)) / Number(yesterdayReport.summary.netSales) * 100).toFixed(1))
      : null,
    inventory: inventory.map((row) => ({ unitLabel: row.unitLabel, stock: Number(row.stock), count: Number(row.count) })),
    productCount: inventory.reduce((sum, row) => sum + Number(row.count), 0),
    inventoryValue: { purchase: Number(inventoryValue.purchaseValue), retail: Number(inventoryValue.retailValue) },
    lowStock: Number(lowStock.count),
    salesTrendStart: weekStartIso,
    salesTrendEnd: today,
    salesTrend: weekReport.byDate.map((row) => ({ date: row.date, sales: Number(row.netSales), profit: Number(row.profitTotal) })),
    paymentBreakdown: paymentBreakdown.map((row) => ({ method: row.method, amount: Number(row.amount) })),
    topProducts: monthReport.byProduct.map((row) => ({ name: row.name, quantity: Number(row.quantity), netSales: Number(row.netSales) })),
    categorySales: Object.values(monthReport.byProduct.reduce((groups, row) => { const name = row.categoryName || 'بدون دسته‌بندی'; const entry = groups[name] || (groups[name] = { categoryName: name, quantity: 0, netSales: 0 }); entry.quantity += Number(row.quantity); entry.netSales += Number(row.netSales); return groups; }, {})).sort((a, b) => b.netSales - a.netSales).slice(0, 8),
    recentSales: recentSales.map((row) => ({ ...row, total: Number(row.total), paidAmount: Number(row.paidAmount), remainingAmount: Number(row.remainingAmount) })),
    topDebtors: topDebtors.map((row) => ({ partyName: row.partyName, accountType: row.accountType, balance: Number(row.balance) })),
    cashMonth: { income: Number(cashMonth.income), expense: Number(cashMonth.expense) },
    monthProfit: Number(monthReport.summary.profitTotal),
    receivables: Number(receivables.amount)
  };
}

function listNotifications(payload = {}) {
  const db = requireDatabase();
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.today || ''))
    ? String(payload.today)
    : localDateIso();
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
  const period = ['day', 'week', 'month', 'year'].includes(String(payload.period || '')) ? String(payload.period) : 'day';
  const conditions = ["s.status = 'active'"];
  const params = [];
  if (from) { conditions.push('s.date >= ?'); params.push(from); }
  if (to) { conditions.push('s.date <= ?'); params.push(to); }
  if (source) { conditions.push('s.source = ?'); params.push(source); }
  const where = conditions.join(' AND ');
  // Sales net of tax: revenue excludes the collected tax, which is a liability
  // rather than income. The guard keeps invoices whose tax exceeds their total
  // from contributing a negative revenue figure.
  const netSalesExpression = "CASE WHEN s.total > s.tax THEN s.total - s.tax ELSE 0 END";
  const summary = db.prepare(`
    SELECT COUNT(*) AS invoiceCount,
      COALESCE(SUM(CASE WHEN s.source = 'daily' THEN 1 ELSE 0 END), 0) AS dailyCount,
      COALESCE(SUM(CASE WHEN s.source = 'invoice' THEN 1 ELSE 0 END), 0) AS formalCount,
      COALESCE(SUM(s.item_count), 0) AS itemCount,
      COALESCE(SUM(s.subtotal), 0) AS subtotal,
      COALESCE(SUM(s.discount), 0) AS discount,
      COALESCE(SUM(s.tax), 0) AS tax,
      COALESCE(SUM(s.total), 0) AS total,
      COALESCE(SUM(${netSalesExpression}), 0) AS netSales,
      COALESCE(SUM(s.paid_amount), 0) AS paidAmount,
      COALESCE(SUM(s.remaining_amount), 0) AS remainingAmount,
      COALESCE(SUM(s.cost_total), 0) AS costTotal,
      COALESCE(SUM(${netSalesExpression} - s.cost_total), 0) AS profitTotal
    FROM sales s WHERE ${where}
  `).get(...params);
  const byDate = db.prepare(`
    SELECT s.date,
      COUNT(*) AS invoiceCount,
      COALESCE(SUM(s.item_count), 0) AS itemCount,
      COALESCE(SUM(s.total), 0) AS total,
      COALESCE(SUM(${netSalesExpression}), 0) AS netSales,
      COALESCE(SUM(s.cost_total), 0) AS costTotal,
      COALESCE(SUM(${netSalesExpression} - s.cost_total), 0) AS profitTotal,
      COALESCE(SUM(CASE WHEN s.source = 'daily' THEN 1 ELSE 0 END), 0) AS dailyCount,
      COALESCE(SUM(CASE WHEN s.source = 'invoice' THEN 1 ELSE 0 END), 0) AS formalCount
    FROM sales s WHERE ${where}
    GROUP BY s.date ORDER BY s.date
  `).all(...params);
  const periodExpressionOf = (alias) => ({
    day: alias,
    week: `date(${alias}, '-' || ((CAST(strftime('%w', ${alias}) AS INTEGER) + 1) % 7) || ' days')`,
    month: `substr(${alias}, 1, 7)`,
    year: `substr(${alias}, 1, 4)`
  }[period]);
  const salesPeriod = periodExpressionOf('s.date');
  const byPeriod = db.prepare(`
    SELECT ${salesPeriod} AS period,
      COUNT(*) AS invoiceCount,
      COALESCE(SUM(s.item_count), 0) AS itemCount,
      COALESCE(SUM(s.total), 0) AS total,
      COALESCE(SUM(${netSalesExpression}), 0) AS netSales,
      COALESCE(SUM(s.cost_total), 0) AS costTotal,
      COALESCE(SUM(${netSalesExpression} - s.cost_total), 0) AS profitTotal,
      COALESCE(SUM(s.paid_amount), 0) AS paidAmount,
      COALESCE(SUM(s.remaining_amount), 0) AS remainingAmount,
      COALESCE(SUM(CASE WHEN s.source = 'daily' THEN 1 ELSE 0 END), 0) AS dailyCount,
      COALESCE(SUM(CASE WHEN s.source = 'invoice' THEN 1 ELSE 0 END), 0) AS formalCount
    FROM sales s WHERE ${where}
    GROUP BY ${salesPeriod} ORDER BY period
  `).all(...params);
  const bySource = db.prepare(`
    SELECT s.source,
      COUNT(*) AS invoiceCount, COALESCE(SUM(s.total), 0) AS total,
      COALESCE(SUM(${netSalesExpression}), 0) AS netSales,
      COALESCE(SUM(s.cost_total), 0) AS costTotal,
      COALESCE(SUM(${netSalesExpression} - s.cost_total), 0) AS profitTotal
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
      COUNT(*) AS invoiceCount,
      COALESCE(SUM(${netSalesExpression}), 0) AS total,
      COALESCE(SUM(${netSalesExpression} - s.cost_total), 0) AS profitTotal
    FROM sales s WHERE ${where}
    GROUP BY customerName ORDER BY total DESC LIMIT 10
  `).all(...params);

  // Completed returns reduce reported revenue, cost and profit. A returned
  // item is valued at the net amount it actually carried: its item total less
  // its proportional share of the invoice-level discount. Returns are
  // attributed to the day they were recorded, matching the P&L report.
  const returnConditions = ["sr.status = 'completed'"];
  const returnParams = [];
  if (from) { returnConditions.push('sr.date >= ?'); returnParams.push(from); }
  if (to) { returnConditions.push('sr.date <= ?'); returnParams.push(to); }
  if (source) { returnConditions.push('s.source = ?'); returnParams.push(source); }
  const returnWhere = returnConditions.join(' AND ');
  const returnsCount = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM sales_returns sr
    JOIN sales s ON s.id = sr.sale_id
    WHERE ${returnWhere}
  `).get(...returnParams).count);
  const returnRows = db.prepare(`
    SELECT
      sr.date AS returnDate,
      ${periodExpressionOf('sr.date')} AS period,
      s.source AS source,
      COALESCE(NULLIF(TRIM(s.party_name), ''), 'مشتری متفرقه') AS customerName,
      sri.product_id AS productId,
      COALESCE(p.name, '') AS productName,
      COALESCE(p.code, '') AS productCode,
      COALESCE(c.name, '') AS categoryName,
      COALESCE(sri.quantity, 0) AS quantity,
      COALESCE(sri.total, 0) AS itemValue,
      COALESCE(sri.total, 0)
        - CASE WHEN s.subtotal > 0
          THEN MIN(MAX(s.discount, 0), s.subtotal) * sri.total / s.subtotal
          ELSE 0 END AS netValue,
      COALESCE(sri.quantity, 0) * COALESCE(si.purchase_price, 0) AS costValue
    FROM sales_returns sr
    JOIN sales s ON s.id = sr.sale_id
    JOIN sales_return_items sri ON sri.return_id = sr.id
    LEFT JOIN sale_items si ON si.id = sri.sale_item_id
    LEFT JOIN products p ON p.id = sri.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE ${returnWhere}
  `).all(...returnParams);

  const totals = { netValue: 0, costValue: 0, itemValue: 0, quantity: 0 };
  const emptyBucket = () => ({ netValue: 0, costValue: 0, itemValue: 0, quantity: 0 });
  const sumInto = (map, key, values) => {
    const existing = map.get(key) || emptyBucket();
    map.set(key, {
      netValue: existing.netValue + values.netValue,
      costValue: existing.costValue + values.costValue,
      itemValue: existing.itemValue + values.itemValue,
      quantity: existing.quantity + values.quantity
    });
  };
  const byDateReturns = new Map();
  const byPeriodReturns = new Map();
  const bySourceReturns = new Map();
  const byCustomerReturns = new Map();
  const byProductReturns = new Map();
  for (const row of returnRows) {
    const values = {
      netValue: Number(row.netValue || 0),
      costValue: Number(row.costValue || 0),
      itemValue: Number(row.itemValue || 0),
      quantity: Number(row.quantity || 0)
    };
    totals.netValue += values.netValue;
    totals.costValue += values.costValue;
    totals.itemValue += values.itemValue;
    totals.quantity += values.quantity;
    if (row.returnDate) sumInto(byDateReturns, row.returnDate, values);
    if (row.period) sumInto(byPeriodReturns, row.period, values);
    if (row.source) sumInto(bySourceReturns, row.source, values);
    sumInto(byCustomerReturns, row.customerName, values);
    if (row.productId) sumInto(byProductReturns, Number(row.productId), values);
  }
  const get = (map, key) => map.get(key) || emptyBucket();

  const castRows = (rows) => rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, typeof value === 'number' ? Number(value) : value])
  ));

  // Returns land on the day/period they were recorded; every breakdown that
  // carries revenue subtracts them so the rows stay internally consistent
  // (profit == netSales - costTotal on every row).
  for (const row of byDate) {
    const r = get(byDateReturns, row.date);
    row.netSales = Number(row.netSales) - r.netValue;
    row.costTotal = Number(row.costTotal) - r.costValue;
    row.itemCount = Number(row.itemCount) - r.quantity;
    row.profitTotal = Number(row.netSales) - Number(row.costTotal);
  }
  // Returns are attributed to the date they were recorded. A return can fall
  // in a period with no sales (or refer to a sale outside the selected range),
  // so create negative-only buckets instead of silently dropping it from the
  // period/source/customer/product breakdowns.
  const ensureBucket = (rows, key, keyOf, create) => {
    let row = rows.find((candidate) => keyOf(candidate) === key);
    if (!row) {
      row = create();
      rows.push(row);
    }
    return row;
  };
  for (const [periodKey, returned] of byPeriodReturns) {
    const row = ensureBucket(byPeriod, periodKey, (candidate) => candidate.period, () => ({
      period: periodKey, invoiceCount: 0, itemCount: 0, total: 0, netSales: 0,
      costTotal: 0, profitTotal: 0, paidAmount: 0, remainingAmount: 0,
      dailyCount: 0, formalCount: 0
    }));
    row.netSales = Number(row.netSales) - returned.netValue;
    row.costTotal = Number(row.costTotal) - returned.costValue;
    row.itemCount = Number(row.itemCount) - returned.quantity;
    row.profitTotal = Number(row.netSales) - Number(row.costTotal);
  }
  for (const [sourceKey, returned] of bySourceReturns) {
    const row = ensureBucket(bySource, sourceKey, (candidate) => candidate.source, () => ({
      source: sourceKey, invoiceCount: 0, total: 0, netSales: 0, costTotal: 0, profitTotal: 0
    }));
    row.total = Number(row.total) - returned.itemValue;
    row.netSales = Number(row.netSales) - returned.netValue;
    row.costTotal = Number(row.costTotal) - returned.costValue;
    row.profitTotal = Number(row.netSales) - Number(row.costTotal);
  }
  for (const [customerKey, returned] of byCustomerReturns) {
    const row = ensureBucket(byCustomer, customerKey, (candidate) => candidate.customerName, () => ({
      customerName: customerKey, invoiceCount: 0, total: 0, profitTotal: 0
    }));
    row.total = Number(row.total) - returned.netValue;
    row.profitTotal = Number(row.profitTotal) - returned.netValue + returned.costValue;
  }
  for (const [productId, returned] of byProductReturns) {
    const detail = returnRows.find((candidate) => Number(candidate.productId) === productId);
    if (!detail) continue;
    const row = ensureBucket(byProduct, productId, (candidate) => Number(candidate.productId), () => ({
      productId, name: detail.productName, code: detail.productCode, categoryName: detail.categoryName,
      quantity: 0, netSales: 0, costTotal: 0, profitTotal: 0
    }));
    row.quantity = Number(row.quantity) - returned.quantity;
    row.netSales = Number(row.netSales) - returned.netValue;
    row.costTotal = Number(row.costTotal) - returned.costValue;
    row.profitTotal = Number(row.profitTotal) - returned.netValue + returned.costValue;
  }
  // A return can be recorded on a day with no sale. Keep that day in a pinned
  // daily report so its negative net sales and returned cost are not lost.
  const salesDates = new Set(byDate.map((row) => row.date));
  for (const [date, returned] of byDateReturns) {
    if (salesDates.has(date)) continue;
    byDate.push({
      date, invoiceCount: 0, itemCount: -returned.quantity, total: 0,
      netSales: -returned.netValue, costTotal: -returned.costValue,
      profitTotal: -returned.netValue + returned.costValue, dailyCount: 0, formalCount: 0
    });
  }
  byDate.sort((a, b) => a.date.localeCompare(b.date));
  byPeriod.sort((a, b) => String(a.period).localeCompare(String(b.period)));
  bySource.sort((a, b) => String(a.source).localeCompare(String(b.source)));
  byCustomer.sort((a, b) => Number(b.total || 0) - Number(a.total || 0));
  byProduct.sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0) || Number(b.netSales || 0) - Number(a.netSales || 0));

  const summaryRow = castRows([summary])[0];
  summaryRow.returnsTotal = totals.netValue;
  summaryRow.returnsCost = totals.costValue;
  summaryRow.returnsCount = returnsCount;
  summaryRow.itemCount = Number(summaryRow.itemCount || 0) - totals.quantity;
  summaryRow.netSales = Number(summaryRow.netSales || 0) - totals.netValue;
  summaryRow.costTotal = Number(summaryRow.costTotal || 0) - totals.costValue;
  summaryRow.profitTotal = Number(summaryRow.netSales) - Number(summaryRow.costTotal);

  // When the caller pinned both ends of the range, the daily breakdown should
  // cover every day in it, not just the days that had sales.
  let dailyRows = byDate;
  if (from && to) {
    const existing = new Map(byDate.map((row) => [row.date, row]));
    const emptyRow = (iso) => ({
      date: iso, invoiceCount: 0, itemCount: 0, total: 0, netSales: 0,
      costTotal: 0, profitTotal: 0, dailyCount: 0, formalCount: 0
    });
    dailyRows = [];
    for (let cursor = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const iso = cursor.toISOString().slice(0, 10);
      dailyRows.push(existing.get(iso) || emptyRow(iso));
    }
  }

  return {
    filters: { from, to, source, period },
    period,
    summary: summaryRow,
    byDate: castRows(dailyRows),
    byPeriod: castRows(byPeriod),
    bySource: castRows(bySource),
    byProduct: castRows(byProduct),
    byCustomer: castRows(byCustomer)
  };
}

function getSalesForecast(payload = {}) {
  const period = String(payload.period || '') === 'year' ? 'year' : 'month';
  const today = localDateIso();
  const window = jalaliForecastPeriods(today, period);
  const report = getSalesReport({ from: window.from, to: today, source: payload.source, period: 'day' });
  if (!Number(report.summary?.invoiceCount) && !Number(report.summary?.returnsCount)) {
    return buildSalesForecast([], { period, horizon: payload.horizon });
  }
  const byPeriod = new Map(window.periods.map((key) => [key, {
    period: key, netSales: 0, profitTotal: 0, invoiceCount: 0
  }]));
  for (const row of report.byDate) {
    const key = jalaliPeriodKey(row.date, period);
    const bucket = byPeriod.get(key);
    if (!bucket) continue;
    bucket.netSales += Number(row.netSales || 0);
    bucket.profitTotal += Number(row.profitTotal || 0);
    bucket.invoiceCount += Number(row.invoiceCount || 0);
  }
  return buildSalesForecast([...byPeriod.values()], { period, horizon: payload.horizon });
}

function getProfitLossReport(payload = {}) {
  const db = requireDatabase();
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  const range = (column = 'date') => `(? = '' OR ${column} >= ?) AND (? = '' OR ${column} <= ?)`;
  // A returned item reverses the net revenue it carried: its item total less
  // its proportional share of the invoice-level discount.
  const returnedNet = "sr.total - CASE WHEN s.subtotal > 0 THEN MIN(MAX(s.discount, 0), s.subtotal) * sr.total / s.subtotal ELSE 0 END";
  const sales = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN total > tax THEN total - tax ELSE 0 END), 0) AS netSales,
      COALESCE(SUM(cost_total), 0) AS costTotal, COUNT(*) AS invoiceCount
    FROM sales WHERE status = 'active' AND ${range('date')}
  `).get(from, from, to, to);
  const saleReturns = db.prepare(`
    SELECT COALESCE(SUM(${returnedNet}), 0) AS total,
      COALESCE(SUM(sri.quantity * si.purchase_price), 0) AS costTotal
    FROM sales_returns sr
    JOIN sales s ON s.id = sr.sale_id
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
        - COALESCE((SELECT SUM(${returnedNet}) FROM sales_returns sr JOIN sales s ON s.id = sr.sale_id WHERE sr.status='completed' AND sr.date=dates.date), 0) AS netSales,
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

module.exports = { getDashboardSummary, getProfitLossReport, getSalesReport, getSalesForecast, listNotifications };
