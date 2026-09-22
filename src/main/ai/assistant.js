// Offline text-command assistant: parses Persian instructions like
// "لیست پروانه‌های لباسشویی را لیست کن و ۲۰ درصد به مبلغ خرید اضافه کن"
// into a structured plan (product selection + optional price adjustment),
// previewable and editable before anything is written to the database.
const { normalizeProductText, rankProductsBySimilarity } = require('./semantic');
const { listProducts, getProduct, updateProductQuick, auditLog, requireDatabase, runInTransaction } = require('../database');

const safeParse = (text) => {
  try { return JSON.parse(text || '{}') || {}; } catch { return {}; }
};

const STOPWORDS = new Set(['لیست', 'کن', 'کنید', 'بده', 'بدهید', 'انجام', 'نمایید', 'را', 'به', 'رو', 'از', 'و', 'یا', 'در', 'روی', 'با', 'این', 'آن', 'هم', 'که', 'تا', 'برای', 'برام', 'برایم', 'من', 'شو', 'نشان', 'نشون', 'نمایش', 'ببینم', 'بیار', 'مبلغ', 'قیمت', 'قیمتها', 'قیمت‌ها', 'خرید', 'عمده', 'فروش', 'اضافه', 'افزایش', 'افزایشبده', 'کاهش', 'کم', 'زیاد', 'بیشتر', 'های', 'هایی', 'ها', 'نمایش', 'نشون', 'ده', 'است', 'همه', 'تمام', 'دسته', 'بندی', 'دسته‌بندی', 'گروه', 'نوع', 'کالا', 'کالاها', 'محصول', 'محصولات', 'درصد', 'درصدی', 'تومان', 'ریال', 'خروجی', 'بگیر', 'اکسل', 'csv', 'excel', 'شد', 'شود', 'شون']);

