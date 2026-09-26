/* Keyboard-first invoice editor. It intentionally replaces the original
   card-based sales view while keeping the same IPC contract. */
function invoiceMarkup(kind) {
  const sale = kind === 'sale';
  const id = sale ? 'sale' : 'purchase';
  return `<div class="page-heading"><div><span class="eyebrow">عملیات ${sale ? 'فروش' : 'خرید'}</span><h2>فاکتور ${sale ? 'فروش' : 'خرید'}</h2></div><label class="sale-date-field">تاریخ<input class="invoice-date" id="${id}Date" type="date"></label></div>
  <div class="invoice-layout"><section class="panel invoice-editor"><div class="invoice-toolbar"><label>${sale ? 'مشتری' : 'تأمین‌کننده'}<input class="party-input" data-kind="${kind}" id="${id}Party" placeholder="جست‌وجو..." autocomplete="off"><div class="party-suggestions hidden" id="${id}PartySuggestions"></div></label><button type="button" class="secondary invoice-new-row" data-kind="${kind}">＋ ردیف جدید</button>${kind === 'purchase' ? '<button type="button" class="secondary invoice-new-product" data-kind="purchase">＋ ثبت کالای جدید</button>' : ''}</div>
  <div class="table-wrap invoice-table-wrap"><table class="invoice-table"><thead><tr><th>محصول</th><th>تعداد</th><th>قیمت واحد</th><th>تخفیف</th><th>مبلغ کل</th><th></th></tr></thead><tbody id="${id}InvoiceItems"></tbody></table></div>
  <div id="${id}InvoiceError" class="form-error hidden"></div><div class="shortcut-guide"><span>راهنما</span><kbd>↑↓</kbd> پیمایش <kbd>Enter</kbd> انتخاب/مرحله بعد <kbd>Tab</kbd> پرداخت <kbd>Ctrl+Delete</kbd> حذف ردیف <kbd>Ctrl+Enter</kbd> ثبت <kbd>Esc</kbd> بستن پیشنهادها</div></section>
  <aside class="panel invoice-summary"><h3>خلاصه فاکتور</h3><div class="summary-lines"><div><span>جمع کالاها</span><strong id="${id}Subtotal">${money(0)}</strong></div><div><span>تخفیف</span><input class="money-input invoice-discount" id="${id}Discount" value="0" inputmode="decimal"></div><div><span>مالیات</span><input class="money-input invoice-tax" id="${id}Tax" value="0" inputmode="decimal"></div><div class="grand-total"><span>مبلغ نهایی</span><strong id="${id}Total">${money(0)}</strong></div></div>
  <div class="payment-box"><div class="payment-heading"><h4>پرداخت</h4><button type="button" class="text-button payment-full" data-kind="${kind}">تسویه کامل</button></div><div class="payment-entry"><select class="payment-method" id="${id}PaymentMethod"><option value="cash">نقدی</option><option value="card">کارت</option><option value="check">چک</option></select><input class="money-input payment-amount" id="${id}PaymentAmount" value="0" inputmode="decimal" placeholder="مبلغ"></div><div class="check-fields hidden" id="${id}CheckFields"><input id="${id}CheckNumber" placeholder="شماره چک"><input id="${id}BankName" placeholder="بانک"><input id="${id}DueDate" type="date"></div><button class="ghost add-payment" data-kind="${kind}" type="button">＋ افزودن پرداخت</button><div class="payment-list" id="${id}Payments"></div></div><div class="summary-lines"><div class="remaining"><span>مانده</span><strong id="${id}Remaining">${money(0)}</strong></div></div><button class="primary wide invoice-save" data-kind="${kind}" type="button">ثبت فاکتور</button><button class="secondary wide invoice-print" data-kind="${kind}" type="button">ثبت و چاپ</button><button class="text-button invoice-clear" data-kind="${kind}" type="button">پاک‌کردن فاکتور</button></aside></div>`;
}

