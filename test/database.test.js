const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  closeDatabase,
  createPurchase,
  createParty,
  listParties,
  updateParty,
  setPartyActive,
  searchProducts,
  getDatabase,
  getSalesReport,
  createSale,
  updateSale,
  settleInvoice,
  listPurchases
} = require('../src/main/database');

function openTestDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accletron-db-'));
  return { directory, db: getDatabase(directory) };
}

test('creates the product and purchase foundation with foreign keys and indexes', () => {
  const { directory, db } = openTestDatabase();
  try {
    for (const table of ['products', 'categories', 'units', 'suppliers', 'parties', 'purchases', 'purchase_items', 'stock_movements']) {
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
    }
    const columns = db.prepare('PRAGMA table_info(products)').all().map((column) => column.name);
    for (const column of ['code', 'name', 'category_id', 'purchase_price', 'wholesale_price', 'retail_price', 'unit_id', 'updated_at']) {
      assert.ok(columns.includes(column), `missing products.${column}`);
    }
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_purchase_items_product_id'").get());
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('manages parties with customer, supplier and both roles', () => {
  const { directory } = openTestDatabase();
  try {
    const party = createParty({
      firstName: 'رضا',
      lastName: 'احمدی',
      phone: '021123456',
      mobile: '09120000000',
      address: 'تهران',
      partyType: 'both'
    });
    assert.equal(party.partyType, 'both');
    assert.equal(party.name, 'رضا احمدی');
    assert.equal(listParties('احمدی', 'customer', true).length, 0);
    assert.equal(listParties('احمدی', 'both', true).length, 1);
    const updated = updateParty(party.id, { firstName: 'رضا', lastName: 'کریمی', partyType: 'supplier' });
    assert.equal(updated.partyType, 'supplier');
    setPartyActive(party.id, false);
    assert.equal(listParties('', '', false).some((item) => item.id === party.id), false);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('purchase preserves historical price and updates current product price transactionally', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id, stock FROM products LIMIT 1').get();
    const beforeStock = Number(product.stock);
    const result = createPurchase({
      invoiceNumber: 'P-TEST-001',
      items: [{ productId: product.id, quantity: 3, unitPrice: 123456, discount: 1000 }]
    });
    const item = db.prepare('SELECT unit_price, total FROM purchase_items WHERE purchase_id = ?').get(result.id);
    const current = db.prepare('SELECT purchase_price, stock FROM products WHERE id = ?').get(product.id);
    assert.equal(item.unit_price, 123456);
    assert.equal(current.purchase_price, 123456);
    assert.equal(Number(current.stock), beforeStock + 3);
    assert.throws(
      () => db.prepare('UPDATE purchase_items SET unit_price = 1 WHERE purchase_id = ?').run(result.id),
      /immutable/
    );
    assert.throws(
      () => db.prepare('DELETE FROM purchases WHERE id = ?').run(result.id),
      /cannot be deleted/
    );
    createPurchase({ invoiceNumber: 'P-TEST-002', items: [{ productId: product.id, quantity: 1, unitPrice: 200000 }] });
    assert.equal(db.prepare('SELECT unit_price FROM purchase_items WHERE purchase_id = ?').get(result.id).unit_price, 123456);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('failed purchase rolls back header, items, stock and price changes', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id, stock, purchase_price FROM products LIMIT 1').get();
    assert.throws(() => createPurchase({
      invoiceNumber: 'P-TEST-ROLLBACK',
      items: [
        { productId: product.id, quantity: 1, unitPrice: 99999 },
        { productId: 99999999, quantity: 1, unitPrice: 1 }
      ]
    }), /کالای خرید پیدا نشد/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM purchases WHERE invoice_number = ?').get('P-TEST-ROLLBACK').count, 0);
    assert.equal(db.prepare('SELECT stock, purchase_price FROM products WHERE id = ?').get(product.id).stock, product.stock);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects sales priced below the current purchase price', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id FROM products LIMIT 1').get();
    db.prepare('UPDATE products SET stock = 5, purchase_price = 100000 WHERE id = ?').run(product.id);

    assert.throws(
      () => createSale({
        invoiceNumber: 'S-BELOW-COST',
        items: [{ productId: product.id, quantity: 1, unitPrice: 900 }]
      }),
      /قیمت فروش .* نمی‌تواند کمتر از قیمت خرید باشد/
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM sales WHERE invoice_number = ?').get('S-BELOW-COST').count,
      0
    );
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a sale when duplicate product rows exceed available stock in total', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id FROM products LIMIT 1').get();
    db.prepare('UPDATE products SET stock = 5, purchase_price = 0 WHERE id = ?').run(product.id);

    assert.throws(
      () => createSale({
        invoiceNumber: 'S-DUPLICATE-STOCK',
        items: [
          { productId: product.id, quantity: 3, unitPrice: 1000 },
          { productId: product.id, quantity: 3, unitPrice: 1000 }
        ]
      }),
      /موجودی .* کافی نیست/
    );
    assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id).stock, 5);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sales WHERE invoice_number = 'S-DUPLICATE-STOCK'").get().count, 0);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('editing a sale refreshes its stock movement audit trail', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id FROM products LIMIT 1').get();
    db.prepare('UPDATE products SET stock = 10, purchase_price = 0 WHERE id = ?').run(product.id);
    const sale = createSale({
      invoiceNumber: 'S-EDIT-MOVEMENT',
      date: '2026-09-01',
      items: [{ productId: product.id, quantity: 1, unitPrice: 1000 }]
    });

    updateSale(sale.id, {
      date: '2026-09-01',
      items: [{ productId: product.id, quantity: 2, unitPrice: 1000 }]
    });

    assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id).stock, 8);
    const movements = db.prepare(
      "SELECT quantity FROM stock_movements WHERE type = 'sale' AND reference_type = 'sale' AND reference_id = ?"
    ).all(sale.id).map((row) => ({ ...row }));
    assert.deepEqual(movements, [{ quantity: -2 }]);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('settling a legacy sale updates its customer balance without a party record', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id FROM products LIMIT 1').get();
    const customer = db.prepare(
      'INSERT INTO customers (code, name, balance) VALUES (?, ?, ?)'
    ).run('C-LEGACY-001', 'Legacy Customer', 0);
    db.prepare('UPDATE products SET stock = 5, purchase_price = 0 WHERE id = ?').run(product.id);
    const sale = createSale({
      invoiceNumber: 'S-LEGACY-CUSTOMER',
      customerId: Number(customer.lastInsertRowid),
      items: [{ productId: product.id, quantity: 1, unitPrice: 1000 }]
    });

    settleInvoice('sale', sale.id, { method: 'cash', amount: 400 });

    assert.equal(
      db.prepare('SELECT balance FROM customers WHERE id = ?').get(Number(customer.lastInsertRowid)).balance,
      60000
    );
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('records mixed cash and check payments and calculates remaining balance', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id FROM products LIMIT 1').get();
    const result = createPurchase({
      invoiceNumber: 'P-PAY-001',
      items: [{ productId: product.id, quantity: 1, unitPrice: 100000 }],
      payments: [
        { method: 'cash', amount: 200 },
        { method: 'check', amount: 300, checkNumber: 'CHK-1', bankName: 'Test Bank', dueDate: '2026-09-15' }
      ]
    });
    assert.equal(result.paidAmount, 50000);
    assert.equal(result.remainingAmount, 50000);
    const payments = db.prepare('SELECT method, amount, check_number, due_date FROM invoice_payments WHERE purchase_id = ? ORDER BY id').all(result.id)
      .map((row) => ({ ...row }));
    assert.deepEqual(payments, [
      { method: 'cash', amount: 20000, check_number: null, due_date: null },
      { method: 'check', amount: 30000, check_number: 'CHK-1', due_date: '2026-09-15' }
    ]);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('purchase monetary fields remain in cents like sales records', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id FROM products LIMIT 1').get();
    const result = createPurchase({
      invoiceNumber: 'P-CENTS-001',
      items: [{ productId: product.id, quantity: 2, unitPrice: 125000, discount: 5000 }],
      discount: 10000,
      tax: 2500,
      payments: [{ method: 'cash', amount: 1000 }]
    });
    assert.equal(result.subtotal, 245000);
    assert.equal(result.discount, 10000);
    assert.equal(result.tax, 2500);
    assert.equal(result.total, 237500);
    assert.equal(result.paidAmount, 100000);
    assert.equal(result.remainingAmount, 137500);
    assert.equal(db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(product.id).purchase_price, 125000);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('lists purchases and moves whole inventory units', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id FROM products LIMIT 1').get();
    db.prepare('UPDATE products SET stock = 1 WHERE id = ?').run(product.id);
    createPurchase({
      invoiceNumber: 'P-LIST-001',
      items: [{ productId: product.id, quantity: 1.1, unitPrice: 100000 }]
    });
    assert.equal(Number(db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id).stock), 2);
    const rows = listPurchases({});
    assert.equal(rows.length, 1);
    assert.equal(rows[0].invoiceNumber, 'P-LIST-001');
    assert.equal(rows[0].itemCount, 1);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('sales report combines daily and formal sales with profit and product breakdown', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id FROM products LIMIT 1').get();
    db.prepare('UPDATE products SET stock = 20, purchase_price = 50000 WHERE id = ?').run(product.id);
    createSale({ invoiceNumber: 'S-REPORT-D', source: 'daily', date: '2026-08-30', items: [{ productId: product.id, quantity: 2, unitPrice: 1000 }], paidAmount: 2000 });
    createSale({ invoiceNumber: 'S-REPORT-I', source: 'invoice', date: '2026-08-31', discount: 100, tax: 90, items: [{ productId: product.id, quantity: 1, unitPrice: 1200 }], paidAmount: 0 });
    const report = getSalesReport({ from: '2026-08-30', to: '2026-08-31' });
    assert.equal(report.summary.invoiceCount, 2);
    assert.equal(report.summary.dailyCount, 1);
    assert.equal(report.summary.formalCount, 1);
    assert.equal(report.summary.netSales, 310000);
    assert.equal(report.summary.costTotal, 150000);
    assert.equal(report.summary.profitTotal, 160000);
    assert.equal(report.byDate.length, 2);
    assert.equal(report.byProduct[0].quantity, 3);
    assert.equal(getSalesReport({ source: 'daily' }).summary.invoiceCount, 1);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('searches products by keyword across all products', () => {
  const { directory, db } = openTestDatabase();
  try {
    db.prepare('INSERT INTO products (code, name, retail_price, sale_price, wholesale_price, stock) VALUES (?, ?, ?, ?, ?, ?)')
      .run('P-FAN-1', 'پروانه حایر 10 شیار', 90000, 90000, 80000, 12);
    db.prepare('INSERT INTO products (code, name, retail_price, sale_price, wholesale_price, stock) VALUES (?, ?, ?, ?, ?, ?)')
      .run('P-FAN-2', 'پروانه حایر 12 شیار', 95000, 95000, 85000, 8);
    assert.equal(searchProducts('پروانه').length, 2);
    assert.equal(searchProducts('حایر 10').length, 1);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
