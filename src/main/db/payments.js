// payments.js — checks and installment plans tied to invoices.
// Split mechanically from database.js; function bodies are unchanged.

const { auditLog, requireDatabase, requirePermission } = require('./core');
const { insertInvoicePayments, isValidIsoDate, normalizeInvoicePayments } = require('./invoices');

function listChecks(payload = {}) {
  const db = requireDatabase();
  const status = ['pending', 'cleared', 'bounced', 'cancelled'].includes(String(payload.status)) ? String(payload.status) : '';
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  const query = String(payload.query || '').trim();
  return db.prepare(`
    SELECT ip.id, ip.method, ip.amount, ip.paid_at AS paidAt, ip.check_number AS checkNumber,
      ip.bank_name AS bankName, ip.due_date AS dueDate, ip.check_holder AS checkHolder,
      ip.check_status AS checkStatus, ip.notes,
      CASE WHEN ip.sale_id IS NOT NULL THEN 'sale' ELSE 'purchase' END AS invoiceKind,
      COALESCE(s.invoice_number, p.invoice_number) AS invoiceNumber,
      COALESCE(s.party_name, p.party_name, '') AS partyName,
      COALESCE(s.party_phone, p.party_phone, '') AS partyPhone
    FROM invoice_payments ip
    LEFT JOIN sales s ON s.id = ip.sale_id
    LEFT JOIN purchases p ON p.id = ip.purchase_id
    WHERE ip.method = 'check'
      AND (? = '' OR ip.check_status = ?)
      AND (? = '' OR ip.due_date >= ?)
      AND (? = '' OR ip.due_date <= ?)
      AND (? = '' OR ip.check_number LIKE ? OR COALESCE(s.invoice_number, p.invoice_number) LIKE ? OR COALESCE(s.party_name, p.party_name, '') LIKE ?)
    ORDER BY CASE WHEN ip.check_status = 'pending' THEN 0 ELSE 1 END, ip.due_date, ip.id DESC
    LIMIT 1000
  `).all(status, status, from, from, to, to, query, `%${query}%`, `%${query}%`, `%${query}%`);
}

function updateCheckStatus(id, status, notes = '') {
  requirePermission('cash');
  const valid = ['pending', 'cleared', 'bounced', 'cancelled'];
  if (!valid.includes(String(status))) throw new Error('وضعیت چک معتبر نیست.');
  const db = requireDatabase();
  const check = db.prepare("SELECT id, sale_id AS saleId, purchase_id AS purchaseId FROM invoice_payments WHERE id = ? AND method = 'check'").get(Number(id));
  if (!check) throw new Error('چک پیدا نشد.');
  const result = db.prepare('UPDATE invoice_payments SET check_status = ?, notes = COALESCE(?, notes) WHERE id = ?').run(String(status), String(notes || '').trim() || null, Number(id));
  if (!result.changes) throw new Error('وضعیت چک تغییر نکرد.');
  auditLog('check.status', check.saleId ? 'sale' : 'purchase', check.saleId || check.purchaseId, { paymentId: Number(id), status });
  return listChecks({ query: '' }).find((item) => item.id === Number(id));
}

function refreshInstallmentStatuses(db, planId = null, today = new Date().toISOString().slice(0, 10)) {
  const where = planId == null ? '' : 'WHERE i.plan_id = ?';
  const rows = db.prepare(`SELECT i.id, i.amount, i.paid_amount AS paidAmount, i.due_date AS dueDate, i.status FROM installments i ${where}`).all(...(planId == null ? [] : [Number(planId)]));
  const update = db.prepare('UPDATE installments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  for (const row of rows) {
    if (row.status === 'cancelled') continue;
    const paid = Number(row.paidAmount || 0);
    const amount = Number(row.amount || 0);
    const status = paid >= amount ? 'paid' : paid > 0 ? 'partial' : (row.dueDate < today ? 'overdue' : 'pending');
    if (status !== row.status) update.run(status, row.id);
  }
}

