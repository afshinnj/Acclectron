const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  closeDatabase,
  createSale,
  createSaleReturn,
  getDatabase,
  getInvoiceDetails,
  getProfitLossReport,
  getSalesReport,
  loginUser
} = require('../src/main/database');

// A sale with an invoice-level discount, then a partial return. Reported
// revenue/profit must reflect the discount share the returned items carried
// and must not ignore the return altogether.
test('sales report and P&L deduct returns at their discounted net value', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accletron-return-report-'));
  const db = getDatabase(directory);
  try {
    loginUser('admin', 'admin123');
    const productResult = db.prepare(
      "INSERT INTO products (code, name, sale_price, stock, purchase_price) VALUES ('RET-001', 'کالای مرجوعی', 100000000, 100, 50000000)"
    ).run();
    const productId = Number(productResult.lastInsertRowid);

    // subtotal 2,000,000 - discount 200,000 + tax 0 = total 1,800,000
    // cost 1,000,000 -> profit 800,000
    const sale = createSale({
      date: '2026-03-10',
      source: 'invoice',
      paidAmount: 1800000,
      discount: 200000,
      tax: 0,
      items: [
        { productId, quantity: 1, unitPrice: 1000000 },
        { productId, quantity: 1, unitPrice: 1000000 }
      ]
    });
    const details = getInvoiceDetails('sale', sale.id);
    const firstItemId = Number(details.items[0].id);

    // Return one of the two items. Its item-level total is 1,000,000 but it
    // carried a 10% invoice discount, so its true net value is 900,000.
    createSaleReturn({
      saleId: sale.id,
      date: '2026-03-11',
      refundAmount: 900000,
      items: [{ saleItemId: firstItemId, quantity: 1 }]
    });

    const report = getSalesReport({ from: '2026-03-01', to: '2026-03-31', period: 'day' });
    // The reports page must net the return out of sales, not ignore it.
    assert.equal(report.summary.netSales, 90_000_000, 'net sales must subtract the discounted return');
    assert.equal(report.summary.costTotal, 50_000_000, 'cost must drop by the returned item cost');
    assert.equal(report.summary.profitTotal, 40_000_000, 'profit must reflect the returned item');
    assert.equal(report.summary.returnsTotal, 90_000_000);
    assert.equal(report.summary.returnsCount, 1);

    const pnl = getProfitLossReport({ from: '2026-03-01', to: '2026-03-31' });
    assert.equal(pnl.salesReturns, 90_000_000, 'P&L return value must include the discount share');
    assert.equal(pnl.netSales, 90_000_000);
    assert.equal(pnl.costTotal, 50_000_000);
    assert.equal(pnl.grossProfit, 40_000_000);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// A range with a leading gap: the daily breakdown must cover the selected
// range, not just the days that have sales.
test('daily report rows cover the whole selected date range', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accletron-range-report-'));
  const db = getDatabase(directory);
  try {
    loginUser('admin', 'admin123');
    const productResult = db.prepare(
      "INSERT INTO products (code, name, sale_price, stock, purchase_price) VALUES ('RNG-001', 'کالای بازه', 100000000, 100, 50000000)"
    ).run();
    const productId = Number(productResult.lastInsertRowid);
    createSale({
      date: '2026-05-10',
      source: 'daily',
      paidAmount: 1000000,
      items: [{ productId, quantity: 1, unitPrice: 1000000 }]
    });

    const report = getSalesReport({ from: '2026-05-01', to: '2026-05-15', period: 'day' });
    const dates = report.byDate.map((row) => row.date);
    assert.equal(dates[0], '2026-05-01', 'first day must be the requested from-date');
    assert.equal(dates[dates.length - 1], '2026-05-15', 'last day must be the requested to-date');
    assert.equal(dates.length, 15);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
