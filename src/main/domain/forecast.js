function normalizeRows(rows = []) {
  return rows
    .map((row) => ({
      period: String(row.period || row.date || ''),
      netSales: Math.max(0, Number(row.netSales || 0)),
      profitTotal: Number(row.profitTotal || 0),
      invoiceCount: Math.max(0, Number(row.invoiceCount || 0))
    }))
    .filter((row) => row.period);
}

function nextPeriod(period, unit) {
  if (unit === 'year') return String(Number(period) + 1);
  const [year, month] = String(period).split('-').map(Number);
  if (!year || !month) return '';
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
}

function linearForecast(values, horizon) {
  const n = values.length;
  if (!n) return { predictions: Array(horizon).fill(0), error: 0, slope: 0 };
  const weights = values.map((_, index) => index + 1);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const xMean = weights.reduce((sum, value, index) => sum + value * index, 0) / weightTotal;
  const yMean = weights.reduce((sum, value, index) => sum + value * values[index], 0) / weightTotal;
  const denominator = weights.reduce((sum, value, index) => sum + value * (index - xMean) ** 2, 0);
  const slope = denominator ? weights.reduce((sum, value, index) => sum + value * (index - xMean) * (values[index] - yMean), 0) / denominator : 0;
  const intercept = yMean - slope * xMean;
  const residuals = values.map((value, index) => value - (intercept + slope * index));
  const error = Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / Math.max(1, n - 1));
  return {
    predictions: Array.from({ length: horizon }, (_, index) => Math.max(0, intercept + slope * (n + index))),
    error,
    slope
  };
}

function buildSalesForecast(rows = [], options = {}) {
  const unit = options.period === 'year' ? 'year' : 'month';
  const normalized = normalizeRows(rows).sort((a, b) => a.period.localeCompare(b.period));
  const maxHistory = unit === 'month' ? 12 : 5;
  const history = normalized.slice(-maxHistory);
  const horizon = Math.max(1, Math.min(12, Math.round(Number(options.horizon || (unit === 'month' ? 3 : 1)))));
  const salesModel = linearForecast(history.map((row) => row.netSales), horizon);
  const profitModel = linearForecast(history.map((row) => row.profitTotal), horizon);
  const invoiceModel = linearForecast(history.map((row) => row.invoiceCount), horizon);
  const lastPeriod = history.at(-1)?.period || '';
  const predictions = [];
  let period = lastPeriod;
  for (let index = 0; index < horizon; index += 1) {
    period = nextPeriod(period, unit);
    const sales = salesModel.predictions[index];
    predictions.push({
      period,
      netSales: Math.round(sales),
      profitTotal: Math.round(profitModel.predictions[index]),
      invoiceCount: Math.round(invoiceModel.predictions[index]),
      lowerBound: Math.max(0, Math.round(sales - salesModel.error * 1.28)),
      upperBound: Math.round(sales + salesModel.error * 1.28),
      isForecast: true
    });
  }
  return {
    period: unit,
    horizon,
    history,
    predictions,
    slope: Math.round(salesModel.slope),
    confidence: history.length >= (unit === 'month' ? 3 : 2) ? 'متوسط' : 'کم',
    note: history.length < (unit === 'month' ? 3 : 2)
      ? `برای پیش‌بینی ${unit === 'month' ? 'ماهانه' : 'سالانه'} دادهٔ کافی وجود ندارد.`
      : `پیش‌بینی بر اساس ${history.length} دورهٔ اخیر و روند وزنی فروش انجام شده است.`
  };
}

module.exports = { buildSalesForecast };
