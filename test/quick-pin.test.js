const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  getDatabase,
  closeDatabase,
  loginUser,
  logoutUser,
  setQuickPin,
  clearQuickPin,
  getQuickPinStatus,
  unlockWithQuickPin
} = require('../src/main/database');

test('sets, unlocks and clears a hashed Quick PIN', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accletron-pin-'));
  try {
    getDatabase(directory);
    loginUser('admin', 'admin123');
    assert.equal(getQuickPinStatus().enabled, false);
    assert.deepEqual(setQuickPin('2468', 'admin123'), { enabled: true });
    assert.equal(getQuickPinStatus().enabled, true);
    assert.throws(() => unlockWithQuickPin('0000'), /PIN نادرست/);
    assert.equal(unlockWithQuickPin('2468').username, 'admin');
    assert.deepEqual(clearQuickPin('admin123'), { enabled: false });
    assert.equal(getQuickPinStatus().enabled, false);
    logoutUser();
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('locks Quick PIN after five failed attempts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accletron-pin-lock-'));
  try {
    getDatabase(directory);
    loginUser('admin', 'admin123');
    setQuickPin('1357', 'admin123');
    for (let attempt = 0; attempt < 5; attempt += 1) assert.throws(() => unlockWithQuickPin('0000'));
    assert.ok(getQuickPinStatus().lockedUntil > Date.now());
    assert.throws(() => unlockWithQuickPin('1357'), /موقتاً قفل/);
    logoutUser();
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
