const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planCommand } = require('../src/main/ai/assistant');
const { tryAnswerQuestion, resolveFollowUp } = require('../src/main/ai/qa');
const { getDatabase, closeDatabase } = require('../src/main/database');

// Statistical questions must read from the same database the listing flow uses.
// The callback is awaited so closeDatabase() in finally does not yank the DB
// out from under a still-pending async assertion.
async function withDatabase(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-qa-'));
  const db = getDatabase(directory);
  db.prepare('INSERT INTO products (code, name, sale_price, purchase_price, stock, minimum_stock) VALUES (?, ?, ?, ?, ?, ?)')
    .run('A1', 'پمپ تخلیه لباسشویی', 100000, 80000, 2, 5);
  db.prepare('INSERT INTO products (code, name, sale_price, purchase_price, stock, minimum_stock) VALUES (?, ?, ?, ?, ?, ?)')
    .run('A2', 'پروانه لباسشویی', 50000, 35000, 10, 2);
  db.prepare('INSERT INTO products (code, name, sale_price, purchase_price, stock, minimum_stock) VALUES (?, ?, ?, ?, ?, ?)')
    .run('A3', 'تایمر پاکشوما', 0, 0, 0, 1);
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('currencyInputUnit', ?)").run('toman');
  try {
    return await callback(db);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('answers a product-count question instead of erroring out', () => withDatabase(() => {
  const plan = tryAnswerQuestion('تعداد محصولات را بهم بگو', { type: 'list' });
  assert.equal(plan.action.type, 'answer');
  assert.equal(plan.action.kind, 'productCount');
  assert.ok(plan.answer.text.includes('۳'), `answer should name the count in Persian digits: ${plan.answer.text}`);
}));

test('answers several phrasings of the same aggregate question', () => withDatabase(() => {
  for (const phrase of ['چند کالا دارم؟', 'تعداد اجناس چنده', 'چند تا محصول داریم']) {
    const plan = tryAnswerQuestion(phrase, { type: 'list' });
    assert.equal(plan?.action?.type, 'answer', `should answer: ${phrase}`);
  }
}));

test('reports low-stock and out-of-stock items with a supporting list', () => withDatabase(() => {
  const low = tryAnswerQuestion('کالاهای کم موجودی کدوم‌ن؟', { type: 'list' });
  assert.equal(low.action.kind, 'lowStock');
  // پمپ (2 <= 5) and تایمر (0 <= 1) are both at or below their minimum.
  assert.equal(low.products.length, 2);
  assert.ok(low.answer.text.includes('پمپ تخلیه لباسشویی'));

  const out = tryAnswerQuestion('کالاهای ناموجود رو نشون بده', { type: 'list' });
  assert.equal(out.action.kind, 'outOfStock');
  assert.equal(out.products.length, 1);
  assert.equal(out.products[0].code, 'A3');
}));

test('questions do not leak into the product listing flow', () => withDatabase(() => {
  // A real product phrase survives intent stripping, so this stays a listing.
  const plan = tryAnswerQuestion('تعداد محصولات لباسشویی را نشان بده', { type: 'list' });
  assert.equal(plan, null);
}));

test('adjust commands are never intercepted as questions', () => withDatabase(() => {
  const plan = tryAnswerQuestion('فروش کالاهای لباسشویی را نشان بده و 20 درصد اضافه کن', { type: 'adjust' });
  assert.equal(plan, null);
}));

test('unknown small talk falls through to the listing flow', () => withDatabase(() => {
  assert.equal(tryAnswerQuestion('سیم مفتالی را لیست کن', { type: 'list' }), null);
}));

test('planCommand returns the answer plan end to end', () => withDatabase(async () => {
  const plan = await planCommand('فروش امروز چقدر بود؟', [], []);
  assert.equal(plan.action.type, 'answer');
  assert.equal(plan.matchMode, 'qa');
  assert.equal(plan.products.length, 0);
}));

test('inventory value formats in the configured currency', () => withDatabase(() => {
  const plan = tryAnswerQuestion('ارزش انبارم چقدره؟', { type: 'list' });
  assert.equal(plan.action.kind, 'inventoryValue');
  // Sum of stock * purchase_price: (2*80000) + (10*35000) + (0*0) hundredths of a toman.
  assert.ok(plan.answer.text.includes('۵٬۱۰۰'), `got: ${plan.answer.text}`);
}));

test('answers the new sales and party questions', () => withDatabase(() => {
  assert.equal(tryAnswerQuestion('فروش این هفته چطور بود؟', { type: 'list' }).action.kind, 'salesWeek');
  assert.equal(tryAnswerQuestion('سود امروز چقدره؟', { type: 'list' }).action.kind, 'profitToday');
  assert.equal(tryAnswerQuestion('چند مشتری دارم؟', { type: 'list' }).action.kind, 'partyCount');
  assert.equal(tryAnswerQuestion('بیشترین بدهکار کیه؟', { type: 'list' }).action.kind, 'topDebtors');
  assert.equal(tryAnswerQuestion('کالاهای قیمت ناقص کدوم‌ن؟', { type: 'list' }).action.kind, 'noPrice');
}));

test('the help intent lists capabilities', () => withDatabase(() => {
  const plan = tryAnswerQuestion('چه کارایی می‌تونی بکنی؟', { type: 'list' });
  assert.equal(plan.action.kind, 'help');
  assert.ok(plan.answer.text.includes('تعداد محصولات'));
}));

test('a follow-up re-asks the previous sales question for another window', () => withDatabase(() => {
  assert.equal(tryAnswerQuestion('و دیروز؟', { type: 'list' }, { lastKind: 'salesToday' }).action.kind, 'salesYesterday');
  assert.equal(tryAnswerQuestion('این هفته', { type: 'list' }, { lastKind: 'salesToday' }).action.kind, 'salesWeek');
  assert.equal(tryAnswerQuestion('سودش چطور بود؟', { type: 'list' }, { lastKind: 'salesMonth' }).action.kind, 'profitMonth');
  // Without a prior question there is nothing to follow up on.
  assert.equal(tryAnswerQuestion('و دیروز؟', { type: 'list' }), null);
}));

test('a countable question narrowed to a product filter reports the subset', () => withDatabase(async () => {
  const plan = await planCommand('تعداد محصولات لباسشویی چنده؟', [], []);
  assert.equal(plan.action.type, 'answer');
  assert.equal(plan.products.length, 2);
  assert.ok(plan.answer.text.includes('۲ کالا'), `got: ${plan.answer.text}`);
}));

test('a count over a filter sums the matched stock and value', () => withDatabase(async () => {
  const units = await planCommand('موجودی محصولات لباسشویی چقدره؟', [], []);
  assert.ok(units.answer.text.includes('۱۲'), `got: ${units.answer.text}`);
  const value = await planCommand('ارزش محصولات لباسشویی چقدره؟', [], []);
  // (2*80000) + (10*35000) hundredths of a toman = 510000 = 5,100 toman.
  assert.ok(value.answer.text.includes('۵٬۱۰۰'), `got: ${value.answer.text}`);
}));

test('top debtors lists parties with a positive balance', () => withDatabase((db) => {
  // createParty does not store a balance; it is derived from the ledger, so
  // seed the balance column directly as an invoice with an unpaid remainder would.
  db.prepare('INSERT INTO parties (code, first_name, last_name, party_type, balance, is_active) VALUES (?, ?, ?, ?, ?, ?)')
    .run('C1', 'بدهکار', 'تستی', 'customer', 2500000, 1);
  const plan = tryAnswerQuestion('بیشترین بدهکار کیه؟', { type: 'list' });
  assert.equal(plan.action.kind, 'topDebtors');
  assert.ok(plan.answer.text.includes('بدهکار'), `got: ${plan.answer.text}`);
  assert.ok(plan.answer.text.includes('۲۵٬۰۰۰'), `got: ${plan.answer.text}`);
}));