const normalizeCommandText = (value) => normalizeProductText(value)
  .replace(/[\u06F0-\u06F9]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  .replace(/[\u0660-\u0669]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  // Frequent typing slips for لباسشویی (ششویی/شسویی/لباسشوی) would otherwise miss every product.
  .replace(/شسویی|ششویی/g, 'شویی')
  .replace(/لباسشوی(?!ی)/g, 'لباسشویی');

const COLUMN_KEYWORDS = { 'نام': 'name', 'اسم': 'name', 'کد': 'code', 'دسته': 'category', 'بندی': 'category', 'تعداد': 'stock', 'موجودی': 'stock', 'انبار': 'stock', 'بارکد': 'barcode', 'واحد': 'unit', 'قیمت': 'price', 'مبلغ': 'price', 'قیمتها': 'price' };
const DISPLAY_VERB = /(نشان|نشون|نمایش|ببینم|بیار)/;
const DEFAULT_COLUMNS = ['code', 'name', 'category', 'stock', 'purchasePrice', 'wholesalePrice', 'retailPrice'];
const FIELD_COLUMNS = { purchase: 'purchasePrice', wholesale: 'wholesalePrice', retail: 'retailPrice' };

function parseCommand(rawText, { allowEmptySelection = false } = {}) {
  const text = normalizeCommandText(rawText);
  const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*درصد/);
  const percent = percentMatch ? Number(percentMatch[1]) : 0;
  const increase = /(اضافه|افزایش|زیاد|بیشتر)/.test(text);
  const decrease = /(کم|کاهش|تخفیف)/.test(text);
  const direction = increase ? 1 : decrease ? -1 : 0;
  const field = /عمده/.test(text) ? 'wholesale' : /خرید/.test(text) ? 'purchase' : /فروش/.test(text) ? 'retail' : 'purchase';
  const rawTokens = text.replace(/(\d+(?:\.\d+)?)\s*درصد/g, ' ').split(/\s+/).filter(Boolean);
  const wantsColumns = DISPLAY_VERB.test(text);
  const columns = [];
  const selectionTokens = [];
  for (let index = 0; index < rawTokens.length; index += 1) {
    const token = rawTokens[index];
    if (wantsColumns && COLUMN_KEYWORDS[token]) {
      if (COLUMN_KEYWORDS[token] === 'price') {
        const next = rawTokens[index + 1] || '';
        if (next === 'خرید') { columns.push('purchasePrice'); index += 1; }
        else if (next === 'عمده') { columns.push('wholesalePrice'); index += 1; }
        else if (next === 'فروش') { columns.push('retailPrice'); index += 1; }
        else columns.push('purchasePrice', 'wholesalePrice', 'retailPrice');
      } else {
        columns.push(COLUMN_KEYWORDS[token]);
      }
      continue;
    }
    if (STOPWORDS.has(token) || /^\d+(\.\d+)?$/.test(token)) continue;
    selectionTokens.push(token);
  }
  const action = percent > 0 && direction !== 0
    ? { type: 'adjust', field, percent, direction }
    : { type: 'list' };
  // The adjusted price must stay visible/editable even if not requested.
  if (action.type === 'adjust' && !columns.includes(FIELD_COLUMNS[action.field])) columns.push(FIELD_COLUMNS[action.field]);
  const selectionPhrase = selectionTokens.join(' ').trim();
  const displayColumns = columns.length ? columns.filter((column, index) => columns.indexOf(column) === index) : DEFAULT_COLUMNS;
  if (action.type === 'adjust' && !displayColumns.includes(FIELD_COLUMNS[action.field])) displayColumns.push(FIELD_COLUMNS[action.field]);
  if (!selectionPhrase && !allowEmptySelection) {
    const error = new Error('نام یا نوع کالاهای موردنظر را در جمله بنویسید؛ مثال: «لیست پروانه‌های لباسشویی و ۲۰ درصد به قیمت خرید اضافه کن».');
    error.code = 'EMPTY_SELECTION';
    throw error;
  }
  return { action, selectionPhrase, columns: displayColumns };
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
  // Margin guard: flag any outcome where the selling price falls below cost.
  const finalPurchase = next.newPurchasePrice;
  next.marginPercent = finalPurchase > 0
    ? Math.round(((next.newRetailPrice - finalPurchase) / finalPurchase) * 10000) / 100
    : null;
  next.belowCost = finalPurchase > 0 && next.newRetailPrice < finalPurchase;
  return next;
}

async function planCommand(rawText, modelRoots = [], previousProductIds = []) {
  const { action, selectionPhrase, columns } = parseCommand(rawText, { allowEmptySelection: true });
  const all = listProducts('', '');
  const buildPlan = (products, matchMode) => ({
    action,
    selectionPhrase,
    columns: action.type === 'adjust' && !columns.includes('margin') ? [...columns, 'margin'] : columns,
    matchMode,
    products: products.slice(0, 200).map((product) => ({
      id: Number(product.id),
      code: product.code,
      name: product.name,
      categoryName: product.categoryName || '',
      unitSymbol: product.unitSymbol || product.unitName || '',
      stock: Number(product.stock || 0),
      ...previewPrices(product, action)
    }))
  });
  // Conversational continuation: a follow-up like «۵۰ درصد به قیمت فروش اضافه کن»
  // with no product phrase applies to the previous command's selection.
  if (!selectionPhrase) {
    const idSet = new Set((previousProductIds || []).map(Number));
    const continued = all.filter((product) => idSet.has(Number(product.id)));
    if (action.type === 'adjust' && continued.length) return buildPlan(continued, 'continued');
    throw new Error('ابتدا کالاها را با یک جمله مثل «لیست پمپ تخلیه لباسشویی» فهرست کنید؛ بعد می‌توانید فقط بگویید «۵۰ درصد به قیمت فروش اضافه کن».');
  }
  const tokens = selectionPhrase.split(/\s+/).filter(Boolean);
  let matchMode = 'keyword';
  const haystackOf = (product) => normalizeCommandText(
    [product.name, product.code, product.barcode, product.categoryName].filter(Boolean).join(' ')
  );
  const matchCount = (product, haystack) => tokens.reduce((count, token) => count + (haystack.includes(token) ? 1 : 0), 0);
  // Precision first (every token present), then a 60%-of-tokens fallback so a
  // single extra word in the request cannot zero out the results.
  let matched = all.filter((product) => matchCount(product, haystackOf(product)) === tokens.length);
  if (!matched.length && tokens.length > 1) {
    const minimum = Math.max(1, Math.ceil(tokens.length * 0.6));
    matched = all
      .map((product) => ({ product, hits: matchCount(product, haystackOf(product)) }))
      .filter((entry) => entry.hits >= minimum)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 100)
      .map((entry) => entry.product);
    if (matched.length) matchMode = 'partial';
  }
  if (!matched.length && modelRoots.length) {
    try {
      const ranked = await rankProductsBySimilarity(selectionPhrase, all, modelRoots);
      matched = ranked.filter((row) => row.score >= 0.45).slice(0, 100)
        .map((row) => all.find((product) => Number(product.id) === Number(row.id)))
        .filter(Boolean);
      if (matched.length) matchMode = 'semantic';
    } catch {
      // Semantic model unavailable: fall through with an empty keyword match.
    }
  }
  return buildPlan(matched, matchMode);
}

