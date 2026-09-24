const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSalesForecast } = require('../src/main/domain/forecast');

test('forecasts future monthly sales with weighted trend and bounds', () => {
  const result = buildSalesForecast([
    { period: '2026-01', netSales: 100000, profitTotal: 20000, invoiceCount: 10 },
    { period: '2026-02', netSales: 120000, profitTotal: 24000, invoiceCount: 12 },
    { period: '2026-03', netSales: 150000, profitTotal: 30000, invoiceCount: 15 }
  ], { period: 'month', horizon: 3 });
  assert.deepEqual(result.predictions.map((row) => row.period), ['2026-04', '2026-05', '2026-06']);
  assert.equal(result.predictions.length, 3);
  assert.ok(result.predictions.every((row) => row.netSales > 0));
  assert.ok(result.predictions.every((row) => row.lowerBound <= row.netSales && row.netSales <= row.upperBound));
  assert.equal(result.confidence, 'متوسط');
});

test('forecasts annual periods and warns when history is limited', () => {
  const result = buildSalesForecast([{ period: '2025', netSales: 1200000, profitTotal: 200000, invoiceCount: 100 }], { period: 'year', horizon: 2 });
  assert.deepEqual(result.predictions.map((row) => row.period), ['2026', '2027']);
  assert.equal(result.confidence, 'کم');
  assert.match(result.note, /دادهٔ کافی/);
});
