import { renderer, registerRendererBindings } from '../shared/runtime.mjs';

/* Keyboard-first invoice editor. It intentionally replaces the original
   card-based sales view while keeping the same IPC contract. */
function invoiceMarkup(kind) {
  const sale = kind === 'sale';
  const id = sale ? 'sale' : 'purchase';
  return `<div class="page-heading"><div><span class="eyebrow">عملیات ${sale ? 'فروش' : 'خرید'}</span><h2>فاکتور ${sale ? 'فروش' : 'خرید'}</h2></div><label class="sale-date-field">تاریخ<input class="invoice-date" id="${id}Date" type="date"></label></div>
  <div class="invoice-layout"><section class="panel invoice-editor"><div class="invoice-toolbar"><label>${sale ? 'مشتری' : 'تأمین‌کننده'}<input class="party-input" data-kind="${kind}" id="${id}Party" placeholder="جست‌وجو..." autocomplete="off"><div class="party-suggestions hidden" id="${id}PartySuggestions"></div></label><button type="button" class="secondary invoice-new-row" data-kind="${kind}">＋ ردیف جدید</button>${kind === 'purchase' ? '<button type="button" class="secondary invoice-new-product" data-kind="purchase">＋ ثبت کالای جدید</button>' : ''}</div>
  <div class="table-wrap invoice-table-wrap"><table class="invoice-table"><thead><tr><th>محصول</th><th>تعداد</th><th>قیمت واحد</th><th>تخفیف</th><th>مبلغ کل</th><th></th></tr></thead><tbody id="${id}InvoiceItems"></tbody></table></div>
  <div id="${id}InvoiceError" class="form-error hidden"></div><div class="shortcut-guide"><span>راهنما</span><kbd>↑↓</kbd> پیمایش <kbd>Enter</kbd> انتخاب/مرحله بعد <kbd>Tab</kbd> پرداخت <kbd>Ctrl+Delete</kbd> حذف ردیف <kbd>Ctrl+Enter</kbd> ثبت <kbd>Esc</kbd> بستن پیشنهادها</div></section>
  <aside class="panel invoice-summary"><h3>خلاصه فاکتور</h3><div class="summary-lines"><div><span>جمع کالاها</span><strong id="${id}Subtotal">${renderer.money(0)}</strong></div><div><span>تخفیف</span><input class="money-input invoice-discount" id="${id}Discount" value="0" inputmode="decimal"></div><div><span>مالیات</span><input class="money-input invoice-tax" id="${id}Tax" value="0" inputmode="decimal"></div><div class="grand-total"><span>مبلغ نهایی</span><strong id="${id}Total">${renderer.money(0)}</strong></div></div>
  <div class="payment-box"><div class="payment-heading"><h4>پرداخت</h4><button type="button" class="text-button payment-full" data-kind="${kind}">تسویه کامل</button></div><div class="payment-entry"><select class="payment-method" id="${id}PaymentMethod"><option value="cash">نقدی</option><option value="card">کارت</option><option value="check">چک</option></select><input class="money-input payment-amount" id="${id}PaymentAmount" value="0" inputmode="decimal" placeholder="مبلغ"></div><div class="check-fields hidden" id="${id}CheckFields"><input id="${id}CheckNumber" placeholder="شماره چک"><input id="${id}BankName" placeholder="بانک"><input id="${id}DueDate" type="date"></div><button class="ghost add-payment" data-kind="${kind}" type="button">＋ افزودن پرداخت</button><div class="payment-list" id="${id}Payments"></div></div><div class="summary-lines"><div class="remaining"><span>مانده</span><strong id="${id}Remaining">${renderer.money(0)}</strong></div></div><button class="primary wide invoice-save" data-kind="${kind}" type="button">ثبت فاکتور</button><button class="secondary wide invoice-print" data-kind="${kind}" type="button">ثبت و چاپ</button><button class="text-button invoice-clear" data-kind="${kind}" type="button">پاک‌کردن فاکتور</button></aside></div>`;
}

function newInvoiceItem(kind) {
  return {
    query: '', productId: null, name: '', code: '', stock: 0, quantity: 1, unitPrice: 0, discount: 0,
    priceType: kind === 'sale' ? 'retail' : 'purchase', purchasePriceOptions: [],
    purchasePriceOpen: false, purchasePriceActiveIndex: -1
  };
}

// هر دو نوع فاکتور (فروش و خرید) یک ردیف ورود خالی در بالای لیست دارند که
// محصول در آن تایپ یا اسکن می‌شود؛ ردیف‌های پایین فقط‌خواندنی هستند. این
// ردیف هم در ثبت و هم در ویرایش فاکتور یکسان است.
function invoiceHasEntryRow(kind) {
  return kind === 'sale' || kind === 'purchase';
}

function enhanceInvoiceMeta(kind, page) {
  const id = kind === 'sale' ? 'sale' : 'purchase';
  const heading = page.querySelector('.page-heading');
  heading?.querySelector('h2')?.remove();
  const dateField = heading?.querySelector('.sale-date-field');
  const dateInput = dateField?.querySelector('.invoice-date');
  if (dateInput) {
    dateInput.type = 'text';
    dateInput.placeholder = '۱۴۰۵/۰۱/۰۹';
    dateInput.inputMode = 'numeric';
    dateInput.value = renderer.isoToJalali(new Date().toISOString().slice(0, 10));
  }
  if (dateField && !heading.querySelector('.invoice-meta-fields')) {
    const meta = document.createElement('div');
    meta.className = 'invoice-meta-fields';
    const numberField = document.createElement('label');
    numberField.className = 'invoice-number-field';
    numberField.innerHTML = `شماره فاکتور<input class="invoice-number" id="${id}InvoiceNumber" placeholder="خودکار" readonly>`;
    meta.append(numberField, dateField);
    heading.append(meta);
  }
  const toolbar = page.querySelector('.invoice-toolbar');
  if (toolbar && !page.querySelector(`#${id}PartyDetails`)) {
    toolbar.insertAdjacentHTML('afterend', `<div class="party-details hidden" id="${id}PartyDetails"></div>`);
  }
}

function invoiceMarkupAndBind() {
  const page = renderer.$('#salesPage');
  if (!page || page.dataset.keyboardInvoice) return;
  const salesInvoice = document.createElement('section');
  salesInvoice.id = 'salesInvoicePage';
  salesInvoice.className = 'page hidden';
  salesInvoice.innerHTML = invoiceMarkup('sale');
  enhanceInvoiceMeta('sale', salesInvoice);
  const purchase = document.createElement('section');
  purchase.id = 'purchasesPage'; purchase.className = 'page hidden'; purchase.innerHTML = invoiceMarkup('purchase'); enhanceInvoiceMeta('purchase', purchase); renderer.$('#placeholderPage').before(purchase);
  renderer.$('#placeholderPage').before(salesInvoice);
  const lists = document.createElement('div');
  lists.innerHTML = invoiceListMarkup('sales') + invoiceListMarkup('purchases');
  renderer.$('#placeholderPage').before(lists);
  document.querySelectorAll('.invoice-list-from').forEach((input) => { input.id = `${input.dataset.kind}FromDate`; });
  document.querySelectorAll('.invoice-list-to').forEach((input) => { input.id = `${input.dataset.kind}ToDate`; });
  document.body.insertAdjacentHTML('beforeend', `<div id="invoiceDetailsBackdrop" class="modal-backdrop hidden"><div id="invoiceDetailsModal" class="modal invoice-details-modal"></div></div>`);
  const nav = document.querySelector('nav');
  const dailySalesButton = nav?.querySelector('button.nav-item[data-page="sales"]');
  if (dailySalesButton && !nav.querySelector('.invoice-menu')) dailySalesButton.insertAdjacentHTML('afterend', `<div class="invoice-menu"><button type="button" class="nav-item invoice-menu-toggle" aria-expanded="false"><span>▤</span><span class="nav-label">فاکتورها</span><span class="invoice-menu-chevron">⌄</span></button><div class="invoice-submenu hidden"><button class="nav-item invoice-submenu-item" data-page="sales-invoice"><span>＋</span><span class="nav-label">ثبت فاکتور فروش</span></button><button class="nav-item invoice-submenu-item" data-page="purchases"><span>↙</span><span class="nav-label">ثبت فاکتور خرید</span></button><button class="nav-item invoice-submenu-item" data-page="sales-invoices"><span>☷</span><span class="nav-label">فاکتورهای فروش</span></button><button class="nav-item invoice-submenu-item" data-page="purchase-invoices"><span>☷</span><span class="nav-label">فاکتورهای خرید</span></button></div></div>`);
  nav?.querySelector('.invoice-menu-toggle')?.addEventListener('click', () => {
    const menu = nav.querySelector('.invoice-menu');
    const submenu = menu?.querySelector('.invoice-submenu');
    const expanded = menu?.classList.toggle('open');
    submenu?.classList.toggle('hidden', !expanded);
    menu?.querySelector('.invoice-menu-toggle')?.setAttribute('aria-expanded', String(Boolean(expanded)));
  });
  document.querySelectorAll('.invoice-date').forEach((input) => { input.value = renderer.isoToJalali(new Date().toISOString().slice(0, 10)); });
  renderer.bindJalaliDatePickers();
  document.querySelectorAll('.invoice-date').forEach((input) => input.addEventListener('change', async () => {
    const kind = input.id.startsWith('sale') ? 'sale' : 'purchase';
    if (renderer.invoiceState[kind].editingId) return;
    const date = renderer.jalaliInputToIso(input.value);
    if (date) renderer.$(`#${kind}InvoiceNumber`).value = await window.api.invoices.nextNumber(kind, date);
  }));
  page.dataset.keyboardInvoice = '1';
  bindKeyboardInvoices();
  bindInvoiceLists();
  // Catalogue reads are guarded; the boot copy is rejected before login and
  // re-issued by refreshAfterLogin, so keep the boot start quiet.
  if (renderer.sessionReady) { loadKeyboardInvoice('sale'); loadKeyboardInvoice('purchase'); }
}

