// Offline question-answering layer for the smart assistant. Detects
// aggregate/statistical questions in natural Persian ("تعداد محصولات چنده؟"،
// "فروش امروز چقدر بود؟") and answers them straight from the local database.
// This complements the command parser in assistant.js, which only understands
// product listing and price adjustment. Everything stays on-device: no
// generative model is involved, so answers to numeric questions are exact.
const { listProducts, listCategories, listParties, getDashboardSummary, getSalesReport } = require('../database');
const { getAppSettings } = require('../db/settings');
const { localDateIso } = require('../domain/dates');
const { normalizeProductText } = require('./semantic');

const faDigits = new Intl.NumberFormat('fa-IR');

// Words that carry no product meaning. Once the aggregate phrase is stripped
// from the question, if only these remain the input is a genuine question;
// if real tokens remain it is a product filter and the listing flow keeps it.
const QUESTION_WORDS = new Set([
  'بگو', 'بگوید', 'بگویید', 'بگوئید', 'چیه', 'چنده', 'چقدر', 'چقدره', 'کی', 'کیه', 'کدوم', 'کدام', 'کجا', 'چطور',
  'است', 'هست', 'هستند', 'هستیم', 'هستم', 'بود', 'بودند', 'بودیم', 'شد', 'شدند', 'شده', 'شدم', 'باشه', 'باشیم',
  'کن', 'کنید', 'کنند', 'کنن', 'بده', 'بدهید', 'بیار', 'ببینم', 'نشان', 'نشون', 'نمایش', 'لیست', 'فهرست', 'جدول',
  'رای', 'را', 'رو', 'به', 'از', 'در', 'روی', 'با', 'و', 'یا', 'تا', 'برای', 'برام', 'برایم', 'بهم',
  'من', 'تو', 'ما', 'شما', 'اون', 'این', 'همه', 'تمام', 'الان', 'خب', 'خوب', 'پس', 'بعدش', 'بعد',
  'دارم', 'داریم', 'داری', 'دارید', 'دامن', 'میشه', 'کنم', 'کنیم', 'سیستم', 'برنامه', 'انجام', 'نمود',
  'قیمت', 'مبلغ', 'تومان', 'ریال', 'درصد', 'تعداد', 'موجودی', 'کالا', 'کالاها', 'محصول', 'محصولات', 'اجناس'
]);

// Order matters: the first pattern to hit wins, so the more specific sales
// windows (دیروز/امروز) precede the generic monthly one. Noun alternations are
// longest-first and end on a word boundary so "محصولات" is not truncated to
// "محصول" and then rejected by the leftover check ("ات" would survive).
const NOT_LETTER = '(?![\\u0621-\\u064A\\u0660-\\u06ED])';
const NOUN_PRODUCT = `(?:کالاها|کالا|محصولات|محصول|اجناس|اقلام)${NOT_LETTER}`;
const NOUN_CATEGORY = `(?:دسته\\s*بندی|دسته|گروه)${NOT_LETTER}`;

