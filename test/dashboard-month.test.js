const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { jalaliMonthRangeIso, jalaliToGregorianIso, gregorianToJalali } = require('../src/main/domain/dates');
const {
  closeDatabase,
  getDatabase,
  setCurrentUser,
  createCategory,
  createProduct,
  createSale,
  getDashboardSummary
} = require('../src/main/database');

test('jalali month range matches the Jalali calendar the UI displays', () => {
  // 2026-09-23 is Mehr 1st, 1405: the month spans 2026-09-23 .. 2026-10-22.
  assert.deepEqual(jalaliMonthRangeIso('2026-09-23'), { from: '2026-09-23', to: '2026-10-22', year: 1405, month: 7 });
  // Esfand 1402 is common (29 days, ends 2024-03-19); Esfand 1403 is leap (30 days).
  assert.deepEqual(jalaliMonthRangeIso('2024-03-01'), { from: '2024-02-20', to: '2024-03-19', year: 1402, month: 12 });
  assert.deepEqual(jalaliMonthRangeIso('2025-03-01'), { from: '2025-02-19', to: '2025-03-20', year: 1403, month: 12 });
  // Farvardin starts the Jalali year.
  assert.deepEqual(jalaliMonthRangeIso('2025-03-21'), { from: '2025-03-21', to: '2025-04-20', year: 1404, month: 1 });
  assert.equal(jalaliToGregorianIso(...gregorianToJalali(2026, 9, 23)), '2026-09-23');
  assert.equal(jalaliMonthRangeIso('not-a-date'), null);
});

test('dashboard monthly windows follow the Jalali month, not the Gregorian month', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accletron-month-'));
  getDatabase(directory);
  const admin = getDatabase(directory).prepare("SELECT id FROM users WHERE username = 'admin'").get();
  setCurrentUser(admin.id);
  const category = createCategory({ name: 'ماه', code: '97' });
  const product = createProduct({ name: 'کالای ماه', categoryId: category.id, purchasePrice: 10000, retailPrice: 20000, stock: 100 });

  // Invoice dated Shahrivar 31 (2026-09-22), paid today (Mehr 1) -> receipt counts, sales month does not.
  createSale({
    date: '2026-09-22',
    items: [{ productId: product.id, quantity: 1, unitPrice: 20000 }],
    payments: [{ method: 'cash', amount: 20000, paidAt: '2026-09-23T10:00:00Z' }]
  });
  // Invoice dated Mehr 8 (2026-09-30) with an explicit Mehr receipt.
  createSale({
    date: '2026-09-30',
    items: [{ productId: product.id, quantity: 1, unitPrice: 20000 }],
    payments: [{ method: 'cash', amount: 20000, paidAt: '2026-09-30T10:00:00Z' }]
  });
  // Invoice dated Mehr 13 (2026-10-05) - Gregorian October, still within Jalali Mehr.
  createSale({
    date: '2026-10-05',
    items: [{ productId: product.id, quantity: 1, unitPrice: 20000 }],
    payments: [{ method: 'card', amount: 20000, paidAt: '2026-10-05T10:00:00Z' }]
  });
  // Receipt settled before the Jalali month began must not appear in it.
  createSale({
    date: '2026-09-28',
    items: [{ productId: product.id, quantity: 1, unitPrice: 20000 }],
    payments: [{ method: 'cash', amount: 20000, paidAt: '2026-09-20T10:00:00Z' }]
  });

  const summary = getDashboardSummary({ today: '2026-09-23' });
  // Three Mehr invoices (Mehr 1, 8, 13); the Shahrivar 31 invoice is last month.
  assert.equal(summary.monthSales, 3 * 20000 * 100);
  const byMethod = Object.fromEntries(summary.paymentBreakdown.map((row) => [row.method, row.amount]));
  // Receipts are attributed by paid_at: the Shahrivar 29 receipt drops out even
  // though its invoice is dated this month.
  assert.equal(byMethod.cash, 2 * 20000 * 100);
  assert.equal(byMethod.card, 20000 * 100);
  closeDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});