function invoiceListMarkup(kind) {
  const sale = kind === 'sales';
  const pageKey = kind === 'purchases' ? 'purchase' : kind;
  const mergeButton = sale ? '<button id="mergeDailySales" class="secondary" type="button" disabled>ادغام فروش‌های روزانه</button>' : '';
  const selectionHeader = sale ? '<th class="invoice-selection-column">انتخاب</th>' : '';
  return `<section id="${pageKey}InvoicesPage" class="page hidden invoice-list-page"><div class="page-heading"><div><span class="eyebrow">مدیریت سوابق</span><h2>فاکتورهای ${sale ? 'فروش' : 'خرید'}</h2></div><div class="invoice-list-actions">${mergeButton}<button class="primary" data-page="${sale ? 'sales-invoice' : 'purchases'}">＋ فاکتور جدید</button></div></div><div class="panel invoice-list-filters"><input class="invoice-list-query" data-kind="${kind}" placeholder="جست‌وجوی شماره، طرف‌حساب یا تلفن"><input class="invoice-list-product-query" data-kind="${kind}" placeholder="نام محصول"><input class="invoice-list-from" data-kind="${kind}" type="date" placeholder="از تاریخ شمسی"><input class="invoice-list-to" data-kind="${kind}" type="date" placeholder="تا تاریخ شمسی"><select class="invoice-list-status" data-kind="${kind}"><option value="">همه وضعیت‌ها</option><option value="${sale ? 'active' : 'completed'}">دارای مانده/فعال</option><option value="cancelled">لغوشده</option>${sale ? '<option value="merged">فاکتورهای ادغام‌شده</option>' : ''}</select></div><div class="panel table-panel"><div class="table-wrap"><table><thead><tr>${selectionHeader}<th>شماره</th><th>تاریخ</th><th>طرف‌حساب</th><th>مبلغ کل</th><th>پرداخت‌شده</th><th>مانده</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody id="${kind}Table"></tbody></table></div></div></section>`;
}

