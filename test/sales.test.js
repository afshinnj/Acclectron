const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateSaleTotals } = require('../src/main/domain/sales');

test('calculates subtotal, discount, tax and remaining amount in cents', () => {
  const result = calculateSaleTotals(
    [{ productId: 1, quantity: 2, unitPrice: 1000, discount: 100 }],
    50,
    20,
    500
  );
  assert.equal(result.subtotal, 190000);
  assert.equal(result.total, 187000);
  assert.equal(result.remainingAmount, 137000);
});

test('rejects an empty invoice', () => {
  assert.throws(() => calculateSaleTotals([]), /حداقل یک کالا/);
});

test('rejects invalid and over-discounted sale amounts', () => {
  assert.throws(() => calculateSaleTotals([{ productId: 1, quantity: 1, unitPrice: 'bad' }]), /قیمت واحد نامعتبر/);
  assert.throws(() => calculateSaleTotals([{ productId: 1, quantity: 1, unitPrice: -1 }]), /قیمت واحد نامعتبر/);
  assert.throws(() => calculateSaleTotals([{ productId: 1, quantity: 1, unitPrice: 100, discount: 101 }]), /تخفیف هر ردیف/);
  assert.throws(() => calculateSaleTotals([{ productId: 1, quantity: 1, unitPrice: 100 }], 101), /تخفیف فاکتور/);
  assert.throws(() => calculateSaleTotals([{ productId: 1, quantity: 1, unitPrice: 100 }], 0, -1), /مالیات نامعتبر/);
});

test('sale totals preserve arithmetic invariants across fractional quantities and mixed discounts', () => {
  const cases = [
    [{ productId: 1, quantity: 0.25, unitPrice: 0.5, discount: 0 }],
    [{ productId: 1, quantity: 1.5, unitPrice: 19.99, discount: 1.25 }, { productId: 2, quantity: 2, unitPrice: 5.55, discount: 0.05 }],
    [{ productId: 1, quantity: 13, unitPrice: 100000000, discount: 2500 }]
  ];
  for (const items of cases) {
    const totals = calculateSaleTotals(items, 0.11, 0.07, 3.25);
    const itemSum = totals.items.reduce((sum, item) => sum + item.total, 0);
    assert.equal(totals.subtotal, itemSum);
    assert.equal(totals.total, totals.subtotal - totals.discount + totals.tax);
    assert.equal(totals.paidAmount, Math.min(totals.total, 325));
    assert.equal(totals.remainingAmount, totals.total - totals.paidAmount);
    assert.ok(totals.items.every((item) => item.total >= 0));
  }
});
