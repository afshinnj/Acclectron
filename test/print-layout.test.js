const test = require('node:test');
const assert = require('node:assert/strict');
const { getPrintOptions, getPdfOptions, resolvePrintLayout } = require('../src/main/print-layout');

test('print copies are bounded integers and invalid input uses one copy', () => {
  for (const [copies, expected] of [['bad', 1], [Infinity, 1], [-5, 1], [2.8, 2], [99, 10]]) {
    assert.equal(getPrintOptions({}, { print: { copies } }).options.copies, expected);
  }
});

test('paper validation rejects unknown keys and bounds thermal height', () => {
  assert.equal(resolvePrintLayout({}, { print: { paperSize: '__proto__' } }).paperSize, 'A4');
  for (const [input, expected] of [[1, 40000], [2000000, 1000000], [123456.1, 123457]]) {
    assert.equal(resolvePrintLayout({}, { print: { paperSize: '58mm' }, contentHeightMicrons: input }).size.height, expected);
  }
});

test('PDF uses numeric margins and inches; thermal paper stays portrait', () => {
  const payload = { print: { paperSize: '80mm', orientation: 'landscape' }, contentHeightMicrons: 120000 };
  const pdf = getPdfOptions({}, payload);
  assert.deepEqual(pdf.margins, { top: 0, bottom: 0, left: 0, right: 0 });
  assert.deepEqual(pdf.pageSize, { width: 80000 / 25400, height: 120000 / 25400 });
  assert.equal(pdf.landscape, false);
  assert.deepEqual(getPrintOptions({}, payload).options.pageSize, { width: 80000, height: 120000 });
});

test('printer selection and settings merge survive layout overrides', () => {
  const { options } = getPrintOptions({ print: { printerName: 'Printer', copies: 2, color: false } }, { print: { paperSize: 'A5', orientation: 'landscape' } });
  assert.equal(options.deviceName, 'Printer');
  assert.equal(options.silent, true);
  assert.equal(options.copies, 2);
  assert.equal(options.color, false);
  assert.equal(options.pageSize, 'A5');
  assert.equal(options.landscape, true);
});