const QA_INTENTS = [
  { kind: 'help', re: /(?:چه\s*کار|چه\s*کارهایی|چه\s*قابلیت|کمک|راهنما|چطور\s*استفاده)/ },
  { kind: 'productCount', re: new RegExp(`(?:تعداد|چند(?:\\s*تا)?)\\s*${NOUN_PRODUCT}`) },
  { kind: 'categoryCount', re: new RegExp(`(?:تعداد|چند(?:\\s*تا)?)\\s*${NOUN_CATEGORY}`) },
  { kind: 'lowStock', re: /(?:کالاها?ی?\s*)?(?:کم\s*موجودی|موجودی\s*کم|کمبود\s*موجودی|کمبود)/ },
  { kind: 'outOfStock', re: /(?:کالاها?ی?\s*)?ناموجود/ },
  { kind: 'noPrice', re: /(?:کالاها?ی?\s*)?(?:قیمت\s*ناقص|ناقص\s*قیمت|بدون\s*قیمت)/ },
  { kind: 'inventoryValue', re: new RegExp(`ارزش\\s*(?:انبار|موجودی|${NOUN_PRODUCT})`) },
  { kind: 'inventoryUnits', re: new RegExp(`موجودی\\s*(?:انبار|${NOUN_PRODUCT})`) },
  { kind: 'salesYesterday', re: /فروش\s*دیروز/ },
  { kind: 'salesToday', re: /فروش\s*(?:امروز|الان)/ },
  { kind: 'salesWeek', re: /فروش\s*(?:این\s*هفته|هفته\s*جاری|هفته)/ },
  { kind: 'salesMonth', re: /فروش\s*(?:این\s*ماه|ماه\s*جاری|ماهانه|ماه)/ },
  { kind: 'profitYesterday', re: /سود\s*دیروز/ },
  { kind: 'profitToday', re: /سود\s*(?:امروز|الان)/ },
  { kind: 'profitWeek', re: /سود\s*(?:این\s*هفته|هفته\s*جاری|هفته)/ },
  { kind: 'profitMonth', re: /سود\s*(?:این\s*ماه|ماه\s*جاری|ماهانه|ماه)/ },
  { kind: 'receivables', re: /(?:مطالبات|باقی\s*مانده|طلب\s*باز)/ },
  { kind: 'topDebtors', re: /(?:بیشترین\s*بدهکار|بدهکاران|طلبا\s*کار|طلبکاران)/ },
  { kind: 'partyCount', re: new RegExp(`(?:تعداد|چند(?:\\s*تا)?)\\s*(?:مشتری|مشتریان|طرف\s*حساب|طرفین\s*حساب|تامین\s*کننده|تامین\s*کنندگان|عرضه\s*کننده)${NOT_LETTER}`) },
  { kind: 'topProducts', re: /(?:پرفروش|پر\s*فروش|بیشترین\s*فروش)/ }
];

// Kinds that stay meaningful when narrowed to a product filter ("تعداد محصولات
// لباسشویی چنده؟"); the rest fall through to the listing flow.
const COUNTABLE_KINDS = new Set(['productCount', 'inventoryUnits', 'inventoryValue', 'lowStock', 'outOfStock']);

// A follow-up is a bare time reference with no aggregate noun; it re-asks the
// previous sales/profit question for a different window ("فروش امروز؟" → "و دیروز؟").
const TIME_SHIFTS = {
  'دیروز': 'Yesterday', 'دیروزش': 'Yesterday',
  'امروز': 'Today', 'الان': 'Today',
  'این ماه': 'Month', 'ماه': 'Month', 'ماه جاری': 'Month', 'ماهانه': 'Month',
  'این هفته': 'Week', 'هفته': 'Week', 'هفته جاری': 'Week'
};
const SHIFT_BASE_KINDS = new Set([
  'salesToday', 'salesYesterday', 'salesWeek', 'salesMonth',
  'profitToday', 'profitYesterday', 'profitWeek', 'profitMonth'
]);

const normalizeQaText = (value) => normalizeProductText(value)
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

// Possessive/object clitics attach without a space in written Persian, so
// "انبارم" and "چقدره" surface as single tokens after normalization.
const CLITICS = ['مان', 'تان', 'شان', 'اند', 'اش', 'ام', 'ات', 'م', 'ت', 'ش', 'ن', 'ه', 'ی'];

// A leftover token only counts as a product filter if it could plausibly be one:
// question words, single letters, and clitic-bearing question words do not.
const isQuestionish = (token) => {
  if (!token || token.length <= 1) return true;
  if (QUESTION_WORDS.has(token)) return true;
  return CLITICS.some((clitic) => token.length > clitic.length + 1
    && token.endsWith(clitic)
    && QUESTION_WORDS.has(token.slice(0, -clitic.length)));
};

// Mirrors the renderer's money(): storage is hundredths of a toman, so the
// display unit (rial vs toman) and label come from the saved currency settings.
function formatMoney(cents) {
  const currency = getAppSettings().currency || {};
  const factor = String(currency.inputUnit || 'rial').toLowerCase() === 'rial' ? 10 : 1;
  const value = (Number(cents || 0) / 100) * factor;
  const label = factor === 10 ? 'ریال' : 'تومان';
  const formatted = new Intl.NumberFormat('fa-IR', {
    maximumFractionDigits: Math.max(0, Math.min(4, Number(currency.decimals || 0))),
    useGrouping: currency.separator !== false
  }).format(value);
  return currency.position === 'prefix' ? `${label} ${formatted}` : `${formatted} ${label}`;
}

