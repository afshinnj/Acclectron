const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand } = require('../src/main/ai/assistant');
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
