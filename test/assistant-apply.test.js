const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  getDatabase,
  getNextProductCode,
  createProduct,
  createCategory,
  setCurrentUser,
  applyProductUpdates
} = require('../src/main/database');

// Note: applyProductUpdates is exported from assistant module; require it directly
const { applyProductUpdates: assistantApply } = require('../src/main/ai/assistant');

function openTestDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accletron-db-'));
  const db = getDatabase(dir);
  // ensure admin user is current
  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (admin) setCurrentUser(admin.id);
  return { dir, db };
}

test('assistant.apply logs before and after product prices', () => {
  const { dir, db } = openTestDatabase();
  try {
    // create a category then a product
    const category = createCategory({ name: 'تست', code: '900' });
    const product = createProduct({ name: 'قلم تستی', categoryId: Number(category.id), purchasePrice: 100000, wholesalePrice: 120000, retailPrice: 130000, stock: 5 });

    // Apply an assistant update
    const result = assistantApply([{ id: product.id, purchasePrice: 110000, wholesalePrice: 125000, retailPrice: 135000 }]);
    assert.equal(result.updated, 1);

    // Read last audit log entry for assistant.apply
    const row = db.prepare("SELECT details FROM audit_logs WHERE action = ? ORDER BY id DESC LIMIT 1").get('assistant.apply');
    assert.ok(row && row.details, 'audit log not created');
    const details = JSON.parse(row.details);
    assert.ok(details.before, 'before not recorded');
    assert.ok(details.after, 'after not recorded');
    assert.equal(details.before.purchasePrice, 100000);
    assert.equal(details.after.purchasePrice, 110000);
  } finally {
    // clean up
    if (db) db.close && db.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
