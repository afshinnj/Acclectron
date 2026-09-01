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