function applyProductUpdates(updates = []) {
  const batch = Date.now();
  // One atomic transaction: either every row updates or none does.
  const applied = runInTransaction(() => {
    const ids = [];
    for (const update of updates.slice(0, 500)) {
      const id = Number(update.id);
      if (!Number.isFinite(id)) continue;
      const payload = {};
      for (const key of ['purchasePrice', 'wholesalePrice', 'retailPrice']) {
        if (update[key] !== undefined && update[key] !== null) {
          payload[key] = Math.max(0, Math.round(Number(update[key]) || 0));
        }
      }
      const before = getProduct(id);
      const after = updateProductQuick(id, payload);
      auditLog('assistant.apply', 'product', id, {
        batch,
        before: {
          purchasePrice: before.purchasePrice, wholesalePrice: before.wholesalePrice, retailPrice: before.retailPrice ?? before.salePrice
        },
        after: {
          purchasePrice: after.purchasePrice, wholesalePrice: after.wholesalePrice, retailPrice: after.retailPrice ?? after.salePrice
        }
      });
      ids.push(id);
    }
    return ids;
  });
  return { updated: applied.length, batch };
}

// Restores the "before" prices of the most recent assistant batch, using the
// audit trail written by applyProductUpdates.
function undoLastAssistantApply() {
  const db = requireDatabase();
  const rows = db.prepare("SELECT entity_id AS entityId, details FROM audit_logs WHERE action = 'assistant.apply' ORDER BY id DESC LIMIT 500").all();
  let batch = null;
  for (const row of rows) {
    const details = safeParse(row.details);
    if (details.batch) { batch = details.batch; break; }
  }
  if (!batch) throw new Error('عملیات قابل واگردانی برای دستیار هوشمند پیدا نشد.');
  const targets = rows
    .map((row) => ({ entityId: Number(row.entityId), details: safeParse(row.details) }))
    .filter((row) => row.details.batch === batch && row.details.before);
  if (!targets.length) throw new Error('اطلاعات قیمت‌های قبلی برای واگردانی موجود نیست.');
  const undone = runInTransaction(() => {
    let count = 0;
    for (const target of targets) {
      updateProductQuick(target.entityId, target.details.before);
      auditLog('assistant.undo', 'product', target.entityId, { batch: target.details.batch, restored: target.details.before });
      count += 1;
    }
    return count;
  });
  return { undone };
}

module.exports = { parseCommand, planCommand, applyProductUpdates, undoLastAssistantApply };
