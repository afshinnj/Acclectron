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
  getDashboardSummary,
  createSale,
  updateSale,
  settleInvoice,
  listPurchases,
  createSaleReturn,
  listSalesReturns,
  cancelSaleReturn,
  createPurchaseReturn,
  listPurchaseReturns,
  cancelPurchaseReturn,
  createCashTransaction,
  listCashTransactions,
  getCashSummary,
  getPartyLedger,
  adjustProductStock,
  listStockMovements,
  loginUser,
  getCurrentUser,
  createUser,
  listUsers,
  setUserActive,
  listAuditLogs,
  listNotifications,
  createInstallmentPlan,
  listInstallmentPlans,
  recordInstallmentPayment,
  listChecks,
  updateCheckStatus,
  changeCurrentUserPassword,
  logoutUser,
  getProfitLossReport,
  closeDailyAccount,
  listDailyClosures
} = require('../src/main/database');

function openTestDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accletron-db-'));
  return { directory, db: getDatabase(directory) };
}

test('creates the product and purchase foundation with foreign keys and indexes', () => {
  const { directory, db } = openTestDatabase();
  try {
    for (const table of ['products', 'categories', 'units', 'suppliers', 'parties', 'purchases', 'purchase_items', 'stock_movements', 'sales_returns', 'sales_return_items', 'purchase_returns', 'purchase_return_items', 'cash_transactions']) {
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

test('lists checks and updates their lifecycle status with audit data', () => {
  const { directory } = openTestDatabase();
  try {
    const product = getDatabase(directory).prepare('SELECT id FROM products LIMIT 1').get();
    const result = createPurchase({
      invoiceNumber: 'P-CHECK-LIFECYCLE',
      items: [{ productId: product.id, quantity: 1, unitPrice: 100000 }],
      payments: [{ method: 'check', amount: 1000, checkNumber: 'CHK-LIFE-1', bankName: 'Test Bank', dueDate: '2026-09-05' }]
    });
    const pending = listChecks({ status: 'pending', query: 'CHK-LIFE-1', from: '2026-09-01', to: '2026-09-30' });
    assert.equal(pending.length, 1);
    assert.equal(pending[0].invoiceNumber, 'P-CHECK-LIFECYCLE');
    assert.equal(pending[0].amount, 100000);
    const cleared = updateCheckStatus(pending[0].id, 'cleared', 'وصول در بانک');
    assert.equal(cleared.checkStatus, 'cleared');
    assert.equal(cleared.notes, 'وصول در بانک');
    assert.equal(listChecks({ status: 'pending' }).length, 0);
    assert.equal(listChecks({ status: 'cleared' }).length, 1);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('builds actionable notifications for checks, unpaid invoices and low stock', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id FROM products LIMIT 1').get();
    db.prepare('UPDATE products SET stock = 0, minimum_stock = 2 WHERE id = ?').run(product.id);
    createPurchase({
      invoiceNumber: 'P-NOTIFY-001',
      items: [{ productId: product.id, quantity: 1, unitPrice: 100000 }],
      payments: [{ method: 'check', amount: 200, checkNumber: 'CHK-NOTIFY', dueDate: '2026-09-01' }]
    });
    const result = listNotifications({ today: '2026-09-02', daysAhead: 7 });
    assert.ok(result.counts.total >= 2);
    assert.ok(result.alerts.some((item) => item.type === 'check-overdue' && item.actionPage === 'checks'));
    assert.ok(result.alerts.some((item) => item.type === 'low-stock' && item.actionPage === 'inventory'));
    assert.ok(result.alerts.some((item) => item.type === 'unpaid-invoice' && item.actionPage === 'purchase-invoices'));
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('creates installment plans and allocates payments to invoice balances', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id FROM products LIMIT 1').get();
    createPurchase({ invoiceNumber: 'P-INSTALL-STOCK', items: [{ productId: product.id, quantity: 3, unitPrice: 100000 }], payments: [{ method: 'cash', amount: 3000 }] });
    const sale = createSale({ invoiceNumber: 'S-INSTALL-001', date: '2026-09-02', items: [{ productId: product.id, quantity: 2, unitPrice: 2000 }], paidAmount: 0 });
    const plan = createInstallmentPlan({
      invoiceKind: 'sale',
      invoiceId: sale.id,
      installments: [
        { dueDate: '2026-09-10', amount: 200000 },
        { dueDate: '2026-10-10', amount: 200000 }
      ]
    });
    assert.equal(plan.totalAmount, 400000);
    assert.equal(plan.installments.length, 2);
    const afterFirst = recordInstallmentPayment(plan.installments[0].id, { amount: 100000, method: 'cash' });
    assert.equal(afterFirst.installments[0].status, 'partial');
    assert.equal(afterFirst.installments[0].paidAmount, 100000);
    const afterSecond = recordInstallmentPayment(plan.installments[0].id, { amount: 100000, method: 'card' });
    assert.equal(afterSecond.installments[0].status, 'paid');
    assert.equal(db.prepare('SELECT remaining_amount FROM sales WHERE id = ?').get(sale.id).remaining_amount, 200000);
    assert.equal(listInstallmentPlans({ status: 'active' }).length, 1);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('allows the signed-in user to change and reuse their password', () => {
  const { directory } = openTestDatabase();
  try {
    loginUser('admin', 'admin123');
    assert.equal(changeCurrentUserPassword('admin123', 'newpass123'), true);
    logoutUser();
    assert.throws(() => loginUser('admin', 'admin123'));
    assert.equal(loginUser('admin', 'newpass123').username, 'admin');
  } finally {
    logoutUser();
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

test('dashboard summary exposes management charts and operational lists', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id FROM products LIMIT 1').get();
    createPurchase({ invoiceNumber: 'P-DASH-001', items: [{ productId: product.id, quantity: 3, unitPrice: 1000 }], payments: [{ method: 'cash', amount: 30 }] });
    createSale({ invoiceNumber: 'S-DASH-001', date: new Date().toISOString().slice(0, 10), items: [{ productId: product.id, quantity: 1, unitPrice: 2000 }], paidAmount: 0 });
    const summary = getDashboardSummary();
    assert.ok(Array.isArray(summary.salesTrend));
    assert.ok(Array.isArray(summary.paymentBreakdown));
    assert.ok(Array.isArray(summary.recentSales));
    assert.ok(Array.isArray(summary.topProducts));
    assert.ok(Array.isArray(summary.topDebtors));
    assert.ok(summary.recentSales.some((row) => row.invoiceNumber === 'S-DASH-001'));
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

test('creates, lists and cancels a partial sale return with stock audit', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id FROM products LIMIT 1').get();
    db.prepare('UPDATE products SET stock = 2, purchase_price = 50000 WHERE id = ?').run(product.id);
    const sale = createSale({
      invoiceNumber: 'S-RETURN-001',
      items: [{ productId: product.id, quantity: 2, unitPrice: 1000 }],
      paidAmount: 2000
    });
    assert.equal(Number(db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id).stock), 0);
    const returned = createSaleReturn({
      saleId: sale.id,
      returnNumber: 'R-RETURN-001',
      items: [{ saleItemId: db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id).id, quantity: 1 }],
      refundAmount: 100000,
      method: 'cash',
      reason: 'ایراد کالا'
    });
    assert.equal(returned.total, 100000);
    assert.equal(returned.refund_amount, 100000);
    assert.equal(Number(db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id).stock), 1);
    assert.equal(listSalesReturns({}).length, 1);
    cancelSaleReturn(returned.id);
    assert.equal(Number(db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id).stock), 0);
    assert.equal(db.prepare('SELECT status FROM sales_returns WHERE id = ?').get(returned.id).status, 'cancelled');
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('tracks manual cash transactions and aggregates cash summary', () => {
  const { directory } = openTestDatabase();
  try {
    createCashTransaction({ type: 'expense', category: 'rent', amount: 250000, method: 'cash', date: '2026-09-02', description: 'اجاره' });
    createCashTransaction({ type: 'income', category: 'other', amount: 100000, method: 'bank', date: '2026-09-02', description: 'دریافت متفرقه' });
    const rows = listCashTransactions({ from: '2026-09-02', to: '2026-09-02' });
    assert.equal(rows.length, 2);
    const summary = getCashSummary({ from: '2026-09-02', to: '2026-09-02' });
    assert.equal(summary.manualIncome, 100000);
    assert.equal(summary.manualExpense, 250000);
    assert.equal(summary.balance, -150000);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('creates and cancels a purchase return with stock, supplier balance and refund tracking', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id FROM products LIMIT 1').get();
    const supplier = createParty({ firstName: 'تأمین‌کننده', partyType: 'supplier' });
    db.prepare('UPDATE products SET stock = 0, purchase_price = 50000 WHERE id = ?').run(product.id);
    const purchase = createPurchase({
      invoiceNumber: 'P-RETURN-001',
      partyId: supplier.id,
      items: [{ productId: product.id, quantity: 2, unitPrice: 100000 }],
      payments: []
    });
    assert.equal(Number(db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id).stock), 2);
    assert.equal(Number(db.prepare('SELECT balance FROM parties WHERE id = ?').get(supplier.id).balance), 200000);
    const purchaseItem = db.prepare('SELECT id FROM purchase_items WHERE purchase_id = ?').get(purchase.id);
    const returned = createPurchaseReturn({
      purchaseId: purchase.id,
      returnNumber: 'PR-RETURN-001',
      purchaseItemId: purchaseItem.id,
      items: [{ purchaseItemId: purchaseItem.id, quantity: 1 }],
      refundAmount: 100000,
      method: 'cash'
    });
    assert.equal(returned.total, 100000);
    assert.equal(returned.refund_amount, 100000);
    assert.equal(Number(db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id).stock), 1);
    assert.equal(Number(db.prepare('SELECT balance FROM parties WHERE id = ?').get(supplier.id).balance), 100000);
    assert.equal(listPurchaseReturns({}).length, 1);
    cancelPurchaseReturn(returned.id);
    assert.equal(Number(db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id).stock), 2);
    assert.equal(Number(db.prepare('SELECT balance FROM parties WHERE id = ?').get(supplier.id).balance), 200000);
    assert.equal(db.prepare('SELECT status FROM purchase_returns WHERE id = ?').get(returned.id).status, 'cancelled');
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('builds a complete party ledger from sales, purchases and payments', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id FROM products LIMIT 1').get();
    const party = createParty({ firstName: 'طرف حساب', partyType: 'both' });
    db.prepare('UPDATE products SET stock = 10, purchase_price = 0 WHERE id = ?').run(product.id);
    createSale({
      invoiceNumber: 'S-LEDGER-001',
      partyId: party.id,
      date: '2026-09-01',
      items: [{ productId: product.id, quantity: 1, unitPrice: 1000 }],
      paidAmount: 500
    });
    createPurchase({
      invoiceNumber: 'P-LEDGER-001',
      partyId: party.id,
      date: '2026-09-02',
      items: [{ productId: product.id, quantity: 1, unitPrice: 2000 }]
    });
    const ledger = getPartyLedger(party.id, { from: '2026-09-01', to: '2026-09-02' });
    assert.equal(ledger.debit, 100000);
    assert.equal(ledger.credit, 52000);
    assert.equal(ledger.closingBalance, 48000);
    assert.equal(ledger.events.length, 3);
    assert.deepEqual(ledger.events.map((event) => event.kind), ['sale', 'payment', 'purchase']);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('adjusts counted stock and records an auditable movement', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id FROM products LIMIT 1').get();
    db.prepare('UPDATE products SET stock = 5 WHERE id = ?').run(product.id);
    adjustProductStock(product.id, { stock: 2, reason: 'کسری انبار' });
    assert.equal(Number(db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id).stock), 2);
    adjustProductStock(product.id, { stock: 7, reason: 'اصلاح شمارش' });
    assert.equal(Number(db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id).stock), 7);
    const movements = listStockMovements({ productId: product.id }).filter((row) => row.type === 'adjustment');
    assert.equal(movements.length, 2);
    assert.equal(Number(movements[0].quantity), 5);
    assert.equal(Number(movements[1].quantity), -3);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('supports user roles, authentication and audit logging', () => {
  const { directory } = openTestDatabase();
  try {
    const admin = loginUser('admin', 'admin123');
    assert.equal(admin.role, 'admin');
    const user = createUser({ username: 'cashier1', displayName: 'صندوقدار', password: 'secret123', role: 'cashier' });
    assert.equal(listUsers().some((item) => item.id === user.id), true);
    setUserActive(user.id, false);
    assert.equal(listUsers().find((item) => item.id === user.id).isActive, false);
    const logs = listAuditLogs({});
    assert.equal(logs.some((log) => log.action === 'auth.login'), true);
    assert.equal(logs.some((log) => log.action === 'user.create'), true);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('calculates profit and loss and closes a day from cash and sales data', () => {
  const { directory, db } = openTestDatabase();
  try {
    const product = db.prepare('SELECT id FROM products LIMIT 1').get();
    db.prepare('UPDATE products SET stock = 10, purchase_price = 50000 WHERE id = ?').run(product.id);
    createSale({
      invoiceNumber: 'S-PL-001',
      date: '2026-09-02',
      items: [{ productId: product.id, quantity: 1, unitPrice: 1000 }],
      paidAmount: 1000
    });
    createCashTransaction({ type: 'expense', category: 'rent', amount: 20000, method: 'cash', date: '2026-09-02' });
    const report = getProfitLossReport({ from: '2026-09-02', to: '2026-09-02' });
    assert.equal(report.netSales, 100000);
    assert.equal(report.costTotal, 50000);
    assert.equal(report.grossProfit, 50000);
    assert.equal(report.expenses, 20000);
    assert.equal(report.netProfit, 30000);
    const closure = closeDailyAccount({ date: '2026-09-02', notes: 'پایان روز' });
    assert.equal(closure.cashIncome, 100000);
    assert.equal(closure.cashExpense, 20000);
    assert.equal(closure.closingBalance, 80000);
    assert.equal(listDailyClosures({ from: '2026-09-02', to: '2026-09-02' }).length, 1);
    assert.throws(() => closeDailyAccount({ date: '2026-09-02' }), /قبلاً بسته شده/);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
