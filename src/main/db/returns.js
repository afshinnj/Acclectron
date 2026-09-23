// returns.js — sale and purchase returns.
// Split mechanically from database.js; function bodies are unchanged.

const { auditLog, requireDatabase, requirePermission } = require('./core');
const { gregorianToJalaliYear, normalizeInvoiceDate } = require('./invoices');

function nextReturnNumber(db, date) {
  const year = String(gregorianToJalaliYear(date));
  const rows = db.prepare('SELECT return_number AS number FROM sales_returns WHERE return_number LIKE ?').all(`R-${year}-%`);
  const sequence = rows.reduce((max, row) => {
    const match = String(row.number).match(/-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  return `R-${year}-${String(sequence).padStart(6, '0')}`;
}

function createSaleReturn(payload = {}) {
  const db = requireDatabase();
  requirePermission('returns');
  const saleId = Number(payload.saleId);
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  if (!sale) throw new Error('فاکتور فروش پیدا نشد.');
  if (sale.status === 'cancelled') throw new Error('فاکتور لغوشده قابل مرجوعی نیست.');
  const requested = Array.isArray(payload.items) ? payload.items : [];
  if (!requested.length) throw new Error('حداقل یک قلم برای مرجوعی انتخاب کنید.');
  const saleItems = db.prepare(`
    SELECT si.*, p.name AS productName
    FROM sale_items si JOIN products p ON p.id = si.product_id
    WHERE si.sale_id = ?
  `).all(saleId);
  const returned = db.prepare(`
    SELECT sri.sale_item_id AS saleItemId, SUM(sri.quantity) AS quantity
    FROM sales_return_items sri JOIN sales_returns sr ON sr.id = sri.return_id
    WHERE sr.sale_id = ? AND sr.status = 'completed'
    GROUP BY sri.sale_item_id
  `).all(saleId);
  const returnedMap = new Map(returned.map((row) => [Number(row.saleItemId), Number(row.quantity || 0)]));
  const items = requested.map((raw) => {
    const saleItem = saleItems.find((item) => Number(item.id) === Number(raw.saleItemId)
      || Number(item.product_id) === Number(raw.productId));
    if (!saleItem) throw new Error('قلم فاکتور برای مرجوعی پیدا نشد.');
    const quantity = Number(raw.quantity);
    const available = Number(saleItem.quantity) - (returnedMap.get(Number(saleItem.id)) || 0);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > available + 1e-9) {
      throw new Error(`تعداد مرجوعی «${saleItem.productName}» بیشتر از مقدار قابل مرجوعی است.`);
    }
    const lineDiscount = saleItem.quantity > 0
      ? Math.min(Number(saleItem.discount || 0), Math.round(Number(saleItem.discount || 0) * quantity / Number(saleItem.quantity)))
      : 0;
    return {
      saleItemId: Number(saleItem.id),
      productId: Number(saleItem.product_id),
      productName: saleItem.productName,
      quantity,
      unitPrice: Number(saleItem.unit_price || 0),
      discount: lineDiscount,
      total: Math.max(0, Math.round(quantity * Number(saleItem.unit_price || 0)) - lineDiscount)
    };
  });
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const refundAmount = Math.min(total, Math.max(0, Math.round(Number(payload.refundAmount || 0))));
  const date = normalizeInvoiceDate(payload.date);
  const returnNumber = String(payload.returnNumber || '').trim() || nextReturnNumber(db, date);
  db.exec('BEGIN IMMEDIATE');
  try {
    const balanceReduction = Math.min(total, Number(sale.remaining_amount || 0));
    const result = db.prepare(`
      INSERT INTO sales_returns (return_number, sale_id, date, total, refund_amount, reason, status, balance_adjustment)
      VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)
    `).run(returnNumber, saleId, date, total, refundAmount, String(payload.reason || '').trim(), balanceReduction);
    const returnId = Number(result.lastInsertRowid);
    const insertItem = db.prepare(`
      INSERT INTO sales_return_items (return_id, sale_item_id, product_id, quantity, unit_price, discount, total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const updateStock = db.prepare('UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const movement = db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity, reference_type, reference_id, description)
      VALUES (?, 'sale_return', ?, 'sale_return', ?, ?)
    `);
    for (const item of items) {
      insertItem.run(returnId, item.saleItemId, item.productId, item.quantity, item.unitPrice, item.discount, item.total);
      updateStock.run(item.quantity, item.productId);
      movement.run(item.productId, item.quantity, returnId, `مرجوعی ${returnNumber}`);
    }
    // A return reduces the outstanding receivable associated with the sale.
    // Keep legacy customer records and the newer party ledger in sync.
    if (balanceReduction > 0) {
      if (sale.party_id) {
        db.prepare('UPDATE parties SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(balanceReduction, sale.party_id);
      }
      if (sale.customer_id) {
        db.prepare('UPDATE customers SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(balanceReduction, sale.customer_id);
      }
    }
    if (refundAmount > 0) {
      db.prepare(`
        INSERT INTO cash_transactions (type, category, amount, method, date, description, reference_type, reference_id)
        VALUES ('expense', 'sales_return', ?, ?, ?, ?, 'sales_return', ?)
      `).run(refundAmount, String(payload.method || 'cash').match(/^(cash|card|bank|other)$/)?.[1] || 'cash', date, `استرداد مرجوعی ${returnNumber}`, returnId);
    }
    db.exec('COMMIT');
    auditLog('sale_return.create', 'sales_return', returnId, { returnNumber, total, refundAmount });
    return getSaleReturnDetails(returnId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getSaleReturnDetails(id) {
  const db = requireDatabase();
  const returnId = Number(id);
  const row = db.prepare(`
    SELECT sr.*, s.invoice_number AS saleInvoiceNumber,
      COALESCE(s.party_name, '') AS partyName
    FROM sales_returns sr JOIN sales s ON s.id = sr.sale_id
    WHERE sr.id = ?
  `).get(returnId);
  if (!row) throw new Error('مرجوعی پیدا نشد.');
  const items = db.prepare(`
    SELECT sri.*, p.name AS productName, p.code AS productCode
    FROM sales_return_items sri JOIN products p ON p.id = sri.product_id
    WHERE sri.return_id = ? ORDER BY sri.id
  `).all(returnId);
  return { ...row, items };
}

function listSalesReturns(payload = {}) {
  const db = requireDatabase();
  const query = String(payload.query || '').trim();
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  return db.prepare(`
    SELECT sr.id, sr.return_number AS returnNumber, sr.sale_id AS saleId,
      sr.date, sr.total, sr.refund_amount AS refundAmount, sr.reason, sr.status,
      s.invoice_number AS saleInvoiceNumber, COALESCE(s.party_name, '') AS partyName
    FROM sales_returns sr JOIN sales s ON s.id = sr.sale_id
    WHERE (? = '' OR sr.return_number LIKE ? OR s.invoice_number LIKE ? OR COALESCE(s.party_name, '') LIKE ?)
      AND (? = '' OR sr.date >= ?) AND (? = '' OR sr.date <= ?)
    ORDER BY sr.date DESC, sr.id DESC LIMIT 500
  `).all(query, `%${query}%`, `%${query}%`, `%${query}%`, from, from, to, to);
}

function cancelSaleReturn(id) {
  const db = requireDatabase();
  requirePermission('returns');
  const returnId = Number(id);
  const record = db.prepare('SELECT * FROM sales_returns WHERE id = ?').get(returnId);
  if (!record) throw new Error('مرجوعی پیدا نشد.');
  if (record.status === 'cancelled') throw new Error('این مرجوعی قبلاً لغو شده است.');
  const items = db.prepare('SELECT product_id AS productId, quantity FROM sales_return_items WHERE return_id = ?').all(returnId);
  db.exec('BEGIN IMMEDIATE');
  try {
    const updateStock = db.prepare('UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const movement = db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity, reference_type, reference_id, description)
      VALUES (?, 'sale_return_cancel', ?, 'sales_return', ?, ?)
    `);
    for (const item of items) {
      const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.productId);
      if (!product || Number(product.stock) < Number(item.quantity)) throw new Error('موجودی فعلی برای لغو مرجوعی کافی نیست.');
      updateStock.run(item.quantity, item.productId);
      movement.run(item.productId, -Number(item.quantity), returnId, `لغو مرجوعی ${record.return_number}`);
    }
    const sale = db.prepare('SELECT party_id, customer_id FROM sales WHERE id = ?').get(record.sale_id);
    const balanceIncrease = Number(record.balance_adjustment || 0);
    if (balanceIncrease > 0) {
      if (sale?.party_id) {
        db.prepare('UPDATE parties SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(balanceIncrease, sale.party_id);
      }
      if (sale?.customer_id) {
        db.prepare('UPDATE customers SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(balanceIncrease, sale.customer_id);
      }
    }
    db.prepare("UPDATE sales_returns SET status = 'cancelled' WHERE id = ?").run(returnId);
    db.prepare("DELETE FROM cash_transactions WHERE reference_type = 'sales_return' AND reference_id = ?").run(returnId);
    db.exec('COMMIT');
    auditLog('sale_return.cancel', 'sales_return', returnId);
    return getSaleReturnDetails(returnId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function nextPurchaseReturnNumber(db, date) {
  const year = String(gregorianToJalaliYear(date));
  const rows = db.prepare('SELECT return_number AS number FROM purchase_returns WHERE return_number LIKE ?').all(`PR-${year}-%`);
  const sequence = rows.reduce((max, row) => {
    const match = String(row.number).match(/-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  return `PR-${year}-${String(sequence).padStart(6, '0')}`;
}

function createPurchaseReturn(payload = {}) {
  const db = requireDatabase();
  requirePermission('returns');
  const purchaseId = Number(payload.purchaseId);
  const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId);
  if (!purchase) throw new Error('فاکتور خرید پیدا نشد.');
  if (purchase.status === 'cancelled') throw new Error('فاکتور لغوشده قابل مرجوعی نیست.');
  const requested = Array.isArray(payload.items) ? payload.items : [];
  if (!requested.length) throw new Error('حداقل یک قلم برای مرجوعی خرید انتخاب کنید.');
  const purchaseItems = db.prepare(`
    SELECT pi.*, p.name AS productName
    FROM purchase_items pi JOIN products p ON p.id = pi.product_id
    WHERE pi.purchase_id = ?
  `).all(purchaseId);
  const returned = db.prepare(`
    SELECT pri.purchase_item_id AS purchaseItemId, SUM(pri.quantity) AS quantity
    FROM purchase_return_items pri JOIN purchase_returns pr ON pr.id = pri.return_id
    WHERE pr.purchase_id = ? AND pr.status = 'completed'
    GROUP BY pri.purchase_item_id
  `).all(purchaseId);
  const returnedMap = new Map(returned.map((row) => [Number(row.purchaseItemId), Number(row.quantity || 0)]));
  const items = requested.map((raw) => {
    const purchaseItem = purchaseItems.find((item) => Number(item.id) === Number(raw.purchaseItemId)
      || Number(item.product_id) === Number(raw.productId));
    if (!purchaseItem) throw new Error('قلم فاکتور خرید برای مرجوعی پیدا نشد.');
    const quantity = Number(raw.quantity);
    const available = Number(purchaseItem.quantity) - (returnedMap.get(Number(purchaseItem.id)) || 0);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > available + 1e-9) {
      throw new Error(`تعداد مرجوعی «${purchaseItem.productName}» بیشتر از مقدار قابل مرجوعی است.`);
    }
    const lineDiscount = purchaseItem.quantity > 0
      ? Math.min(Number(purchaseItem.discount || 0), Math.round(Number(purchaseItem.discount || 0) * quantity / Number(purchaseItem.quantity)))
      : 0;
    return {
      purchaseItemId: Number(purchaseItem.id),
      productId: Number(purchaseItem.product_id),
      productName: purchaseItem.productName,
      quantity,
      unitPrice: Number(purchaseItem.unit_price || 0),
      discount: lineDiscount,
      total: Math.max(0, Math.round(quantity * Number(purchaseItem.unit_price || 0)) - lineDiscount)
    };
  });
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const refundAmount = Math.min(total, Math.max(0, Math.round(Number(payload.refundAmount || 0))));
  const date = normalizeInvoiceDate(payload.date);
  const returnNumber = String(payload.returnNumber || '').trim() || nextPurchaseReturnNumber(db, date);
  db.exec('BEGIN IMMEDIATE');
  try {
    const balanceReduction = Math.min(total, Number(purchase.remaining_amount || 0));
    const result = db.prepare(`
      INSERT INTO purchase_returns (return_number, purchase_id, date, total, refund_amount, reason, status, balance_adjustment)
      VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)
    `).run(returnNumber, purchaseId, date, total, refundAmount, String(payload.reason || '').trim(), balanceReduction);
    const returnId = Number(result.lastInsertRowid);
    const insertItem = db.prepare(`
      INSERT INTO purchase_return_items (return_id, purchase_item_id, product_id, quantity, unit_price, discount, total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const updateStock = db.prepare('UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const movement = db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity, reference_type, reference_id, description)
      VALUES (?, 'purchase_return', ?, 'purchase_return', ?, ?)
    `);
    for (const item of items) {
      const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.productId);
      if (!product || Number(product.stock) < item.quantity) throw new Error(`موجودی «${item.productName}» برای مرجوعی خرید کافی نیست.`);
      insertItem.run(returnId, item.purchaseItemId, item.productId, item.quantity, item.unitPrice, item.discount, item.total);
      updateStock.run(item.quantity, item.productId);
      movement.run(item.productId, -item.quantity, returnId, `مرجوعی خرید ${returnNumber}`);
    }
    if (refundAmount > 0) {
      db.prepare(`
        INSERT INTO cash_transactions (type, category, amount, method, date, description, reference_type, reference_id)
        VALUES ('income', 'purchase_return', ?, ?, ?, ?, 'purchase_return', ?)
      `).run(refundAmount, String(payload.method || 'cash').match(/^(cash|card|bank|other)$/)?.[1] || 'cash', date, `دریافت بابت مرجوعی خرید ${returnNumber}`, returnId);
    }
    if (purchase.supplier_id && balanceReduction > 0) {
      db.prepare('UPDATE suppliers SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(balanceReduction, purchase.supplier_id);
    }
    if (purchase.party_id && balanceReduction > 0) {
      db.prepare('UPDATE parties SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(balanceReduction, purchase.party_id);
    }
    db.exec('COMMIT');
    auditLog('purchase_return.create', 'purchase_return', returnId, { returnNumber, total, refundAmount });
    return getPurchaseReturnDetails(returnId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getPurchaseReturnDetails(id) {
  const db = requireDatabase();
  const returnId = Number(id);
  const row = db.prepare(`
    SELECT pr.*, p.invoice_number AS purchaseInvoiceNumber, COALESCE(p.party_name, '') AS partyName
    FROM purchase_returns pr JOIN purchases p ON p.id = pr.purchase_id
    WHERE pr.id = ?
  `).get(returnId);
  if (!row) throw new Error('مرجوعی خرید پیدا نشد.');
  const items = db.prepare(`
    SELECT pri.*, p.name AS productName, p.code AS productCode
    FROM purchase_return_items pri JOIN products p ON p.id = pri.product_id
    WHERE pri.return_id = ? ORDER BY pri.id
  `).all(returnId);
  return { ...row, items };
}

function listPurchaseReturns(payload = {}) {
  const db = requireDatabase();
  const query = String(payload.query || '').trim();
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  return db.prepare(`
    SELECT pr.id, pr.return_number AS returnNumber, pr.purchase_id AS purchaseId,
      pr.date, pr.total, pr.refund_amount AS refundAmount, pr.reason, pr.status,
      p.invoice_number AS purchaseInvoiceNumber, COALESCE(p.party_name, '') AS partyName
    FROM purchase_returns pr JOIN purchases p ON p.id = pr.purchase_id
    WHERE (? = '' OR pr.return_number LIKE ? OR p.invoice_number LIKE ? OR COALESCE(p.party_name, '') LIKE ?)
      AND (? = '' OR pr.date >= ?) AND (? = '' OR pr.date <= ?)
    ORDER BY pr.date DESC, pr.id DESC LIMIT 500
  `).all(query, `%${query}%`, `%${query}%`, `%${query}%`, from, from, to, to);
}

function cancelPurchaseReturn(id) {
  const db = requireDatabase();
  requirePermission('returns');
  const returnId = Number(id);
  const record = db.prepare('SELECT * FROM purchase_returns WHERE id = ?').get(returnId);
  if (!record) throw new Error('مرجوعی خرید پیدا نشد.');
  if (record.status === 'cancelled') throw new Error('این مرجوعی خرید قبلاً لغو شده است.');
  const items = db.prepare('SELECT product_id AS productId, quantity FROM purchase_return_items WHERE return_id = ?').all(returnId);
  db.exec('BEGIN IMMEDIATE');
  try {
    const updateStock = db.prepare('UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const movement = db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity, reference_type, reference_id, description)
      VALUES (?, 'purchase_return_cancel', ?, 'purchase_return', ?, ?)
    `);
    for (const item of items) {
      updateStock.run(item.quantity, item.productId);
      movement.run(item.productId, Number(item.quantity), returnId, `لغو مرجوعی خرید ${record.return_number}`);
    }
    const purchase = db.prepare('SELECT supplier_id, party_id FROM purchases WHERE id = ?').get(record.purchase_id);
    const balanceIncrease = Number(record.balance_adjustment || 0);
    if (purchase?.supplier_id && balanceIncrease > 0) db.prepare('UPDATE suppliers SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(balanceIncrease, purchase.supplier_id);
    if (purchase?.party_id && balanceIncrease > 0) db.prepare('UPDATE parties SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(balanceIncrease, purchase.party_id);
    db.prepare("UPDATE purchase_returns SET status = 'cancelled' WHERE id = ?").run(returnId);
    db.prepare("DELETE FROM cash_transactions WHERE reference_type = 'purchase_return' AND reference_id = ?").run(returnId);
    db.exec('COMMIT');
    auditLog('purchase_return.cancel', 'purchase_return', returnId);
    return getPurchaseReturnDetails(returnId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { cancelPurchaseReturn, cancelSaleReturn, createPurchaseReturn, createSaleReturn, getPurchaseReturnDetails, getSaleReturnDetails, listPurchaseReturns, listSalesReturns, nextPurchaseReturnNumber, nextReturnNumber };
