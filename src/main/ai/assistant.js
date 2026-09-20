// Offline text-command assistant: parses Persian instructions like
// "لیست پروانه‌های لباسشویی را لیست کن و ۲۰ درصد به مبلغ خرید اضافه کن"
// into a structured plan (product selection + optional price adjustment),
// previewable and editable before anything is written to the database.
const { normalizeProductText, rankProductsBySimilarity } = require('./semantic');
const { listProducts, updateProductQuick, auditLog } = require('../database');

const STOPWORDS = new Set(['لیست', 'کن', 'کنید', 'بده', 'بدهید', 'انجام', 'نمایید', 'را', 'به', 'از', 'و', 'یا', 'مبلغ', 'قیمت', 'قیمتها', 'قیمت‌ها', 'خرید', 'عمده', 'فروش', 'اضافه', 'افزایش', 'افزایشبده', 'کاهش', 'کم', 'زیاد', 'بیشتر', 'های', 'هایی', 'ها', 'نمایش', 'نشون', 'ده', 'است', 'همه', 'تمام', 'کالا', 'کالاها', 'محصول', 'محصولات', 'درصد', 'درصدی', 'تومان', 'ریال', 'خروجی', 'بگیر', 'اکسل', 'csv', 'excel', 'شد', 'شود', 'شون']);

function parseCommand(rawText) {
  const text = normalizeProductText(rawText).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*درصد/);
  const percent = percentMatch ? Number(percentMatch[1]) : 0;
  const increase = /(اضافه|افزایش|زیاد|بیشتر)/.test(text);
  const decrease = /(کم|کاهش|تخفیف)/.test(text);
  const direction = increase ? 1 : decrease ? -1 : 0;
  const field = /عمده/.test(text) ? 'wholesale' : /خرید/.test(text) ? 'purchase' : /فروش/.test(text) ? 'retail' : 'purchase';
  const selectionPhrase = text
    .replace(/(\d+(?:\.\d+)?)\s*درصد/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !STOPWORDS.has(token) && !/^\d+(\.\d+)?$/.test(token))
    .join(' ')
    .trim();
  if (!selectionPhrase) {
    const error = new Error('نام یا نوع کالاهای موردنظر را در جمله بنویسید؛ مثال: «لیست پروانه‌های لباسشویی و ۲۰ درصد به قیمت خرید اضافه کن».');
    error.code = 'EMPTY_SELECTION';
    throw error;
  }
  const action = percent > 0 && direction !== 0
    ? { type: 'adjust', field, percent, direction }
    : { type: 'list' };
  return { action, selectionPhrase };
}

function previewPrices(product, action) {
  const current = {
    purchasePrice: Number(product.purchasePrice || 0),
    wholesalePrice: Number(product.wholesalePrice || 0),
    retailPrice: Number(product.salePrice || 0)
  };
  if (action.type !== 'adjust') return { ...current, newPurchasePrice: current.purchasePrice, newWholesalePrice: current.wholesalePrice, newRetailPrice: current.retailPrice };
  const factor = 1 + (action.direction * action.percent) / 100;
  const field = action.field === 'wholesale' ? 'wholesalePrice' : action.field === 'retail' ? 'retailPrice' : 'purchasePrice';
  const next = { ...current, newPurchasePrice: current.purchasePrice, newWholesalePrice: current.wholesalePrice, newRetailPrice: current.retailPrice };
  next[field] = Math.max(0, Math.ceil(current[field] * factor));
  if (field === 'purchasePrice') next.newPurchasePrice = next.purchasePrice;
  if (field === 'wholesalePrice') next.newWholesalePrice = next.wholesalePrice;
  if (field === 'retailPrice') next.newRetailPrice = next.retailPrice;
  return next;
}

async function planCommand(rawText, modelRoots = []) {
  const { action, selectionPhrase } = parseCommand(rawText);
  const tokens = selectionPhrase.split(/\s+/).filter(Boolean);
  const all = listProducts('', '');
  let matchMode = 'keyword';
  let matched = all.filter((product) => {
    const haystack = normalizeProductText([product.name, product.code, product.barcode, product.categoryName].filter(Boolean).join(' '));
    return tokens.every((token) => haystack.includes(token));
  });
  if (!matched.length && modelRoots.length) {
    try {
      const ranked = await rankProductsBySimilarity(selectionPhrase, all, modelRoots);
      matched = ranked.filter((row) => row.score >= 0.4).slice(0, 100)
        .map((row) => all.find((product) => Number(product.id) === Number(row.id)))
        .filter(Boolean);
      if (matched.length) matchMode = 'semantic';
    } catch {
      // Semantic model unavailable: fall through with an empty keyword match.
    }
  }
  matched = matched.slice(0, 200);
  return {
    action,
    selectionPhrase,
    matchMode,
    products: matched.map((product) => ({
      id: Number(product.id),
      code: product.code,
      name: product.name,
      categoryName: product.categoryName || '',
      unitSymbol: product.unitSymbol || product.unitName || '',
      stock: Number(product.stock || 0),
      ...previewPrices(product, action)
    }))
  };
}

function applyProductUpdates(updates = []) {
  const applied = [];
  for (const update of updates.slice(0, 500)) {
    const id = Number(update.id);
    if (!Number.isFinite(id)) continue;
    const before = updateProductQuick(id, {
      purchasePrice: Math.max(0, Math.round(Number(update.purchasePrice) || 0)),
      wholesalePrice: Math.max(0, Math.round(Number(update.wholesalePrice) || 0)),
      retailPrice: Math.max(0, Math.round(Number(update.retailPrice) || 0))
    });
    auditLog('assistant.apply', 'product', id, {
      purchasePrice: before.purchasePrice, wholesalePrice: before.wholesalePrice, retailPrice: before.salePrice
    });
    applied.push(id);
  }
  return { updated: applied.length };
}

module.exports = { parseCommand, planCommand, applyProductUpdates };