function newInvoiceItem(kind) {
  return {
    query: '', productId: null, name: '', code: '', stock: 0, quantity: 1, unitPrice: 0, discount: 0,
    priceType: kind === 'sale' ? 'retail' : 'purchase', purchasePriceOptions: [],
    purchasePriceOpen: false, purchasePriceActiveIndex: -1
  };
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
    dateInput.value = isoToJalali(new Date().toISOString().slice(0, 10));
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
  const page = $('#salesPage');
  if (!page || page.dataset.keyboardInvoice) return;
  const salesInvoice = document.createElement('section');
  salesInvoice.id = 'salesInvoicePage';
  salesInvoice.className = 'page hidden';
  salesInvoice.innerHTML = invoiceMarkup('sale');
  enhanceInvoiceMeta('sale', salesInvoice);
  const purchase = document.createElement('section');
  purchase.id = 'purchasesPage'; purchase.className = 'page hidden'; purchase.innerHTML = invoiceMarkup('purchase'); enhanceInvoiceMeta('purchase', purchase); $('#placeholderPage').before(purchase);
  $('#placeholderPage').before(salesInvoice);
  const lists = document.createElement('div');
  lists.innerHTML = invoiceListMarkup('sales') + invoiceListMarkup('purchases');
  $('#placeholderPage').before(lists);
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
  document.querySelectorAll('.invoice-date').forEach((input) => { input.value = isoToJalali(new Date().toISOString().slice(0, 10)); });
  bindJalaliDatePickers();
  document.querySelectorAll('.invoice-date').forEach((input) => input.addEventListener('change', async () => {
    const kind = input.id.startsWith('sale') ? 'sale' : 'purchase';
    if (invoiceState[kind].editingId) return;
    const date = jalaliInputToIso(input.value);
    if (date) $(`#${kind}InvoiceNumber`).value = await window.api.invoices.nextNumber(kind, date);
  }));
  page.dataset.keyboardInvoice = '1';
  bindKeyboardInvoices();
  bindInvoiceLists();
  loadKeyboardInvoice('sale'); loadKeyboardInvoice('purchase');
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
  const query = $(`${pageSelector} .invoice-list-query`)?.value || '';
  const productQuery = $(`${pageSelector} .invoice-list-product-query`)?.value || '';
  const fromValue = $(`${pageSelector} .invoice-list-from`)?.value || '';
  const toValue = $(`${pageSelector} .invoice-list-to`)?.value || '';
  const body = $(`#${kind}Table`);
  const columnCount = apiKind === 'sale' ? 9 : 8;
  if (body) body.innerHTML = Array.from({ length: 6 }, () => `<tr class="skeleton-row"><td colspan="${columnCount}"><div class="skeleton line-skeleton"></div></td></tr>`).join('');
  const rows = await (apiKind === 'sale' ? window.api.sales.list : window.api.purchases.list)({ query, productQuery, from: jalaliInputToIso(fromValue), to: jalaliInputToIso(toValue), status: $(`${pageSelector} .invoice-list-status`)?.value || '' });
  body.innerHTML = rows.length ? rows.map((row) => {
    const eligibleForMerge = apiKind === 'sale' && row.source === 'daily' && row.status === 'active';
    const selection = apiKind === 'sale' ? `<td class="invoice-selection-column">${eligibleForMerge ? `<input class="daily-sale-merge-select" type="checkbox" value="${row.id}" data-date="${row.date}" aria-label="انتخاب ${esc(row.invoiceNumber)} برای ادغام">` : ''}</td>` : '';
    return `<tr class="${apiKind === 'sale' && row.pinned ? 'pinned-row' : ''}">${selection}<td><strong>${esc(row.invoiceNumber)}</strong>${apiKind === 'sale' && row.pinned ? '<span class="pin-badge" title="سنجاق‌شده">📌</span>' : ''}</td><td>${isoToJalali(row.date)}</td><td>${apiKind === 'sale' && row.source === 'daily' ? '<span class="daily-sale-party">فروش روزانه</span>' : esc(row.partyName || 'بدون طرف‌حساب')}</td><td>${money(row.total)}</td><td>${money(row.paidAmount)}</td><td class="${row.remainingAmount > 0 ? 'debt-amount' : ''}">${money(row.remainingAmount)}</td><td><span class="status-badge ${row.status === 'cancelled' ? 'inactive' : row.remainingAmount > 0 ? 'warning' : 'active'}">${invoiceStatusLabel(row.status, row)}</span></td><td>${apiKind === 'sale' ? `<button class="table-action pin-invoice${row.pinned ? ' pinned' : ''}" data-kind="${apiKind}" data-id="${row.id}" data-pinned="${row.pinned ? '1' : '0'}">${row.pinned ? 'برداشتن سنجاق' : 'سنجاق'}</button>` : ''}<button class="table-action view-invoice" data-kind="${apiKind}" data-id="${row.id}">مشاهده</button><button class="table-action print-invoice" data-kind="${apiKind}" data-id="${row.id}">چاپ</button>${row.remainingAmount > 0 && row.status !== 'cancelled' ? `<button class="table-action settle-invoice" data-kind="${apiKind}" data-id="${row.id}">تسویه</button>` : ''}${row.status !== 'cancelled' ? `<button class="table-action danger cancel-invoice" data-kind="${apiKind}" data-id="${row.id}">لغو</button>` : ''}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="${columnCount}">فاکتوری برای نمایش وجود ندارد.</td></tr>`;
  updateDailyMergeButton();
}

async function openInvoiceDetails(kind, id) {
  const invoice = await window.api.invoices.details(kind, id);
  const modal = $('#invoiceDetailsModal');
  const computedCost = (invoice.items || []).reduce((sum, item) => sum + Number(item.purchase_price || 0) * Number(item.quantity || 0), 0);
  const computedProfit = (invoice.items || []).reduce((sum, item) => sum + Number(item.profit || 0), 0);
  const profitTotal = Number(invoice.profit_total || 0) || computedProfit;
  const costTotal = Number(invoice.cost_total || 0) || computedCost;
  const fullSettlementHtml = Number(invoice.remaining_amount || 0) > 0 && invoice.status !== 'cancelled'
    ? `<button type="button" class="secondary detail-full-settle" data-kind="${kind}" data-id="${id}" title="Ctrl+Shift+Enter">تسویه کامل (${money(invoice.remaining_amount)}) <kbd>Ctrl+Shift+Enter</kbd></button>`
    : '';
  const profitLossHtml = kind === 'sale'
    ? `<div class="invoice-detail-totals profit-loss-summary"><span>بهای تمام‌شده: <strong>${money(costTotal)}</strong></span><span class="${profitTotal >= 0 ? 'profit-amount' : 'loss-amount'}">${profitTotal >= 0 ? 'سود' : 'زیان'}: <strong>${money(Math.abs(profitTotal))}</strong></span></div>`
    : '';
  modal.innerHTML = `<div class="modal-header"><div><span class="eyebrow">جزئیات فاکتور</span><h3>${esc(invoice.invoice_number)}</h3></div><button class="modal-close" data-close-invoice-details>×</button></div><div class="invoice-detail-meta"><span>تاریخ: ${isoToJalali(invoice.date)}</span><span>طرف‌حساب: ${kind === 'sale' && invoice.source === 'daily' ? '<span class="daily-sale-party">فروش روزانه</span>' : esc(invoice.partyName || 'بدون طرف‌حساب')}</span><span>تلفن: ${esc(invoice.partyPhone || '—')}</span><span>آدرس: ${esc(invoice.partyAddress || '—')}</span></div><div class="table-wrap"><table><thead><tr><th>کالا</th><th>تعداد</th><th>قیمت</th><th>تخفیف</th><th>جمع</th></tr></thead><tbody>${invoice.items.map((item) => `<tr><td>${esc(item.productName)}<small>${esc(item.productCode || '')}</small></td><td>${Math.round(Number(item.quantity) || 0)}</td><td>${money(item.unit_price)}</td><td>${money(item.discount)}</td><td>${money(item.total)}</td></tr>`).join('')}</tbody></table></div><div class="invoice-detail-totals"><span>کل: <strong>${money(invoice.total)}</strong></span><span>پرداخت‌شده: <strong>${money(invoice.paid_amount)}</strong></span><span>مانده: <strong class="debt-amount">${money(invoice.remaining_amount)}</strong></span></div>${profitLossHtml}<div class="detail-settlement-actions">${fullSettlementHtml}</div><h4>پرداخت‌ها</h4><div class="payment-list detail-payments">${invoice.payments.map((p) => `<div class="payment-row"><span>${p.method === 'check' ? `چک ${esc(p.check_number || '')}` : p.method === 'card' ? 'کارت' : 'نقدی'}</span><strong>${money(p.amount)}</strong></div>`).join('') || '<small>پرداختی ثبت نشده است.</small>'}</div>${invoice.remaining_amount > 0 && invoice.status !== 'cancelled' ? `<div class="detail-settlement"><h4>ثبت پرداخت جدید</h4><div class="payment-entry"><select id="detailPaymentMethod"><option value="cash">نقدی</option><option value="card">کارت</option><option value="check">چک</option></select><input id="detailPaymentAmount" class="money-input" inputmode="decimal" placeholder="مبلغ"></div><div id="detailCheckFields" class="check-fields hidden"><input id="detailCheckNumber" placeholder="شماره چک"><input id="detailBankName" placeholder="بانک"><input id="detailDueDate" type="date"></div><button class="primary wide detail-settle-button" data-kind="${kind}" data-id="${id}">ثبت پرداخت</button></div>` : ''}`;
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
  $('#invoiceDetailsBackdrop').classList.remove('hidden'); modal.classList.remove('hidden');
  applyDefaultPaymentMethod(modal);
}

async function editInvoice(kind, id) {
  if (kind !== 'sale') return showToast('ویرایش فاکتور خرید هنوز فعال نشده است.', true);
  const invoice = await window.api.invoices.details(kind, id);
  setManagedPage('sales-invoice');
  const state = invoiceState.sale;
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
  state.payments = invoice.payments.map((payment) => ({
    method: payment.method, amount: Number(payment.amount || 0), checkNumber: payment.check_number || '',
    bankName: payment.bank_name || '', dueDate: payment.due_date || ''
  }));
  $('#saleParty').value = invoice.partyName || '';
  $('#saleDate').value = isoToJalali(invoice.date);
  $('#saleInvoiceNumber').value = invoice.invoice_number;
  $('#saleDiscount').value = Number(invoice.discount || 0) / 100;
  $('#saleTax').value = Number(invoice.tax || 0) / 100;
  renderInvoiceParty('sale'); renderKeyboardItems('sale'); renderKeyboardSummary('sale');
  showToast('فاکتور برای ویرایش آماده شد.');
}

function selectedDailySalesForMerge() {
  return [...document.querySelectorAll('#salesInvoicesPage .daily-sale-merge-select:checked')].map((input) => ({
    id: Number(input.value), date: input.dataset.date
  }));
}

function updateDailyMergeButton() {
  const button = $('#mergeDailySales');
  if (!button) return;
  const selected = selectedDailySalesForMerge();
  const sameDate = selected.length > 0 && new Set(selected.map((sale) => sale.date)).size === 1;
  button.disabled = !sameDate;
  button.title = selected.length && !sameDate ? 'فقط فروش‌های روزانه با یک تاریخ مشترک قابل ادغام‌اند.' : '';
}

async function openDailySalesMergeModal() {
  const selected = selectedDailySalesForMerge();
  if (!selected.length) return showToast('حداقل یک فروش روزانه را انتخاب کنید.', true);
  if (new Set(selected.map((sale) => sale.date)).size !== 1) return showToast('فقط فروش‌های روزانه با یک تاریخ مشترک قابل ادغام‌اند.', true);
  const parties = (await window.api.customers.list({ query: '', type: '', includeInactive: false }))
    .filter((party) => ['customer', 'both'].includes(party.partyType));
  if (!parties.length) return showToast('برای ادغام، ابتدا یک مشتری فعال ثبت کنید.', true);
  let backdrop = $('#dailySalesMergeBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'dailySalesMergeBackdrop';
    backdrop.className = 'modal-backdrop hidden';
    document.body.appendChild(backdrop);
  }
  const date = selected[0].date;
  backdrop.innerHTML = `<div class="modal daily-sales-merge-modal"><div class="modal-header"><div><span class="eyebrow">تبدیل فروش روزانه</span><h3>ادغام در فاکتور فروش</h3></div><button class="modal-close" type="button" data-close-daily-merge>×</button></div><p class="daily-merge-note">${selected.length} فروش روزانهٔ انتخاب‌شده با تاریخ <strong>${isoToJalali(date)}</strong> در یک فاکتور فروش ثبت می‌شوند. موجودی کالا دوباره تغییر نمی‌کند و پرداخت‌های ثبت‌شده منتقل می‌شوند.</p><label>مشتری فاکتور جدید<select id="dailyMergeParty"><option value="">انتخاب مشتری</option>${parties.map((party) => `<option value="${party.id}">${esc(party.name)}${party.phone || party.mobile ? ` · ${esc(party.phone || party.mobile)}` : ''}</option>`).join('')}</select></label><div id="dailyMergeError" class="form-error hidden"></div><div class="modal-actions"><button class="secondary" type="button" data-close-daily-merge>انصراف</button><button id="confirmDailySalesMerge" class="primary" type="button">ثبت فاکتور ادغامی</button></div></div>`;
  backdrop.classList.remove('hidden');
  backdrop.onclick = async (event) => {
    if (event.target === backdrop || event.target.closest('[data-close-daily-merge]')) { backdrop.classList.add('hidden'); return; }
    if (!event.target.closest('#confirmDailySalesMerge')) return;
    const partyId = Number($('#dailyMergeParty').value);
    const error = $('#dailyMergeError');
    if (!partyId) { error.textContent = 'انتخاب مشتری الزامی است.'; error.classList.remove('hidden'); return; }
    if (!await showConfirmDialog({ title: 'ادغام فروش‌های روزانه', message: `فروش‌های روزانهٔ انتخاب‌شده در فاکتور جدیدِ تاریخ ${isoToJalali(date)} ادغام شوند؟`, confirmText: 'ادغام و ثبت' })) return;
    try {
      const result = await window.api.sales.mergeDaily({ saleIds: selected.map((sale) => sale.id), date, partyId });
      backdrop.classList.add('hidden');
      showToast(`فاکتور ${result.invoiceNumber} با موفقیت ایجاد شد.`);
      await Promise.all([loadInvoiceList('sales'), window.api.dashboard.summary().then(renderMetrics)]);
    } catch (err) {
      error.textContent = err.message || 'ادغام فاکتورها انجام نشد.';
      error.classList.remove('hidden');
    }
  };
}

function bindInvoiceLists() {
  ['sales', 'purchases'].forEach((kind) => {
    const page = $(invoiceListPageSelector(kind));
    ['input', 'change'].forEach((eventName) => page.addEventListener(eventName, (event) => {
      if (event.target.matches('.invoice-list-query, .invoice-list-product-query, .invoice-list-from, .invoice-list-to, .invoice-list-status')) loadInvoiceList(kind);
      if (kind === 'sales' && event.target.matches('.daily-sale-merge-select')) updateDailyMergeButton();
    }));
    if (kind === 'sales') page.addEventListener('click', (event) => {
      if (event.target.closest('#mergeDailySales')) openDailySalesMergeModal().catch((error) => showToast(error.message, true));
    });
  });
  $('#invoiceDetailsBackdrop').addEventListener('click', async (event) => {
    if (event.target.id === 'invoiceDetailsBackdrop' || event.target.closest('[data-close-invoice-details]')) { $('#invoiceDetailsBackdrop').classList.add('hidden'); return; }
    const settle = event.target.closest('.detail-settle-button');
    if (settle) {
      const method = $('#detailPaymentMethod').value;
      const amount = parsePriceInput($('#detailPaymentAmount').value) / 100;
      try {
        await window.api.invoices.settle(settle.dataset.kind, Number(settle.dataset.id), { method, amount, checkNumber: $('#detailCheckNumber')?.value, bankName: $('#detailBankName')?.value, dueDate: $('#detailDueDate')?.value });
        $('#invoiceDetailsBackdrop').classList.add('hidden'); showToast('پرداخت با موفقیت ثبت شد.'); await loadInvoiceList(settle.dataset.kind === 'sale' ? 'sales' : 'purchases');
      } catch (error) { showToast(error.message, true); }
    }
    const fullSettle = event.target.closest('.detail-full-settle');
    if (fullSettle) {
      try {
        const invoice = await window.api.invoices.details(fullSettle.dataset.kind, Number(fullSettle.dataset.id));
        const amount = Number(invoice.remaining_amount || 0) / 100;
        if (amount <= 0) return;
        const method = ['cash', 'card', 'check'].includes(defaultSettlementMethod) ? defaultSettlementMethod : 'cash';
        if (!await showConfirmDialog({ title: 'تسویه کامل فاکتور', message: `مانده ${money(invoice.remaining_amount)} با روش ${method === 'card' ? 'کارت' : method === 'check' ? 'چک' : 'نقدی'} تسویه شود؟`, confirmText: 'تسویه فاکتور' })) return;
        await window.api.invoices.settle(fullSettle.dataset.kind, Number(fullSettle.dataset.id), { method, amount });
        $('#invoiceDetailsBackdrop').classList.add('hidden');
        showToast('فاکتور به‌طور کامل تسویه شد.');
        if (await showConfirmDialog({ title: 'چاپ رسید پرداخت', message: 'رسید پرداخت چاپ شود؟', confirmText: 'چاپ رسید', destructive: false })) printPaymentReceipt(invoice, { method, amount: Number(invoice.remaining_amount || 0) });
        await loadInvoiceList(fullSettle.dataset.kind === 'sale' ? 'sales' : 'purchases');
      } catch (error) { showToast(error.message, true); }
    }
  });
  $('#invoiceDetailsBackdrop').addEventListener('change', (event) => { if (event.target.id === 'detailPaymentMethod') $('#detailCheckFields').classList.toggle('hidden', event.target.value !== 'check'); });
  document.addEventListener('click', async (event) => {
    const edit = event.target.closest('.edit-invoice-detail');
    if (edit) {
      $('#invoiceDetailsBackdrop').classList.add('hidden');
      try { await editInvoice(edit.dataset.kind, Number(edit.dataset.id)); } catch (error) { showToast(error.message || 'ویرایش فاکتور انجام نشد.', true); }
      return;
    }
    const print = event.target.closest('.invoice-detail-print');
    if (print) {
      try { await openInvoicePrintPreview(print.dataset.kind, Number(print.dataset.id)); } catch (error) { showToast(error.message || 'پیش‌نمایش فاکتور بارگذاری نشد.', true); }
      return;
    }
    const printInvoice = event.target.closest('.print-invoice');
    if (printInvoice) {
      try { await openInvoicePrintPreview(printInvoice.dataset.kind, Number(printInvoice.dataset.id)); } catch (error) { showToast(error.message || 'پیش‌نمایش فاکتور بارگذاری نشد.', true); }
      return;
    }
    const pin = event.target.closest('.pin-invoice');
    if (pin) {
      try {
        const pinned = pin.dataset.pinned !== '1';
        await window.api.invoices.setPinned(pin.dataset.kind, Number(pin.dataset.id), pinned);
        showToast(pinned ? 'فاکتور سنجاق شد و همیشه بالای فهرست می‌ماند.' : 'سنجاق فاکتور برداشته شد.');
        await loadInvoiceList(pin.dataset.kind === 'sale' ? 'sales' : 'purchases');
      } catch (error) { showToast(error.message || 'تغییر سنجاق فاکتور انجام نشد.', true); }
      return;
    }
    const view = event.target.closest('.view-invoice');
    if (view) { try { await openInvoiceDetails(view.dataset.kind, Number(view.dataset.id)); } catch (error) { showToast(error.message || 'جزئیات فاکتور بارگذاری نشد.', true); } return; }
    const settle = event.target.closest('.settle-invoice');
    if (settle) { try { await openInvoiceDetails(settle.dataset.kind, Number(settle.dataset.id)); } catch (error) { showToast(error.message || 'فاکتور بارگذاری نشد.', true); } return; }
    const cancel = event.target.closest('.cancel-invoice');
    if (cancel && await showConfirmDialog({ title: 'لغو فاکتور', message: 'این فاکتور لغو شود؟ موجودی و مانده حساب اصلاح خواهد شد.', confirmText: 'لغو فاکتور', destructive: true })) {
      try { await window.api.invoices.cancel(cancel.dataset.kind, Number(cancel.dataset.id)); showToast('فاکتور لغو شد.'); await loadInvoiceList(cancel.dataset.kind === 'sale' ? 'sales' : 'purchases'); } catch (error) { showToast(error.message, true); }
    }
  });
  document.addEventListener('keydown', (event) => {
    if (!uiShortcuts) return;
    if (!(event.ctrlKey && event.shiftKey && event.key === 'Enter')) return;
    const button = $('#invoiceDetailsBackdrop:not(.hidden) .detail-full-settle');
    if (button) { event.preventDefault(); button.click(); }
  });
}

async function loadKeyboardInvoice(kind) {
  const state = invoiceState[kind];
  state.products = await window.api.products.search('');
  state.parties = (await window.api.customers.list({ query: '', type: '', includeInactive: false }))
    .filter((party) => party.partyType === (kind === 'sale' ? 'customer' : 'supplier') || party.partyType === 'both');
  if (!state.items.length) state.items = [newInvoiceItem(kind)];
  if (kind === 'purchase' && state.items[0]?.productId) state.items.unshift(newInvoiceItem('purchase'));
  const numberField = $(`#${kind}InvoiceNumber`);
  if (numberField && !numberField.value) numberField.value = await window.api.invoices.nextNumber(kind, jalaliInputToIso($(`#${kind}Date`).value));
  renderKeyboardItems(kind); renderKeyboardSummary(kind);
  if (!state.payments.length) {
    const methodInput = $(`#${kind}PaymentMethod`);
    if (methodInput) methodInput.value = defaultSettlementMethod;
  }
}

function renderKeyboardItems(kind, focus) {
  const state = invoiceState[kind]; const body = $(`#${kind}InvoiceItems`);
  body.innerHTML = state.items.map((item, index) => {
    const hasEntryRow = kind === 'purchase' || (kind === 'sale' && !state.editingId);
    if (hasEntryRow && index > 0) {
      return `<tr class="invoice-committed-row" data-index="${index}"><td><strong>${esc(item.name)}</strong><small>${esc(item.code)}</small></td><td>${Math.max(1, Math.round(Number(item.quantity) || 1))}</td><td>${money(item.unitPrice)}</td><td>${money(item.discount)}</td><td class="line-total">${money(Math.max(0, item.quantity * item.unitPrice - item.discount))}</td><td><button class="delete-line" data-kind="${kind}" data-index="${index}" title="حذف">×</button></td></tr>`;
    }
    return `<tr class="${hasEntryRow ? 'invoice-entry-row' : ''}" data-index="${index}"><td class="product-cell"><input class="invoice-product-input" data-kind="${kind}" data-index="${index}" value="${esc(item.query || item.name)}" placeholder="نام، کد یا بارکد" autocomplete="off"><div class="invoice-suggestions hidden"></div>${item.name ? `<small>${esc(item.code)} · موجودی ${item.stock}</small>` : ''}</td><td><input class="invoice-quantity" data-kind="${kind}" data-index="${index}" type="number" min="1" step="1" value="${Math.max(1, Math.round(Number(item.quantity) || 1))}"></td>${invoicePriceFieldMarkup(kind, item, index)}<td><input class="invoice-discount-line" data-kind="${kind}" data-index="${index}" type="text" inputmode="decimal" value="${formatPriceInput(item.discount)}"></td><td class="line-total" tabindex="0">${money(Math.max(0, item.quantity * item.unitPrice - item.discount))}</td><td><button class="delete-line" data-kind="${kind}" data-index="${index}" title="حذف">×</button></td></tr>`;
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
  return `<td class="price-cell"><select class="invoice-price-combo" data-kind="${kind}" data-index="${index}"><option value="retail" ${item.priceType === 'retail' ? 'selected' : ''}>قیمت فروش — ${money(item.retailPrice || item.unitPrice)}</option><option value="wholesale" ${item.priceType === 'wholesale' ? 'selected' : ''} ${item.wholesalePrice > 0 ? '' : 'disabled'}>فروش عمده — ${money(item.wholesalePrice || 0)}</option><option value="custom" ${isCustom ? 'selected' : ''}>قیمت دستی</option></select><input class="invoice-price-custom ${isCustom ? '' : 'hidden'}" data-kind="${kind}" data-index="${index}" type="text" inputmode="decimal" value="${formatPriceInput(item.unitPrice)}" placeholder="قیمت دستی"></td>`;
}

function setInvoicePriceSelection(kind, index, value, options = {}) {
  const item = invoiceState[kind]?.items[index];
  const row = $(`#${kind}InvoiceItems tr[data-index="${index}"]`);
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
  return `<div class="purchase-price-entry"><input class="invoice-price-custom purchase-price-input" data-kind="purchase" data-index="${index}" type="text" inputmode="decimal" value="${formatPriceInput(item.unitPrice)}" placeholder="قیمت خرید"><div class="purchase-price-suggestions hidden" data-index="${index}">${purchasePriceSuggestionsMarkup(item, index)}</div></div>`;
}

function purchasePriceSuggestionsMarkup(item, index) {
  const options = item.purchasePriceOptions || [];
  if (!options.length) return '<div class="purchase-price-empty">قیمت خرید قبلی ثبت نشده است.</div>';
  return options.map((row, optionIndex) => `<button type="button" class="purchase-price-option ${item.purchasePriceActiveIndex === optionIndex ? 'active' : ''}" data-index="${index}" data-option-index="${optionIndex}"><span>${money(row.effectiveUnitPrice)}</span><small>${isoToJalali(row.date)}${row.supplierName ? ` · ${esc(row.supplierName)}` : ''}</small></button>`).join('');
}

function renderPurchasePriceSuggestions(item, index) {
  const row = $(`#purchaseInvoiceItems tr[data-index="${index}"]`);
  const box = row?.querySelector('.purchase-price-suggestions');
  if (!box) return;
  box.innerHTML = purchasePriceSuggestionsMarkup(item, index);
  box.classList.toggle('hidden', !item.purchasePriceOpen);
}

function openPurchasePriceSuggestions(index) {
  const item = invoiceState.purchase.items[index];
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
  if (history?.error) return `<div class="purchase-history-empty error">${esc(history.error)}</div>`;
  const rows = history?.items || [];
  if (!rows.length) return '<div class="purchase-history-empty">برای این کالا سابقهٔ خرید فعال ثبت نشده است.</div>';
  const summary = history.summary || {};
  return `<div class="purchase-history-summary"><span>کمینه <b>${money(summary.minUnitPrice)}</b></span><span>بیشینه <b>${money(summary.maxUnitPrice)}</b></span><span>میانگین خالص <b>${money(summary.averageEffectiveUnitPrice)}</b></span>${summary.selectedSupplierCount ? `<span class="selected-supplier-count">${summary.selectedSupplierCount} خرید از تأمین‌کنندهٔ انتخاب‌شده</span>` : ''}</div><div class="purchase-history-rows">${rows.map((row) => `<button type="button" class="purchase-history-row ${row.isSelectedSupplier ? 'selected-supplier' : ''}" data-index="${index}" data-price="${Number(row.effectiveUnitPrice || 0)}" title="انتخاب این قیمت"><span><strong>${esc(row.supplierName)}</strong><small>${isoToJalali(row.date)} · فاکتور ${esc(row.invoiceNumber)} · ${Number(row.quantity || 0)} عدد${Number(row.returnedQuantity || 0) ? ` · ${Number(row.returnedQuantity)} مرجوعی` : ''}</small></span><span><small>واحد ${money(row.unitPrice)}${Number(row.discount || 0) ? ` · تخفیف ${money(row.discount)}` : ''}</small><b>خالص ${money(row.effectiveUnitPrice)}</b></span></button>`).join('')}</div><small class="purchase-history-note">قیمت خالص، پس از تخفیف همان ردیف است و تخفیف یا مالیات کل فاکتور را شامل نمی‌شود.</small>`;
}

async function loadPurchasePricesForItem(item) {
  const state = invoiceState.purchase;
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
    const input = $(`#purchaseInvoiceItems tr[data-index="${index}"] .purchase-price-input`);
    if (input) input.value = formatPriceInput(current.unitPrice);
    renderPurchasePriceSuggestions(current, index);
  } catch (error) {
    const current = state.items.find((candidate) => candidate === item);
    if (!current || current.productId !== productId) return;
    current.purchasePriceOptions = [];
    renderPurchasePriceSuggestions(current, state.items.indexOf(current));
  }
}

function refreshPurchasePrices() {
  const entry = invoiceState.purchase.items[0];
  if (entry?.productId) loadPurchasePricesForItem(entry);
}

function commitPurchaseEntry() {
  const state = invoiceState.purchase;
  const entry = state.items[0];
  if (!entry?.productId) return showToast('ابتدا کالا را انتخاب کنید.', true);
  if (Number(entry.unitPrice || 0) <= 0) return showToast('قیمت خرید را وارد یا انتخاب کنید.', true);
  entry.purchasePriceOpen = false;
  entry.purchasePriceActiveIndex = -1;
  state.items.push({ ...entry, purchasePriceOpen: false, purchasePriceActiveIndex: -1 });
  state.items[0] = newInvoiceItem('purchase');
  renderKeyboardItems('purchase', { index: 0, className: 'invoice-product-input' });
  renderKeyboardSummary('purchase');
}

function commitSaleEntry() {
  const state = invoiceState.sale;
  const entry = state.items[0];
  if (!entry?.productId) return showToast('ابتدا کالا را انتخاب کنید.', true);
  if (Number(entry.unitPrice || 0) <= 0) return showToast('قیمت فروش را وارد یا انتخاب کنید.', true);
  state.items.push({ ...entry });
  state.items[0] = newInvoiceItem('sale');
  renderKeyboardItems('sale', { index: 0, className: 'invoice-product-input' });
  renderKeyboardSummary('sale');
}

function keyboardInvoiceTotals(kind) {
  const state = invoiceState[kind];
  const invoiceItems = (kind === 'purchase' || (kind === 'sale' && !state.editingId)) ? state.items.slice(1) : state.items;
  const subtotal = invoiceItems.reduce((sum, item) => sum + Math.max(0, item.quantity * item.unitPrice - item.discount), 0);
  const discount = parsePriceInput($(`#${kind}Discount`).value); const tax = parsePriceInput($(`#${kind}Tax`).value);
  return { subtotal, discount, tax, total: Math.max(0, subtotal - discount + tax) };
}

function renderKeyboardSummary(kind) {
  const totals = keyboardInvoiceTotals(kind); const state = invoiceState[kind];
  const paid = state.payments.reduce((sum, item) => sum + item.amount, 0);
  $(`#${kind}Subtotal`).textContent = money(totals.subtotal); $(`#${kind}Total`).textContent = money(totals.total); $(`#${kind}Remaining`).textContent = money(Math.max(0, totals.total - paid));
  $(`#${kind}Payments`).innerHTML = state.payments.map((p, i) => `<div class="payment-row"><span>${p.method === 'check' ? `چک ${esc(p.checkNumber || '')}` : p.method === 'card' ? 'کارت' : 'نقدی'}</span><strong>${money(p.amount)}</strong><button class="delete-payment" data-kind="${kind}" data-index="${i}">×</button></div>`).join('');
}

function showKeyboardSuggestions(kind, index) {
  const row = $(`#${kind}InvoiceItems tr[data-index="${index}"]`); const input = row?.querySelector('.invoice-product-input'); const box = row?.querySelector('.invoice-suggestions'); if (!input || !box) return;
  const tokens = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean); const rows = invoiceState[kind].products.filter((p) => !tokens.length || tokens.every((token) => [p.name, p.code, p.barcode].some((v) => String(v || '').toLowerCase().includes(token)))).slice(0, 8);
  box.innerHTML = rows.map((p) => `<button type="button" class="invoice-suggestion" data-kind="${kind}" data-index="${index}" data-id="${p.id}"><span>${esc(p.name)}${kind === 'purchase' ? '' : `<small>${esc(p.code)} · موجودی ${p.stock}</small>`}</span><b>${money(kind === 'purchase' ? p.purchasePrice : p.salePrice)}</b></button>`).join('');
  box.classList.toggle('hidden', !rows.length);
}

function chooseKeyboardProduct(kind, index, product) {
  if (!product) return; const state = invoiceState[kind]; const item = state.items[index];
  const isEntryRow = index === 0 && (kind === 'purchase' || (kind === 'sale' && !state.editingId));
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
  if (kind === 'purchase' || (kind === 'sale' && !invoiceState.sale.editingId)) {
    renderKeyboardItems(kind, { index: 0, className: 'invoice-product-input' });
    return;
  }
  invoiceState[kind].items.push(newInvoiceItem(kind));
  renderKeyboardItems(kind, { index: invoiceState[kind].items.length - 1, className: 'invoice-product-input' });
}

function addKeyboardPayment(kind, options = {}) {
  const amount = parsePriceInput($(`#${kind}PaymentAmount`).value); const method = $(`#${kind}PaymentMethod`).value;
  if (!amount) {
    if (!options.silent) showToast('مبلغ پرداخت را وارد کنید.', true);
    return false;
  }
  if (method === 'check' && !$(`#${kind}CheckNumber`).value.trim()) {
    const message = 'شماره چک را وارد کنید.';
    if (options.throwOnError) throw new Error(message);
    showToast(message, true);
    return false;
  }
  invoiceState[kind].payments.push({ method, amount, checkNumber: $(`#${kind}CheckNumber`).value, bankName: $(`#${kind}BankName`).value, dueDate: $(`#${kind}DueDate`).value });
  $(`#${kind}PaymentAmount`).value = '0'; $(`#${kind}CheckNumber`).value = ''; $(`#${kind}BankName`).value = ''; $(`#${kind}DueDate`).value = ''; renderKeyboardSummary(kind);
  return true;
}

function renderInvoiceParty(kind) {
  const party = invoiceState[kind].party;
  const box = $(`#${kind}PartyDetails`);
  const manualName = $(`#${kind}Party`)?.value.trim();
  if (!box) return;
  if (!party && !manualName) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.innerHTML = party
    ? `<strong>${esc(party.name || '')}</strong><span>${esc(party.code || '')}</span>${party.phone || party.mobile ? `<span>${esc(party.phone || party.mobile)}</span>` : ''}${party.address ? `<span>${esc(party.address)}</span>` : ''}`
    : `<strong>${esc(manualName)}</strong><span>طرف‌حساب دستی</span>`;
  box.classList.remove('hidden');
}

function clearKeyboardInvoice(kind) {
  const state = invoiceState[kind]; state.items = [newInvoiceItem(kind)]; state.payments = []; state.party = null; state.editingId = null;
  $(`#${kind}Discount`).value = '0'; $(`#${kind}Tax`).value = '0'; $(`#${kind}Party`).value = ''; $(`#${kind}InvoiceNumber`).value = ''; $(`#${kind}Date`).value = isoToJalali(new Date().toISOString().slice(0, 10)); renderInvoiceParty(kind); renderKeyboardItems(kind, { index: 0, className: 'invoice-product-input' }); renderKeyboardSummary(kind); loadKeyboardInvoice(kind);
}

async function saveKeyboardInvoice(kind, print = false) {
  const state = invoiceState[kind]; const error = $(`#${kind}InvoiceError`); error.classList.add('hidden');
  try {
    // مبلغی که در کادر پرداخت وارد شده، حتی اگر کاربر دکمهٔ «افزودن پرداخت»
    // را نزده باشد، باید همراه فاکتور ثبت شود.
    addKeyboardPayment(kind, { throwOnError: true, silent: true });
    const items = state.items.filter((item, index) => item.productId && (kind === 'purchase' || (kind === 'sale' && !state.editingId) ? index > 0 : true)).map((item) => ({
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
      invoiceNumber: state.editingId ? undefined : $(`#${kind}InvoiceNumber`)?.value.trim(),
      discount: kind === 'purchase' ? parsePriceInput($(`#${kind}Discount`).value) : parsePriceInput($(`#${kind}Discount`).value) / 100,
      tax: kind === 'purchase' ? parsePriceInput($(`#${kind}Tax`).value) : parsePriceInput($(`#${kind}Tax`).value) / 100,
      payments: state.payments.map((p) => ({ ...p, amount: p.amount / 100 })),
      partyId: state.party?.id,
      partyName: $(`#${kind}Party`)?.value.trim(),
      date: jalaliInputToIso($(`#${kind}Date`).value),
      source: 'invoice'
    };
    const result = state.editingId
      ? await window.api.invoices.update(kind, state.editingId, payload)
      : kind === 'sale' ? await window.api.sales.create(payload) : await window.api.purchases.create(payload);
    showToast(`${kind === 'sale' ? 'فروش' : 'خرید'} ${result.invoiceNumber} با موفقیت ثبت شد.`);
    const printSettings = (await window.api.settings.get()).print || {};
    if (print || (kind === 'sale' ? printSettings.autoPrintSale : printSettings.autoPrintPurchase)) {
      await openInvoicePrintPreview(kind, result.id);
    }
    clearKeyboardInvoice(kind); await loadKeyboardInvoice(kind);
    if (kind === 'sale') {
      window.api.dashboard.summary().then(renderMetrics);
      if (!$('#reportsPage')?.classList.contains('hidden')) loadSalesReport();
    }
  } catch (err) { error.textContent = readableError(err, 'ثبت فاکتور انجام نشد.'); error.classList.remove('hidden'); }
}

function bindKeyboardInvoices() {
  document.querySelectorAll('.invoice-editor').forEach((editor) => {
    editor.addEventListener('focusin', (event) => {
      const input = event.target.closest('.purchase-price-input');
      if (input) openPurchasePriceSuggestions(Number(input.dataset.index));
    });
    editor.addEventListener('input', (event) => {
      const t = event.target; const kind = t.dataset.kind; if (!kind) return; const item = invoiceState[kind].items[Number(t.dataset.index)];
      if (t.classList.contains('invoice-product-input')) {
        item.query = t.value;
        const requestId = Number(t.dataset.productSearchRequest || 0) + 1;
        t.dataset.productSearchRequest = String(requestId);
        showKeyboardSuggestions(kind, Number(t.dataset.index));
        // Re-query the database while typing so products created in the
        // products screen or through the invoice modal appear immediately.
        window.api.products.search(t.value).then((products) => {
          if (Number(t.dataset.productSearchRequest) !== requestId) return;
          invoiceState[kind].products = products;
          showKeyboardSuggestions(kind, Number(t.dataset.index));
        }).catch(() => {});
      }
      else if (t.classList.contains('invoice-quantity')) item.quantity = Math.max(1, Math.round(Number(t.value) || 1));
      else if (t.classList.contains('invoice-price-custom')) {
        item.unitPrice = parsePriceInput(t.value);
        if (kind === 'purchase') {
          item.priceType = 'custom';
          item.purchasePriceActiveIndex = -1;
          item.purchasePriceOpen = true;
          renderPurchasePriceSuggestions(item, Number(t.dataset.index));
        }
      }
      else if (t.classList.contains('invoice-discount-line')) item.discount = parsePriceInput(t.value);
      renderKeyboardSummary(kind);
    });
    editor.addEventListener('keydown', (event) => {
      const t = event.target; const kind = t.dataset.kind; if (!kind) return; const index = Number(t.dataset.index);
      if (t.classList.contains('invoice-product-input')) {
        const suggestions = [...t.parentElement.querySelectorAll('.invoice-suggestion')]; let active = suggestions.findIndex((n) => n.classList.contains('active'));
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (suggestions.length) { active = event.key === 'ArrowDown' ? (active + 1) % suggestions.length : (active - 1 + suggestions.length) % suggestions.length; suggestions.forEach((n, i) => n.classList.toggle('active', i === active)); } }
        if (event.key === 'Enter') { event.preventDefault(); const button = suggestions[active >= 0 ? active : 0]; if (button) chooseKeyboardProduct(kind, index, invoiceState[kind].products.find((p) => p.id === Number(button.dataset.id))); }
        if (event.key === 'Escape') t.parentElement.querySelector('.invoice-suggestions')?.classList.add('hidden');
      } else if (event.key === 'Enter' && t.classList.contains('invoice-quantity')) {
        event.preventDefault();
        t.closest('tr').querySelector(kind === 'purchase' ? '.purchase-price-input' : '.invoice-price-combo')?.focus();
      } else if (event.key === 'ArrowDown' && t.classList.contains('purchase-price-input')) {
        event.preventDefault();
        const item = invoiceState.purchase.items[index];
        const count = item?.purchasePriceOptions?.length || 0;
        if (count) {
          item.purchasePriceOpen = true;
          item.purchasePriceActiveIndex = (Number(item.purchasePriceActiveIndex) + 1 + count) % count;
          renderPurchasePriceSuggestions(item, index);
        }
      } else if (event.key === 'ArrowUp' && t.classList.contains('purchase-price-input')) {
        event.preventDefault();
        const item = invoiceState.purchase.items[index];
        const count = item?.purchasePriceOptions?.length || 0;
        if (count) {
          item.purchasePriceOpen = true;
          item.purchasePriceActiveIndex = Number(item.purchasePriceActiveIndex) < 0
            ? count - 1
            : (Number(item.purchasePriceActiveIndex) - 1 + count) % count;
          renderPurchasePriceSuggestions(item, index);
        }
      } else if (event.key === 'Enter' && t.classList.contains('purchase-price-input')) {
        const item = invoiceState.purchase.items[index];
        if (item?.purchasePriceActiveIndex >= 0 && item.purchasePriceOptions?.[item.purchasePriceActiveIndex]) {
          event.preventDefault();
          const selected = item.purchasePriceOptions[item.purchasePriceActiveIndex];
          item.unitPrice = Number(selected.effectiveUnitPrice || 0);
          item.priceType = 'custom';
          t.value = formatPriceInput(item.unitPrice);
          commitPurchaseEntry();
        } else {
          event.preventDefault();
          commitPurchaseEntry();
        }
      } else if (event.key === 'Escape' && t.classList.contains('purchase-price-input')) {
        const item = invoiceState.purchase.items[index];
        if (item) {
          item.purchasePriceOpen = false;
          item.purchasePriceActiveIndex = -1;
          renderPurchasePriceSuggestions(item, index);
        }
      } else if (event.key === 'Enter' && kind === 'sale' && !invoiceState.sale.editingId
        && (t.classList.contains('invoice-price-combo') || t.classList.contains('invoice-price-custom'))) {
        event.preventDefault();
        commitSaleEntry();
      } else if (kind === 'sale' && t.classList.contains('invoice-price-custom')
        && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        const combo = t.closest('td')?.querySelector('.invoice-price-combo');
        if (combo) {
          event.preventDefault();
          const options = [...combo.options].filter((option) => !option.disabled);
          const current = Math.max(0, options.findIndex((option) => option.value === invoiceState.sale.items[index]?.priceType));
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
        const state = invoiceState[kind];
        if ((kind === 'purchase' || (kind === 'sale' && !state.editingId)) && index === 0) {
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
      const s = event.target.closest('.invoice-suggestion'); if (s) { chooseKeyboardProduct(s.dataset.kind, Number(s.dataset.index), invoiceState[s.dataset.kind].products.find((p) => p.id === Number(s.dataset.id))); return; }
      const priceOption = event.target.closest('.purchase-price-option');
      if (priceOption) {
        const index = Number(priceOption.dataset.index);
        const optionIndex = Number(priceOption.dataset.optionIndex);
        const item = invoiceState.purchase.items[index];
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
        const item = invoiceState.purchase.items[Number(historyToggle.dataset.index)];
        if (item?.purchaseHistory && !item.purchaseHistory.loading) {
          item.purchaseHistoryOpen = !item.purchaseHistoryOpen;
          renderKeyboardItems('purchase');
        }
        return;
      }
      const historyRow = event.target.closest('.purchase-history-row');
      if (historyRow) {
        const index = Number(historyRow.dataset.index);
        const item = invoiceState.purchase.items[index];
        if (!item) return;
        item.unitPrice = Number(historyRow.dataset.price || 0);
        item.priceType = 'custom';
        item.purchaseHistoryOpen = false;
        renderKeyboardItems('purchase', { index, className: 'invoice-price-custom' });
        renderKeyboardSummary('purchase');
        return;
      }
      const combo = event.target.closest('.invoice-price-combo'); if (combo) { const item = invoiceState[combo.dataset.kind].items[Number(combo.dataset.index)]; if (combo.value === 'custom') { item.priceType = 'custom'; item.unitPrice = 0; const custom = combo.closest('td').querySelector('.invoice-price-custom'); custom.value = ''; custom.classList.remove('hidden'); requestAnimationFrame(() => custom.focus()); } }
      const remove = event.target.closest('.delete-line');
      if (remove) {
        const kind = remove.dataset.kind;
        const state = invoiceState[kind];
        if ((kind === 'purchase' || (kind === 'sale' && !state.editingId)) && Number(remove.dataset.index) === 0) return;
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
  document.querySelectorAll('.payment-method').forEach((n) => n.addEventListener('change', () => $(`#${n.id.replace('PaymentMethod', 'CheckFields')}`).classList.toggle('hidden', n.value !== 'check')));
  document.querySelectorAll('.add-payment').forEach((b) => b.addEventListener('click', () => addKeyboardPayment(b.dataset.kind)));
  document.querySelectorAll('.payment-full').forEach((b) => b.addEventListener('click', () => { const kind = b.dataset.kind; const total = keyboardInvoiceTotals(kind).total; const paid = invoiceState[kind].payments.reduce((s, p) => s + p.amount, 0); $(`#${kind}PaymentAmount`).value = formatPriceInput(Math.max(0, total - paid)); }));
  document.querySelectorAll('.payment-list').forEach((n) => n.addEventListener('click', (e) => { const b = e.target.closest('.delete-payment'); if (b) { invoiceState[b.dataset.kind].payments.splice(Number(b.dataset.index), 1); renderKeyboardSummary(b.dataset.kind); } }));
  document.querySelectorAll('.party-input').forEach((n) => {
    n.addEventListener('input', async () => {
      const kind = n.dataset.kind;
      const invoice = invoiceState[kind];
      const requestId = Number(n.dataset.partySearchRequest || 0) + 1;
      n.dataset.partySearchRequest = String(requestId);
      invoice.party = null;
      renderInvoiceParty(kind);
      const query = n.value.trim();
      const tokens = normalizeDigits(query.toLowerCase()).split(/\s+/).filter(Boolean);
      const matches = (parties) => parties.filter((p) => {
        const text = normalizeDigits(`${p.name} ${p.code} ${p.phone || ''} ${p.mobile || ''}`.toLowerCase());
        return !tokens.length || tokens.every((token) => text.includes(token));
      }).slice(0, 8);
      const box = $(`#${kind}PartySuggestions`);
      const renderSuggestions = (rows) => {
        box.innerHTML = rows.map((p) => `<button type="button" class="party-suggestion" data-kind="${kind}" data-id="${p.id}">${esc(p.name)} <small>${esc(p.code)}${p.phone ? ` · ${esc(p.phone)}` : ''}</small></button>`).join('');
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
      const box = $(`#${n.dataset.kind}PartySuggestions`);
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
        invoiceState[kind].party = invoiceState[kind].parties.find((p) => p.id === Number(row.dataset.id));
        n.value = invoiceState[kind].party.name;
        renderInvoiceParty(kind);
        box.classList.add('hidden');
      }
    });
  });
  document.querySelectorAll('.party-suggestions').forEach((box) => box.addEventListener('click', (e) => { const b = e.target.closest('.party-suggestion'); if (!b) return; const kind = b.dataset.kind; invoiceState[kind].party = invoiceState[kind].parties.find((p) => p.id === Number(b.dataset.id)); $(`#${kind}Party`).value = invoiceState[kind].party.name; renderInvoiceParty(kind); box.classList.add('hidden'); }));
}

function restoreDailySalesMarkup() {
  const page = $('#salesPage');
  if (!page || page.dataset.dailyRestored) return;
  page.innerHTML = `<div class="page-heading"><div><span class="eyebrow">عملیات فروش</span></div><label class="sale-date-field daily-sale-date-field"><span class="sale-date-caption"><i aria-hidden="true">◷</i>تاریخ فروش</span><input id="saleDate" type="date"></label></div><div class="sale-modern-layout"><section class="panel product-picker"><div class="picker-header"><div><h3>لیست محصولات</h3><small id="dailySalePriceHint">قیمت‌ها به ${currencyLabel()} نمایش داده می‌شوند.</small></div><div class="toolbar-search"><span>⌕</span><input id="saleProductFilter" placeholder="کلیدواژه: نام، کد یا بارکد"></div></div><div id="saleProductCards" class="product-cards"></div></section><aside class="panel modern-cart"><div class="cart-heading"><div><h3>سبد فروش</h3><small id="cartCount">۰ قلم</small></div><button id="clearSaleCart" class="danger-button" type="button" title="پاک کردن سبد" aria-label="پاک کردن سبد">🗑️</button></div><div class="table-wrap"><table><thead><tr><th>محصول</th><th id="dailySalePriceHeader">قیمت (${currencyLabel()})</th><th>تعداد</th><th></th></tr></thead><tbody id="modernSaleItems"></tbody></table></div><div class="cart-total"><span id="dailySaleTotalLabel">مبلغ کل (${currencyLabel()})</span><strong id="modernSaleTotal">${money(0)}</strong></div><div id="modernSaleError" class="form-error hidden"></div><button id="modernSaveSale" class="primary wide" type="button">ثبت فروش</button><button id="modernSaveSalePrint" class="secondary wide" type="button">ثبت و چاپ فاکتور رسمی</button></aside></div>`;
  $('#saleDate').type = 'text';
  $('#saleDate').inputMode = 'numeric';
  $('#saleDate').autocomplete = 'off';
  $('#saleDate').placeholder = '۱۴۰۵/۰۶/۰۸';
  $('#saleDate').value = isoToJalali(new Date().toISOString().slice(0, 10));
  enhanceDailySalesMarkup(page);
  restoreDailySaleDraft();
  page.dataset.dailyRestored = '1';
  refreshDailySaleCurrencyLabels();
  bindSalesEvents();
  bindJalaliDatePickers();
  loadSaleProducts();
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
    total.outerHTML = '<div class="cart-summary"><div><span>اقلام</span><strong id="cartItemCount">۰</strong></div><div><span>مبلغ کل</span><strong id="modernSaleTotal">' + money(0) + '</strong></div></div>';
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
function initializeAssistantPage() {
  if ($('#assistantPage')) return;
  $('#placeholderPage')?.insertAdjacentHTML('beforebegin', `
    <section id="assistantPage" class="page hidden">
      <div class="page-heading"><div><span class="eyebrow">پردازش درخواست متنی · کاملاً محلی و آفلاین</span><h2>دستیار هوشمند</h2></div></div>
      <div class="panel assistant-box">
        <label class="assistant-label">درخواست خود را به فارسی بنویسید
          <textarea id="assistantInput" rows="2" placeholder="مثال: لیست پروانه های لباسشویی را لیست کن و 20 درصد به مبلغ خرید اضافه کن"></textarea>
        </label>
        <div class="assistant-chips">
          <button type="button" class="assistant-chip" data-text="پمپ تخلیه لباسشویی را لیست کن">فهرست: پمپ تخلیه لباسشویی</button>
          <button type="button" class="assistant-chip" data-text="پمپ تخلیه لباسشویی را لیست کن و 10 درصد به قیمت خرید اضافه کن">+۱۰٪ قیمت خرید</button>
          <button type="button" class="assistant-chip" data-text="سیم مفتالی را لیست کن و 15 درصد از قیمت فروش کم کن و نام محصول تعداد موجودی و قیمت را نشان بده">−۱۵٪ فروش با ستون‌های دلخواه</button>
        </div>
        <div class="assistant-actions-row">
          <button id="assistantRun" class="primary" type="button">تحلیل و پیش‌نمایش</button>
          <button id="assistantApply" class="secondary" type="button" disabled>اعمال تغییرات</button>
          <button id="assistantUndo" class="text-button" type="button">واگردانی آخرین عملیات</button>
          <button id="assistantExport" class="secondary" type="button" disabled>خروجی CSV</button>
          <button id="assistantExportPdf" class="secondary" type="button" disabled>خروجی PDF</button>
          <label class="check-label"><input id="assistantSelectAll" type="checkbox" checked> انتخاب همه</label>
        </div>
        <div id="assistantSummary" class="assistant-summary"></div>
        <div id="assistantError" class="form-error hidden"></div>
        <div class="table-wrap"><table><thead id="assistantHead"></thead><tbody id="assistantRows"></tbody></table></div>
      </div>
    </section>`);
  const state = { plan: null };
  const toUser = (cents) => Math.round((Number(cents) || 0) / 100 * currencyFactor());
  const toCents = (raw) => Math.max(0, Math.round(parsePriceInput(raw) * 100 / currencyFactor()));
  const fieldInput = (id, field) => document.querySelector(`.assistant-new-price[data-id="${id}"][data-field="${field}"]`);
  const columnLabels = { code: 'کد', name: 'نام کالا', category: 'دسته', stock: 'موجودی', unit: 'واحد', barcode: 'بارکد', purchasePrice: 'قیمت خرید', wholesalePrice: 'قیمت عمده', retailPrice: 'قیمت فروش', margin: 'سود ٪' };
  const priceColumns = ['purchasePrice', 'wholesalePrice', 'retailPrice'];
  const matchModeLabels = { keyword: 'تطبیق کلمه‌ای', partial: 'تطبیق بخشی کلمات', semantic: 'جست‌وجوی معنایی لوکال', continued: 'ادامهٔ انتخاب قبلی' };
  const render = () => {
    const plan = state.plan;
    const adjust = plan?.action?.type === 'adjust';
    const columns = plan?.columns?.length ? plan.columns : ['code', 'name', 'stock', 'purchasePrice', 'wholesalePrice', 'retailPrice'];
    const targetField = adjust ? { purchase: 'purchasePrice', wholesale: 'wholesalePrice', retail: 'retailPrice' }[plan.action.field] : null;
    $('#assistantApply').disabled = !adjust;
    $('#assistantExport').disabled = !plan?.products?.length;
    $('#assistantExportPdf').disabled = !plan?.products?.length;
    const fieldLabels = { purchase: 'قیمت خرید', wholesale: 'قیمت عمده', retail: 'قیمت فروش' };
    $('#assistantSummary').textContent = plan
      ? `${new Intl.NumberFormat('fa-IR').format(plan.products.length)} کالا مطابقت دارد · روش: ${matchModeLabels[plan.matchMode] || 'تطبیق کلمه‌ای'}${adjust ? ` · عملیات: ${plan.action.direction > 0 ? 'افزایش' : 'کاهش'} ${new Intl.NumberFormat('fa-IR').format(plan.action.percent)}٪ ${fieldLabels[plan.action.field]} — مقادیر ستون «جدید» را می‌توانید قبل از اعمال ویرایش کنید.` : ' · فقط فهرست‌سازی (بدون تغییر قیمت)'}`
      : '';
    $('#assistantHead').innerHTML = `<tr><th></th>${columns.map((column) => `<th>${columnLabels[column] || column}${column === targetField ? ' (فعلی ← جدید)' : ''}</th>`).join('')}</tr>`;
    const cell = (p, column) => {
      if (column === 'margin') {
        if (p.marginPercent == null) return '—';
        return `<span class="${p.belowCost ? 'debt-amount' : 'profit-amount'}" title="${p.belowCost ? 'هشدار: قیمت فروش زیر قیمت خرید است' : 'حاشیه سود نسبت به قیمت خرید'}">${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(p.marginPercent)}٪</span>`;
      }
      if (priceColumns.includes(column)) {
        const current = { purchasePrice: p.purchasePrice, wholesalePrice: p.wholesalePrice, retailPrice: p.retailPrice }[column];
        const next = { purchasePrice: p.newPurchasePrice, wholesalePrice: p.newWholesalePrice, retailPrice: p.newRetailPrice }[column];
        return column === targetField
          ? `${money(current)} ← <input class="assistant-new-price" data-id="${p.id}" data-field="${column}" value="${toUser(next)}">`
          : money(current);
      }
      const value = { code: p.code, name: p.name, category: p.categoryName || '—', stock: new Intl.NumberFormat('fa-IR').format(Number(p.stock || 0)), unit: p.unitSymbol || '—', barcode: p.barcode || '—' }[column];
      return column === 'name' ? `${esc(value)}<small>${esc(p.unitSymbol || '')}</small>` : esc(value ?? '—');
    };
    $('#assistantRows').innerHTML = plan?.products?.length ? plan.products.map((p) => `<tr><td><input class="assistant-select" type="checkbox" data-id="${p.id}" checked aria-label="انتخاب ${esc(p.name)}"><button type="button" class="assistant-remove" data-id="${p.id}" title="حذف از نتیجه">✕</button></td>${columns.map((column) => `<td>${cell(p, column)}</td>`).join('')}</tr>`).join('')
      : `<tr class="empty-row"><td colspan="${columns.length + 1}">ابتدا یک درخواست تحلیل کنید یا کالایی مطابق درخواست پیدا نشد.</td></tr>`;
  };
  const run = async () => {
    const errorBox = $('#assistantError');
    errorBox.classList.add('hidden');
    try {
      state.plan = await window.api.ai.plan($('#assistantInput').value || '', (state.plan?.products || []).map((product) => product.id));
      render();
    } catch (error) {
      state.plan = null;
      render();
      errorBox.textContent = error?.message || 'تحلیل درخواست انجام نشد.';
      errorBox.classList.remove('hidden');
    }
  };
  $('#assistantRun').addEventListener('click', run);
  document.querySelectorAll('.assistant-chip').forEach((chip) => chip.addEventListener('click', () => {
    $('#assistantInput').value = chip.dataset.text || '';
    run();
  }));
  $('#assistantRows').addEventListener('click', (event) => {
    const remove = event.target.closest('.assistant-remove');
    if (!remove || !state.plan) return;
    state.plan.products = state.plan.products.filter((product) => Number(product.id) !== Number(remove.dataset.id));
    render();
  });
  $('#assistantSelectAll').addEventListener('change', (event) => {
    document.querySelectorAll('.assistant-select').forEach((box) => { box.checked = event.target.checked; });
  });
  $('#assistantApply').addEventListener('click', async () => {
    const selected = [...document.querySelectorAll('.assistant-select:checked')].map((box) => Number(box.dataset.id));
    if (!selected.length) return showToast('هیچ کالایی انتخاب نشده است.', true);
    const selectedIds = new Set(selected);
    const riskyCount = (state.plan?.products || []).filter((p) => selectedIds.has(Number(p.id)) && p.belowCost).length;
    const message = riskyCount
      ? `هشدار: در ${new Intl.NumberFormat('fa-IR').format(riskyCount)} کالا قیمت فروش به زیر قیمت خرید می‌رسد (حاشیه سود منفی). قیمت‌ها اعمال شود؟`
      : `قیمت‌های ویرایش‌شده روی ${new Intl.NumberFormat('fa-IR').format(selected.length)} کالا اعمال شود؟`;
    if (!await showConfirmDialog({ title: 'اعمال تغییرات قیمت', message, confirmText: 'اعمال شود', destructive: riskyCount > 0 })) return;
    try {
      const result = await window.api.ai.apply(selected.map((id) => {
        const update = { id };
        ['purchasePrice', 'wholesalePrice', 'retailPrice'].forEach((field) => {
          const input = fieldInput(id, field);
          if (input) update[field] = toCents(input.value);
        });
        return update;
      }));
      showToast(`${new Intl.NumberFormat('fa-IR').format(result.updated)} کالا به‌روزرسانی شد.`);
      await run();
    } catch (error) { showToast(error?.message || 'اعمال تغییرات انجام نشد.', true); }
  });
  const buildExportRows = () => {
    const selected = new Set([...document.querySelectorAll('.assistant-select:checked')].map((box) => Number(box.dataset.id)));
    const plan = state.plan;
    const columns = plan?.columns?.length ? plan.columns : ['code', 'name', 'stock', 'purchasePrice', 'wholesalePrice', 'retailPrice'];
    const targetField = plan?.action?.type === 'adjust' ? { purchase: 'purchasePrice', wholesale: 'wholesalePrice', retail: 'retailPrice' }[plan.action.field] : null;
    const rows = [columns.flatMap((column) => column === targetField ? [`${columnLabels[column]} فعلی`, `${columnLabels[column]} جدید`] : [columnLabels[column] || column])];
    for (const p of (plan?.products || []).filter((product) => selected.has(Number(product.id)))) {
      rows.push(columns.flatMap((column) => {
        const current = { code: p.code, name: p.name, category: p.categoryName, stock: new Intl.NumberFormat('fa-IR').format(Number(p.stock || 0)), unit: p.unitSymbol, barcode: p.barcode, purchasePrice: toUser(p.purchasePrice), wholesalePrice: toUser(p.wholesalePrice), retailPrice: toUser(p.retailPrice), margin: p.marginPercent == null ? '—' : `${p.marginPercent}٪` }[column];
        if (column === targetField) {
          const input = fieldInput(p.id, column);
          return [current, input ? Math.round(toCents(input.value) / 100 * currencyFactor()) : current];
        }
        return [current];
      }));
    }
    return rows;
  };
  const exportOutput = async (kind) => {
    try {
      const result = kind === 'pdf'
        ? await window.api.ai.exportPdf(buildExportRows(), 'دستیار-هوشمند')
        : await window.api.ai.exportCsv(buildExportRows(), 'دستیار-هوشمند');
      if (!result.canceled) showToast(kind === 'pdf' ? 'خروجی PDF ذخیره شد.' : 'خروجی CSV ذخیره شد.');
    } catch (error) { showToast(error?.message || 'خروجی انجام نشد.', true); }
  };
  $('#assistantExport').addEventListener('click', () => exportOutput('csv'));
  $('#assistantExportPdf').addEventListener('click', () => exportOutput('pdf'));
  $('#assistantUndo').addEventListener('click', async () => {
    if (!await showConfirmDialog({ title: 'واگردانی آخرین عملیات', message: 'قیمت‌های آخرین اعمالِ دستیار هوشمند به مقادیر قبلی برگردد؟', confirmText: 'واگردانی', destructive: true })) return;
    try {
      const result = await window.api.ai.undo();
      showToast(`${new Intl.NumberFormat('fa-IR').format(result.undone)} کالا به قیمت‌های قبلی بازگشت.`);
      await run();
    } catch (error) { showToast(error?.message || 'واگردانی انجام نشد.', true); }
  });
}

const assistantNavTarget = document.querySelector('.sidebar nav');
if (assistantNavTarget && !document.querySelector('[data-page="assistant"]')) {
  assistantNavTarget.insertAdjacentHTML('beforeend', '<button class="nav-item" data-page="assistant"><span>✦</span><span class="nav-label">دستیار هوشمند</span></button>');
}

// Named distinctly from the 02-management setManagedPage: in the original
// monolith a single hoisted function declaration won, but as separate
// <script> tags this duplicate global declaration would clobber the settings
// wrapper assigned in 02-management.js. 02 calls this by name at page-click
// time (after every chunk has loaded).
function setPageRouter(page) {
  initializeManagementMarkup();
  // Lazy page markup must be created before the visibility toggle below runs,
  // otherwise the freshly-created section keeps its initial "hidden" class
  // and the first visit renders an empty content area.
  if (page === 'assistant') initializeAssistantPage();
  const titles = { dashboard: 'داشبورد', sales: 'فروش روزانه', 'sales-invoice': 'فاکتور فروش', purchases: 'فاکتور خرید', 'sales-invoices': 'فاکتورهای فروش', 'purchase-invoices': 'فاکتورهای خرید', products: 'مدیریت کالاها', categories: 'دسته‌بندی‌ها', customers: 'مدیریت مشتریان', ledger: 'گردش حساب', inventory: 'انبارگردانی', returns: 'مرجوعی‌ها', checks: 'چک‌ها و سررسیدها', installments: 'مدیریت اقساط', cash: 'صندوق و هزینه‌ها', 'profit-loss': 'سود و زیان', users: 'کاربران و لاگ', reports: 'گزارش‌ها', assistant: 'دستیار هوشمند', settings: 'تنظیمات' };
  const view = page === 'customers' ? 'parties' : page;
  const pageId = view === 'sales-invoice' ? 'salesInvoice' : view === 'sales-invoices' ? 'salesInvoices' : view === 'purchase-invoices' ? 'purchaseInvoices' : view === 'profit-loss' ? 'profitLoss' : view;
  ['dashboard', 'sales', 'salesInvoice', 'purchases', 'salesInvoices', 'purchaseInvoices', 'products', 'categories', 'parties', 'ledger', 'inventory', 'returns', 'checks', 'installments', 'cash', 'profitLoss', 'users', 'reports', 'assistant', 'placeholder'].forEach((id) => { const node = $(`#${id}Page`); if (node) node.classList.toggle('hidden', id !== pageId && !(id === 'placeholder' && !['dashboard', 'sales', 'salesInvoice', 'purchases', 'salesInvoices', 'purchaseInvoices', 'products', 'categories', 'parties', 'ledger', 'inventory', 'returns', 'checks', 'installments', 'cash', 'profitLoss', 'users', 'reports', 'assistant'].includes(pageId))); });
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  const invoicePage = ['sales-invoice', 'purchases', 'sales-invoices', 'purchase-invoices'].includes(page);
  const invoiceMenu = document.querySelector('.invoice-menu');
  invoiceMenu?.classList.toggle('open', invoicePage);
  invoiceMenu?.querySelector('.invoice-submenu')?.classList.toggle('hidden', !invoicePage && !invoiceMenu.classList.contains('open'));
  invoiceMenu?.querySelector('.invoice-menu-toggle')?.classList.toggle('active', invoicePage);
  invoiceMenu?.querySelector('.invoice-menu-toggle')?.setAttribute('aria-expanded', String(invoicePage || invoiceMenu?.classList.contains('open')));
  const productPage = ['products', 'categories'].includes(page);
  const productMenu = document.querySelector('.product-menu');
  productMenu?.classList.toggle('open', productPage);
  productMenu?.querySelector('.product-submenu')?.classList.toggle('hidden', !productPage && !productMenu.classList.contains('open'));
  productMenu?.querySelector('.product-menu-toggle')?.classList.toggle('active', productPage);
  productMenu?.querySelector('.product-menu-toggle')?.setAttribute('aria-expanded', String(productPage || productMenu?.classList.contains('open')));
  $('#pageTitle').textContent = titles[page] || page; $('#windowContext').textContent = titles[page] || page;
  if (page === 'products') loadManagedProducts(); if (page === 'categories') loadManagedCategories(); if (page === 'customers') loadManagedParties();
  if (page === 'sales-invoice') loadKeyboardInvoice('sale').catch(() => {});
  if (page === 'purchases') loadKeyboardInvoice('purchase').catch(() => {});
  if (page === 'sales-invoices') loadInvoiceList('sales'); if (page === 'purchase-invoices') loadInvoiceList('purchases');
  if (page === 'reports') loadSalesReport();
}

function initializeReportsPage() {
  if ($('#reportsPage')) return;
  const placeholder = $('#placeholderPage');
  if (!placeholder) return;
  placeholder.insertAdjacentHTML('beforebegin', `
    <section id="reportsPage" class="page hidden report-page">
      <div class="report-actions"><button id="reportExportCsv" class="secondary" type="button">خروجی Excel</button><button id="reportExportPdf" class="secondary" type="button">خروجی PDF</button></div>
      <div class="page-heading"><div><span class="eyebrow">تحلیل جامع فروش</span><h2>گزارش فروش و سود و زیان</h2></div>
        <button id="reportRefresh" class="secondary" type="button">به‌روزرسانی گزارش</button></div>
      <div class="panel report-filters">
        <label>از تاریخ<input id="reportFrom" class="report-date" type="date"></label>
        <label>تا تاریخ<input id="reportTo" class="report-date" type="date"></label>
        <label>نوع فروش<select id="reportSource"><option value="">همه فروش‌ها</option><option value="daily">فروش روزانه</option><option value="invoice">فاکتور فروش</option></select></label>
        <label>دورهٔ تجمیع<select id="reportPeriod"><option value="day">روزانه</option><option value="week">هفتگی</option><option value="month">ماهانه</option><option value="year">سالانه</option></select></label>
        <button id="reportApply" class="primary" type="button">اعمال فیلتر</button>
      </div>
      <div id="reportError" class="form-error hidden"></div>
      <div class="report-metrics">
        <div class="metric-card"><span>فروش خالص</span><strong id="reportNetSales">${money(0)}</strong><small id="reportInvoiceCount">۰ فاکتور</small></div>
        <div class="metric-card"><span>سود ناخالص</span><strong id="reportProfit">${money(0)}</strong><small id="reportCost">هزینه: ${money(0)}</small></div>
        <div class="metric-card"><span>دریافتی</span><strong id="reportPaid">${money(0)}</strong><small id="reportRemaining">مانده: ${money(0)}</small></div>
        <div class="metric-card"><span>تعداد کالا</span><strong id="reportItems">۰</strong><small id="reportSources">روزانه: ۰ | فاکتور: ۰</small></div>
      </div>
      <div id="reportAdjustments" class="report-adjustments"></div>
      <div id="reportComparison" class="report-adjustments report-comparison"></div>
      <div class="report-grid">
        <section class="panel report-chart-panel"><div class="panel-heading"><h3>روند فروش و سود</h3><small id="reportTrendNote">بر اساس روز</small></div><div id="reportTrendChart" class="report-chart"></div></section>
        <section class="panel report-chart-panel"><div class="panel-heading"><h3>پیش‌بینی فروش</h3><small id="reportForecastNote">میانگین متحرک ۷ روزه</small></div><div id="reportForecastChart" class="report-chart"></div></section>
      </div>
      <div class="report-grid">
        <section class="panel report-chart-panel"><div class="panel-heading"><h3>فروش بر اساس نوع ثبت</h3></div><div id="reportSourceChart" class="report-chart compact-chart"></div></section>
        <section class="panel report-chart-panel"><div class="panel-heading"><h3>پرفروش‌ترین کالاها</h3><small>۲۰ کالای اول</small></div><div id="reportProductChart" class="report-chart"></div></section>
      </div>
      <div class="report-grid report-tables">
        <section class="panel"><div class="panel-heading"><h3>جزئیات روزانه</h3></div><div id="reportDailyTable" class="table-wrap"></div></section>
        <section class="panel"><div class="panel-heading"><h3>مشتریان برتر</h3></div><div id="reportCustomerTable" class="table-wrap"></div></section>
      </div>
    </section>`);
  $('#reportApply').addEventListener('click', loadSalesReport);
  $('#reportRefresh').addEventListener('click', loadSalesReport);
  $('#reportExportCsv').addEventListener('click', async () => {
    try {
      const result = await window.api.reports.exportCsv('sales', {
        from: reportDateValue('reportFrom'),
        to: reportDateValue('reportTo'),
        source: $('#reportSource')?.value || '', period: $('#reportPeriod')?.value || 'day'
      });
      if (!result?.canceled) showToast(`فایل Excel ذخیره شد: ${result.filePath}`);
    } catch (e) { showToast(readableError(e, 'خروجی Excel ناموفق بود.'), true); }
  });
  $('#reportExportPdf').addEventListener('click', async () => {
    document.body.classList.add('printing-report');
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const result = await window.api.reports.exportPdf({ fileName: `گزارش-فروش-${new Date().toISOString().slice(0, 10)}` });
      if (!result?.canceled) showToast(`فایل PDF ذخیره شد: ${result.filePath}`);
    } catch (e) { showToast(readableError(e, 'خروجی PDF ناموفق بود.'), true); }
    finally { document.body.classList.remove('printing-report'); }
  });
  const today = new Date().toISOString().slice(0, 10);
  $('#reportFrom').value = reportIsoToJalali(today);
  $('#reportTo').value = reportIsoToJalali(today);
  bindJalaliDatePickers(true);
}

function reportIsoToJalali(iso) {
  const [year, month, day] = String(iso || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  return gregorianToJalali(year, month, day).map((part) => String(part).padStart(2, '0')).join('/');
}

function reportDateValue(id) {
  const input = $(`#${id}`);
  if (!input || !input.value) return '';
  const parts = normalizeDigits(input.value).replace(/-/g, '/').split('/').map(Number);
  return parts.length === 3 ? jalaliToGregorian(parts[0], parts[1], parts[2]) : '';
}

// Top-level copy of the Persian-digit mapper: reportPeriodLabel runs in the
// global scope, where the nested helper inside renderDashboard is not visible.
const toPersianDigits = (value) => String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[digit]);

function reportPeriodLabel(value) {
  const period = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) return toPersianDigits(reportIsoToJalali(period).slice(5));
  if (/^\d{4}-\d{2}$/.test(period)) {
    const jalali = reportIsoToJalali(`${period}-01`).split('/');
    return toPersianDigits(`${jalali[0]}/${jalali[1]}`);
  }
  if (/^\d{4}$/.test(period)) return toPersianDigits(String(gregorianToJalali(Number(period), 1, 1)[0]));
  return period;
}

function reportSvgLine(container, points, series) {
  if (!container) return;
  if (!points.length) { container.innerHTML = '<div class="empty-state compact">برای بازه انتخاب‌شده داده‌ای وجود ندارد.</div>'; return; }
  const width = 720, height = 230, pad = 34;
  const values = series.flatMap((s) => points.map((p) => Number(p[s.key] || 0)));
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = Math.max(1, max - min);
  const x = (i) => pad + (points.length === 1 ? (width - pad * 2) / 2 : i * (width - pad * 2) / (points.length - 1));
  const y = (v) => height - pad - ((Number(v || 0) - min) / range) * (height - pad * 2);
  const grid = [0.25, 0.5, 0.75].map((ratio) => `<line x1="${pad}" y1="${y(min + range * ratio)}" x2="${width - pad}" y2="${y(min + range * ratio)}" class="chart-grid"/>`).join('')
    + (min < 0 ? `<line x1="${pad}" y1="${y(0)}" x2="${width - pad}" y2="${y(0)}" class="chart-zero"/>` : '');
  const paths = series.map((s) => `<polyline points="${points.map((p, i) => `${x(i)},${y(p[s.key])}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  const labels = points.map((p, i) => (i % Math.max(1, Math.ceil(points.length / 6)) === 0 ? `<text x="${x(i)}" y="${height - 8}" text-anchor="middle">${esc(reportPeriodLabel(p.date))}</text>` : '')).join('');
  const legend = series.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('');
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img">${grid}${paths}${labels}</svg><div class="chart-legend">${legend}</div>`;
}

function reportSvgBars(container, rows, valueKey, labelKey, color = '#6ee7b7', options = {}) {
  if (!container) return;
  if (!rows.length) { container.innerHTML = '<div class="empty-state compact">داده‌ای وجود ندارد.</div>'; return; }
  const max = Math.max(...rows.map((r) => Number(r[valueKey] || 0)), 1);
  container.innerHTML = `<div class="report-bars">${rows.slice(0, 8).map((row) => {
    const value = Number(row[valueKey] || 0);
    const displayedValue = options.displayValueKey ? Number(row[options.displayValueKey] || 0) : value;
    const secondaryValue = options.secondaryValueKey ? Number(row[options.secondaryValueKey] || 0) : null;
    const secondary = secondaryValue === null
      ? ''
      : `<small>${new Intl.NumberFormat('fa-IR').format(secondaryValue)} ${esc(options.secondaryLabel || '')}</small>`;
    return `<div class="report-bar-row"><div class="report-bar-label"><span>${esc(String(row[labelKey] || '—'))}</span><strong><span>${money(displayedValue)}</span>${secondary}</strong></div><div class="report-bar-track"><i style="width:${Math.max(2, value / max * 100)}%;background:${color}"></i></div></div>`;
  }).join('')}</div>`;
}

function reportFillDates(rows) {
  if (!rows.length) return [];
  const map = new Map(rows.map((row) => [row.date, row]));
  const start = new Date(`${rows[0].date}T00:00:00Z`);
  const end = new Date(`${rows[rows.length - 1].date}T00:00:00Z`);
  const result = [];
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const iso = date.toISOString().slice(0, 10);
    result.push(map.get(iso) || { date: iso, total: 0, netSales: 0, profitTotal: 0, costTotal: 0, invoiceCount: 0, itemCount: 0 });
  }
  return result;
}

async function loadSalesReport() {
  initializeReportsPage();
  const error = $('#reportError');
  if (!error) return;
  error.classList.add('hidden');
  try {
    const data = await window.api.reports.sales({ from: reportDateValue('reportFrom'), to: reportDateValue('reportTo'), source: $('#reportSource')?.value || '', period: $('#reportPeriod')?.value || 'day' });
    const s = data.summary || {};
    $('#reportNetSales').textContent = money(s.netSales);
    $('#reportInvoiceCount').textContent = `${new Intl.NumberFormat('fa-IR').format(Number(s.invoiceCount || 0))} فاکتور`;
    $('#reportProfit').textContent = money(s.profitTotal);
    $('#reportProfit').classList.toggle('negative', Number(s.profitTotal) < 0);
    $('#reportCost').textContent = `هزینه: ${money(s.costTotal)}`;
    $('#reportPaid').textContent = money(s.paidAmount);
    $('#reportRemaining').textContent = `مانده: ${money(s.remainingAmount)}`;
    $('#reportItems').textContent = new Intl.NumberFormat('fa-IR').format(Number(s.itemCount || 0));
    $('#reportSources').textContent = `روزانه: ${Number(s.dailyCount || 0)} | فاکتور: ${Number(s.formalCount || 0)}`;
    $('#reportAdjustments').innerHTML = `<span>جمع قبل از تخفیف: ${money(s.subtotal)}</span><span>تخفیف: ${money(s.discount)}</span><span>مالیات: ${money(s.tax)} (در سود لحاظ نشده)</span>`;
    const periodLabels = { day: 'روزانه', week: 'هفتگی', month: 'ماهانه', year: 'سالانه' };
    const period = data.period || $('#reportPeriod')?.value || 'day';
    const periodRows = data.byPeriod || [];
    const periodTotal = periodRows.reduce((sum, row) => sum + Number(row.netSales || 0), 0);
    const previousPeriodTotal = periodRows.length > 1 ? Number(periodRows[periodRows.length - 2].netSales || 0) : 0;
    const latestPeriodTotal = periodRows.length ? Number(periodRows[periodRows.length - 1].netSales || 0) : 0;
    const growth = previousPeriodTotal ? ((latestPeriodTotal - previousPeriodTotal) / previousPeriodTotal) * 100 : null;
    const average = periodRows.length ? periodTotal / periodRows.length : 0;
    $('#reportComparison').innerHTML = `<span>تجمیع: <b>${periodLabels[period]}</b></span><span>میانگین هر دوره: ${money(average)}</span><span>رشد آخرین دوره: <b class="${growth !== null && growth < 0 ? 'negative' : ''}">${growth === null ? '—' : `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}٪`}</b></span>`;
    $('#reportTrendNote').textContent = `تجمیع ${periodLabels[period]}`;
    const daily = reportFillDates(data.byDate || []);
    const trendRows = period === 'day' ? daily : periodRows.map((row) => ({ ...row, date: row.period }));
    reportSvgLine($('#reportTrendChart'), trendRows, [{ key: 'netSales', label: 'فروش خالص', color: '#6ee7b7' }, { key: 'profitTotal', label: 'سود', color: '#60a5fa' }]);
    const recent = daily.slice(-7);
    const avg = recent.length ? recent.reduce((sum, row) => sum + Number(row.netSales || 0), 0) / recent.length : 0;
    const forecast = Array.from({ length: 7 }, (_, i) => ({ date: `پیش‌بینی ${i + 1}`, netSales: avg, profitTotal: avg * (Number(s.profitTotal || 0) / Math.max(1, Number(s.netSales || 0))) }));
    reportSvgLine($('#reportForecastChart'), forecast, [{ key: 'netSales', label: 'فروش پیش‌بینی‌شده', color: '#fbbf24' }]);
    $('#reportForecastNote').textContent = recent.length >= 3 ? `میانگین ۷ روز اخیر: ${money(avg)} در روز` : 'داده کافی برای پیش‌بینی وجود ندارد';
    const sourceRows = (data.bySource || []).map((row) => ({ ...row, sourceLabel: row.source === 'daily' ? 'فروش روزانه' : 'فاکتور فروش' }));
    reportSvgBars($('#reportSourceChart'), sourceRows, 'netSales', 'sourceLabel', '#c084fc');
    reportSvgBars($('#reportProductChart'), data.byProduct || [], 'quantity', 'name', '#6ee7b7', {
      displayValueKey: 'netSales',
      secondaryValueKey: 'quantity',
      secondaryLabel: 'عدد فروش'
    });
    const tableRows = period === 'day' ? daily : periodRows.map((row) => ({ ...row, date: row.period }));
    $('#reportDailyTable').innerHTML = tableRows.length ? `<table><thead><tr><th>${periodLabels[period]}</th><th>فروش خالص</th><th>هزینه</th><th>سود</th><th>فاکتور</th><th>میانگین فاکتور</th></tr></thead><tbody>${tableRows.slice().reverse().map((row) => `<tr><td>${esc(/^\d{4}-\d{2}-\d{2}$/.test(String(row.date)) ? reportIsoToJalali(row.date) : String(row.date))}</td><td>${money(row.netSales)}</td><td>${money(row.costTotal)}</td><td class="${Number(row.profitTotal) < 0 ? 'negative' : ''}">${money(row.profitTotal)}</td><td>${Number(row.invoiceCount || 0)}</td><td>${money(Number(row.invoiceCount || 0) ? Number(row.netSales || 0) / Number(row.invoiceCount) : 0)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state compact">داده‌ای وجود ندارد.</div>';
    $('#reportCustomerTable').innerHTML = (data.byCustomer || []).length ? `<table><thead><tr><th>مشتری</th><th>فروش</th><th>سود</th></tr></thead><tbody>${data.byCustomer.map((row) => `<tr><td>${esc(row.customerName)}</td><td>${money(row.total)}</td><td class="${Number(row.profitTotal) < 0 ? 'negative' : ''}">${money(row.profitTotal)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state compact">داده‌ای وجود ندارد.</div>';
  } catch (err) {
    error.textContent = err.message || 'دریافت گزارش ناموفق بود.';
    error.classList.remove('hidden');
  }
}

initializeReportsPage();
initializeNotifications();
initializeInstallmentNavigation();
loadNotifications().catch(() => {});
setInterval(() => loadNotifications().catch(() => {}), 5 * 60 * 1000);