// Products ride along in the plan shape the renderer already knows, with
// salePrice renamed to the retailPrice key the table expects.
const shapeProduct = (product) => ({
  id: Number(product.id),
  code: product.code,
  name: product.name,
  categoryName: product.categoryName || '',
  unitSymbol: product.unitSymbol || product.unitName || '',
  stock: Number(product.stock || 0),
  purchasePrice: Number(product.purchasePrice || 0),
  wholesalePrice: Number(product.wholesalePrice || 0),
  retailPrice: Number(product.salePrice || 0),
  newPurchasePrice: Number(product.purchasePrice || 0),
  newWholesalePrice: Number(product.wholesalePrice || 0),
  newRetailPrice: Number(product.salePrice || 0)
});

const LIST_COLUMNS = ['code', 'name', 'category', 'stock'];

function buildAnswer(kind) {
  const summary = getDashboardSummary();
  const all = listProducts('', '');
  const active = all.filter((product) => product.isActive !== 0);
  const answer = (text, products = [], columns = LIST_COLUMNS) => ({
    action: { type: 'answer', kind },
    selectionPhrase: '',
    columns,
    matchMode: 'qa',
    products: products.slice(0, 100).map(shapeProduct),
    answer: { kind, text }
  });
  switch (kind) {
    case 'help':
      return answer(
        'از این کارها برمیام:\n'
        + '• شمارش و آمار: «تعداد محصولات چنده؟»، «چند دسته‌بندی دارم؟»، «چند مشتری دارم؟»\n'
        + '• انبار: «موجودی انبار چقدره؟»، «ارزش انبارم چقدره؟»، «کالاهای کم موجودی کدوم‌ن؟»، «کالاهای ناموجود رو نشون بده»، «کالاهای قیمت ناقص»\n'
        + '• فروش و سود: «فروش امروز چقدر بود؟»، «و دیروز؟»، «فروش این هفته»، «سود ماه چقدره؟»، «مطالبات باز چقدره؟»، «بیشترین بدهکار کیه؟»\n'
        + '• پرفروش‌ها: «پرفروش‌ترین کالاها کدوم‌ن؟»\n'
        + '• فیلتر روی یک گروه کالا: «تعداد محصولات لباسشویی چنده؟» یا «ارزش محصولات پاکشوما چقدره؟»\n'
        + '• تغییر قیمت: «پمپ تخلیه لباسشویی را لیست کن و ۱۰ درصد به قیمت خرید اضافه کن»',
        []
      );
    case 'productCount': {
      const categories = listCategories().filter((category) => category.isActive);
      return answer(
        `در سیستم ${faDigits.format(active.length)} کالای فعال ثبت شده‌اید، در ${faDigits.format(categories.length)} دسته‌بندی.`
        + ` مجموع موجودی انبار ${faDigits.format(summary.inventory)} واحد است`
        + (summary.lowStock ? ` و ${faDigits.format(summary.lowStock)} کالا نیازمند تأمین (موجودی کم) هستند.` : ' و هیچ کالایی در حال حاضر کمبود موجودی ندارد.'),
        []
      );
    }
    case 'categoryCount': {
      const categories = listCategories().filter((category) => category.isActive);
      if (!categories.length) return answer('هنوز هیچ دسته‌بندی‌ای تعریف نکرده‌اید.', []);
      const top = categories.slice().sort((a, b) => Number(b.productCount || 0) - Number(a.productCount || 0))[0];
      return answer(
        `تا اکنون ${faDigits.format(categories.length)} دسته‌بندی فعال تعریف کرده‌اید.`
        + ` بیشترین تعداد کالا در دستهٔ «${top.name}» است (${faDigits.format(Number(top.productCount || 0))} کالا).`,
        []
      );
    }
    case 'partyCount': {
      const customers = listParties('', 'customer', false);
      const suppliers = listParties('', 'supplier', false);
      return answer(
        `${faDigits.format(customers.length)} مشتری و ${faDigits.format(suppliers.length)} تامین‌کننده/عرضه‌کننده ثبت شده‌اید.`
        + (summary.topDebtors.length ? ` در حال حاضر ${faDigits.format(summary.topDebtors.length)} طرف‌حساب بدهی دارند.` : ''),
        []
      );
    }
    case 'lowStock': {
      const low = active.filter((product) => Number(product.stock || 0) <= Number(product.minimumStock || 0))
        .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0));
      if (!low.length) return answer('هیچ کالایی در حال حاضر دارای کمبود موجودی نیست.', []);
      const names = low.slice(0, 5).map((product) => `«${product.name}» (${faDigits.format(Number(product.stock || 0))})`).join('، ');
      return answer(
        `${faDigits.format(low.length)} کالا دارای موجودی کم (مساوی یا کمتر از حداقل مجاز) هستند: ${names}`
        + (low.length > 5 ? ` و ${faDigits.format(low.length - 5)} مورد دیگر.` : '.'),
        low, LIST_COLUMNS
      );
    }
    case 'outOfStock': {
      const out = active.filter((product) => Number(product.stock || 0) <= 0);
      if (!out.length) return answer('هیچ کالایی در حال حاضر ناموجود نیست؛ همهٔ کالاها حداقل یک واحد موجودی دارند.', []);
      const names = out.slice(0, 5).map((product) => `«${product.name}»`).join('، ');
      return answer(
        `${faDigits.format(out.length)} کالا ناموجود هستند (موجودی صفر یا منفی): ${names}`
        + (out.length > 5 ? ` و ${faDigits.format(out.length - 5)} مورد دیگر.` : '.'),
        out, LIST_COLUMNS
      );
    }
    case 'noPrice': {
      const incomplete = active.filter((product) => !(Number(product.purchasePrice || 0) > 0)
        || !(Number(product.salePrice || 0) > 0));
      if (!incomplete.length) return answer('همهٔ کالاها قیمت خرید و قیمت فروش دارند؛ کالای ناقصی وجود ندارد.', []);
      const names = incomplete.slice(0, 5).map((product) => `«${product.name}»`).join('، ');
      return answer(
        `${faDigits.format(incomplete.length)} کالا قیمت ناقص دارند (قیمت خرید یا فروش صفر است): ${names}`
        + (incomplete.length > 5 ? ` و ${faDigits.format(incomplete.length - 5)} مورد دیگر.` : '.'),
        incomplete, ['code', 'name', 'purchasePrice', 'retailPrice']
      );
    }
    case 'inventoryValue':
      return answer(
        `ارزش انبار شما به قیمت خرید ${formatMoney(summary.inventoryValue.purchase)}`
        + ` و به قیمت فروش ${formatMoney(summary.inventoryValue.retail)} است`
        + ` (${faDigits.format(active.length)} کالا و ${faDigits.format(summary.inventory)} واحد).`,
        []
      );
    case 'inventoryUnits':
      return answer(
        `در مجموع ${faDigits.format(summary.inventory)} واحد کالا در انبار موجود است، توزیع‌شده روی ${faDigits.format(active.length)} کالا.`
        + (summary.lowStock ? ` ${faDigits.format(summary.lowStock)} کالا در آستانهٔ اتمام هستند.` : ''),
        []
      );
    case 'salesToday':
      return answer(
        `فروش امروز ${formatMoney(summary.todaySales)} از ${faDigits.format(summary.todayCount)} فاکتور بوده است.`
        + (summary.yesterdaySales > 0
          ? ` نسبت به دیروز ${summary.salesChangePct > 0 ? 'افزایش' : 'کاهش'} ${faDigits.format(Math.abs(summary.salesChangePct))}٪ داشته‌اید.`
          : ''),
        []
      );
    case 'salesYesterday':
      return answer(
        summary.yesterdaySales > 0
          ? `فروش دیروز ${formatMoney(summary.yesterdaySales)} بود.`
          : 'دیروز هیچ فروشی ثبت نشده است.',
        []
      );
    case 'salesWeek': {
      const weekTotal = (summary.salesTrend || []).reduce((sum, row) => sum + Number(row.sales || 0), 0);
      const days = (summary.salesTrend || []).length;
      return answer(
        weekTotal > 0
          ? `فروش این هفته (از ${summary.salesTrendStart} تا ${summary.salesTrendEnd}) ${formatMoney(weekTotal)} در ${faDigits.format(days)} روز بوده است.`
          : 'این هفته هنوز فروشی ثبت نشده است.',
        []
      );
    }
    case 'salesMonth':
      return answer(`فروش ماه جاری ${formatMoney(summary.monthSales)} است.`, []);
    case 'profitYesterday':
    case 'profitToday': {
      const date = localDateIso();
      const target = kind === 'profitYesterday' ? new Date(`${date}T00:00:00Z`) : null;
      if (target) target.setUTCDate(target.getUTCDate() - 1);
      const reportDate = target ? target.toISOString().slice(0, 10) : date;
      const report = getSalesReport({ from: reportDate, to: reportDate });
      const label = kind === 'profitYesterday' ? 'دیروز' : 'امروز';
      return answer(
        report.invoiceCount
          ? `سود ${label} ${formatMoney(Number(report.profitTotal || 0))} از ${faDigits.format(report.invoiceCount)} فاکتور بوده است.`
          : `${kind === 'profitYesterday' ? 'دیروز' : 'امروز'} هنوز فروشی ثبت نشده است.`,
        []
      );
    }
    case 'profitWeek': {
      const today = localDateIso();
      const start = new Date(`${today}T00:00:00Z`);
      start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 1) % 7));
      const from = start.toISOString().slice(0, 10);
      const report = getSalesReport({ from, to: today });
      return answer(
        report.invoiceCount
          ? `سود این هفته (از ${from} تا ${today}) ${formatMoney(Number(report.profitTotal || 0))} از ${faDigits.format(report.invoiceCount)} فاکتور بوده است.`
          : 'این هفته هنوز فروشی ثبت نشده است.',
        []
      );
    }
    case 'profitMonth':
      return answer(`سود ماه جاری ${formatMoney(summary.monthProfit)} است.`, []);
    case 'receivables':
      return answer(
        summary.receivables > 0
          ? `مطالبات باز (فاکتورهای تسویه‌نشده) در مجموع ${formatMoney(summary.receivables)} است.`
          : 'در حال حاضر هیچ مطالبات بازِ تسویه‌نشده‌ای وجود ندارد.',
        []
      );
    case 'topDebtors': {
      const top = (summary.topDebtors || []).slice(0, 5);
      if (!top.length) return answer('در حال حاضر هیچ بدهکاری ثبت نشده است؛ همهٔ حساب‌ها تسویه هستند.', []);
      const lines = top.map((row, index) => `${faDigits.format(index + 1)}. ${row.partyName} — ${formatMoney(Number(row.balance || 0))}`);
      return answer(`بزرگ‌ترین بدهکاران:\n${lines.join('\n')}`, []);
    }
    case 'topProducts': {
      const top = (summary.topProducts || []).slice(0, 5);
      if (!top.length) return answer('هنوز فروشی در ماه جاری ثبت نشده است که کالای پرفروشی داشته باشد.', []);
      const lines = top.map((row, index) => `${faDigits.format(index + 1)}. ${row.name} — ${faDigits.format(Number(row.quantity || 0))} عدد فروخته شده (${formatMoney(Number(row.netSales || 0))})`);
      return answer(`پرفروش‌ترین کالاهای ماه جاری:\n${lines.join('\n')}`, []);
    }
    default:
      return null;
  }
}

