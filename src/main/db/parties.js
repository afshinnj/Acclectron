// parties.js — parties (customers/suppliers), customer search and party ledger.
// Split mechanically from database.js; function bodies are unchanged.

const { requireDatabase } = require('./core');

function listParties(query = '', type = '', includeInactive = true) {
  const db = requireDatabase();
  const term = `%${String(query).trim()}%`;
  const partyType = ['customer', 'supplier', 'both'].includes(String(type)) ? String(type) : '';
  return db.prepare(`
    SELECT id, code, first_name AS firstName, last_name AS lastName,
      trim(first_name || ' ' || COALESCE(last_name, '')) AS name,
      phone, mobile, address, party_type AS partyType, description,
      balance, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
    FROM parties
    WHERE (? = 1 OR is_active = 1)
      AND (? = '' OR party_type = ?)
      AND (
        first_name LIKE ? OR COALESCE(last_name, '') LIKE ? OR
        trim(first_name || ' ' || COALESCE(last_name, '')) LIKE ? OR
        code LIKE ? OR COALESCE(phone, '') LIKE ? OR COALESCE(mobile, '') LIKE ?
      )
    ORDER BY is_active DESC, first_name COLLATE NOCASE, last_name COLLATE NOCASE
  `).all(includeInactive ? 1 : 0, partyType, partyType, term, term, term, term, term, term);
}

function normalizePartyPayload(payload = {}) {
  const firstName = String(payload.firstName || '').trim();
  const lastName = String(payload.lastName || '').trim();
  const partyType = String(payload.partyType || '').trim();
  if (!firstName) throw new Error('نام طرف حساب الزامی است.');
  if (!['customer', 'supplier', 'both'].includes(partyType)) throw new Error('نوع طرف حساب معتبر نیست.');
  return {
    firstName,
    lastName,
    phone: String(payload.phone || '').trim(),
    mobile: String(payload.mobile || '').trim(),
    address: String(payload.address || '').trim(),
    partyType,
    description: String(payload.description || '').trim()
  };
}

function generatePartyCode(excludeId = null) {
  const db = requireDatabase();
  const rows = db.prepare(
    'SELECT code FROM parties WHERE code LIKE ?' + (excludeId ? ' AND id <> ?' : '')
  ).all(...(excludeId ? ['PT-%', excludeId] : ['PT-%']));
  let sequence = 1;
  for (const row of rows) {
    const match = /^PT-(\d+)$/.exec(String(row.code));
    if (match) sequence = Math.max(sequence, Number(match[1]) + 1);
  }
  return `PT-${String(sequence).padStart(4, '0')}`;
}

function createParty(payload = {}) {
  const db = requireDatabase();
  const party = normalizePartyPayload(payload);
  const result = db.prepare(`
    INSERT INTO parties
      (code, first_name, last_name, phone, mobile, address, party_type, description, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    generatePartyCode(), party.firstName, party.lastName, party.phone, party.mobile,
    party.address, party.partyType, party.description
  );
  return listParties('', '', true).find((item) => item.id === Number(result.lastInsertRowid));
}

function updateParty(id, payload = {}) {
  const db = requireDatabase();
  const partyId = Number(id);
  const party = normalizePartyPayload(payload);
  const result = db.prepare(`
    UPDATE parties SET first_name = ?, last_name = ?, phone = ?, mobile = ?,
      address = ?, party_type = ?, description = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    party.firstName, party.lastName, party.phone, party.mobile,
    party.address, party.partyType, party.description, partyId
  );
  if (!result.changes) throw new Error('طرف حساب پیدا نشد.');
  return listParties('', '', true).find((item) => item.id === partyId);
}

