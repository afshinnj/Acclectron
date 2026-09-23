// invoices.js — sales and purchase invoices, settlements, merges and listing.
// Split mechanically from database.js; function bodies are unchanged.

const { calculateSaleTotals } = require('../domain/sales');
const { auditLog, requireDatabase, requirePermission } = require('./core');
const { getAppSettings } = require('./settings');
const { updateProduct } = require('./catalog');

function normalizeInvoicePayments(payments, total, fallbackPaidAmount = 0) {
  const source = Array.isArray(payments) && payments.length
    ? payments
    : (Number(fallbackPaidAmount) > 0 ? [{ method: 'cash', amount: fallbackPaidAmount }] : []);
  const normalized = source.map((payment) => {
    const method = ['cash', 'card', 'check'].includes(String(payment.method)) ? String(payment.method) : 'cash';
    const amount = Math.max(0, Math.round(Number(payment.amount || payment.amountToman || 0) * 100));
    if (!amount) throw new Error('مبلغ پرداخت باید بیشتر از صفر باشد.');
    if (method === 'check' && !String(payment.checkNumber || '').trim()) {
      throw new Error('شماره چک برای پرداخت چکی الزامی است.');
    }
    return {
      method,
      amount,
      paidAt: String(payment.paidAt || new Date().toISOString()),
      checkNumber: String(payment.checkNumber || '').trim() || null,
      bankName: String(payment.bankName || '').trim() || null,
      dueDate: String(payment.dueDate || '').trim() || null,
      checkHolder: String(payment.checkHolder || '').trim() || null,
      checkStatus: method === 'check' ? (['pending', 'cleared', 'bounced', 'cancelled'].includes(String(payment.checkStatus)) ? String(payment.checkStatus) : 'pending') : null,
      notes: String(payment.notes || '').trim() || null
    };
  });
  const paidAmount = normalized.reduce((sum, payment) => sum + payment.amount, 0);
  if (paidAmount > total) throw new Error('مجموع پرداخت‌ها نمی‌تواند بیشتر از مبلغ فاکتور باشد.');
  return { payments: normalized, paidAmount, remainingAmount: total - paidAmount };
}

