const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  closeDatabase,
  createSale,
  getDatabase,
  getSalesReport
} = require('../src/main/database');

test('aggregates sales by day, ISO week, month and year', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accletron-report-'));
  const db = getDatabase(directory);
  try {
    const productResult = db.prepare("INSERT INTO products (code, name, sale_price, stock, purchase_price) VALUES ('REPORT-001', 'کالای گزارش', 1000000, 100, 500000)").run();
    const product = { id: Number(productResult.lastInsertRowid) };
    for (const [date, price] of [['2026-01-05', 10000], ['2026-01-06', 20000], ['2026-02-02', 30000], ['2027-01-04', 40000]]) {
      createSale({ date, source: 'daily', paidAmount: price, items: [{ productId: product.id, quantity: 1, unitPrice: price }] });
    }
    const day = getSalesReport({ from: '2026-01-01', to: '2026-12-31', period: 'day' });
    const week = getSalesReport({ from: '2026-01-01', to: '2026-12-31', period: 'week' });
    const month = getSalesReport({ from: '2026-01-01', to: '2026-12-31', period: 'month' });
    const year = getSalesReport({ from: '2026-01-01', to: '2026-12-31', period: 'year' });
    assert.equal(day.period, 'day');
    assert.equal(day.byPeriod.length, 3);
    assert.equal(week.byPeriod.length, 2);
    assert.deepEqual(week.byPeriod.map((row) => row.period), ['2026-01-03', '2026-01-31']);
    assert.deepEqual(month.byPeriod.map((row) => row.period), ['2026-01', '2026-02']);
    assert.deepEqual(year.byPeriod.map((row) => row.period), ['2026']);
    assert.equal(month.byPeriod[0].netSales, 3000000);
    assert.equal(month.byPeriod[1].netSales, 3000000);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