function setPartyActive(id, isActive = false) {
  const db = requireDatabase();
  const partyId = Number(id);
  const result = db.prepare('UPDATE parties SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(isActive ? 1 : 0, partyId);
  if (!result.changes) throw new Error('طرف حساب پیدا نشد.');
  return listParties('', '', true).find((item) => item.id === partyId);
}

function searchCustomers(query = '') {
  const db = requireDatabase();
  const term = `%${String(query).trim()}%`;
  return db.prepare(`
    SELECT id, code, name, phone, balance
    FROM customers
    WHERE is_active = 1 AND (name LIKE ? OR code LIKE ? OR phone LIKE ?)
    ORDER BY name LIMIT 30
  `).all(term, term, term);
}

function getPartyLedger(partyId, payload = {}) {
  const db = requireDatabase();
  const id = Number(partyId);
  const party = db.prepare(`
    SELECT id, code, trim(first_name || ' ' || COALESCE(last_name, '')) AS name,
      party_type AS partyType, balance, phone, mobile, address
    FROM parties WHERE id = ?
  `).get(id);
  if (!party) throw new Error('طرف‌حساب پیدا نشد.');
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  const events = [];
  const add = (date, kind, reference, referenceId, description, debit, credit) => {
    events.push({ date, kind, reference, referenceId, description, debit: Number(debit || 0), credit: Number(credit || 0) });
  };
  const sales = db.prepare(`SELECT id, invoice_number AS invoiceNumber, date, total, source FROM sales WHERE party_id = ? AND status = 'active' ORDER BY date, id`).all(id);
  for (const row of sales) {
    add(row.date, 'sale', row.invoiceNumber, row.id, row.source === 'daily' ? 'فروش روزانه' : 'فاکتور فروش', row.total, 0);
    const payments = db.prepare('SELECT id, amount, paid_at AS paidAt, method FROM invoice_payments WHERE sale_id = ? ORDER BY id').all(row.id);
    // Keep invoice and its payments together in period ledgers, even when a
    // payment was entered after the invoice date.
    for (const payment of payments) add(row.date, 'payment', row.invoiceNumber, payment.id, `دریافت فروش (${payment.method})`, 0, payment.amount);
  }
  const saleReturns = db.prepare(`
    SELECT sr.id, sr.return_number AS returnNumber, sr.date, sr.total
    FROM sales_returns sr JOIN sales s ON s.id = sr.sale_id
    WHERE s.party_id = ? AND sr.status = 'completed' ORDER BY sr.date, sr.id
  `).all(id);
  for (const row of saleReturns) add(row.date, 'sale_return', row.returnNumber, row.id, 'مرجوعی فروش', 0, row.total);
  const purchases = db.prepare(`SELECT id, invoice_number AS invoiceNumber, date, total FROM purchases WHERE party_id = ? AND status = 'completed' ORDER BY date, id`).all(id);
  for (const row of purchases) {
    add(row.date, 'purchase', row.invoiceNumber, row.id, 'فاکتور خرید', 0, row.total);
    const payments = db.prepare('SELECT id, amount, paid_at AS paidAt, method FROM invoice_payments WHERE purchase_id = ? ORDER BY id').all(row.id);
    for (const payment of payments) add(row.date, 'payment', row.invoiceNumber, payment.id, `پرداخت خرید (${payment.method})`, payment.amount, 0);
  }
  const purchaseReturns = db.prepare(`
    SELECT pr.id, pr.return_number AS returnNumber, pr.date, pr.total
    FROM purchase_returns pr JOIN purchases p ON p.id = pr.purchase_id
    WHERE p.party_id = ? AND pr.status = 'completed' ORDER BY pr.date, pr.id
  `).all(id);
  for (const row of purchaseReturns) add(row.date, 'purchase_return', row.returnNumber, row.id, 'مرجوعی خرید', row.total, 0);
  events.sort((a, b) => a.date.localeCompare(b.date) || a.referenceId - b.referenceId);
  const openingBalance = from
    ? events.filter((event) => event.date < from).reduce((sum, event) => sum + event.debit - event.credit, 0)
    : 0;
  const rangedEvents = events.filter((event) => (!from || event.date >= from) && (!to || event.date <= to));
  let running = openingBalance;
  for (const event of rangedEvents) {
    running += event.debit - event.credit;
    event.balance = running;
  }
  const debit = rangedEvents.reduce((sum, event) => sum + event.debit, 0);
  const credit = rangedEvents.reduce((sum, event) => sum + event.credit, 0);
  return { party, filters: { from, to }, openingBalance, debit, credit, closingBalance: openingBalance + debit - credit, events: rangedEvents };
}

module.exports = { createParty, generatePartyCode, getPartyLedger, listParties, normalizePartyPayload, searchCustomers, setPartyActive, updateParty };