function invoiceListKindToApi(kind) { return kind === 'sales' ? 'sale' : 'purchase'; }
function invoiceListPageSelector(kind) { return `#${kind === 'purchases' ? 'purchase' : kind}InvoicesPage`; }
function invoiceStatusLabel(status, row = {}) {
  if (row.mergedIntoInvoiceNumber) return `ادغام‌شده در ${row.mergedIntoInvoiceNumber}`;
  if (status === 'cancelled') return 'لغوشده';
  if (Number(row.remainingAmount || 0) === 0) return 'تسویه‌شده';
  return 'دارای مانده';
}
async function loadInvoiceList(kind) {
  const apiKind = invoiceListKindToApi(kind);
  const pageSelector = invoiceListPageSelector(kind);
  const query = renderer.$(`${pageSelector} .invoice-list-query`)?.value || '';
  const productQuery = renderer.$(`${pageSelector} .invoice-list-product-query`)?.value || '';
  const fromValue = renderer.$(`${pageSelector} .invoice-list-from`)?.value || '';
  const toValue = renderer.$(`${pageSelector} .invoice-list-to`)?.value || '';
  const body = renderer.$(`#${kind}Table`);
  const columnCount = apiKind === 'sale' ? 9 : 8;
  if (body) body.innerHTML = Array.from({ length: 6 }, () => `<tr class="skeleton-row"><td colspan="${columnCount}"><div class="skeleton line-skeleton"></div></td></tr>`).join('');
  const rows = await (apiKind === 'sale' ? window.api.sales.list : window.api.purchases.list)({ query, productQuery, from: renderer.jalaliInputToIso(fromValue), to: renderer.jalaliInputToIso(toValue), status: renderer.$(`${pageSelector} .invoice-list-status`)?.value || '' });
  body.innerHTML = rows.length ? rows.map((row) => {
    const eligibleForMerge = apiKind === 'sale' && row.source === 'daily' && row.status === 'active';
    const selection = apiKind === 'sale' ? `<td class="invoice-selection-column">${eligibleForMerge ? `<input class="daily-sale-merge-select" type="checkbox" value="${row.id}" data-date="${row.date}" aria-label="انتخاب ${renderer.esc(row.invoiceNumber)} برای ادغام">` : ''}</td>` : '';
    return `<tr class="${apiKind === 'sale' && row.pinned ? 'pinned-row' : ''}">${selection}<td><strong>${renderer.esc(row.invoiceNumber)}</strong>${apiKind === 'sale' && row.pinned ? '<span class="pin-badge" title="سنجاق‌شده">📌</span>' : ''}</td><td>${renderer.isoToJalali(row.date)}</td><td>${apiKind === 'sale' && row.source === 'daily' ? '<span class="daily-sale-party">فروش روزانه</span>' : renderer.esc(row.partyName || 'بدون طرف‌حساب')}</td><td>${renderer.money(row.total)}</td><td>${renderer.money(row.paidAmount)}</td><td class="${row.remainingAmount > 0 ? 'debt-amount' : ''}">${renderer.money(row.remainingAmount)}</td><td><span class="status-badge ${row.status === 'cancelled' ? 'inactive' : row.remainingAmount > 0 ? 'warning' : 'active'}">${invoiceStatusLabel(row.status, row)}</span></td><td>${apiKind === 'sale' ? `<button class="table-action pin-invoice${row.pinned ? ' pinned' : ''}" data-kind="${apiKind}" data-id="${row.id}" data-pinned="${row.pinned ? '1' : '0'}">${row.pinned ? 'برداشتن سنجاق' : 'سنجاق'}</button>` : ''}<button class="table-action view-invoice" data-kind="${apiKind}" data-id="${row.id}">مشاهده</button><button class="table-action print-invoice" data-kind="${apiKind}" data-id="${row.id}">چاپ</button>${row.remainingAmount > 0 && row.status !== 'cancelled' ? `<button class="table-action settle-invoice" data-kind="${apiKind}" data-id="${row.id}">تسویه</button>` : ''}${row.status !== 'cancelled' ? `<button class="table-action danger cancel-invoice" data-kind="${apiKind}" data-id="${row.id}">لغو</button>` : ''}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="${columnCount}">فاکتوری برای نمایش وجود ندارد.</td></tr>`;
  updateDailyMergeButton();
}

async function openInvoiceDetails(kind, id) {
  const invoice = await window.api.invoices.details(kind, id);
  const modal = renderer.$('#invoiceDetailsModal');
  const computedCost = (invoice.items || []).reduce((sum, item) => sum + Number(item.purchase_price || 0) * Number(item.quantity || 0), 0);
  const computedProfit = (invoice.items || []).reduce((sum, item) => sum + Number(item.profit || 0), 0);
  const profitTotal = Number(invoice.profit_total || 0) || computedProfit;
  const costTotal = Number(invoice.cost_total || 0) || computedCost;
  const fullSettlementHtml = Number(invoice.remaining_amount || 0) > 0 && invoice.status !== 'cancelled'
    ? `<button type="button" class="secondary detail-full-settle" data-kind="${kind}" data-id="${id}" title="Ctrl+Shift+Enter">تسویه کامل (${renderer.money(invoice.remaining_amount)}) <kbd>Ctrl+Shift+Enter</kbd></button>`
    : '';
  const profitLossHtml = kind === 'sale'
    ? `<div class="invoice-detail-totals profit-loss-summary"><span>بهای تمام‌شده: <strong>${renderer.money(costTotal)}</strong></span><span class="${profitTotal >= 0 ? 'profit-amount' : 'loss-amount'}">${profitTotal >= 0 ? 'سود' : 'زیان'}: <strong>${renderer.money(Math.abs(profitTotal))}</strong></span></div>`
    : '';
  modal.innerHTML = `<div class="modal-header"><div><span class="eyebrow">جزئیات فاکتور</span><h3>${renderer.esc(invoice.invoice_number)}</h3></div><button class="modal-close" data-close-invoice-details>×</button></div><div class="invoice-detail-meta"><span>تاریخ: ${renderer.isoToJalali(invoice.date)}</span><span>طرف‌حساب: ${kind === 'sale' && invoice.source === 'daily' ? '<span class="daily-sale-party">فروش روزانه</span>' : renderer.esc(invoice.partyName || 'بدون طرف‌حساب')}</span><span>تلفن: ${renderer.esc(invoice.partyPhone || '—')}</span><span>آدرس: ${renderer.esc(invoice.partyAddress || '—')}</span></div><div class="table-wrap"><table><thead><tr><th>کالا</th><th>تعداد</th><th>قیمت</th><th>تخفیف</th><th>جمع</th></tr></thead><tbody>${invoice.items.map((item) => `<tr><td>${renderer.esc(item.productName)}<small>${renderer.esc(item.productCode || '')}</small></td><td>${Math.round(Number(item.quantity) || 0)}</td><td>${renderer.money(item.unit_price)}</td><td>${renderer.money(item.discount)}</td><td>${renderer.money(item.total)}</td></tr>`).join('')}</tbody></table></div><div class="invoice-detail-totals"><span>کل: <strong>${renderer.money(invoice.total)}</strong></span><span>پرداخت‌شده: <strong>${renderer.money(invoice.paid_amount)}</strong></span><span>مانده: <strong class="debt-amount">${renderer.money(invoice.remaining_amount)}</strong></span></div>${profitLossHtml}<div class="detail-settlement-actions">${fullSettlementHtml}</div><h4>پرداخت‌ها</h4><div class="payment-list detail-payments">${invoice.payments.map((p) => `<div class="payment-row"><span>${p.method === 'check' ? `چک ${renderer.esc(p.check_number || '')}` : p.method === 'card' ? 'کارت' : 'نقدی'}</span><strong>${renderer.money(p.amount)}</strong></div>`).join('') || '<small>پرداختی ثبت نشده است.</small>'}</div>${invoice.remaining_amount > 0 && invoice.status !== 'cancelled' ? `<div class="detail-settlement"><h4>ثبت پرداخت جدید</h4><div class="payment-entry"><select id="detailPaymentMethod"><option value="cash">نقدی</option><option value="card">کارت</option><option value="check">چک</option></select><input id="detailPaymentAmount" class="money-input" inputmode="decimal" placeholder="مبلغ"></div><div id="detailCheckFields" class="check-fields hidden"><input id="detailCheckNumber" placeholder="شماره چک"><input id="detailBankName" placeholder="بانک"><input id="detailDueDate" type="date"></div><button class="primary wide detail-settle-button" data-kind="${kind}" data-id="${id}">ثبت پرداخت</button></div>` : ''}`;
  if (kind === 'sale' && invoice.status !== 'cancelled') {
    const header = modal.querySelector('.modal-header');
    const editButton = document.createElement('button');
    editButton.className = 'edit-invoice-detail';
    editButton.title = 'ویرایش فاکتور';
    editButton.setAttribute('aria-label', 'ویرایش فاکتور');
    editButton.innerHTML = '<span aria-hidden="true">✎</span>';
    editButton.dataset.kind = kind;
    editButton.dataset.id = String(id);
    const printButton = document.createElement('button');
    printButton.className = 'invoice-detail-print';
    printButton.type = 'button';
    printButton.title = 'پیش‌نمایش و چاپ فاکتور';
    printButton.setAttribute('aria-label', 'پیش‌نمایش و چاپ فاکتور');
    printButton.innerHTML = '<span aria-hidden="true">🖨</span>';
    printButton.dataset.kind = kind;
    printButton.dataset.id = String(id);
    const closeButton = header?.querySelector('.modal-close');
    if (header && closeButton) {
      const actions = document.createElement('div');
      actions.className = 'invoice-detail-actions';
      closeButton.replaceWith(actions);
      actions.append(printButton, editButton, closeButton);
    }
  }
  renderer.$('#invoiceDetailsBackdrop').classList.remove('hidden'); modal.classList.remove('hidden');
  renderer.applyDefaultPaymentMethod(modal);
}

async function editInvoice(kind, id) {
  if (kind !== 'sale') return renderer.showToast('ویرایش فاکتور خرید هنوز فعال نشده است.', true);
  const invoice = await window.api.invoices.details(kind, id);
  renderer.setManagedPage('sales-invoice');
  const state = renderer.invoiceState.sale;
  state.editingId = Number(id);
  await loadKeyboardInvoice('sale');
  state.editingId = Number(id);
  state.party = state.parties.find((party) => party.id === Number(invoice.party_id)) || null;
  state.items = invoice.items.map((item) => {
    const product = state.products.find((candidate) => candidate.id === item.product_id);
    return {
      query: item.productName, productId: item.product_id, name: item.productName, code: item.productCode || '',
      stock: Number(product?.stock || 0) + Number(item.quantity || 0),
      retailPrice: product?.salePrice || item.unit_price, wholesalePrice: product?.wholesalePrice || 0,
      purchasePrice: product?.purchasePrice || item.purchase_price || 0, quantity: Number(item.quantity || 1),
      unitPrice: Number(item.unit_price || 0), discount: Number(item.discount || 0), priceType: item.price_type || 'retail'
    };
  });
  // ردیف ورود خالی بالای لیست، درست مثل حالت ثبت فاکتور جدید: محصول جدید
  // در آن تایپ/اسکن می‌شود و ردیف‌های موجود پایین آن فقط‌خواندنی می‌مانند.
  state.items.unshift(newInvoiceItem('sale'));
  state.payments = invoice.payments.map((payment) => ({
    method: payment.method, amount: Number(payment.amount || 0), checkNumber: payment.check_number || '',
    bankName: payment.bank_name || '', dueDate: payment.due_date || '',
    paidAt: payment.paid_at || '', checkHolder: payment.check_holder || '',
    checkStatus: payment.check_status || '', notes: payment.notes || ''
  }));
  renderer.$('#saleParty').value = invoice.partyName || '';
  renderer.$('#saleDate').value = renderer.isoToJalali(invoice.date);
  renderer.$('#saleInvoiceNumber').value = invoice.invoice_number;
  renderer.$('#saleDiscount').value = Number(invoice.discount || 0) / 100;
  renderer.$('#saleTax').value = Number(invoice.tax || 0) / 100;
  renderInvoiceParty('sale'); renderKeyboardItems('sale'); renderKeyboardSummary('sale');
  renderer.showToast('فاکتور برای ویرایش آماده شد.');
}

function selectedDailySalesForMerge() {
  return [...document.querySelectorAll('#salesInvoicesPage .daily-sale-merge-select:checked')].map((input) => ({
    id: Number(input.value), date: input.dataset.date
  }));
}

function updateDailyMergeButton() {
  const button = renderer.$('#mergeDailySales');
  if (!button) return;
  const selected = selectedDailySalesForMerge();
  const sameDate = selected.length > 0 && new Set(selected.map((sale) => sale.date)).size === 1;
  button.disabled = !sameDate;
  button.title = selected.length && !sameDate ? 'فقط فروش‌های روزانه با یک تاریخ مشترک قابل ادغام‌اند.' : '';
}

async function openDailySalesMergeModal() {
  const selected = selectedDailySalesForMerge();
  if (!selected.length) return renderer.showToast('حداقل یک فروش روزانه را انتخاب کنید.', true);
  if (new Set(selected.map((sale) => sale.date)).size !== 1) return renderer.showToast('فقط فروش‌های روزانه با یک تاریخ مشترک قابل ادغام‌اند.', true);
  const parties = (await window.api.customers.list({ query: '', type: '', includeInactive: false }))
    .filter((party) => ['customer', 'both'].includes(party.partyType));
  if (!parties.length) return renderer.showToast('برای ادغام، ابتدا یک مشتری فعال ثبت کنید.', true);
  let backdrop = renderer.$('#dailySalesMergeBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'dailySalesMergeBackdrop';
    backdrop.className = 'modal-backdrop hidden';
    document.body.appendChild(backdrop);
  }
  const date = selected[0].date;
  backdrop.innerHTML = `<div class="modal daily-sales-merge-modal"><div class="modal-header"><div><span class="eyebrow">تبدیل فروش روزانه</span><h3>ادغام در فاکتور فروش</h3></div><button class="modal-close" type="button" data-close-daily-merge>×</button></div><p class="daily-merge-note">${selected.length} فروش روزانهٔ انتخاب‌شده با تاریخ <strong>${renderer.isoToJalali(date)}</strong> در یک فاکتور فروش ثبت می‌شوند. موجودی کالا دوباره تغییر نمی‌کند و پرداخت‌های ثبت‌شده منتقل می‌شوند.</p><label>مشتری فاکتور جدید<select id="dailyMergeParty"><option value="">انتخاب مشتری</option>${parties.map((party) => `<option value="${party.id}">${renderer.esc(party.name)}${party.phone || party.mobile ? ` · ${renderer.esc(party.phone || party.mobile)}` : ''}</option>`).join('')}</select></label><div id="dailyMergeError" class="form-error hidden"></div><div class="modal-actions"><button class="secondary" type="button" data-close-daily-merge>انصراف</button><button id="confirmDailySalesMerge" class="primary" type="button">ثبت فاکتور ادغامی</button></div></div>`;
  backdrop.classList.remove('hidden');
  backdrop.onclick = async (event) => {
    if (event.target.closest('[data-close-daily-merge]')) { backdrop.classList.add('hidden'); return; }
    if (!event.target.closest('#confirmDailySalesMerge')) return;
    const partyId = Number(renderer.$('#dailyMergeParty').value);
    const error = renderer.$('#dailyMergeError');
    if (!partyId) { error.textContent = 'انتخاب مشتری الزامی است.'; error.classList.remove('hidden'); return; }
    if (!await renderer.showConfirmDialog({ title: 'ادغام فروش‌های روزانه', message: `فروش‌های روزانهٔ انتخاب‌شده در فاکتور جدیدِ تاریخ ${renderer.isoToJalali(date)} ادغام شوند؟`, confirmText: 'ادغام و ثبت' })) return;
    try {
      const result = await window.api.sales.mergeDaily({ saleIds: selected.map((sale) => sale.id), date, partyId });
      backdrop.classList.add('hidden');
      renderer.showToast(`فاکتور ${result.invoiceNumber} با موفقیت ایجاد شد.`);
      await Promise.all([loadInvoiceList('sales'), window.api.dashboard.summary().then(renderer.renderMetrics)]);
    } catch (err) {
      error.textContent = err.message || 'ادغام فاکتورها انجام نشد.';
      error.classList.remove('hidden');
    }
  };
}

function bindInvoiceLists() {
  ['sales', 'purchases'].forEach((kind) => {
    const page = renderer.$(invoiceListPageSelector(kind));
    ['input', 'change'].forEach((eventName) => page.addEventListener(eventName, (event) => {
      if (event.target.matches('.invoice-list-query, .invoice-list-product-query, .invoice-list-from, .invoice-list-to, .invoice-list-status')) loadInvoiceList(kind);
      if (kind === 'sales' && event.target.matches('.daily-sale-merge-select')) updateDailyMergeButton();
    }));
    if (kind === 'sales') page.addEventListener('click', (event) => {
      if (event.target.closest('#mergeDailySales')) openDailySalesMergeModal().catch((error) => renderer.showToast(error.message, true));
    });
  });
  renderer.$('#invoiceDetailsBackdrop').addEventListener('click', async (event) => {
    if (event.target.closest('[data-close-invoice-details]')) { renderer.$('#invoiceDetailsBackdrop').classList.add('hidden'); return; }
    const settle = event.target.closest('.detail-settle-button');
    if (settle) {
      const method = renderer.$('#detailPaymentMethod').value;
      const amount = renderer.parsePriceInput(renderer.$('#detailPaymentAmount').value) / 100;
      try {
        await window.api.invoices.settle(settle.dataset.kind, Number(settle.dataset.id), { method, amount, checkNumber: renderer.$('#detailCheckNumber')?.value, bankName: renderer.$('#detailBankName')?.value, dueDate: renderer.$('#detailDueDate')?.value });
        renderer.$('#invoiceDetailsBackdrop').classList.add('hidden'); renderer.showToast('پرداخت با موفقیت ثبت شد.'); await loadInvoiceList(settle.dataset.kind === 'sale' ? 'sales' : 'purchases');
      } catch (error) { renderer.showToast(error.message, true); }
    }
    const fullSettle = event.target.closest('.detail-full-settle');
    if (fullSettle) {
      try {
        const invoice = await window.api.invoices.details(fullSettle.dataset.kind, Number(fullSettle.dataset.id));
        const amount = Number(invoice.remaining_amount || 0) / 100;
        if (amount <= 0) return;
        const method = ['cash', 'card', 'check'].includes(renderer.defaultSettlementMethod) ? defaultSettlementMethod : 'cash';
        if (!await renderer.showConfirmDialog({ title: 'تسویه کامل فاکتور', message: `مانده ${renderer.money(invoice.remaining_amount)} با روش ${method === 'card' ? 'کارت' : method === 'check' ? 'چک' : 'نقدی'} تسویه شود؟`, confirmText: 'تسویه فاکتور' })) return;
        await window.api.invoices.settle(fullSettle.dataset.kind, Number(fullSettle.dataset.id), { method, amount });
        renderer.$('#invoiceDetailsBackdrop').classList.add('hidden');
        renderer.showToast('فاکتور به‌طور کامل تسویه شد.');
        if (await renderer.showConfirmDialog({ title: 'چاپ رسید پرداخت', message: 'رسید پرداخت چاپ شود؟', confirmText: 'چاپ رسید', destructive: false })) renderer.printPaymentReceipt(invoice, { method, amount: Number(invoice.remaining_amount || 0) });
        await loadInvoiceList(fullSettle.dataset.kind === 'sale' ? 'sales' : 'purchases');
      } catch (error) { renderer.showToast(error.message, true); }
    }
  });
  renderer.$('#invoiceDetailsBackdrop').addEventListener('change', (event) => { if (event.target.id === 'detailPaymentMethod') renderer.$('#detailCheckFields').classList.toggle('hidden', event.target.value !== 'check'); });
  document.addEventListener('click', async (event) => {
    const edit = event.target.closest('.edit-invoice-detail');
    if (edit) {
      renderer.$('#invoiceDetailsBackdrop').classList.add('hidden');
      try { await editInvoice(edit.dataset.kind, Number(edit.dataset.id)); } catch (error) { renderer.showToast(error.message || 'ویرایش فاکتور انجام نشد.', true); }
      return;
    }
    const print = event.target.closest('.invoice-detail-print');
    if (print) {
      try { await renderer.openInvoicePrintPreview(print.dataset.kind, Number(print.dataset.id)); } catch (error) { renderer.showToast(error.message || 'پیش‌نمایش فاکتور بارگذاری نشد.', true); }
      return;
    }
    const printInvoice = event.target.closest('.print-invoice');
    if (printInvoice) {
      try { await renderer.openInvoicePrintPreview(printInvoice.dataset.kind, Number(printInvoice.dataset.id)); } catch (error) { renderer.showToast(error.message || 'پیش‌نمایش فاکتور بارگذاری نشد.', true); }
      return;
    }
    const pin = event.target.closest('.pin-invoice');
    if (pin) {
      try {
        const pinned = pin.dataset.pinned !== '1';
        await window.api.invoices.setPinned(pin.dataset.kind, Number(pin.dataset.id), pinned);
        renderer.showToast(pinned ? 'فاکتور سنجاق شد و همیشه بالای فهرست می‌ماند.' : 'سنجاق فاکتور برداشته شد.');
        await loadInvoiceList(pin.dataset.kind === 'sale' ? 'sales' : 'purchases');
      } catch (error) { renderer.showToast(error.message || 'تغییر سنجاق فاکتور انجام نشد.', true); }
      return;
    }
    const view = event.target.closest('.view-invoice');
    if (view) { try { await openInvoiceDetails(view.dataset.kind, Number(view.dataset.id)); } catch (error) { renderer.showToast(error.message || 'جزئیات فاکتور بارگذاری نشد.', true); } return; }
    const settle = event.target.closest('.settle-invoice');
    if (settle) { try { await openInvoiceDetails(settle.dataset.kind, Number(settle.dataset.id)); } catch (error) { renderer.showToast(error.message || 'فاکتور بارگذاری نشد.', true); } return; }
    const cancel = event.target.closest('.cancel-invoice');
    if (cancel && await renderer.showConfirmDialog({ title: 'لغو فاکتور', message: 'این فاکتور لغو شود؟ موجودی و مانده حساب اصلاح خواهد شد.', confirmText: 'لغو فاکتور', destructive: true })) {
      try { await window.api.invoices.cancel(cancel.dataset.kind, Number(cancel.dataset.id)); renderer.showToast('فاکتور لغو شد.'); await loadInvoiceList(cancel.dataset.kind === 'sale' ? 'sales' : 'purchases'); } catch (error) { renderer.showToast(error.message, true); }
    }
  });
  document.addEventListener('keydown', (event) => {
    if (!renderer.uiShortcuts) return;
    if (!(event.ctrlKey && event.shiftKey && event.key === 'Enter')) return;
    const button = renderer.$('#invoiceDetailsBackdrop:not(.hidden) .detail-full-settle');
    if (button) { event.preventDefault(); button.click(); }
  });
}

async function loadKeyboardInvoice(kind) {
  const state = renderer.invoiceState[kind];
  state.products = await window.api.products.search('');
  state.parties = (await window.api.customers.list({ query: '', type: '', includeInactive: false }))
    .filter((party) => party.partyType === (kind === 'sale' ? 'customer' : 'supplier') || party.partyType === 'both');
  if (!state.items.length) state.items = [newInvoiceItem(kind)];
  if (kind === 'purchase' && state.items[0]?.productId) state.items.unshift(newInvoiceItem('purchase'));
  const numberField = renderer.$(`#${kind}InvoiceNumber`);
  if (numberField && !numberField.value) numberField.value = await window.api.invoices.nextNumber(kind, renderer.jalaliInputToIso(renderer.$(`#${kind}Date`).value));
  renderKeyboardItems(kind); renderKeyboardSummary(kind);
  if (!state.payments.length) {
    const methodInput = renderer.$(`#${kind}PaymentMethod`);
    if (methodInput) methodInput.value = renderer.defaultSettlementMethod;
  }
}

function renderKeyboardItems(kind, focus) {
  const state = renderer.invoiceState[kind]; const body = renderer.$(`#${kind}InvoiceItems`);
  body.innerHTML = state.items.map((item, index) => {
    const hasEntryRow = invoiceHasEntryRow(kind);
    if (hasEntryRow && index > 0) {
      return `<tr class="invoice-committed-row" data-index="${index}"><td><strong>${renderer.esc(item.name)}</strong><small>${renderer.esc(item.code)}</small></td><td>${Math.max(1, Math.round(Number(item.quantity) || 1))}</td><td>${renderer.money(item.unitPrice)}</td><td>${renderer.money(item.discount)}</td><td class="line-total">${renderer.money(Math.max(0, item.quantity * item.unitPrice - item.discount))}</td><td><button class="delete-line" data-kind="${kind}" data-index="${index}" title="حذف">×</button></td></tr>`;
    }
    return `<tr class="${hasEntryRow ? 'invoice-entry-row' : ''}" data-index="${index}"><td class="product-cell"><input class="invoice-product-input" data-kind="${kind}" data-index="${index}" value="${renderer.esc(item.query || item.name)}" placeholder="نام، کد یا بارکد" autocomplete="off"><div class="invoice-suggestions hidden"></div>${item.name ? `<small>${renderer.esc(item.code)} · موجودی ${item.stock}</small>` : ''}</td><td><input class="invoice-quantity" data-kind="${kind}" data-index="${index}" type="number" min="1" step="1" value="${Math.max(1, Math.round(Number(item.quantity) || 1))}"></td>${invoicePriceFieldMarkup(kind, item, index)}<td><input class="invoice-discount-line" data-kind="${kind}" data-index="${index}" type="text" inputmode="decimal" value="${renderer.formatPriceInput(item.discount)}"></td><td class="line-total" tabindex="0">${renderer.money(Math.max(0, item.quantity * item.unitPrice - item.discount))}</td><td><button class="delete-line" data-kind="${kind}" data-index="${index}" title="حذف">×</button></td></tr>`;
  }).join('');
  if (kind === 'purchase') {
    state.items.forEach((item, index) => {
      const row = body.querySelector(`tr[data-index="${index}"]`);
      if (!row?.classList.contains('invoice-entry-row')) return;
      row?.querySelector('.product-cell > small')?.remove();
      const priceCell = row.querySelector('.price-cell');
      priceCell?.replaceChildren();
      priceCell?.insertAdjacentHTML('afterbegin', purchasePriceFieldMarkup(item, index));
    });
    body.querySelector('tr[data-index="0"] .delete-line')?.remove();
  }
  if (focus) { const node = body.querySelector(`[data-index="${focus.index}"] .${focus.className}`); if (node) { node.focus(); node.select?.(); } }
}

function invoicePriceFieldMarkup(kind, item, index) {
  if (kind === 'purchase') return '<td class="price-cell"></td>';
  const isCustom = item.priceType === 'custom';
  return `<td class="price-cell"><select class="invoice-price-combo" data-kind="${kind}" data-index="${index}"><option value="retail" ${item.priceType === 'retail' ? 'selected' : ''}>قیمت فروش — ${renderer.money(item.retailPrice || item.unitPrice)}</option><option value="wholesale" ${item.priceType === 'wholesale' ? 'selected' : ''} ${item.wholesalePrice > 0 ? '' : 'disabled'}>فروش عمده — ${renderer.money(item.wholesalePrice || 0)}</option><option value="custom" ${isCustom ? 'selected' : ''}>قیمت دستی</option></select><input class="invoice-price-custom ${isCustom ? '' : 'hidden'}" data-kind="${kind}" data-index="${index}" type="text" inputmode="decimal" value="${renderer.formatPriceInput(item.unitPrice)}" placeholder="قیمت دستی"></td>`;
}

function setInvoicePriceSelection(kind, index, value, options = {}) {
  const item = renderer.invoiceState[kind]?.items[index];
  const row = renderer.$(`#${kind}InvoiceItems tr[data-index="${index}"]`);
  const combo = row?.querySelector('.invoice-price-combo');
  const custom = row?.querySelector('.invoice-price-custom');
  if (!item || !combo || !custom) return;
  item.priceType = value;
  combo.value = value;
  if (value === 'custom') {
    item.unitPrice = options.keepValue ? Number(item.unitPrice || 0) : 0;
    custom.classList.remove('hidden');
    if (!options.keepValue) custom.value = '';
    if (options.focus !== false) requestAnimationFrame(() => { custom.focus(); custom.select?.(); });
  } else {
    item.unitPrice = value === 'wholesale' ? Number(item.wholesalePrice || 0) : Number(item.retailPrice || 0);
    custom.value = '';
    custom.classList.add('hidden');
    if (options.focus) requestAnimationFrame(() => combo.focus());
  }
  renderKeyboardSummary(kind);
}

function purchasePriceFieldMarkup(item, index) {
  return `<div class="purchase-price-entry"><input class="invoice-price-custom purchase-price-input" data-kind="purchase" data-index="${index}" type="text" inputmode="decimal" value="${renderer.formatPriceInput(item.unitPrice)}" placeholder="قیمت خرید"><div class="purchase-price-suggestions hidden" data-index="${index}">${purchasePriceSuggestionsMarkup(item, index)}</div></div>`;
}

function purchasePriceSuggestionsMarkup(item, index) {
  const options = item.purchasePriceOptions || [];
  if (!options.length) return '<div class="purchase-price-empty">قیمت خرید قبلی ثبت نشده است.</div>';
  return options.map((row, optionIndex) => `<button type="button" class="purchase-price-option ${item.purchasePriceActiveIndex === optionIndex ? 'active' : ''}" data-index="${index}" data-option-index="${optionIndex}"><span>${renderer.money(row.effectiveUnitPrice)}</span><small>${renderer.isoToJalali(row.date)}${row.supplierName ? ` · ${renderer.esc(row.supplierName)}` : ''}</small></button>`).join('');
}

function renderPurchasePriceSuggestions(item, index) {
  const row = renderer.$(`#purchaseInvoiceItems tr[data-index="${index}"]`);
  const box = row?.querySelector('.purchase-price-suggestions');
  if (!box) return;
  box.innerHTML = purchasePriceSuggestionsMarkup(item, index);
  box.classList.toggle('hidden', !item.purchasePriceOpen);
}

function openPurchasePriceSuggestions(index) {
  const item = renderer.invoiceState.purchase.items[index];
  if (!item) return;
  item.purchasePriceOpen = true;
  item.purchasePriceActiveIndex = -1;
  renderPurchasePriceSuggestions(item, index);
}

function purchaseHistoryMarkup(item, index) {
  const history = item.purchaseHistory;
  const count = Number(history?.summary?.count || 0);
  const loading = Boolean(history?.loading);
  const buttonLabel = loading ? 'در حال دریافت سوابق…' : `سوابق خرید${count ? ` (${count})` : ''}`;
  const panel = item.purchaseHistoryOpen
    ? `<div class="purchase-history-panel">${purchaseHistoryPanelMarkup(history, index)}</div>`
    : '';
  return `<button type="button" class="purchase-history-toggle" data-index="${index}" ${loading ? 'disabled' : ''}>${buttonLabel}</button>${panel}`;
}

function purchaseHistoryPanelMarkup(history, index) {
  if (history?.loading) return '<div class="purchase-history-empty">در حال دریافت سوابق…</div>';
  if (history?.error) return `<div class="purchase-history-empty error">${renderer.esc(history.error)}</div>`;
  const rows = history?.items || [];
  if (!rows.length) return '<div class="purchase-history-empty">برای این کالا سابقهٔ خرید فعال ثبت نشده است.</div>';
  const summary = history.summary || {};
  return `<div class="purchase-history-summary"><span>کمینه <b>${renderer.money(summary.minUnitPrice)}</b></span><span>بیشینه <b>${renderer.money(summary.maxUnitPrice)}</b></span><span>میانگین خالص <b>${renderer.money(summary.averageEffectiveUnitPrice)}</b></span>${summary.selectedSupplierCount ? `<span class="selected-supplier-count">${summary.selectedSupplierCount} خرید از تأمین‌کنندهٔ انتخاب‌شده</span>` : ''}</div><div class="purchase-history-rows">${rows.map((row) => `<button type="button" class="purchase-history-row ${row.isSelectedSupplier ? 'selected-supplier' : ''}" data-index="${index}" data-price="${Number(row.effectiveUnitPrice || 0)}" title="انتخاب این قیمت"><span><strong>${renderer.esc(row.supplierName)}</strong><small>${renderer.isoToJalali(row.date)} · فاکتور ${renderer.esc(row.invoiceNumber)} · ${Number(row.quantity || 0)} عدد${Number(row.returnedQuantity || 0) ? ` · ${Number(row.returnedQuantity)} مرجوعی` : ''}</small></span><span><small>واحد ${renderer.money(row.unitPrice)}${Number(row.discount || 0) ? ` · تخفیف ${renderer.money(row.discount)}` : ''}</small><b>خالص ${renderer.money(row.effectiveUnitPrice)}</b></span></button>`).join('')}</div><small class="purchase-history-note">قیمت خالص، پس از تخفیف همان ردیف است و تخفیف یا مالیات کل فاکتور را شامل نمی‌شود.</small>`;
}

async function loadPurchasePricesForItem(item) {
  const state = renderer.invoiceState.purchase;
  if (!item?.productId) return;
  const productId = item.productId;
  item.purchasePriceOptions = [];
  try {
    const history = await window.api.purchases.priceHistory(productId, { limit: 20 });
    const current = state.items.find((candidate) => candidate === item);
    if (!current || current.productId !== productId) return;
    current.purchasePriceOptions = history.items || [];
    if (current.priceType === 'purchase' && current.purchasePriceOptions.length) {
      current.unitPrice = Number(current.purchasePriceOptions[0].effectiveUnitPrice || 0);
      current.priceType = 'custom';
    }
    const index = state.items.indexOf(current);
    const input = renderer.$(`#purchaseInvoiceItems tr[data-index="${index}"] .purchase-price-input`);
    if (input) input.value = renderer.formatPriceInput(current.unitPrice);
    renderPurchasePriceSuggestions(current, index);
  } catch (error) {
    const current = state.items.find((candidate) => candidate === item);
    if (!current || current.productId !== productId) return;
    current.purchasePriceOptions = [];
    renderPurchasePriceSuggestions(current, state.items.indexOf(current));
  }
}

function refreshPurchasePrices() {
  const entry = renderer.invoiceState.purchase.items[0];
  if (entry?.productId) loadPurchasePricesForItem(entry);
}

function commitPurchaseEntry() {
  const state = renderer.invoiceState.purchase;
  const entry = state.items[0];
  if (!entry?.productId) return renderer.showToast('ابتدا کالا را انتخاب کنید.', true);
  if (Number(entry.unitPrice || 0) <= 0) return renderer.showToast('قیمت خرید را وارد یا انتخاب کنید.', true);
  entry.purchasePriceOpen = false;
  entry.purchasePriceActiveIndex = -1;
  state.items.push({ ...entry, purchasePriceOpen: false, purchasePriceActiveIndex: -1 });
  state.items[0] = newInvoiceItem('purchase');
  renderKeyboardItems('purchase', { index: 0, className: 'invoice-product-input' });
  renderKeyboardSummary('purchase');
}

function commitSaleEntry() {
  const state = renderer.invoiceState.sale;
  const entry = state.items[0];
  if (!entry?.productId) return renderer.showToast('ابتدا کالا را انتخاب کنید.', true);
  if (Number(entry.unitPrice || 0) <= 0) return renderer.showToast('قیمت فروش را وارد یا انتخاب کنید.', true);
  state.items.push({ ...entry });
  state.items[0] = newInvoiceItem('sale');
  renderKeyboardItems('sale', { index: 0, className: 'invoice-product-input' });
  renderKeyboardSummary('sale');
}

function keyboardInvoiceTotals(kind) {
  const state = renderer.invoiceState[kind];
  const invoiceItems = invoiceHasEntryRow(kind) ? state.items.slice(1) : state.items;
  const subtotal = invoiceItems.reduce((sum, item) => sum + Math.max(0, item.quantity * item.unitPrice - item.discount), 0);
  const discount = renderer.parsePriceInput(renderer.$(`#${kind}Discount`).value); const tax = renderer.parsePriceInput(renderer.$(`#${kind}Tax`).value);
  return { subtotal, discount, tax, total: Math.max(0, subtotal - discount + tax) };
}

function renderKeyboardSummary(kind) {
  const totals = keyboardInvoiceTotals(kind); const state = renderer.invoiceState[kind];
  const paid = state.payments.reduce((sum, item) => sum + item.amount, 0);
  renderer.$(`#${kind}Subtotal`).textContent = renderer.money(totals.subtotal); renderer.$(`#${kind}Total`).textContent = renderer.money(totals.total); renderer.$(`#${kind}Remaining`).textContent = renderer.money(Math.max(0, totals.total - paid));
  renderer.$(`#${kind}Payments`).innerHTML = state.payments.map((p, i) => `<div class="payment-row"><span>${p.method === 'check' ? `چک ${renderer.esc(p.checkNumber || '')}` : p.method === 'card' ? 'کارت' : 'نقدی'}</span><strong>${renderer.money(p.amount)}</strong><button class="delete-payment" data-kind="${kind}" data-index="${i}">×</button></div>`).join('');
}

function showKeyboardSuggestions(kind, index) {
  const row = renderer.$(`#${kind}InvoiceItems tr[data-index="${index}"]`); const input = row?.querySelector('.invoice-product-input'); const box = row?.querySelector('.invoice-suggestions'); if (!input || !box) return;
  const tokens = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean); const rows = renderer.invoiceState[kind].products.filter((p) => !tokens.length || tokens.every((token) => [p.name, p.code, p.barcode].some((v) => String(v || '').toLowerCase().includes(token)))).slice(0, 8);
  box.innerHTML = rows.map((p) => `<button type="button" class="invoice-suggestion" data-kind="${kind}" data-index="${index}" data-id="${p.id}"><span>${renderer.esc(p.name)}${kind === 'purchase' ? '' : `<small>${renderer.esc(p.code)} · موجودی ${p.stock}</small>`}</span><b>${renderer.money(kind === 'purchase' ? p.purchasePrice : p.salePrice)}</b></button>`).join('');
  box.classList.toggle('hidden', !rows.length);
}

function chooseKeyboardProduct(kind, index, product) {
  if (!product) return; const state = renderer.invoiceState[kind]; const item = state.items[index];
  const isEntryRow = index === 0 && invoiceHasEntryRow(kind);
  Object.assign(item, { productId: product.id, name: product.name, code: product.code, query: product.name, stock: product.stock, retailPrice: product.salePrice, wholesalePrice: product.wholesalePrice, purchasePrice: product.purchasePrice, unitPrice: kind === 'purchase' ? 0 : product.salePrice, priceType: kind === 'purchase' ? 'purchase' : 'retail' });
  if (kind === 'purchase') Object.assign(item, { purchasePriceOptions: [] });
  if (isEntryRow) {
    renderKeyboardItems(kind, { index: 0, className: 'invoice-quantity' });
    if (kind === 'purchase') loadPurchasePricesForItem(item);
    return;
  }
  const duplicate = state.items.findIndex((candidate, candidateIndex) => candidateIndex !== index && candidate.productId === item.productId && candidate.unitPrice === item.unitPrice);
  if (duplicate >= 0) {
    state.items[duplicate].quantity += item.quantity || 1;
    if (isEntryRow) state.items[index] = newInvoiceItem(kind);
    else state.items.splice(index, 1);
    renderKeyboardItems(kind, { index: duplicate, className: 'invoice-quantity' }); renderKeyboardSummary(kind); return;
  }
  renderKeyboardItems(kind, { index, className: 'invoice-quantity' }); renderKeyboardSummary(kind);
  if (kind === 'purchase') loadPurchasePricesForItem(item);
}

function addKeyboardRow(kind) {
  if (invoiceHasEntryRow(kind)) {
    renderKeyboardItems(kind, { index: 0, className: 'invoice-product-input' });
    return;
  }
  renderer.invoiceState[kind].items.push(newInvoiceItem(kind));
  renderKeyboardItems(kind, { index: renderer.invoiceState[kind].items.length - 1, className: 'invoice-product-input' });
}

function addKeyboardPayment(kind, options = {}) {
  const amount = renderer.parsePriceInput(renderer.$(`#${kind}PaymentAmount`).value); const method = renderer.$(`#${kind}PaymentMethod`).value;
  if (!amount) {
    if (!options.silent) renderer.showToast('مبلغ پرداخت را وارد کنید.', true);
    return false;
  }
  if (method === 'check' && !renderer.$(`#${kind}CheckNumber`).value.trim()) {
    const message = 'شماره چک را وارد کنید.';
    if (options.throwOnError) throw new Error(message);
    renderer.showToast(message, true);
    return false;
  }
  renderer.invoiceState[kind].payments.push({ method, amount, checkNumber: renderer.$(`#${kind}CheckNumber`).value, bankName: renderer.$(`#${kind}BankName`).value, dueDate: renderer.$(`#${kind}DueDate`).value });
  renderer.$(`#${kind}PaymentAmount`).value = '0'; renderer.$(`#${kind}CheckNumber`).value = ''; renderer.$(`#${kind}BankName`).value = ''; renderer.$(`#${kind}DueDate`).value = ''; renderKeyboardSummary(kind);
  return true;
}

function renderInvoiceParty(kind) {
  const party = renderer.invoiceState[kind].party;
  const box = renderer.$(`#${kind}PartyDetails`);
  const manualName = renderer.$(`#${kind}Party`)?.value.trim();
  if (!box) return;
  if (!party && !manualName) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.innerHTML = party
    ? `<strong>${renderer.esc(party.name || '')}</strong><span>${renderer.esc(party.code || '')}</span>${party.phone || party.mobile ? `<span>${renderer.esc(party.phone || party.mobile)}</span>` : ''}${party.address ? `<span>${renderer.esc(party.address)}</span>` : ''}`
    : `<strong>${renderer.esc(manualName)}</strong><span>طرف‌حساب دستی</span>`;
  box.classList.remove('hidden');
}

function clearKeyboardInvoice(kind) {
  const state = renderer.invoiceState[kind]; state.items = [newInvoiceItem(kind)]; state.payments = []; state.party = null; state.editingId = null;
  renderer.$(`#${kind}Discount`).value = '0'; renderer.$(`#${kind}Tax`).value = '0'; renderer.$(`#${kind}Party`).value = ''; renderer.$(`#${kind}InvoiceNumber`).value = ''; renderer.$(`#${kind}Date`).value = renderer.isoToJalali(new Date().toISOString().slice(0, 10)); renderInvoiceParty(kind); renderKeyboardItems(kind, { index: 0, className: 'invoice-product-input' }); renderKeyboardSummary(kind); loadKeyboardInvoice(kind);
}

async function saveKeyboardInvoice(kind, print = false) {
  const state = renderer.invoiceState[kind]; const error = renderer.$(`#${kind}InvoiceError`); error.classList.add('hidden');
  try {
    // مبلغی که در کادر پرداخت وارد شده، حتی اگر کاربر دکمهٔ «افزودن پرداخت»
    // را نزده باشد، باید همراه فاکتور ثبت شود.
    addKeyboardPayment(kind, { throwOnError: true, silent: true });
    const items = state.items.filter((item, index) => item.productId && (invoiceHasEntryRow(kind) ? index > 0 : true)).map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      // createPurchase receives persisted monetary values in cents, while
      // createSale keeps its public payload in toman and normalizes to cents.
      unitPrice: kind === 'purchase' ? item.unitPrice : item.unitPrice / 100,
      discount: kind === 'purchase' ? item.discount : item.discount / 100,
      priceType: item.priceType
    }));
    if (!items.length) throw new Error('حداقل یک محصول به فاکتور اضافه کنید.');
    const payload = {
      items,
      invoiceNumber: state.editingId ? undefined : renderer.$(`#${kind}InvoiceNumber`)?.value.trim(),
      discount: kind === 'purchase' ? renderer.parsePriceInput(renderer.$(`#${kind}Discount`).value) : renderer.parsePriceInput(renderer.$(`#${kind}Discount`).value) / 100,
      tax: kind === 'purchase' ? renderer.parsePriceInput(renderer.$(`#${kind}Tax`).value) : renderer.parsePriceInput(renderer.$(`#${kind}Tax`).value) / 100,
      payments: state.payments.map((p) => ({ ...p, amount: p.amount / 100 })),
      partyId: state.party?.id,
      partyName: renderer.$(`#${kind}Party`)?.value.trim(),
      date: renderer.jalaliInputToIso(renderer.$(`#${kind}Date`).value),
      source: 'invoice'
    };
    const result = state.editingId
      ? await window.api.invoices.update(kind, state.editingId, payload)
      : kind === 'sale' ? await window.api.sales.create(payload) : await window.api.purchases.create(payload);
    renderer.showToast(`${kind === 'sale' ? 'فروش' : 'خرید'} ${result.invoiceNumber} با موفقیت ثبت شد.`);
    const printSettings = (await window.api.settings.get()).print || {};
    if (print || (kind === 'sale' ? printSettings.autoPrintSale : printSettings.autoPrintPurchase)) {
      await renderer.openInvoicePrintPreview(kind, result.id);
    }
    clearKeyboardInvoice(kind); await loadKeyboardInvoice(kind);
    if (kind === 'sale') {
      window.api.dashboard.summary().then(renderer.renderMetrics);
      if (!renderer.$('#reportsPage')?.classList.contains('hidden')) renderer.loadSalesReport();
    }
  } catch (err) { error.textContent = renderer.readableError(err, 'ثبت فاکتور انجام نشد.'); error.classList.remove('hidden'); }
}