// Answer a countable question narrowed to an already-matched product set
// ("تعداد محصولات لباسشویی چنده؟"). Called from planCommand after the normal
// keyword/semantic matching pipeline has resolved the filter phrase.
function answerFiltered(kind, products, phrase) {
  const rows = products.filter((product) => product.isActive !== 0);
  const label = phrase ? `برای «${phrase}» ` : '';
  const sum = (selector) => rows.reduce((total, product) => total + selector(product), 0);
  const text = (() => {
    switch (kind) {
      case 'productCount':
        return `${faDigits.format(rows.length)} کالا ${label}پیدا شد.`
          + (rows.length ? ` مجموع موجودی ${faDigits.format(sum((product) => Number(product.stock || 0)))} واحد است.` : '');
      case 'inventoryUnits':
        return `${faDigits.format(sum((product) => Number(product.stock || 0)))} واحد موجودی ${label}ثبت شده است، در ${faDigits.format(rows.length)} کالا.`;
      case 'inventoryValue':
        return `ارزش ${label}به قیمت خرید ${formatMoney(sum((product) => Number(product.stock || 0) * Number(product.purchasePrice || 0)))}`
          + ` و به قیمت فروش ${formatMoney(sum((product) => Number(product.stock || 0) * Number(product.salePrice || 0)))} است`
          + ` (${faDigits.format(rows.length)} کالا).`;
      case 'lowStock': {
        const low = rows.filter((product) => Number(product.stock || 0) <= Number(product.minimumStock || 0));
        return low.length
          ? `${faDigits.format(low.length)} کالا ${label}دارای موجودی کم هستند.`
          : `هیچ کالایی ${label}دارای کمبود موجودی نیست.`;
      }
      case 'outOfStock': {
        const out = rows.filter((product) => Number(product.stock || 0) <= 0);
        return out.length
          ? `${faDigits.format(out.length)} کالا ${label}ناموجود هستند.`
          : `هیچ کالایی ${label}ناموجود نیست.`;
      }
      default:
        return null;
    }
  })();
  if (!text) return null;
  return {
    action: { type: 'answer', kind },
    selectionPhrase: '',
    columns: LIST_COLUMNS,
    matchMode: 'qa',
    products: rows.slice(0, 100).map(shapeProduct),
    answer: { kind, text }
  };
}

