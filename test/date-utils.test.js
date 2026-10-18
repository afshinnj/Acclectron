const test = require('node:test');
const assert = require('node:assert/strict');
test('formats the local calendar date without converting through UTC', async () => {
  const { localDateIso } = await import('../src/renderer/shared/date-utils.mjs');
  const localMidnight = {
    getFullYear: () => 2026,
    getMonth: () => 9,
    getDate: () => 19
  };

  assert.equal(localDateIso(localMidnight), '2026-10-19');
});