function bindKeyboardInvoices() {
  document.querySelectorAll('.invoice-editor').forEach((editor) => {
    editor.addEventListener('focusin', (event) => {
      const input = event.target.closest('.purchase-price-input');
      if (input) openPurchasePriceSuggestions(Number(input.dataset.index));
    });
    editor.addEventListener('input', (event) => {
      const t = event.target; const kind = t.dataset.kind; if (!kind) return; const item = renderer.invoiceState[kind].items[Number(t.dataset.index)];
      if (t.classList.contains('invoice-product-input')) {
        item.query = t.value;
        const requestId = Number(t.dataset.productSearchRequest || 0) + 1;
        t.dataset.productSearchRequest = String(requestId);
        showKeyboardSuggestions(kind, Number(t.dataset.index));
        // Re-query the database while typing so products created in the
        // products screen or through the invoice modal appear immediately.
        window.api.products.search(t.value).then((products) => {
          if (Number(t.dataset.productSearchRequest) !== requestId) return;
          renderer.invoiceState[kind].products = products;
          showKeyboardSuggestions(kind, Number(t.dataset.index));
        }).catch(() => {});
      }
      else if (t.classList.contains('invoice-quantity')) item.quantity = Math.max(1, Math.round(Number(t.value) || 1));
      else if (t.classList.contains('invoice-price-custom')) {
        item.unitPrice = renderer.parsePriceInput(t.value);
        if (kind === 'purchase') {
          item.priceType = 'custom';
          item.purchasePriceActiveIndex = -1;
          item.purchasePriceOpen = true;
          renderPurchasePriceSuggestions(item, Number(t.dataset.index));
        }
      }
      else if (t.classList.contains('invoice-discount-line')) item.discount = renderer.parsePriceInput(t.value);
      renderKeyboardSummary(kind);
    });
    editor.addEventListener('keydown', (event) => {
      const t = event.target; const kind = t.dataset.kind; if (!kind) return; const index = Number(t.dataset.index);
      if (t.classList.contains('invoice-product-input')) {
        const suggestions = [...t.parentElement.querySelectorAll('.invoice-suggestion')]; let active = suggestions.findIndex((n) => n.classList.contains('active'));
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (suggestions.length) { active = event.key === 'ArrowDown' ? (active + 1) % suggestions.length : (active - 1 + suggestions.length) % suggestions.length; suggestions.forEach((n, i) => n.classList.toggle('active', i === active)); } }
        if (event.key === 'Enter') { event.preventDefault(); const button = suggestions[active >= 0 ? active : 0]; if (button) chooseKeyboardProduct(kind, index, renderer.invoiceState[kind].products.find((p) => p.id === Number(button.dataset.id))); }
        if (event.key === 'Escape') t.parentElement.querySelector('.invoice-suggestions')?.classList.add('hidden');
      } else if (event.key === 'Enter' && t.classList.contains('invoice-quantity')) {
        event.preventDefault();
        t.closest('tr').querySelector(kind === 'purchase' ? '.purchase-price-input' : '.invoice-price-combo')?.focus();
      } else if (event.key === 'ArrowDown' && t.classList.contains('purchase-price-input')) {
        event.preventDefault();
        const item = renderer.invoiceState.purchase.items[index];
        const count = item?.purchasePriceOptions?.length || 0;
        if (count) {
          item.purchasePriceOpen = true;
          item.purchasePriceActiveIndex = (Number(item.purchasePriceActiveIndex) + 1 + count) % count;
          renderPurchasePriceSuggestions(item, index);
        }
      } else if (event.key === 'ArrowUp' && t.classList.contains('purchase-price-input')) {
        event.preventDefault();
        const item = renderer.invoiceState.purchase.items[index];
        const count = item?.purchasePriceOptions?.length || 0;
        if (count) {
          item.purchasePriceOpen = true;
          item.purchasePriceActiveIndex = Number(item.purchasePriceActiveIndex) < 0
            ? count - 1
            : (Number(item.purchasePriceActiveIndex) - 1 + count) % count;
          renderPurchasePriceSuggestions(item, index);
        }
      } else if (event.key === 'Enter' && t.classList.contains('purchase-price-input')) {
        const item = renderer.invoiceState.purchase.items[index];
        if (item?.purchasePriceActiveIndex >= 0 && item.purchasePriceOptions?.[item.purchasePriceActiveIndex]) {
          event.preventDefault();
          const selected = item.purchasePriceOptions[item.purchasePriceActiveIndex];
          item.unitPrice = Number(selected.effectiveUnitPrice || 0);
          item.priceType = 'custom';
          t.value = renderer.formatPriceInput(item.unitPrice);
          commitPurchaseEntry();
        } else {
          event.preventDefault();
          commitPurchaseEntry();
        }
      } else if (event.key === 'Escape' && t.classList.contains('purchase-price-input')) {
        const item = renderer.invoiceState.purchase.items[index];
        if (item) {
          item.purchasePriceOpen = false;
          item.purchasePriceActiveIndex = -1;
          renderPurchasePriceSuggestions(item, index);
        }
      } else if (event.key === 'Enter' && kind === 'sale'
        && (t.classList.contains('invoice-price-combo') || t.classList.contains('invoice-price-custom'))) {
        event.preventDefault();
        commitSaleEntry();
      } else if (kind === 'sale' && t.classList.contains('invoice-price-custom')
        && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        const combo = t.closest('td')?.querySelector('.invoice-price-combo');
        if (combo) {
          event.preventDefault();
          const options = [...combo.options].filter((option) => !option.disabled);
          const current = Math.max(0, options.findIndex((option) => option.value === renderer.invoiceState.sale.items[index]?.priceType));
          const next = event.key === 'ArrowDown'
            ? (current + 1) % options.length
            : (current - 1 + options.length) % options.length;
          setInvoicePriceSelection('sale', index, options[next].value, { focus: true });
        }
      } else if (kind === 'sale' && t.classList.contains('invoice-price-custom') && event.key === 'Escape') {
        event.preventDefault();
        t.closest('td')?.querySelector('.invoice-price-combo')?.focus();
      } else if (event.key === 'Enter' && (t.classList.contains('invoice-price-custom') || t.classList.contains('invoice-price-combo') || t.classList.contains('invoice-discount-line') || t.classList.contains('line-total'))) { event.preventDefault(); addKeyboardRow(kind); }
      if (event.ctrlKey && event.key === 'Delete') {
        event.preventDefault();
        const state = renderer.invoiceState[kind];
        if (invoiceHasEntryRow(kind) && index === 0) {
          state.items[0] = newInvoiceItem(kind);
          renderKeyboardItems(kind, { index: 0, className: 'invoice-product-input' });
        } else {
          state.items.splice(index, 1);
          if (!state.items.length) state.items.push(newInvoiceItem(kind));
          if (kind === 'purchase' && state.items[0]?.productId) state.items.unshift(newInvoiceItem('purchase'));
          renderKeyboardItems(kind);
        }
        renderKeyboardSummary(kind);
      }
    });
    editor.addEventListener('change', (event) => {
      const combo = event.target.closest('.invoice-price-combo');
      if (!combo) return;
      const kind = combo.dataset.kind;
      const index = Number(combo.dataset.index);
      setInvoicePriceSelection(kind, index, combo.value);
    });
    editor.addEventListener('click', (event) => {
      const s = event.target.closest('.invoice-suggestion'); if (s) { chooseKeyboardProduct(s.dataset.kind, Number(s.dataset.index), renderer.invoiceState[s.dataset.kind].products.find((p) => p.id === Number(s.dataset.id))); return; }
      const priceOption = event.target.closest('.purchase-price-option');
      if (priceOption) {
        const index = Number(priceOption.dataset.index);
        const optionIndex = Number(priceOption.dataset.optionIndex);
        const item = renderer.invoiceState.purchase.items[index];
        const selected = item?.purchasePriceOptions?.[optionIndex];
        if (item && selected) {
          item.unitPrice = Number(selected.effectiveUnitPrice || 0);
          item.priceType = 'custom';
          item.purchasePriceActiveIndex = optionIndex;
          item.purchasePriceOpen = true;
          renderKeyboardItems('purchase', { index, className: 'purchase-price-input' });
          renderKeyboardSummary('purchase');
        }
        return;
      }
      const historyToggle = event.target.closest('.purchase-history-toggle');
      if (historyToggle) {
        const item = renderer.invoiceState.purchase.items[Number(historyToggle.dataset.index)];
        if (item?.purchaseHistory && !item.purchaseHistory.loading) {
          item.purchaseHistoryOpen = !item.purchaseHistoryOpen;
          renderKeyboardItems('purchase');
        }
        return;
      }
      const historyRow = event.target.closest('.purchase-history-row');
      if (historyRow) {
        const index = Number(historyRow.dataset.index);
        const item = renderer.invoiceState.purchase.items[index];
        if (!item) return;
        item.unitPrice = Number(historyRow.dataset.price || 0);
        item.priceType = 'custom';
        item.purchaseHistoryOpen = false;
        renderKeyboardItems('purchase', { index, className: 'invoice-price-custom' });
        renderKeyboardSummary('purchase');
        return;
      }
      const combo = event.target.closest('.invoice-price-combo'); if (combo) { const item = renderer.invoiceState[combo.dataset.kind].items[Number(combo.dataset.index)]; if (combo.value === 'custom') { item.priceType = 'custom'; item.unitPrice = 0; const custom = combo.closest('td').querySelector('.invoice-price-custom'); custom.value = ''; custom.classList.remove('hidden'); requestAnimationFrame(() => custom.focus()); } }
      const remove = event.target.closest('.delete-line');
      if (remove) {
        const kind = remove.dataset.kind;
        const state = renderer.invoiceState[kind];
        if (invoiceHasEntryRow(kind) && Number(remove.dataset.index) === 0) return;
        state.items.splice(Number(remove.dataset.index), 1);
        if (!state.items.length) state.items.push(newInvoiceItem(kind));
        if (kind === 'purchase' && state.items[0]?.productId) state.items.unshift(newInvoiceItem('purchase'));
        renderKeyboardItems(kind);
        renderKeyboardSummary(kind);
      }
    });
  });
  document.querySelectorAll('.invoice-new-row').forEach((b) => b.addEventListener('click', () => addKeyboardRow(b.dataset.kind)));
  document.querySelectorAll('.invoice-save').forEach((b) => b.addEventListener('click', () => saveKeyboardInvoice(b.dataset.kind)));
  document.querySelectorAll('.invoice-print').forEach((b) => b.addEventListener('click', () => saveKeyboardInvoice(b.dataset.kind, true)));
  document.querySelectorAll('.invoice-clear').forEach((b) => b.addEventListener('click', () => clearKeyboardInvoice(b.dataset.kind)));
  document.querySelectorAll('.invoice-discount,.invoice-tax').forEach((n) => n.addEventListener('input', () => renderKeyboardSummary(n.id.startsWith('sale') ? 'sale' : 'purchase')));
  document.querySelectorAll('.payment-method').forEach((n) => n.addEventListener('change', () => renderer.$(`#${n.id.replace('PaymentMethod', 'CheckFields')}`).classList.toggle('hidden', n.value !== 'check')));
  document.querySelectorAll('.add-payment').forEach((b) => b.addEventListener('click', () => addKeyboardPayment(b.dataset.kind)));
  document.querySelectorAll('.payment-full').forEach((b) => b.addEventListener('click', () => { const kind = b.dataset.kind; const total = keyboardInvoiceTotals(kind).total; const paid = renderer.invoiceState[kind].payments.reduce((s, p) => s + p.amount, 0); renderer.$(`#${kind}PaymentAmount`).value = renderer.formatPriceInput(Math.max(0, total - paid)); }));
  document.querySelectorAll('.payment-list').forEach((n) => n.addEventListener('click', (e) => { const b = e.target.closest('.delete-payment'); if (b) { renderer.invoiceState[b.dataset.kind].payments.splice(Number(b.dataset.index), 1); renderKeyboardSummary(b.dataset.kind); } }));
  document.querySelectorAll('.party-input').forEach((n) => {
    n.addEventListener('input', async () => {
      const kind = n.dataset.kind;
      const invoice = renderer.invoiceState[kind];
      const requestId = Number(n.dataset.partySearchRequest || 0) + 1;
      n.dataset.partySearchRequest = String(requestId);
      invoice.party = null;
      renderInvoiceParty(kind);
      const query = n.value.trim();
      const tokens = renderer.normalizeDigits(query.toLowerCase()).split(/\s+/).filter(Boolean);
      const matches = (parties) => parties.filter((p) => {
        const text = renderer.normalizeDigits(`${p.name} ${p.code} ${p.phone || ''} ${p.mobile || ''}`.toLowerCase());
        return !tokens.length || tokens.every((token) => text.includes(token));
      }).slice(0, 8);
      const box = renderer.$(`#${kind}PartySuggestions`);
      const renderSuggestions = (rows) => {
        box.innerHTML = rows.map((p) => `<button type="button" class="party-suggestion" data-kind="${kind}" data-id="${p.id}">${renderer.esc(p.name)} <small>${renderer.esc(p.code)}${p.phone ? ` · ${renderer.esc(p.phone)}` : ''}</small></button>`).join('');
        box.classList.toggle('hidden', !rows.length);
      };
      renderSuggestions(matches(invoice.parties));

      // Refresh from the database while typing so newly-created and legacy
      // customer/supplier records are available without reopening the form.
      try {
        const fetched = await window.api.customers.list({ query, type: '', includeInactive: false });
        if (Number(n.dataset.partySearchRequest) !== requestId) return;
        invoice.parties = fetched.filter((p) => p.partyType === (kind === 'sale' ? 'customer' : 'supplier') || p.partyType === 'both');
        renderSuggestions(matches(invoice.parties));
      } catch {
        // Keep locally loaded suggestions if the background refresh fails.
      }
    });
    n.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return;
      const box = renderer.$(`#${n.dataset.kind}PartySuggestions`);
      const rows = [...box.querySelectorAll('.party-suggestion')];
      if (event.key === 'Escape') { box.classList.add('hidden'); return; }
      if (!rows.length) return;
      event.preventDefault();
      let active = rows.findIndex((row) => row.classList.contains('active'));
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        active = event.key === 'ArrowDown' ? (active + 1) % rows.length : (active - 1 + rows.length) % rows.length;
        rows.forEach((row, index) => row.classList.toggle('active', index === active));
      } else {
        const row = rows[active >= 0 ? active : 0];
        const kind = n.dataset.kind;
        renderer.invoiceState[kind].party = renderer.invoiceState[kind].parties.find((p) => p.id === Number(row.dataset.id));
        n.value = renderer.invoiceState[kind].party.name;
        renderInvoiceParty(kind);
        box.classList.add('hidden');
      }
    });
  });
  document.querySelectorAll('.party-suggestions').forEach((box) => box.addEventListener('click', (e) => { const b = e.target.closest('.party-suggestion'); if (!b) return; const kind = b.dataset.kind; renderer.invoiceState[kind].party = renderer.invoiceState[kind].parties.find((p) => p.id === Number(b.dataset.id)); renderer.$(`#${kind}Party`).value = renderer.invoiceState[kind].party.name; renderInvoiceParty(kind); box.classList.add('hidden'); }));
}