// Resolves a bare follow-up ("و دیروز؟") against the previous question's kind.
function resolveFollowUp(text, context = {}) {
  const lastKind = context.lastKind;
  if (!lastKind || !SHIFT_BASE_KINDS.has(lastKind)) return null;
  const cleaned = text.replace(/^و\s*/, '').replace(/[?؟.]/g, '').trim();
  if (!cleaned) return null;
  const words = cleaned.split(/\s+/).filter(Boolean);
  const twoWord = words.slice(0, 2).join(' ');
  const windowName = TIME_SHIFTS[twoWord] || TIME_SHIFTS[words[0]];
  if (windowName) return `${lastKind.startsWith('profit') ? 'profit' : 'sales'}${windowName}`;
  // «سودش چطور بود؟» after a sales question, or «فروشش» after a profit one.
  const requestedMetric = /^سود/.test(cleaned) ? 'profit' : /^فروش/.test(cleaned) ? 'sales' : '';
  if (requestedMetric) {
    const window = lastKind.replace(/^(?:sales|profit)/, '');
    return `${requestedMetric}${window}`;
  }
  return null;
}

// A countable intent only takes the filtered-count path when the sentence
// reads as a question; an explicit display verb ("نشان بده") still lists.
const QUESTION_MARKER = /(?:چنده|چقدر|چطور|کی|کجا|کدوم|هست|بود|شد|بگو|بدهید|کنید|است)/;