function insertInvoicePayments(db, invoiceColumn, invoiceId, payments) {
  if (!payments.length) return;
  const statement = db.prepare(`
    INSERT INTO invoice_payments
      (${invoiceColumn}, method, amount, paid_at, check_number, bank_name, due_date, check_holder, check_status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const payment of payments) {
    statement.run(
      invoiceId, payment.method, payment.amount, payment.paidAt, payment.checkNumber,
      payment.bankName, payment.dueDate, payment.checkHolder, payment.checkStatus, payment.notes
    );
  }
}

function normalizeInvoiceDate(value) {
  const text = String(value || '').trim();
  return isValidIsoDate(text) ? text : new Date().toISOString().slice(0, 10);
}

function isValidIsoDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function nextInvoiceNumber(db, kind, date) {
  const prefix = kind === 'sale' ? (getAppSettings().sales.invoicePrefix || 'S-') : 'P-';
  const year = String(gregorianToJalaliYear(date));
  const pattern = `${prefix}${year}-%`;
  const table = kind === 'sale' ? 'sales' : 'purchases';
  const rows = db.prepare(`SELECT invoice_number AS invoiceNumber FROM ${table} WHERE invoice_number LIKE ?`).all(pattern);
  const sequence = rows.reduce((max, row) => {
    const match = String(row.invoiceNumber).match(/-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  return `${prefix}${year}-${String(sequence).padStart(6, '0')}`;
}

function gregorianToJalaliYear(isoDate) {
  const [gy, gm, gd] = String(isoDate || '').split('-').map(Number);
  if (!gy || !gm || !gd) return new Date().getUTCFullYear() - 621;
  const monthDays = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jalaliYear = gy > 1600 ? 979 : 0;
  const gregorianBaseYear = gy > 1600 ? gy - 1600 : gy - 621;
  const leapYear = gm > 2 ? gregorianBaseYear + 1 : gregorianBaseYear;
  let days = (365 * gregorianBaseYear) + Math.floor((leapYear + 3) / 4) - Math.floor((leapYear + 99) / 100)
    + Math.floor((leapYear + 399) / 400) - 80 + gd + monthDays[gm - 1];
  jalaliYear += 33 * Math.floor(days / 12053);
  days %= 12053;
  jalaliYear += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) jalaliYear += Math.floor((days - 1) / 365);
  return jalaliYear;
}

function getNextInvoiceNumber(kind, date) {
  const db = requireDatabase();
  return nextInvoiceNumber(db, kind, normalizeInvoiceDate(date));
}

function getPartySnapshot(db, partyId, fallback = {}, allowedTypes = []) {
  const party = partyId ? db.prepare(`
    SELECT id, trim(first_name || ' ' || COALESCE(last_name, '')) AS name,
      code, phone, mobile, address, party_type AS partyType
    FROM parties WHERE id = ? AND is_active = 1
  `).get(Number(partyId)) : null;
  if (partyId && !party) throw new Error('طرف‌حساب انتخاب‌شده فعال یا معتبر نیست.');
  if (party && allowedTypes.length && !allowedTypes.includes(party.partyType)) {
    throw new Error('نوع طرف‌حساب انتخاب‌شده برای این فاکتور معتبر نیست.');
  }
  return {
    partyId: party?.id || null,
    partyName: String(party?.name || fallback.name || '').trim() || null,
    partyPhone: String(party?.phone || party?.mobile || fallback.phone || '').trim() || null,
    partyAddress: String(party?.address || fallback.address || '').trim() || null
  };
}

function priceSaleItems(pricedItems, discount, subtotal) {
  const effectiveDiscount = Math.min(Math.max(0, Number(discount) || 0), Math.max(0, Number(subtotal) || 0));
  let allocatedDiscount = 0;
  return pricedItems.map((item, index) => {
    const allocation = index === pricedItems.length - 1
      ? effectiveDiscount - allocatedDiscount
      : (subtotal > 0 ? Math.round(effectiveDiscount * item.total / subtotal) : 0);
    allocatedDiscount += allocation;
    return {
      ...item,
      profit: Math.round(item.total - allocation - (item.purchasePrice * item.quantity))
    };
  });
}

function rejectSalesBelowPurchasePrice(pricedItems) {
  const lossMakingItem = pricedItems.find((item) => item.profit < 0);
  if (!lossMakingItem) return;
  throw new Error(`قیمت فروش «${lossMakingItem.name}» نمی‌تواند کمتر از قیمت خرید باشد.`);
}

function getAvailableSaleProducts(db, items, enforceStock = true) {
  const requestedQuantities = new Map();
  for (const item of items) {
    const productId = Number(item.productId);
    requestedQuantities.set(productId, (requestedQuantities.get(productId) || 0) + Number(item.quantity || 0));
  }

  const findProduct = db.prepare(
    'SELECT id, name, stock, purchase_price AS purchasePrice FROM products WHERE id = ? AND is_active = 1'
  );
  const products = new Map();
  for (const [productId, requestedQuantity] of requestedQuantities) {
    const product = findProduct.get(productId);
    if (!product) throw new Error('کالای انتخاب‌شده پیدا نشد.');
    if (enforceStock && Number(product.stock) < requestedQuantity) {
      throw new Error(`موجودی «${product.name}» کافی نیست.`);
    }
    products.set(productId, product);
  }
  return products;
}

function createSale(payload = {}) {
  const db = requireDatabase();
  requirePermission('sales');
  const baseTotals = calculateSaleTotals(payload.items, payload.discount, payload.tax, 0);
  validateInventoryQuantities(db, baseTotals.items);
  const paymentTotals = normalizeInvoicePayments(payload.payments, baseTotals.total, payload.paidAmount);
  const totals = { ...baseTotals, ...paymentTotals };
  const customerId = payload.customerId ? Number(payload.customerId) : null;
  const party = getPartySnapshot(db, payload.partyId, { name: payload.partyName, phone: payload.partyPhone, address: payload.partyAddress }, ['customer', 'both']);
  const partyId = party.partyId;
  const date = normalizeInvoiceDate(payload.date);
  const invoiceNumber = String(payload.invoiceNumber || '').trim()
    || nextInvoiceNumber(db, 'sale', date);

  db.exec('BEGIN IMMEDIATE');
  try {
    const products = getAvailableSaleProducts(db, totals.items, getAppSettings().sales.preventOversell !== false && getAppSettings().product.allowNegativeStock !== true);
    let pricedItems = totals.items.map((item) => {
      const product = products.get(item.productId);
      const purchasePrice = Number(product.purchasePrice || 0);
      return { ...item, name: product.name, purchasePrice };
    });
    pricedItems = priceSaleItems(pricedItems, totals.discount, totals.subtotal);
    rejectSalesBelowPurchasePrice(pricedItems);
    const costTotal = pricedItems.reduce((sum, item) => sum + Math.round(item.purchasePrice * item.quantity), 0);
    const profitTotal = pricedItems.reduce((sum, item) => sum + item.profit, 0);
    const itemCount = pricedItems.reduce((sum, item) => sum + item.quantity, 0);

    const sale = db.prepare(`
      INSERT INTO sales (invoice_number, customer_id, party_id, party_name, party_phone, party_address, date, subtotal, discount, tax, total, paid_amount, remaining_amount, cost_total, profit_total, item_count, source, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invoiceNumber,
      customerId,
      partyId,
      party.partyName,
      party.partyPhone,
      party.partyAddress,
      date,
      totals.subtotal,
      totals.discount,
      totals.tax,
      totals.total,
      totals.paidAmount,
      totals.remainingAmount,
      costTotal,
      profitTotal,
      itemCount,
      payload.source === 'daily' ? 'daily' : 'invoice',
      String(payload.notes || '')
    );
    const saleId = Number(sale.lastInsertRowid);
    const insertItem = db.prepare(
      'INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount, total, purchase_price, profit, price_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const updateStock = db.prepare('UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const movement = db.prepare(
      "INSERT INTO stock_movements (product_id, type, quantity, reference_type, reference_id) VALUES (?, 'sale', ?, 'sale', ?)"
    );
    for (const item of pricedItems) {
      insertItem.run(saleId, item.productId, item.quantity, item.unitPrice, item.discount, item.total, item.purchasePrice, item.profit, item.priceType || 'retail');
      updateStock.run(item.quantity, item.productId);
      movement.run(item.productId, -item.quantity, saleId);
    }
    insertInvoicePayments(db, 'sale_id', saleId, paymentTotals.payments);
    if (customerId && totals.remainingAmount > 0) {
      db.prepare('UPDATE customers SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(totals.remainingAmount, customerId);
    }
    if (partyId && totals.remainingAmount > 0) {
      db.prepare('UPDATE parties SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(totals.remainingAmount, partyId);
    }
    db.exec('COMMIT');
    auditLog('sale.create', 'sale', saleId, { invoiceNumber, total: totals.total });
    return { id: saleId, invoiceNumber, costTotal, profitTotal, itemCount, ...totals };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function validateInventoryQuantities(db, items) {
  const globalFractional = getAppSettings().product.allowFractional !== false;
  const find = db.prepare('SELECT p.name, u.allow_fraction AS allowFraction FROM products p LEFT JOIN units u ON u.id = p.unit_id WHERE p.id = ?');
  for (const item of items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error('مقدار کالا نامعتبر است.');
    if (!globalFractional && !Number.isInteger(item.quantity)) throw new Error('مقدار کسری کالا در تنظیمات غیرفعال است.');
    const product = find.get(item.productId);
    if (!product) throw new Error('کالای انتخاب‌شده پیدا نشد.');
    if (!Number.isInteger(item.quantity) && product.allowFraction === 0) throw new Error(`واحد کالای «${product.name}» مقدار کسری را پشتیبانی نمی‌کند.`);
  }
}

function createPurchase(payload = {}) {
  const db = requireDatabase();
  requirePermission('purchases');
  const items = (payload.items || []).map((item) => {
    // Purchase quantities are whole inventory units in the invoice editor.
    // Normalize API payloads too so stock moves by whole units.
    const quantity = Number(item.quantity);
    const unitPrice = Math.round(Number(item.unitPrice) || 0);
    const itemDiscount = Math.round(Number(item.discount) || 0);
    if (!Number.isFinite(quantity) || quantity <= 0 || unitPrice < 0 || itemDiscount < 0) {
      throw new Error('اقلام خرید نامعتبر است.');
    }
    return {
      productId: Number(item.productId),
      quantity,
      unitPrice,
      discount: itemDiscount,
      total: Math.max(0, Math.round(quantity * unitPrice) - itemDiscount)
    };
  });
  if (!items.length) throw new Error('خرید باید حداقل یک کالا داشته باشد.');

  validateInventoryQuantities(db, items);
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const discount = Math.max(0, Math.round(Number(payload.discount) || 0));
  const tax = Math.max(0, Math.round(Number(payload.tax) || 0));
  const total = Math.max(0, subtotal - discount + tax);
  const paymentTotals = normalizeInvoicePayments(payload.payments, total, Number(payload.paidAmount || 0) / 100);
  const paidAmount = paymentTotals.paidAmount;
  const date = normalizeInvoiceDate(payload.date);
  const invoiceNumber = String(payload.invoiceNumber || '').trim() || nextInvoiceNumber(db, 'purchase', date);
  const party = getPartySnapshot(db, payload.partyId, { name: payload.partyName, phone: payload.partyPhone, address: payload.partyAddress }, ['supplier', 'both']);
  const partyId = party.partyId;

  db.exec('BEGIN IMMEDIATE');
  try {
    const purchase = db.prepare(`
      INSERT INTO purchases
        (invoice_number, supplier_id, party_id, party_name, party_phone, party_address, date, subtotal, discount, tax, total, paid_amount, remaining_amount, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
    `).run(
      invoiceNumber,
      payload.supplierId ? Number(payload.supplierId) : null,
      partyId,
      party.partyName,
      party.partyPhone,
      party.partyAddress,
      date,
      subtotal,
      discount,
      tax,
      total,
      paidAmount,
      total - paidAmount,
      String(payload.notes || '')
    );
    const purchaseId = Number(purchase.lastInsertRowid);
    const insertItem = db.prepare(
      'INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_price, discount, total) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const updateProduct = db.prepare(
      'UPDATE products SET stock = stock + ?, purchase_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    );
    const movement = db.prepare(
      "INSERT INTO stock_movements (product_id, type, quantity, reference_type, reference_id, description) VALUES (?, 'purchase', ?, 'purchase', ?, ?)"
    );
    for (const item of items) {
      const product = db.prepare('SELECT id FROM products WHERE id = ? AND is_active = 1').get(item.productId);
      if (!product) throw new Error('کالای خرید پیدا نشد.');
      insertItem.run(purchaseId, item.productId, item.quantity, item.unitPrice, item.discount, item.total);
      updateProduct.run(item.quantity, item.unitPrice, item.productId);
      movement.run(item.productId, item.quantity, purchaseId, `Purchase ${invoiceNumber}`);
    }
    insertInvoicePayments(db, 'purchase_id', purchaseId, paymentTotals.payments);
    if (payload.supplierId && total - paidAmount > 0) {
      db.prepare('UPDATE suppliers SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(total - paidAmount, Number(payload.supplierId));
    }
    if (partyId && paymentTotals.remainingAmount > 0) {
      db.prepare('UPDATE parties SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(paymentTotals.remainingAmount, partyId);
    }
    db.exec('COMMIT');
    auditLog('purchase.create', 'purchase', purchaseId, { invoiceNumber, total });
    return { id: purchaseId, invoiceNumber, subtotal, discount, tax, total, paidAmount, remainingAmount: paymentTotals.remainingAmount, payments: paymentTotals.payments };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function invoiceListQuery(kind, payload = {}) {
  const db = requireDatabase();
  const table = kind === 'sale' ? 'sales' : 'purchases';
  const sourceExpression = kind === 'sale' ? 'i.source' : 'NULL';
  const partyColumn = kind === 'sale' ? 'customer_id' : 'supplier_id';
  const query = String(payload.query || '').trim();
  const term = `%${query}%`;
  const productQuery = String(payload.productQuery || '').trim();
  const productTerm = `%${productQuery}%`;
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  const requestedStatus = String(payload.status || '');
  const showMerged = kind === 'sale' && requestedStatus === 'merged';
  const status = ['active', 'completed', 'cancelled'].includes(requestedStatus) ? requestedStatus : '';
  const mergeColumns = kind === 'sale'
    ? `,
      (SELECT merged_sale_id FROM sale_merge_sources WHERE source_sale_id = i.id) AS mergedIntoSaleId,
      (SELECT target.invoice_number FROM sale_merge_sources sms JOIN sales target ON target.id = sms.merged_sale_id WHERE sms.source_sale_id = i.id) AS mergedIntoInvoiceNumber`
    : ', NULL AS mergedIntoSaleId, NULL AS mergedIntoInvoiceNumber';
  const mergeFilter = kind === 'sale'
    ? (showMerged
      ? 'AND EXISTS (SELECT 1 FROM sale_merge_sources sms WHERE sms.source_sale_id = i.id)'
      : 'AND NOT EXISTS (SELECT 1 FROM sale_merge_sources sms WHERE sms.source_sale_id = i.id)')
    : '';
  const rows = db.prepare(`
    SELECT i.id, i.invoice_number AS invoiceNumber, i.date, i.subtotal, i.discount, i.tax,
      i.total, i.paid_amount AS paidAmount, i.remaining_amount AS remainingAmount,
      i.status, ${sourceExpression} AS source, ${kind === 'sale' ? 'i.pinned' : '0'} AS pinned, i.created_at AS createdAt,
      COALESCE(i.party_name, trim(p.first_name || ' ' || COALESCE(p.last_name, '')), c.name, s.name, '') AS partyName,
      COALESCE(i.party_phone, p.phone, p.mobile, c.phone, s.phone, '') AS partyPhone,
      COALESCE(i.party_address, p.address, s.address, '') AS partyAddress,
      (SELECT COUNT(*) FROM ${kind === 'sale' ? 'sale_items' : 'purchase_items'} ii WHERE ii.${kind === 'sale' ? 'sale' : 'purchase'}_id = i.id) AS itemCount
      ${mergeColumns}
    FROM ${table} i
    LEFT JOIN parties p ON p.id = i.party_id
    LEFT JOIN customers c ON c.id = i.${partyColumn}
    LEFT JOIN suppliers s ON s.id = i.${partyColumn}
    WHERE (? = '' OR i.invoice_number LIKE ? OR COALESCE(i.party_name, '') LIKE ? OR COALESCE(p.first_name || ' ' || p.last_name, '') LIKE ? OR COALESCE(c.name, '') LIKE ? OR COALESCE(s.name, '') LIKE ? OR COALESCE(c.phone, '') LIKE ? OR COALESCE(s.phone, '') LIKE ?)
      AND (? = '' OR EXISTS (
        SELECT 1
        FROM ${kind === 'sale' ? 'sale_items' : 'purchase_items'} ii
        JOIN products product ON product.id = ii.product_id
        WHERE ii.${kind === 'sale' ? 'sale' : 'purchase'}_id = i.id
          AND product.name LIKE ?
      ))
      AND (? = '' OR i.date >= ?) AND (? = '' OR i.date <= ?)
      ${mergeFilter}
      AND (? = '' OR i.status = ?)
    ORDER BY pinned DESC, i.date DESC, i.id DESC
    LIMIT 500
  `).all(query, term, term, term, term, term, term, term, productQuery, productTerm, from, from, to, to, status, status);
  return rows.map((row) => ({ ...row, itemCount: Number(row.itemCount || 0), pinned: Boolean(row.pinned) }));
}

function listSales(payload = {}) { return invoiceListQuery('sale', payload); }

function listPurchases(payload = {}) { return invoiceListQuery('purchase', payload); }

function mergeDailySales(payload = {}) {
  const db = requireDatabase();
  requirePermission('sales');
  const sourceIds = [...new Set((Array.isArray(payload.saleIds) ? payload.saleIds : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0))];
  if (!sourceIds.length) throw new Error('حداقل یک فاکتور فروش روزانه را انتخاب کنید.');
  const date = String(payload.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('تاریخ فاکتور ادغامی معتبر نیست.');
  const partyId = Number(payload.partyId);
  if (!Number.isInteger(partyId) || partyId <= 0) throw new Error('انتخاب مشتری برای فاکتور ادغامی الزامی است.');

  db.exec('BEGIN IMMEDIATE');
  try {
    const placeholders = sourceIds.map(() => '?').join(', ');
    const sources = db.prepare(`
      SELECT id, invoice_number AS invoiceNumber, date, subtotal, discount, tax, total,
        paid_amount AS paidAmount, remaining_amount AS remainingAmount,
        cost_total AS costTotal, profit_total AS profitTotal, item_count AS itemCount,
        source, status
      FROM sales WHERE id IN (${placeholders}) ORDER BY id
    `).all(...sourceIds);
    if (sources.length !== sourceIds.length) throw new Error('یکی از فاکتورهای انتخاب‌شده پیدا نشد.');
    if (sources.some((sale) => sale.source !== 'daily' || sale.status !== 'active' || sale.date !== date)) {
      throw new Error('فقط فاکتورهای فعالِ فروش روزانه با یک تاریخ مشترک قابل ادغام هستند.');
    }
    const party = db.prepare(`
      SELECT id, trim(first_name || ' ' || COALESCE(last_name, '')) AS name,
        phone, mobile, address, party_type AS partyType
      FROM parties WHERE id = ? AND is_active = 1
    `).get(partyId);
    if (!party || !['customer', 'both'].includes(party.partyType)) throw new Error('مشتری انتخاب‌شده معتبر نیست.');
    const returnCount = db.prepare(`
      SELECT COUNT(*) AS count FROM sales_returns
      WHERE sale_id IN (${placeholders}) AND status = 'completed'
    `).get(...sourceIds).count;
    if (returnCount) throw new Error('فاکتور دارای مرجوعی قابل ادغام نیست.');
    const installmentCount = db.prepare(`
      SELECT COUNT(*) AS count FROM installment_plans
      WHERE invoice_kind = 'sale' AND invoice_id IN (${placeholders}) AND status <> 'cancelled'
    `).get(...sourceIds).count;
    if (installmentCount) throw new Error('فاکتور دارای برنامه اقساط قابل ادغام نیست.');

    const payments = db.prepare(`
      SELECT id, sale_id AS saleId, amount FROM invoice_payments
      WHERE sale_id IN (${placeholders}) ORDER BY id
    `).all(...sourceIds);
    const paymentTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const declaredPaid = sources.reduce((sum, sale) => sum + Number(sale.paidAmount || 0), 0);
    if (paymentTotal !== declaredPaid) throw new Error('جمع پرداخت‌های یکی از فاکتورها با اطلاعات ثبت‌شده همخوانی ندارد.');

    const totals = sources.reduce((result, sale) => ({
      subtotal: result.subtotal + Number(sale.subtotal || 0),
      discount: result.discount + Number(sale.discount || 0),
      tax: result.tax + Number(sale.tax || 0),
      total: result.total + Number(sale.total || 0),
      paidAmount: result.paidAmount + Number(sale.paidAmount || 0),
      remainingAmount: result.remainingAmount + Number(sale.remainingAmount || 0),
      costTotal: result.costTotal + Number(sale.costTotal || 0),
      profitTotal: result.profitTotal + Number(sale.profitTotal || 0),
      itemCount: result.itemCount + Number(sale.itemCount || 0)
    }), { subtotal: 0, discount: 0, tax: 0, total: 0, paidAmount: 0, remainingAmount: 0, costTotal: 0, profitTotal: 0, itemCount: 0 });
    if (totals.total !== totals.paidAmount + totals.remainingAmount) throw new Error('مانده فاکتورهای انتخاب‌شده معتبر نیست.');
    const invoiceNumber = nextInvoiceNumber(db, 'sale', date);
    const sourceNumbers = sources.map((sale) => sale.invoiceNumber).join('، ');
    const target = db.prepare(`
      INSERT INTO sales
        (invoice_number, party_id, party_name, party_phone, party_address, date, subtotal, discount, tax, total, paid_amount, remaining_amount, cost_total, profit_total, item_count, source, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'invoice', 'active', ?)
    `).run(
      invoiceNumber, party.id, party.name, party.phone || party.mobile || null, party.address || null,
      date, totals.subtotal, totals.discount, totals.tax, totals.total, totals.paidAmount,
      totals.remainingAmount, totals.costTotal, totals.profitTotal, totals.itemCount,
      `ادغام فروش‌های روزانه: ${sourceNumbers}`
    );
    const mergedSaleId = Number(target.lastInsertRowid);
    db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount, total, purchase_price, profit, price_type)
      SELECT ?, product_id, quantity, unit_price, discount, total, purchase_price, profit, price_type
      FROM sale_items WHERE sale_id IN (${placeholders}) ORDER BY id
    `).run(mergedSaleId, ...sourceIds);
    db.prepare(`UPDATE invoice_payments SET sale_id = ? WHERE sale_id IN (${placeholders})`).run(mergedSaleId, ...sourceIds);
    db.prepare(`
      INSERT INTO sale_merge_sources (source_sale_id, merged_sale_id)
      VALUES ${sourceIds.map(() => '(?, ?)').join(', ')}
    `).run(...sourceIds.flatMap((sourceId) => [sourceId, mergedSaleId]));
    db.prepare(`
      UPDATE sales
      SET status = 'cancelled', paid_amount = 0, remaining_amount = 0,
        notes = trim(COALESCE(notes, '') || CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE '\n' END || ?),
        updated_at = CURRENT_TIMESTAMP
      WHERE id IN (${placeholders})
    `).run(`ادغام‌شده در فاکتور ${invoiceNumber}`, ...sourceIds);
    if (totals.remainingAmount > 0) {
      db.prepare('UPDATE parties SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(totals.remainingAmount, party.id);
    }
    db.exec('COMMIT');
    auditLog('sale.merge_daily', 'sale', mergedSaleId, { invoiceNumber, sourceSaleIds: sourceIds, sourceInvoiceNumbers: sources.map((sale) => sale.invoiceNumber) });
    return { id: mergedSaleId, invoiceNumber, date, sourceSaleIds: sourceIds, ...totals };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getPurchasePriceHistory(productId, payload = {}) {
  const db = requireDatabase();
  const id = Number(productId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('کالای موردنظر معتبر نیست.');

  const limit = Math.min(50, Math.max(1, Math.floor(Number(payload.limit) || 15)));
  const partyId = Number(payload.partyId || 0);
  const baseQuery = `
    WITH returned_items AS (
      SELECT pri.purchase_item_id AS purchase_item_id, SUM(pri.quantity) AS returned_quantity
      FROM purchase_return_items pri
      JOIN purchase_returns pr ON pr.id = pri.return_id
      WHERE pr.status = 'completed'
      GROUP BY pri.purchase_item_id
    )
    SELECT
      pi.id AS purchaseItemId,
      pu.id AS purchaseId,
      pu.invoice_number AS invoiceNumber,
      pu.date,
      pu.party_id AS partyId,
      COALESCE(
        NULLIF(trim(pu.party_name), ''),
        NULLIF(trim(COALESCE(pt.first_name, '') || ' ' || COALESCE(pt.last_name, '')), ''),
        NULLIF(trim(s.name), ''),
        'بدون تأمین‌کننده'
      ) AS supplierName,
      pi.quantity,
      pi.unit_price AS unitPrice,
      pi.discount AS discount,
      pi.total AS lineTotal,
      CAST(ROUND(CAST(pi.total AS REAL) / pi.quantity) AS INTEGER) AS effectiveUnitPrice,
      COALESCE(ri.returned_quantity, 0) AS returnedQuantity,
      CASE WHEN ? > 0 AND pu.party_id = ? THEN 1 ELSE 0 END AS isSelectedSupplier
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchase_id
    LEFT JOIN parties pt ON pt.id = pu.party_id
    LEFT JOIN suppliers s ON s.id = pu.supplier_id
    LEFT JOIN returned_items ri ON ri.purchase_item_id = pi.id
    WHERE pi.product_id = ? AND pu.status = 'completed'
  `;
  const items = db.prepare(`${baseQuery} ORDER BY pu.date DESC, pi.id DESC LIMIT ?`)
    .all(partyId, partyId, id, limit);
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS count,
      MIN(pi.unit_price) AS minUnitPrice,
      MAX(pi.unit_price) AS maxUnitPrice,
      CAST(ROUND(SUM(pi.total) * 1.0 / NULLIF(SUM(pi.quantity), 0)) AS INTEGER) AS averageEffectiveUnitPrice,
      SUM(CASE WHEN ? > 0 AND pu.party_id = ? THEN 1 ELSE 0 END) AS selectedSupplierCount
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchase_id
    WHERE pi.product_id = ? AND pu.status = 'completed'
  `).get(partyId, partyId, id);

  return {
    items,
    summary: {
      count: Number(summary.count || 0),
      minUnitPrice: Number(summary.minUnitPrice || 0),
      maxUnitPrice: Number(summary.maxUnitPrice || 0),
      averageEffectiveUnitPrice: Number(summary.averageEffectiveUnitPrice || 0),
      selectedSupplierCount: Number(summary.selectedSupplierCount || 0)
    }
  };
}

function updateSale(id, payload = {}) {
  const db = requireDatabase();
  requirePermission('sales');
  const saleId = Number(id);
  const existing = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  if (!existing) throw new Error('فاکتور پیدا نشد.');
  if (existing.status === 'cancelled') throw new Error('فاکتور لغوشده قابل ویرایش نیست.');
  const baseTotals = calculateSaleTotals(payload.items, payload.discount, payload.tax, 0);
  validateInventoryQuantities(db, baseTotals.items);
  const paymentTotals = normalizeInvoicePayments(payload.payments, baseTotals.total, payload.paidAmount);
  const totals = { ...baseTotals, ...paymentTotals };
  const party = getPartySnapshot(db, payload.partyId, { name: payload.partyName, phone: payload.partyPhone, address: payload.partyAddress }, ['customer', 'both']);
  const date = normalizeInvoiceDate(payload.date);
  db.exec('BEGIN IMMEDIATE');
  try {
    const oldItems = db.prepare('SELECT product_id AS productId, quantity FROM sale_items WHERE sale_id = ?').all(saleId);
    const adjustStock = db.prepare('UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    for (const item of oldItems) adjustStock.run(Number(item.quantity), item.productId);
    if (existing.party_id && Number(existing.remaining_amount || 0) > 0) {
      db.prepare('UPDATE parties SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(existing.remaining_amount, existing.party_id);
    }
    const products = getAvailableSaleProducts(db, totals.items, getAppSettings().sales.preventOversell !== false && getAppSettings().product.allowNegativeStock !== true);
    let pricedItems = totals.items.map((item) => {
      const product = products.get(item.productId);
      const purchasePrice = Number(product.purchasePrice || 0);
      return { ...item, name: product.name, purchasePrice };
    });
    pricedItems = priceSaleItems(pricedItems, totals.discount, totals.subtotal);
    rejectSalesBelowPurchasePrice(pricedItems);
    const costTotal = pricedItems.reduce((sum, item) => sum + Math.round(item.purchasePrice * item.quantity), 0);
    const profitTotal = pricedItems.reduce((sum, item) => sum + item.profit, 0);
    const itemCount = pricedItems.reduce((sum, item) => sum + item.quantity, 0);
    db.prepare(`UPDATE sales SET party_id = ?, party_name = ?, party_phone = ?, party_address = ?, date = ?, subtotal = ?, discount = ?, tax = ?, total = ?, paid_amount = ?, remaining_amount = ?, cost_total = ?, profit_total = ?, item_count = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(party.partyId, party.partyName, party.partyPhone, party.partyAddress, date, totals.subtotal, totals.discount, totals.tax, totals.total, totals.paidAmount, totals.remainingAmount, costTotal, profitTotal, itemCount, String(payload.notes || ''), saleId);
    db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId);
    db.prepare('DELETE FROM invoice_payments WHERE sale_id = ?').run(saleId);
    db.prepare("DELETE FROM stock_movements WHERE type = 'sale' AND reference_type = 'sale' AND reference_id = ?").run(saleId);
    const insertItem = db.prepare('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount, total, purchase_price, profit, price_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const movement = db.prepare(
      "INSERT INTO stock_movements (product_id, type, quantity, reference_type, reference_id) VALUES (?, 'sale', ?, 'sale', ?)"
    );
    for (const item of pricedItems) {
      insertItem.run(saleId, item.productId, item.quantity, item.unitPrice, item.discount, item.total, item.purchasePrice, item.profit, item.priceType || 'retail');
      adjustStock.run(-item.quantity, item.productId);
      movement.run(item.productId, -item.quantity, saleId);
    }
    insertInvoicePayments(db, 'sale_id', saleId, paymentTotals.payments);
    if (party.partyId && totals.remainingAmount > 0) {
      db.prepare('UPDATE parties SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(totals.remainingAmount, party.partyId);
    }
    db.exec('COMMIT');
    auditLog('sale.update', 'sale', saleId);
    return getInvoiceDetails('sale', saleId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getInvoiceDetails(kind, id) {
  const db = requireDatabase();
  const invoiceId = Number(id);
  const table = kind === 'sale' ? 'sales' : 'purchases';
  const itemTable = kind === 'sale' ? 'sale_items' : 'purchase_items';
  const partyTable = kind === 'sale' ? 'customers' : 'suppliers';
  const partyColumn = kind === 'sale' ? 'customer_id' : 'supplier_id';
  const partyAddressExpression = kind === 'sale' ? "COALESCE(i.party_address, p.address, '')" : "COALESCE(i.party_address, p.address, x.address, '')";
  const invoice = db.prepare(`
    SELECT i.*, COALESCE(i.party_name, trim(p.first_name || ' ' || COALESCE(p.last_name, '')), x.name, '') AS partyName,
      COALESCE(i.party_phone, p.phone, p.mobile, x.phone, '') AS partyPhone,
      ${partyAddressExpression} AS partyAddress
    FROM ${table} i
    LEFT JOIN parties p ON p.id = i.party_id
    LEFT JOIN ${partyTable} x ON x.id = i.${partyColumn}
    WHERE i.id = ?
  `).get(invoiceId);
  if (!invoice) throw new Error('فاکتور پیدا نشد.');
  const items = db.prepare(`
    SELECT ii.*, p.name AS productName, p.code AS productCode, u.name AS unitName, u.symbol AS unitSymbol
    FROM ${itemTable} ii JOIN products p ON p.id = ii.product_id
    LEFT JOIN units u ON u.id = p.unit_id
    WHERE ii.${kind === 'sale' ? 'sale' : 'purchase'}_id = ? ORDER BY ii.id
  `).all(invoiceId);
  const payments = db.prepare('SELECT * FROM invoice_payments WHERE ' + (kind === 'sale' ? 'sale_id' : 'purchase_id') + ' = ? ORDER BY id').all(invoiceId);
  return { ...invoice, items, payments };
}

function settleInvoice(kind, id, payload = {}) {
  const db = requireDatabase();
  requirePermission(kind === 'sale' ? 'sales' : 'purchases');
  const invoiceId = Number(id);
  const table = kind === 'sale' ? 'sales' : 'purchases';
  const invoice = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(invoiceId);
  if (!invoice) throw new Error('فاکتور پیدا نشد.');
  if (invoice.status === 'cancelled') throw new Error('فاکتور لغوشده قابل تسویه نیست.');
  const paymentTotals = normalizeInvoicePayments([payload], Number(invoice.remaining_amount || 0), 0);
  if (!paymentTotals.payments.length) throw new Error('مبلغ پرداخت را وارد کنید.');
  const payment = paymentTotals.payments[0];
  db.exec('BEGIN IMMEDIATE');
  try {
    insertInvoicePayments(db, kind === 'sale' ? 'sale_id' : 'purchase_id', invoiceId, [payment]);
    const nextPaid = Number(invoice.paid_amount || 0) + payment.amount;
    const nextRemaining = Math.max(0, Number(invoice.total || 0) - nextPaid);
    db.prepare(`UPDATE ${table} SET paid_amount = ?, remaining_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(nextPaid, nextRemaining, invoiceId);
    if (payment.amount > 0) {
      if (invoice.party_id) {
      db.prepare('UPDATE parties SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(payment.amount, invoice.party_id);
      }
      if (kind === 'sale' && invoice.customer_id) db.prepare('UPDATE customers SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(payment.amount, invoice.customer_id);
      if (kind === 'purchase' && invoice.supplier_id) db.prepare('UPDATE suppliers SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(payment.amount, invoice.supplier_id);
    }
    db.exec('COMMIT');
    auditLog('invoice.settle', kind, invoiceId, { amount: payment.amount });
    return getInvoiceDetails(kind, invoiceId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function cancelInvoice(kind, id) {
  const db = requireDatabase();
  requirePermission(kind === 'sale' ? 'sales' : 'purchases');
  const invoiceId = Number(id);
  const table = kind === 'sale' ? 'sales' : 'purchases';
  const itemTable = kind === 'sale' ? 'sale_items' : 'purchase_items';
  const invoice = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(invoiceId);
  if (!invoice) throw new Error('فاکتور پیدا نشد.');
  if (invoice.status === 'cancelled') throw new Error('این فاکتور قبلاً لغو شده است.');
  const items = db.prepare(`SELECT product_id AS productId, quantity FROM ${itemTable} WHERE ${kind === 'sale' ? 'sale' : 'purchase'}_id = ?`).all(invoiceId);
  db.exec('BEGIN IMMEDIATE');
  try {
    const stockSign = kind === 'sale' ? 1 : -1;
    const updateStock = db.prepare('UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const movement = db.prepare("INSERT INTO stock_movements (product_id, type, quantity, reference_type, reference_id, description) VALUES (?, ?, ?, ?, ?, ?)");
    for (const item of items) {
      if (kind === 'purchase' && Number(db.prepare('SELECT stock FROM products WHERE id = ?').get(item.productId)?.stock || 0) < Number(item.quantity)) {
        throw new Error('موجودی فعلی برای لغو این فاکتور خرید کافی نیست.');
      }
      updateStock.run(stockSign * Number(item.quantity), item.productId);
      movement.run(item.productId, kind === 'sale' ? 'sale_cancel' : 'purchase_cancel', stockSign * Number(item.quantity), kind, invoiceId, `لغو فاکتور ${invoice.invoice_number}`);
    }
    if (Number(invoice.remaining_amount || 0) > 0) {
      if (invoice.party_id) {
        db.prepare('UPDATE parties SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(invoice.remaining_amount, invoice.party_id);
      }
      if (kind === 'sale' && invoice.customer_id) db.prepare('UPDATE customers SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(invoice.remaining_amount, invoice.customer_id);
      if (kind === 'purchase' && invoice.supplier_id) db.prepare('UPDATE suppliers SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(invoice.remaining_amount, invoice.supplier_id);
    }
    db.prepare(`UPDATE ${table} SET status = 'cancelled', remaining_amount = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(invoiceId);
    db.exec('COMMIT');
    auditLog('invoice.cancel', kind, invoiceId);
    return getInvoiceDetails(kind, invoiceId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function setSalePinned(id, pinned) {
  const db = requireDatabase();
  requirePermission('sales');
  const saleId = Number(id);
  const result = db.prepare('UPDATE sales SET pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(pinned ? 1 : 0, saleId);
  if (!result.changes) throw new Error('فاکتور پیدا نشد.');
  auditLog(pinned ? 'sale.pin' : 'sale.unpin', 'sale', saleId);
  return { id: saleId, pinned: Boolean(pinned) };
}

module.exports = { cancelInvoice, createPurchase, createSale, getAvailableSaleProducts, getInvoiceDetails, getNextInvoiceNumber, getPartySnapshot, getPurchasePriceHistory, gregorianToJalaliYear, insertInvoicePayments, invoiceListQuery, isValidIsoDate, listPurchases, listSales, mergeDailySales, nextInvoiceNumber, normalizeInvoiceDate, normalizeInvoicePayments, priceSaleItems, rejectSalesBelowPurchasePrice, setSalePinned, settleInvoice, updateSale, validateInventoryQuantities };