function restoreDailySalesMarkup() {
  const page = renderer.$('#salesPage');
  if (!page || page.dataset.dailyRestored) return;
  page.innerHTML = `<div class="page-heading"><div><span class="eyebrow">عملیات فروش</span></div><label class="sale-date-field daily-sale-date-field"><span class="sale-date-caption"><i aria-hidden="true">◷</i>تاریخ فروش</span><input id="saleDate" type="date"></label></div><div class="sale-modern-layout"><section class="panel product-picker"><div class="picker-header"><div><h3>لیست محصولات</h3><small id="dailySalePriceHint">قیمت‌ها به ${renderer.currencyLabel()} نمایش داده می‌شوند.</small></div><div class="toolbar-search"><span>⌕</span><input id="saleProductFilter" placeholder="کلیدواژه: نام، کد یا بارکد"></div></div><div id="saleProductCards" class="product-cards"></div></section><aside class="panel modern-cart"><div class="cart-heading"><div><h3>سبد فروش</h3><small id="cartCount">۰ قلم</small></div><button id="clearSaleCart" class="danger-button" type="button" title="پاک کردن سبد" aria-label="پاک کردن سبد">🗑️</button></div><div class="table-wrap"><table><thead><tr><th>محصول</th><th id="dailySalePriceHeader">قیمت (${renderer.currencyLabel()})</th><th>تعداد</th><th></th></tr></thead><tbody id="modernSaleItems"></tbody></table></div><div class="cart-total"><span id="dailySaleTotalLabel">مبلغ کل (${renderer.currencyLabel()})</span><strong id="modernSaleTotal">${renderer.money(0)}</strong></div><div id="modernSaleError" class="form-error hidden"></div><button id="modernSaveSale" class="primary wide" type="button">ثبت فروش</button><button id="modernSaveSalePrint" class="secondary wide" type="button">ثبت و چاپ فاکتور رسمی</button></aside></div>`;
  renderer.$('#saleDate').type = 'text';
  renderer.$('#saleDate').inputMode = 'numeric';
  renderer.$('#saleDate').autocomplete = 'off';
  renderer.$('#saleDate').placeholder = '۱۴۰۵/۰۶/۰۸';
  renderer.$('#saleDate').value = renderer.isoToJalali(new Date().toISOString().slice(0, 10));
  enhanceDailySalesMarkup(page);
  renderer.restoreDailySaleDraft();
  page.dataset.dailyRestored = '1';
  renderer.refreshDailySaleCurrencyLabels();
  renderer.bindSalesEvents();
  renderer.bindJalaliDatePickers();
  // Before login the IPC guard rejects this; refreshAfterLogin re-issues it
  // after a session exists and setPageRouter('sales') re-reads on entry.
  if (renderer.sessionReady) renderer.loadSaleProducts();
}