// Returns an answer plan, a filter descriptor ({ qaFilter }) for planCommand to
// resolve against matched products, or null when the input is not a question.
function tryAnswerQuestion(rawText, parsedAction, context = {}) {
  if (parsedAction && parsedAction.type === 'adjust') return null;
  const text = normalizeQaText(rawText);
  const intent = QA_INTENTS.find((entry) => entry.re.test(text));
  if (!intent) {
    const followUp = resolveFollowUp(text, context);
    return followUp ? buildAnswer(followUp) : null;
  }
  // The help intent always answers; its remainder is only filler words.
  if (intent.kind === 'help') return buildAnswer('help');
  // Strip the aggregate phrase itself, then whatever meaningful tokens remain
  // signals a product filter rather than a question ("تعداد محصولات لباسشویی
  // را نشان بده" keeps «لباسشویی» and stays a listing request).
  const hasQuestionMark = /[?؟]/.test(text);
  const remainder = text.replace(intent.re, ' ').replace(/[?؟]/g, ' ');
  const leftover = remainder.split(/\s+/).filter((token) => token && !isQuestionish(token));
  if (!leftover.length) return buildAnswer(intent.kind);
  const hasDisplayVerb = /(?:نشان|نشون|نمایش|لیست|فهرست)/.test(remainder);
  if (!COUNTABLE_KINDS.has(intent.kind) || hasDisplayVerb || (!hasQuestionMark && !QUESTION_MARKER.test(remainder))) return null;
  return { qaFilter: { kind: intent.kind, phrase: leftover.join(' ') } };
}

module.exports = { tryAnswerQuestion, answerFiltered, resolveFollowUp, normalizeQaText, QA_INTENTS };
