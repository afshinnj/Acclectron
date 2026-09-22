const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizePersianText, normalizeProductRows, parseXlsxFile } = require('../src/main/importer');

test('normalizes Persian and Arabic letter forms and stray whitespace', () => {
  assert.equal(normalizePersianText('قيمت  خريد'), 'قیمت خرید');
  assert.equal(normalizePersianText('نیم\u200Cفاصله'), 'نیم فاصله');
  assert.equal(normalizePersianText('  متن  '), 'متن');
});

test('normalizes product rows with Persian digits and Arabic letter forms', () => {
  const rows = [
    { A: 'گروه اصلی', B: 'نام کالا', C: 'تعداد بدهکار', D: 'قيمت خريد', E: 'قيمت فروش عمده', F: 'قيمت فروش' },
    { A: 'لباسشویی', B: 'پمپ تخلیه', C: '۱۰', D: '۵۰۰,۰۰۰', E: '600000', F: '۷۰۰۰۰۰' }
  ];
  const result = normalizeProductRows(rows);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].category, 'لباسشویی');
  assert.equal(result.rows[0].stock, 10);
  assert.equal(result.rows[0].purchasePrice, 500000);
  assert.equal(result.rows[0].wholesalePrice, 600000);
  assert.equal(result.rows[0].retailPrice, 700000);
});

test('collects row-level errors for empty categories and invalid numbers', () => {
  const rows = [
    { A: 'گروه اصلی', B: 'نام کالا', C: 'تعداد بدهکار', D: 'قيمت خريد', E: 'قيمت فروش عمده', F: 'قيمت فروش' },
    { A: '', B: 'بی‌دسته', C: '1', D: '1', E: '1', F: '1' },
    { A: 'گروه', B: 'منفی', C: '-2', D: '1', E: '1', F: '1' }
  ];
  const result = normalizeProductRows(rows);
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.errors.map((error) => error.row).sort(), [2, 3]);
});

test('throws when required columns are missing', () => {
  assert.throws(() => normalizeProductRows([{ A: 'نام کالا' }]), /ضروری پیدا نشدند/);
});

test('rejects missing files, wrong extensions and broken workbooks', async () => {
  await assert.rejects(() => parseXlsxFile(''), /پیدا نشد/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accletron-importer-'));
  try {
    const xlsPath = path.join(dir, 'old.xls');
    fs.writeFileSync(xlsPath, 'old format');
    await assert.rejects(() => parseXlsxFile(xlsPath), /پسوند xlsx/);
    const brokenPath = path.join(dir, 'broken.xlsx');
    fs.writeFileSync(brokenPath, 'definitely not a zip archive');
    await assert.rejects(() => parseXlsxFile(brokenPath));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