function enhanceDailySalesMarkup(page) {
  const heading = page.querySelector('.page-heading > div');
  if (heading && !heading.querySelector('.daily-sale-shortcuts')) {
    heading.insertAdjacentHTML('beforeend', '<h2>ثبت فروش روزانه</h2><div class="daily-sale-shortcuts"><kbd>F2</kbd> جست‌وجو <kbd>Enter</kbd> افزودن <kbd>F9</kbd> ثبت فروش</div>');
  }
  const search = page.querySelector('#saleProductFilter');
  if (search) {
    search.placeholder = 'اسکن بارکد یا جست‌وجوی کالا';
    search.autocomplete = 'off';
    search.parentElement.classList.add('daily-sale-search');
    if (!search.parentElement.querySelector('kbd')) search.parentElement.insertAdjacentHTML('beforeend', '<kbd>F2</kbd>');
  }
  const picker = page.querySelector('.product-picker .picker-header');
  if (picker && !page.querySelector('.daily-sale-hint')) picker.insertAdjacentHTML('afterend', '<div class="daily-sale-hint">با اسکن دوبارهٔ یک کالا، تعداد همان ردیف افزایش پیدا می‌کند.</div>');
  const total = page.querySelector('.cart-total');
  if (total && !page.querySelector('.cart-summary')) {
    total.outerHTML = '<div class="cart-summary"><div><span>اقلام</span><strong id="cartItemCount">۰</strong></div><div><span>مبلغ کل</span><strong id="modernSaleTotal">' + renderer.money(0) + '</strong></div></div>';
  }
  const cart = page.querySelector('.modern-cart');
  if (cart) cart.classList.add('daily-sale-cart');
  const clearButton = page.querySelector('#clearSaleCart');
  if (clearButton) {
    clearButton.textContent = '🗑️';
    clearButton.title = 'پاک کردن سبد';
    clearButton.setAttribute('aria-label', 'پاک کردن سبد');
  }
}