function createInstallmentPlan(payload = {}) {
  const db = requireDatabase();
  const invoiceKind = ['sale', 'purchase'].includes(String(payload.invoiceKind)) ? String(payload.invoiceKind) : 'sale';
  requirePermission(invoiceKind === 'sale' ? 'sales' : 'purchases');
  const invoiceId = Number(payload.invoiceId);
  const table = invoiceKind === 'sale' ? 'sales' : 'purchases';
  const invoice = db.prepare(`SELECT id, total, remaining_amount AS remainingAmount, status FROM ${table} WHERE id = ?`).get(invoiceId);
  if (!invoice) throw new Error('فاکتور برای تقسیط پیدا نشد.');
  if (invoice.status === 'cancelled') throw new Error('فاکتور لغوشده قابل تقسیط نیست.');
  if (Number(invoice.remainingAmount) <= 0) throw new Error('این فاکتور مانده قابل تقسیط ندارد.');
  if (db.prepare('SELECT id FROM installment_plans WHERE invoice_kind = ? AND invoice_id = ? AND status = ?').get(invoiceKind, invoiceId, 'active')) {
    throw new Error('برای این فاکتور برنامه اقساط فعال وجود دارد.');
  }
  const raw = Array.isArray(payload.installments) ? payload.installments : [];
  if (!raw.length || raw.length > 120) throw new Error('حداقل یک و حداکثر ۱۲۰ قسط وارد کنید.');
  const installments = raw.map((item, index) => ({
    number: index + 1,
    dueDate: String(item.dueDate || '').trim(),
    amount: Math.round(Number(item.amount || 0))
  }));
  if (installments.some((item) => !/^\d{4}-\d{2}-\d{2}$/.test(item.dueDate) || item.amount <= 0)) throw new Error('تاریخ یا مبلغ قسط نامعتبر است.');
  if (installments.some((item) => !isValidIsoDate(item.dueDate))) throw new Error('تاریخ قسط نامعتبر است.');
  const totalAmount = installments.reduce((sum, item) => sum + item.amount, 0);
  if (totalAmount !== Number(invoice.remainingAmount)) throw new Error('جمع اقساط باید دقیقاً برابر مانده فاکتور باشد.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(`
      INSERT INTO installment_plans (invoice_kind, invoice_id, total_amount, installment_count, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(invoiceKind, invoiceId, totalAmount, installments.length, String(payload.notes || '').trim() || null);
    const planId = Number(result.lastInsertRowid);
    const insert = db.prepare('INSERT INTO installments (plan_id, installment_number, due_date, amount, notes) VALUES (?, ?, ?, ?, ?)');
    installments.forEach((item) => insert.run(planId, item.number, item.dueDate, item.amount, String(payload.notes || '').trim() || null));
    db.exec('COMMIT');
    auditLog('installment.plan.create', invoiceKind, invoiceId, { planId, count: installments.length, totalAmount });
    return listInstallmentPlans({ id: planId })[0];
  } catch (error) {
    db.exec('ROLLBACK');
    if (String(error.message).includes('UNIQUE')) throw new Error('برای این فاکتور برنامه اقساط فعال وجود دارد.');
    throw error;
  }
}

function listInstallmentPlans(payload = {}) {
  const db = requireDatabase();
  refreshInstallmentStatuses(db);
  const conditions = [];
  const params = [];
  if (payload.id) { conditions.push('ip.id = ?'); params.push(Number(payload.id)); }
  if (['sale', 'purchase'].includes(String(payload.invoiceKind))) { conditions.push('ip.invoice_kind = ?'); params.push(String(payload.invoiceKind)); }
  if (['active', 'completed', 'cancelled'].includes(String(payload.status))) { conditions.push('ip.status = ?'); params.push(String(payload.status)); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const plans = db.prepare(`
    SELECT ip.id, ip.invoice_kind AS invoiceKind, ip.invoice_id AS invoiceId,
      ip.total_amount AS totalAmount, ip.installment_count AS installmentCount,
      ip.status, ip.notes, ip.created_at AS createdAt,
      COALESCE(s.invoice_number, p.invoice_number) AS invoiceNumber,
      COALESCE(s.party_name, p.party_name, '') AS partyName,
      COALESCE(s.remaining_amount, p.remaining_amount, 0) AS invoiceRemaining
    FROM installment_plans ip
    LEFT JOIN sales s ON ip.invoice_kind = 'sale' AND s.id = ip.invoice_id
    LEFT JOIN purchases p ON ip.invoice_kind = 'purchase' AND p.id = ip.invoice_id
    ${where}
    ORDER BY ip.id DESC
  `).all(...params);
  const installments = db.prepare(`
    SELECT i.id, i.plan_id AS planId, i.installment_number AS installmentNumber,
      i.due_date AS dueDate, i.amount, i.paid_amount AS paidAmount, i.status, i.notes
    FROM installments i ORDER BY i.due_date, i.installment_number
  `).all();
  const updatePlan = db.prepare("UPDATE installment_plans SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'");
  const cancelOpenInstallments = db.prepare("UPDATE installments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE plan_id = ? AND status IN ('pending', 'partial')");
  return plans.map((plan) => {
    const rows = installments.filter((item) => item.planId === plan.id);
    // An invoice may have been settled outside the installment screen
    // (for example from invoice details). Do not leave stale "pay" buttons
    // visible for a plan whose invoice has no remaining balance.
    if (plan.status === 'active' && Number(plan.invoiceRemaining || 0) <= 0) {
      cancelOpenInstallments.run(plan.id);
      updatePlan.run(plan.id);
      rows.forEach((item) => {
        if (['pending', 'partial'].includes(item.status)) item.status = 'cancelled';
      });
      plan.status = 'completed';
    } else if (rows.length && rows.every((item) => item.status === 'paid')) {
      updatePlan.run(plan.id); plan.status = 'completed';
    }
    return { ...plan, installments: rows };
  });
}

function recordInstallmentPayment(id, payload = {}) {
  const db = requireDatabase();
  const installment = db.prepare(`
    SELECT i.*, ip.invoice_kind AS invoiceKind, ip.invoice_id AS invoiceId
    FROM installments i JOIN installment_plans ip ON ip.id = i.plan_id WHERE i.id = ?
  `).get(Number(id));
  if (!installment) throw new Error('قسط پیدا نشد.');
  requirePermission(installment.invoiceKind === 'sale' ? 'sales' : 'purchases');
  if (installment.status === 'cancelled' || installment.status === 'paid') throw new Error('این قسط قابل پرداخت نیست.');
  const amount = Math.round(Number(payload.amount || 0));
  if (!amount || amount > Number(installment.amount) - Number(installment.paid_amount || 0)) throw new Error('مبلغ پرداخت قسط نامعتبر است.');
  const method = ['cash', 'card', 'check'].includes(String(payload.method)) ? String(payload.method) : 'cash';
  const invoiceTable = installment.invoiceKind === 'sale' ? 'sales' : 'purchases';
  const invoice = db.prepare(`SELECT * FROM ${invoiceTable} WHERE id = ?`).get(installment.invoiceId);
  const invoiceRemaining = Number(invoice?.remaining_amount || 0);
  if (!invoice) throw new Error('فاکتور مرتبط با قسط پیدا نشد.');
  if (invoiceRemaining <= 0) {
    db.prepare("UPDATE installments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('pending', 'partial')")
      .run(installment.id);
    db.prepare("UPDATE installment_plans SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'")
      .run(installment.plan_id);
    throw new Error('فاکتور مرتبط قبلاً تسویه شده است و این قسط قابل پرداخت نیست.');
  }
  if (invoiceRemaining < amount) throw new Error(`مبلغ پرداختی از مانده فاکتور (${invoiceRemaining}) بیشتر است.`);
  const payment = normalizeInvoicePayments([{ ...payload, method, amount: amount / 100 }], Number(invoice.remaining_amount), 0).payments[0];
  db.exec('BEGIN IMMEDIATE');
  try {
    insertInvoicePayments(db, installment.invoiceKind === 'sale' ? 'sale_id' : 'purchase_id', installment.invoiceId, [payment]);
    const paymentId = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
    const nextPaid = Number(invoice.paid_amount || 0) + payment.amount;
    db.prepare(`UPDATE ${invoiceTable} SET paid_amount = ?, remaining_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(nextPaid, Math.max(0, Number(invoice.total) - nextPaid), installment.invoiceId);
    const installmentPaid = Number(installment.paid_amount || 0) + payment.amount;
    db.prepare('UPDATE installments SET paid_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(installmentPaid, installmentPaid >= Number(installment.amount) ? 'paid' : 'partial', installment.id);
    db.prepare('INSERT INTO installment_payments (installment_id, invoice_payment_id, amount, paid_at, method, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(installment.id, paymentId, payment.amount, payment.paidAt, payment.method, payment.notes);
    if (invoice.party_id) db.prepare('UPDATE parties SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(payment.amount, invoice.party_id);
    if (installment.invoiceKind === 'sale' && invoice.customer_id) db.prepare('UPDATE customers SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(payment.amount, invoice.customer_id);
    if (installment.invoiceKind === 'purchase' && invoice.supplier_id) db.prepare('UPDATE suppliers SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(payment.amount, invoice.supplier_id);
    db.exec('COMMIT');
    auditLog('installment.payment', installment.invoiceKind, installment.invoiceId, { installmentId: installment.id, amount: payment.amount });
    return listInstallmentPlans({ id: installment.plan_id })[0];
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { createInstallmentPlan, listChecks, listInstallmentPlans, recordInstallmentPayment, refreshInstallmentStatuses, updateCheckStatus };
