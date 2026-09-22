const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseCommand, planCommand, applyProductUpdates, undoLastAssistantApply } = require('../src/main/ai/assistant');
const { getDatabase, closeDatabase } = require('../src/main/database');
const { dotProduct, normalizeProductText, aiStatus } = require('../src/main/ai/semantic');

test('parses a Persian price-adjustment command with selection phrase', () => {
  const plan = parseCommand('لیست پروانه های لباسشویی را لیست کن و 20 درصد به مبلغ خرید اضافه کن');
  assert.equal(plan.action.type, 'adjust');
  assert.equal(plan.action.field, 'purchase');
  assert.equal(plan.action.percent, 20);
  assert.equal(plan.action.direction, 1);
  assert.ok(plan.selectionPhrase.includes('پروانه'));
  assert.ok(plan.selectionPhrase.includes('لباسشویی'));
});

test('parses Persian digits, wholesale field and reductions', () => {
  const plan = parseCommand('قیمت عمده سیم های مفتالی را ۱۵ درصد کم کن');
  assert.equal(plan.action.type, 'adjust');
  assert.equal(plan.action.field, 'wholesale');
  assert.equal(plan.action.percent, 15);
  assert.equal(plan.action.direction, -1);
  assert.ok(plan.selectionPhrase.includes('مفتالی'));
});

test('parses a list-only command', () => {
  const plan = parseCommand('لیست تایمرهای پاکشوما');
  assert.equal(plan.action.type, 'list');
  assert.ok(plan.selectionPhrase.includes('تایمرهای'));
});

test('rejects a command without any product phrase', () => {
  assert.throws(() => parseCommand('20 درصد اضافه کن'), /نام یا نوع کالاهای موردنظر/);
});

test('semantic helpers stay pure and offline-safe', () => {
  assert.equal(dotProduct([1, 0], [1, 1]), 1);
  assert.equal(normalizeProductText('ABC'), 'abc');
  assert.equal(normalizeProductText('ي'), 'ی');
  assert.equal(aiStatus(['Z:/definitely-missing']).available, false);
});

test('extracts requested display columns and keeps them out of the selection', () => {
  const plan = parseCommand('پمپ تخلیه لباسشوی ها را لیست کن و 10 درصد رو قیمت خرید اضافه کن و نام محصول تعداد موجودی و قیمت را نشان بده');
  assert.equal(plan.action.type, 'adjust');
  assert.equal(plan.action.field, 'purchase');
  assert.equal(plan.action.percent, 10);
  assert.ok(plan.selectionPhrase.includes('پمپ'));
  assert.ok(plan.selectionPhrase.includes('لباسشویی'));
  assert.ok(plan.columns.includes('name'));
  assert.ok(plan.columns.includes('stock'));
  assert.ok(plan.columns.includes('purchasePrice'));
  assert.ok(plan.columns.includes('retailPrice'));
});

test('adjust command without a product phrase continues the previous selection', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-plan-'));
  const db = getDatabase(directory);
  try {
    db.prepare('INSERT INTO products (code, name, sale_price, purchase_price, stock) VALUES (?, ?, ?, ?, ?)')
      .run('A1', 'پمپ تخلیه لباسشویی', 100000, 80000, 3);
    const first = await planCommand('پمپ تخلیه لباسشویی را لیست کن', []);
    assert.equal(first.products.length, 1);
    const second = await planCommand('50 درصد به قیمت فروش اضافه کن', [], first.products.map((p) => p.id));
    assert.equal(second.matchMode, 'continued');
    assert.equal(second.products.length, 1);
    assert.equal(second.products[0].newRetailPrice, 150000);
    assert.ok(second.columns.includes('retailPrice'));
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('assistant apply is transactional, undoable and flags below-cost pricing', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-apply-'));
  const db = getDatabase(directory);
  try {
    db.prepare('INSERT INTO products (code, name, sale_price, purchase_price, stock) VALUES (?, ?, ?, ?, ?)')
      .run('A1', 'پمپ تخلیه لباسشویی', 100000, 80000, 3);
    const plan = await planCommand('50 درصد به قیمت فروش اضافه کن', [], [1]);
    assert.equal(plan.products[0].newRetailPrice, 150000);
    assert.equal(plan.products[0].belowCost, false);
    assert.ok(plan.products[0].marginPercent > 0);
    assert.ok(plan.columns.includes('margin'));

    const result = applyProductUpdates([{ id: 1, purchasePrice: 80000, wholesalePrice: 90000, retailPrice: 150000 }]);
    assert.equal(result.updated, 1);
    assert.equal(db.prepare('SELECT retail_price FROM products WHERE id = 1').get().retail_price, 150000);

    const undo = undoLastAssistantApply();
    assert.equal(undo.undone, 1);
    assert.equal(db.prepare('SELECT retail_price FROM products WHERE id = 1').get().retail_price, 100000);

    const risky = await planCommand('60 درصد از قیمت فروش کم کن', [], [1]);
    assert.equal(risky.products[0].belowCost, true);
    assert.ok(risky.products[0].marginPercent < 0);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