// Named distinctly from 02-management.js's initializeSalesMarkupLegacy: in the
// original monolith a single hoisted declaration won, but as separate
// <script> tags the duplicate name would let this file's declaration shadow
// the partial initializer for callers that resolve the name too early.
function initializeSalesMarkupFinal() { restoreDailySalesMarkup(); invoiceMarkupAndBind(); }

registerRendererBindings(renderer, {
  functions: {
    invoiceMarkup: { get: () => invoiceMarkup, set: (value) => { invoiceMarkup = value; } },
    newInvoiceItem: { get: () => newInvoiceItem, set: (value) => { newInvoiceItem = value; } },
    invoiceHasEntryRow: { get: () => invoiceHasEntryRow, set: (value) => { invoiceHasEntryRow = value; } },
    enhanceInvoiceMeta: { get: () => enhanceInvoiceMeta, set: (value) => { enhanceInvoiceMeta = value; } },
    invoiceMarkupAndBind: { get: () => invoiceMarkupAndBind, set: (value) => { invoiceMarkupAndBind = value; } },
    invoiceListMarkup: { get: () => invoiceListMarkup, set: (value) => { invoiceListMarkup = value; } },
    invoiceListKindToApi: { get: () => invoiceListKindToApi, set: (value) => { invoiceListKindToApi = value; } },
    invoiceListPageSelector: { get: () => invoiceListPageSelector, set: (value) => { invoiceListPageSelector = value; } },
    invoiceStatusLabel: { get: () => invoiceStatusLabel, set: (value) => { invoiceStatusLabel = value; } },
    loadInvoiceList: { get: () => loadInvoiceList, set: (value) => { loadInvoiceList = value; } },
    openInvoiceDetails: { get: () => openInvoiceDetails, set: (value) => { openInvoiceDetails = value; } },
    editInvoice: { get: () => editInvoice, set: (value) => { editInvoice = value; } },
    selectedDailySalesForMerge: { get: () => selectedDailySalesForMerge, set: (value) => { selectedDailySalesForMerge = value; } },
    updateDailyMergeButton: { get: () => updateDailyMergeButton, set: (value) => { updateDailyMergeButton = value; } },
    openDailySalesMergeModal: { get: () => openDailySalesMergeModal, set: (value) => { openDailySalesMergeModal = value; } },
    bindInvoiceLists: { get: () => bindInvoiceLists, set: (value) => { bindInvoiceLists = value; } },
    loadKeyboardInvoice: { get: () => loadKeyboardInvoice, set: (value) => { loadKeyboardInvoice = value; } },
    renderKeyboardItems: { get: () => renderKeyboardItems, set: (value) => { renderKeyboardItems = value; } },
    invoicePriceFieldMarkup: { get: () => invoicePriceFieldMarkup, set: (value) => { invoicePriceFieldMarkup = value; } },
    setInvoicePriceSelection: { get: () => setInvoicePriceSelection, set: (value) => { setInvoicePriceSelection = value; } },
    purchasePriceFieldMarkup: { get: () => purchasePriceFieldMarkup, set: (value) => { purchasePriceFieldMarkup = value; } },
    purchasePriceSuggestionsMarkup: { get: () => purchasePriceSuggestionsMarkup, set: (value) => { purchasePriceSuggestionsMarkup = value; } },
    renderPurchasePriceSuggestions: { get: () => renderPurchasePriceSuggestions, set: (value) => { renderPurchasePriceSuggestions = value; } },
    openPurchasePriceSuggestions: { get: () => openPurchasePriceSuggestions, set: (value) => { openPurchasePriceSuggestions = value; } },
    purchaseHistoryMarkup: { get: () => purchaseHistoryMarkup, set: (value) => { purchaseHistoryMarkup = value; } },
    purchaseHistoryPanelMarkup: { get: () => purchaseHistoryPanelMarkup, set: (value) => { purchaseHistoryPanelMarkup = value; } },
    loadPurchasePricesForItem: { get: () => loadPurchasePricesForItem, set: (value) => { loadPurchasePricesForItem = value; } },
    refreshPurchasePrices: { get: () => refreshPurchasePrices, set: (value) => { refreshPurchasePrices = value; } },
    commitPurchaseEntry: { get: () => commitPurchaseEntry, set: (value) => { commitPurchaseEntry = value; } },
    commitSaleEntry: { get: () => commitSaleEntry, set: (value) => { commitSaleEntry = value; } },
    keyboardInvoiceTotals: { get: () => keyboardInvoiceTotals, set: (value) => { keyboardInvoiceTotals = value; } },
    renderKeyboardSummary: { get: () => renderKeyboardSummary, set: (value) => { renderKeyboardSummary = value; } },
    showKeyboardSuggestions: { get: () => showKeyboardSuggestions, set: (value) => { showKeyboardSuggestions = value; } },
    chooseKeyboardProduct: { get: () => chooseKeyboardProduct, set: (value) => { chooseKeyboardProduct = value; } },
    addKeyboardRow: { get: () => addKeyboardRow, set: (value) => { addKeyboardRow = value; } },
    addKeyboardPayment: { get: () => addKeyboardPayment, set: (value) => { addKeyboardPayment = value; } },
    renderInvoiceParty: { get: () => renderInvoiceParty, set: (value) => { renderInvoiceParty = value; } },
    clearKeyboardInvoice: { get: () => clearKeyboardInvoice, set: (value) => { clearKeyboardInvoice = value; } },
    saveKeyboardInvoice: { get: () => saveKeyboardInvoice, set: (value) => { saveKeyboardInvoice = value; } },
    bindKeyboardInvoices: { get: () => bindKeyboardInvoices, set: (value) => { bindKeyboardInvoices = value; } },
    restoreDailySalesMarkup: { get: () => restoreDailySalesMarkup, set: (value) => { restoreDailySalesMarkup = value; } },
    enhanceDailySalesMarkup: { get: () => enhanceDailySalesMarkup, set: (value) => { enhanceDailySalesMarkup = value; } },
    initializeSalesMarkupFinal: { get: () => initializeSalesMarkupFinal, set: (value) => { initializeSalesMarkupFinal = value; } }
  }
});
