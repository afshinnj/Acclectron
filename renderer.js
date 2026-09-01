const state = { page: 'dashboard', items: [], products: [] };
const $ = (selector) => document.querySelector(selector);
let uiCurrency = { code: 'IRR', name: '\u062a\u0648\u0645\u0627\u0646', symbol: '\u062a\u0648\u0645\u0627\u0646', position: 'suffix', decimals: 0, separator: true, inputUnit: 'toman' };
let defaultSettlementMethod = 'cash';
let uiTheme = 'dark';
let uiCalendar = 'gregorian';
let uiNotifications = true;
let uiShortcuts = true;

function applyAppearanceSettings(appearance = {}) {
  const previousCalendar = uiCalendar;
  const theme = ['dark', 'light', 'system'].includes(String(appearance.theme))
    ? String(appearance.theme)
    : 'dark';
  const resolvedTheme = theme === 'system'
    ? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme;
  uiTheme = resolvedTheme;
  uiCalendar = appearance.calendar === 'jalali' ? 'jalali' : 'gregorian';
  uiNotifications = appearance.notifications !== false;
  uiShortcuts = appearance.shortcuts !== false;
  document.documentElement.dataset.theme = resolvedTheme;
  const scale = Math.max(80, Math.min(130, Number(appearance.fontScale || 100))) / 100;
  document.documentElement.style.setProperty('--font-scale', String(scale));
  document.documentElement.style.zoom = String(scale);
  document.documentElement.style.setProperty('--calendar', uiCalendar);
  document.querySelectorAll('#saleDate,.invoice-date,.invoice-list-from,.invoice-list-to,.report-date').forEach((input) => {
    if (input.classList.contains('report-date')) {
      input.type = 'text';
      input.classList.add('jalali-date-input');
      return;
    }
    input.type = uiCalendar === 'jalali' ? 'text' : 'date';
    input.classList.toggle('jalali-date-input', uiCalendar === 'jalali');
    if (input.value) {
      const parsed = previousCalendar === 'jalali' ? parseJalaliDate(input.value) : null;
      const iso = parsed ? jalaliToGregorian(parsed.year, parsed.month, parsed.day) : input.value;
      if (iso) input.value = uiCalendar === 'jalali' ? isoToJalali(iso) : iso;
    }
  });
}

const currencyFactor = (currency = uiCurrency) => {
  const inputUnit = String(currency.inputUnit || '').toLowerCase();
  return inputUnit === 'rial' ? 10 : 1;
};
const currencyLabel = (currency = uiCurrency) => {
  return currencyFactor(currency) === 10 ? '\u0631\u06cc\u0627\u0644' : '\u062a\u0648\u0645\u0627\u0646';
};
const formatCurrencyNumber = (cents, currency = uiCurrency) => {
  const value = (Number(cents || 0) / 100) * currencyFactor(currency);
  return new Intl.NumberFormat('fa-IR', {
    minimumFractionDigits: Number(currency.decimals || 0),
    maximumFractionDigits: Number(currency.decimals || 0),
    useGrouping: currency.separator !== false
  }).format(value);
};
const money = (cents) => {
  const formatted = formatCurrencyNumber(cents, uiCurrency);
  const label = currencyLabel(uiCurrency);
  return uiCurrency.position === 'prefix' ? `${label} ${formatted}` : `${formatted} ${label}`;
};
function refreshDailySaleCurrencyLabels() {
  const unit = currencyLabel();
  const hint = $('#dailySalePriceHint');
  const header = $('#dailySalePriceHeader');
  const total = $('#dailySaleTotalLabel');
  if (hint) hint.textContent = `قیمت‌ها به ${unit} نمایش داده می‌شوند.`;
  if (header) header.textContent = `قیمت (${unit})`;
  if (total) total.textContent = `مبلغ کل (${unit})`;
}
async function refreshCurrencyDisplays() {
  try { renderMetrics(await window.api.dashboard.summary()); } catch {}
  refreshDailySaleCurrencyLabels();
  if (saleState?.products?.length) renderSaleProducts();
  if (saleState?.cart) renderSaleCart();
  if (managementState?.products?.length) renderManagedProducts();
  if (managementState?.parties?.length) renderManagedParties();
  ['sale', 'purchase'].forEach((kind) => {
    if (invoiceState?.[kind]?.items?.length) {
      renderKeyboardItems(kind);
      renderKeyboardSummary(kind);
    }
  });
  if ($('#salesTable') && !$('#salesPage')?.classList.contains('hidden')) loadInvoiceList('sales').catch(() => {});
  if ($('#purchasesTable') && !$('#purchasesPage')?.classList.contains('hidden')) loadInvoiceList('purchases').catch(() => {});
}
const normalizeDigits = (value) => String(value ?? '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const number = (value) => Number(normalizeDigits(value).replace(/[^\d.]/g, '')) || 0;

function showToast(message, error = false) {
  if (!uiNotifications) return;
  const toast = $('#toast');
  toast.textContent = message;
  toast.style.background = error ? '#4b252f' : '#163c34';
  toast.style.color = error ? '#ffb0b2' : '#8af1c6';
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

function setPage(page) {
  state.page = page;
  document.querySelectorAll('.nav-item,.activity-item').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  $('#dashboardPage').classList.toggle('hidden', page !== 'dashboard');
  $('#salesPage').classList.toggle('hidden', page !== 'sales');
  $('#placeholderPage').classList.toggle('hidden', ['dashboard', 'sales'].includes(page));
  const titles = { dashboard: 'داشبورد', sales: 'ثبت فروش روزانه', products: 'مدیریت کالاها', customers: 'مدیریت مشتریان', reports: 'گزارش‌ها' };
  $('#pageTitle').textContent = titles[page] || page;
  $('#windowContext').textContent = titles[page] || page;
  $('#placeholderTitle').textContent = titles[page] || page;
  if (page === 'sales') $('#productSearch').focus();
}

function renderMetrics(summary) {
  $('#todaySales').textContent = money(summary.todaySales);
  $('#todayCount').textContent = `${new Intl.NumberFormat('fa-IR').format(summary.todayCount)} فاکتور`;
  $('#monthSales').textContent = money(summary.monthSales);
  $('#inventory').textContent = `${new Intl.NumberFormat('fa-IR').format(summary.inventory)} عدد`;
  $('#productCount').textContent = `${new Intl.NumberFormat('fa-IR').format(summary.productCount)} کالا`;
  $('#lowStock').textContent = `${new Intl.NumberFormat('fa-IR').format(summary.lowStock)} کالا`;
}

function renderResults() {
  const box = $('#productResults');
  if (!state.products.length) { box.classList.add('hidden'); return; }
  box.innerHTML = state.products.map((product) => `<button class="result-item" data-id="${product.id}"><span>${product.name}<small>${product.code} · موجودی ${product.stock}</small></span><b>${money(product.salePrice)}</b></button>`).join('');
  box.classList.remove('hidden');
  box.querySelectorAll('.result-item').forEach((button) => button.addEventListener('click', () => addProduct(Number(button.dataset.id))));
}

function renderItems() {
  const body = $('#saleItems');
  if (!state.items.length) { body.innerHTML = '<tr class="empty-row"><td colspan="6">برای شروع، کالا را جستجو و انتخاب کنید.</td></tr>'; return; }
  body.innerHTML = state.items.map((item, index) => `<tr><td><strong>${item.name}</strong><small>${item.code} · موجودی ${item.stock}</small></td><td><input class="line-quantity" data-index="${index}" type="number" min="0.01" step="0.01" value="${item.quantity}" /></td><td>${money(item.unitPrice)}</td><td><input class="line-discount" data-index="${index}" type="number" min="0" value="${formatPriceInput(item.discount)}" /></td><td>${money(Math.max(0, item.quantity * item.unitPrice - item.discount))}</td><td><button class="delete-line" data-index="${index}" title="حذف">×</button></td></tr>`).join('');
  body.querySelectorAll('input').forEach((input) => input.addEventListener('input', () => { const item = state.items[Number(input.dataset.index)]; if (input.classList.contains('line-quantity')) item.quantity = number(input.value); else item.discount = parsePriceInput(input.value); updateSummary(); }));
  body.querySelectorAll('.delete-line').forEach((button) => button.addEventListener('click', () => { state.items.splice(Number(button.dataset.index), 1); renderItems(); updateSummary(); }));
}

function updateSummary() {
  const subtotal = state.items.reduce((sum, item) => sum + Math.max(0, item.quantity * item.unitPrice - item.discount), 0);
  const discount = parsePriceInput($('#discount').value);
  const tax = parsePriceInput($('#tax').value);
  const total = Math.max(0, subtotal - discount + tax);
  const paid = Math.min(total, parsePriceInput($('#paidAmount').value));
  $('#subtotal').textContent = money(subtotal);
  $('#total').textContent = money(total);
  $('#remaining').textContent = money(total - paid);
}

async function addProduct(id) {
  const product = state.products.find((candidate) => candidate.id === id);
  if (!product) return;
  const existing = state.items.find((item) => item.productId === id);
  if (existing) existing.quantity += 1;
  else state.items.push({ productId: product.id, name: product.name, code: product.code, stock: product.stock, unitPrice: product.salePrice, quantity: 1, discount: 0 });
  $('#productSearch').value = '';
  $('#productResults').classList.add('hidden');
  renderItems(); updateSummary();
}

async function searchProducts() {
  state.products = await window.api.products.search($('#productSearch').value);
  renderResults();
}

async function saveSale(print = false) {
  const error = $('#saleError');
  error.classList.add('hidden');
  try {
    const result = await window.api.sales.create({
      items: state.items.map(({ productId, quantity, unitPrice, discount }) => ({ productId, quantity, unitPrice: unitPrice / 100, discount: discount / 100 })),
      discount: parsePriceInput($('#discount').value) / 100,
      tax: parsePriceInput($('#tax').value) / 100,
      paidAmount: parsePriceInput($('#paidAmount').value) / 100,
      date: $('#saleDate').value
    });
    showToast(`فروش ${result.invoiceNumber} با موفقیت ثبت شد.`);
    if (print) await openInvoicePrintPreview('sale', result.id);
    state.items = []; renderItems(); ['discount', 'tax', 'paidAmount'].forEach((id) => { $(`#${id}`).value = '0'; }); updateSummary();
    renderMetrics(await window.api.dashboard.summary());
  } catch (err) {
    error.textContent = err.message || 'ثبت فروش انجام نشد.';
    error.classList.remove('hidden');
  }
}

function clearSale() { state.items = []; renderItems(); ['discount', 'tax', 'paidAmount'].forEach((id) => { $(`#${id}`).value = '0'; }); updateSummary(); $('#saleError').classList.add('hidden'); }

document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.page)));
$('#collapseSidebar').addEventListener('click', () => { const sidebar = $('#sidebar'); sidebar.classList.toggle('collapsed'); $('#collapseSidebar').textContent = sidebar.classList.contains('collapsed') ? '›' : '‹'; });
$('#minimizeWindow').addEventListener('click', () => window.api.window.minimize());
$('#maximizeWindow').addEventListener('click', () => window.api.window.toggleMaximize());
$('#closeWindow').addEventListener('click', () => window.api.window.close());
$('#productSearch').addEventListener('input', searchProducts);
$('#productSearch').addEventListener('keydown', (event) => { if (event.key === 'Enter' && state.products[0]) addProduct(state.products[0].id); if (event.key === 'Escape') $('#productResults').classList.add('hidden'); });
['discount', 'tax', 'paidAmount'].forEach((id) => $(`#${id}`).addEventListener('input', updateSummary));
$('#saveSale').addEventListener('click', () => saveSale());
$('#saveAndPrint').addEventListener('click', () => saveSale(true));
$('#cancelSale').addEventListener('click', clearSale);
$('#addLine').addEventListener('click', () => $('#productSearch').focus());
document.addEventListener('keydown', (event) => {
  if (!uiShortcuts) return;
  if (event.key === 'F2') { event.preventDefault(); setManagedPage('sales'); $('#saleProductFilter')?.focus(); }
  if (event.key === 'F9') { event.preventDefault(); if (!$('#salesPage')?.classList.contains('hidden')) saveSale(); }
  if (event.ctrlKey && event.key === 'Enter') {
    event.preventDefault();
    if (!$('#salesInvoicePage')?.classList.contains('hidden')) saveKeyboardInvoice('sale');
    else if (!$('#purchasesPage')?.classList.contains('hidden')) saveKeyboardInvoice('purchase');
  }
});
$('#version').textContent = window.appInfo?.version || '۱.۰.۰';
$('#saleDate').value = new Date().toISOString().slice(0, 10);
$('#clock').textContent = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(new Date());
window.api.dashboard.summary().then(renderMetrics).catch(() => {});
setPage('dashboard');

/* Management screens are injected here so existing installations keep their
   original shell while gaining product/category CRUD without a migration. */
const managementState = { ready: false, products: [], categories: [], units: [], parties: [] };
const saleState = { products: [], cart: [] };
const invoiceState = {
  sale: { products: [], items: [], parties: [], party: null, payments: [], editingId: null, paymentDraft: { method: 'cash', amount: 0 } },
  purchase: { products: [], items: [], parties: [], party: null, payments: [], editingId: null, paymentDraft: { method: 'cash', amount: 0 } }
};
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const readableError = (error, fallback) => String(error?.message || fallback)
  .replace(/^Error invoking remote method '[^']+': Error:\s*/i, '').trim() || fallback;
const toman = (value) => formatCurrencyNumber(value, uiCurrency);
const parsePriceInput = (value) => {
  const latin = String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[,\u066c٬\s]/g, '')
    .replace(/[٫]/g, '.');
  const parsed = Number(latin);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100 / currencyFactor(uiCurrency))) : 0;
};
const formatPriceInput = (cents) => new Intl.NumberFormat('fa-IR', {
  useGrouping: uiCurrency.separator !== false,
  minimumFractionDigits: Number(uiCurrency.decimals || 0),
  maximumFractionDigits: Math.max(2, Number(uiCurrency.decimals || 0))
}).format((Number(cents || 0) / 100) * currencyFactor(uiCurrency));
function gregorianToJalali(gy, gm, gd) {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy > 1600 ? 979 : 0;
  let gy2 = gy > 1600 ? gy - 1600 : gy - 621;
  const gy3 = gm > 2 ? gy2 + 1 : gy2;
  let days = 365 * gy2 + Math.floor((gy3 + 3) / 4) - Math.floor((gy3 + 99) / 100) + Math.floor((gy3 + 399) / 400) - 80 + gd + gdm[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  let jy2 = jy + 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { jy2 += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy2, jm, jd];
}
function jalaliToGregorian(jy, jm, jd) {
  jy = Number(jy); jm = Number(jm); jd = Number(jd);
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd) || jm < 1 || jm > 12 || jd < 1 || jd > 31) return '';
  let gy;
  if (jy > 979) { gy = 1600; jy -= 979; } else { gy = 621; }
  let days = (365 * jy) + (Math.floor(jy / 33) * 8) + Math.floor(((jy % 33) + 3) / 4) + 78 + jd
    + (jm < 7 ? ((jm - 1) * 31) : (((jm - 7) * 30) + 186));
  gy += 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) { gy += 100 * Math.floor(--days / 36524); days %= 36524; if (days >= 365) days += 1; }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const gd = days + 1;
  const leap = gy % 4 === 0 && (gy % 100 !== 0 || gy % 400 === 0); const sal = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 1; let rem = gd; while (rem > sal[gm]) rem -= sal[gm++];
  return `${String(gy).padStart(4, '0')}-${String(gm).padStart(2, '0')}-${String(rem).padStart(2, '0')}`;
}
function isoToJalali(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number); if (!y || !m || !d) return '';
  if (uiCalendar === 'gregorian') return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return gregorianToJalali(y, m, d).map((n) => String(n).padStart(2, '0')).join('/');
}
function jalaliInputToIso(value) {
  if (uiCalendar === 'gregorian') return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
  const parts = normalizeDigits(value).replace(/-/g, '/').split('/').map(Number);
  return parts.length === 3 ? jalaliToGregorian(parts[0], parts[1], parts[2]) : '';
}
const jalaliMonthNames = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
function jalaliMonthDays(month) { return month <= 6 ? 31 : month <= 11 ? 30 : 29; }
function parseJalaliDate(value) {
  const parts = normalizeDigits(value).replace(/-/g, '/').split('/').map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) && parts[0] > 0 && parts[1] >= 1 && parts[1] <= 12 && parts[2] >= 1
    ? { year: parts[0], month: parts[1], day: parts[2] } : null;
}
function renderJalaliPicker(input, year, month) {
  let popup = $('#jalaliDatePickerPopup');
  if (!popup) { popup = document.createElement('div'); popup.id = 'jalaliDatePickerPopup'; popup.className = 'jalali-datepicker hidden'; document.body.appendChild(popup); }
  const selected = parseJalaliDate(input.value);
  const firstIso = jalaliToGregorian(year, month, 1);
  const firstDate = firstIso ? new Date(`${firstIso}T12:00:00`) : new Date();
  const offset = (firstDate.getDay() + 1) % 7;
  const days = jalaliMonthDays(month);
  const cells = Array.from({ length: offset }, () => '<span class="jalali-day empty"></span>');
  for (let day = 1; day <= days; day += 1) {
    const active = selected && selected.year === year && selected.month === month && selected.day === day ? ' active' : '';
    cells.push(`<button type="button" class="jalali-day${active}" data-jalali-day="${day}">${day}</button>`);
  }
  popup.dataset.inputId = input.id || '';
  popup.dataset.year = String(year); popup.dataset.month = String(month);
  popup.innerHTML = `<div class="jalali-datepicker-head"><button type="button" data-jalali-prev>‹</button><strong>${jalaliMonthNames[month - 1]} ${year}</strong><button type="button" data-jalali-next>›</button></div><div class="jalali-weekdays"><span>ش</span><span>ی</span><span>د</span><span>س</span><span>چ</span><span>پ</span><span>ج</span></div><div class="jalali-days">${cells.join('')}</div>`;
  const rect = input.getBoundingClientRect();
  popup.style.top = `${rect.bottom + window.scrollY + 4}px`;
  popup.style.left = `${Math.max(8, rect.left + window.scrollX - 8)}px`;
  popup.classList.remove('hidden');
}
function bindJalaliDatePickers(forceJalali = false) {
  document.querySelectorAll('#saleDate,.invoice-date,.invoice-list-from,.invoice-list-to,.report-date').forEach((input) => {
    const reportDate = input.classList.contains('report-date');
    if (uiCalendar !== 'jalali' && !reportDate) {
      input.type = 'date';
      input.inputMode = '';
      input.classList.remove('jalali-date-input');
      return;
    }
    input.type = 'text'; input.inputMode = 'numeric'; input.autocomplete = 'off'; input.classList.add('jalali-date-input');
    if (input.dataset.jalaliPickerBound) return;
    input.dataset.jalaliPickerBound = '1';
    input.addEventListener('focus', () => {
      if (uiCalendar !== 'jalali' && !reportDate) return;
      const today = new Date().toISOString().slice(0, 10);
      const current = parseJalaliDate(input.value)
        || parseJalaliDate(reportDate ? reportIsoToJalali(today) : isoToJalali(today));
      renderJalaliPicker(input, current.year, current.month);
    });
  });
  if (document.body.dataset.jalaliPickerBound) return;
  document.body.dataset.jalaliPickerBound = '1';
  document.addEventListener('click', (event) => {
    const popup = $('#jalaliDatePickerPopup');
    if (event.target.closest('#saleDate,.invoice-date,.invoice-list-from,.invoice-list-to,.report-date')) return;
    if (!popup || popup.classList.contains('hidden')) return;
    if (!event.target.closest('#jalaliDatePickerPopup')) { popup.classList.add('hidden'); return; }
    const source = document.getElementById(popup.dataset.inputId);
    if (!source) return;
    let year = Number(popup.dataset.year); let month = Number(popup.dataset.month);
    if (event.target.closest('[data-jalali-prev]')) { month -= 1; if (month < 1) { month = 12; year -= 1; } renderJalaliPicker(source, year, month); return; }
    if (event.target.closest('[data-jalali-next]')) { month += 1; if (month > 12) { month = 1; year += 1; } renderJalaliPicker(source, year, month); return; }
    const day = event.target.closest('[data-jalali-day]')?.dataset.jalaliDay;
    if (day) { source.value = `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`; source.dispatchEvent(new Event('input', { bubbles: true })); source.dispatchEvent(new Event('change', { bubbles: true })); popup.classList.add('hidden'); }
  });
}

function initializeManagementMarkup() {
  if (managementState.ready) return;
  const placeholder = $('#placeholderPage');
  placeholder.insertAdjacentHTML('beforebegin', `<section id="productsPage" class="page hidden"><div class="page-heading"><div><span class="eyebrow">مدیریت موجودی</span><h2>کالاها</h2></div><button id="addProduct" class="primary">＋ ثبت کالای جدید</button></div><div class="panel management-toolbar"><div class="toolbar-search"><span>⌕</span><input id="productsFilter" placeholder="جست‌وجوی نام، کد یا بارکد"></div><select id="productCategoryFilter"><option value="">همه دسته‌بندی‌ها</option></select><label class="check-label"><input id="showInactiveProducts" type="checkbox"> نمایش غیرفعال‌ها</label></div><div class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>کد</th><th>نام کالا</th><th>دسته‌بندی</th><th>قیمت فروش</th><th>موجودی</th><th>واحد</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody id="productsTable"></tbody></table></div></div></section><section id="categoriesPage" class="page hidden"><div class="page-heading"><div><span class="eyebrow">ساختار کالاها</span><h2>دسته‌بندی‌ها</h2></div><button id="addCategory" class="primary">＋ ثبت دسته‌بندی</button></div><div class="panel management-toolbar"><div class="toolbar-search"><span>⌕</span><input id="categoriesFilter" placeholder="جست‌وجوی دسته‌بندی"></div><label class="check-label"><input id="showInactiveCategories" type="checkbox"> نمایش غیرفعال‌ها</label></div><div class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>کد</th><th>نام دسته‌بندی</th><th>توضیحات</th><th>تعداد کالا</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody id="categoriesTable"></tbody></table></div></div></section>`);
  document.body.insertAdjacentHTML('beforeend', `<div id="managementModalBackdrop" class="modal-backdrop hidden"><div id="productModal" class="modal hidden"><div class="modal-header"><div><span class="eyebrow">اطلاعات کالا</span><h3 id="productModalTitle">ثبت کالای جدید</h3></div><button class="modal-close" data-close-management>×</button></div><form id="productForm"><input id="productId" type="hidden"><div class="form-grid"><label>نام کالا *<input id="productName" required></label><label>کد کالا <input id="productCode" readonly placeholder="پس از انتخاب دسته‌بندی ساخته می‌شود"></label><label>بارکد<input id="productBarcode"></label><label>دسته‌بندی *<select id="productCategory" required><option value="">انتخاب دسته‌بندی</option></select></label><label>واحد<select id="productUnit"><option value="">انتخاب واحد</option></select></label><label>قیمت خرید<input id="productPurchasePrice" type="number" min="0"></label><label>قیمت عمده<input id="productWholesalePrice" type="number" min="0"></label><label>قیمت فروش *<input id="productRetailPrice" type="number" min="0" required></label><label>موجودی اولیه<input id="productStock" type="number" min="0" step="0.01" value="0"></label><label>حداقل موجودی<input id="productMinimumStock" type="number" min="0" step="0.01" value="0"></label></div><label>توضیحات<textarea id="productDescription" rows="3"></textarea></label><div id="productFormError" class="form-error hidden"></div><div class="modal-actions"><button type="button" class="secondary" data-close-management>انصراف</button><button type="submit" class="primary">ذخیره کالا</button></div></form></div><div id="categoryModal" class="modal hidden"><div class="modal-header"><div><span class="eyebrow">ساختار کالاها</span><h3 id="categoryModalTitle">ثبت دسته‌بندی</h3></div><button class="modal-close" data-close-management>×</button></div><form id="categoryForm"><input id="categoryId" type="hidden"><label>کد دسته‌بندی *<input id="categoryCode" required inputmode="numeric" pattern="\\d{1,4}"></label><label>نام دسته‌بندی *<input id="categoryName" required></label><label>توضیحات<textarea id="categoryDescription" rows="4"></textarea></label><div id="categoryFormError" class="form-error hidden"></div><div class="modal-actions"><button type="button" class="secondary" data-close-management>انصراف</button><button type="submit" class="primary">ذخیره دسته‌بندی</button></div></form></div></div>`);
  placeholder.insertAdjacentHTML('beforebegin', `<section id="partiesPage" class="page hidden"><div class="page-heading"><div><span class="eyebrow">مدیریت اشخاص</span><h2>طرف‌حساب‌ها</h2></div><button id="addParty" class="primary">＋ ثبت طرف‌حساب</button></div><div class="panel management-toolbar"><div class="toolbar-search"><span>⌕</span><input id="partiesFilter" placeholder="جست‌وجوی نام، کد یا شماره تماس"></div><select id="partyTypeFilter"><option value="">همه انواع</option><option value="customer">مشتری</option><option value="supplier">تأمین‌کننده</option><option value="both">هر دو</option></select><label class="check-label"><input id="showInactiveParties" type="checkbox"> نمایش غیرفعال‌ها</label></div><div class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>کد</th><th>نام و نام خانوادگی</th><th>نوع</th><th>شماره تماس</th><th>آدرس</th><th>مانده</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody id="partiesTable"></tbody></table></div></div></section>`);
  $('#managementModalBackdrop').insertAdjacentHTML('beforeend', `<div id="partyModal" class="modal hidden"><div class="modal-header"><div><span class="eyebrow">اطلاعات طرف‌حساب</span><h3 id="partyModalTitle">ثبت طرف‌حساب جدید</h3></div><button class="modal-close" data-close-management>×</button></div><form id="partyForm"><input id="partyId" type="hidden"><div class="form-grid"><label>نام *<input id="partyFirstName" required></label><label>نام خانوادگی<input id="partyLastName"></label><label>شماره تماس<input id="partyPhone" inputmode="tel"></label><label>شماره همراه<input id="partyMobile" inputmode="tel"></label><label>نوع طرف‌حساب *<select id="partyType" required><option value="customer">مشتری</option><option value="supplier">تأمین‌کننده</option><option value="both">هر دو</option></select></label></div><label>آدرس<textarea id="partyAddress" rows="3"></textarea></label><label>توضیحات<textarea id="partyDescription" rows="3"></textarea></label><div id="partyFormError" class="form-error hidden"></div><div class="modal-actions"><button type="button" class="secondary" data-close-management>انصراف</button><button type="submit" class="primary">ذخیره طرف‌حساب</button></div></form></div>`);
  const nav = document.querySelector('nav');
  const productsButton = nav?.querySelector('[data-page="products"]');
  if (productsButton && !nav.querySelector('.product-menu')) {
    productsButton.insertAdjacentHTML('beforebegin', `<div class="product-menu">
      <button type="button" class="nav-item product-menu-toggle" aria-expanded="false">
        <span>▦</span><span class="nav-label">کالاها</span><span class="product-menu-chevron">⌄</span>
      </button>
      <div class="product-submenu hidden">
        <button class="nav-item product-submenu-item" data-page="products"><span>▦</span><span class="nav-label">کالاها</span></button>
        <button class="nav-item product-submenu-item" data-page="categories"><span>⌘</span><span class="nav-label">دسته‌بندی‌ها</span></button>
      </div>
    </div>`);
    productsButton.remove();
  }
  nav?.querySelector('.product-menu-toggle')?.addEventListener('click', () => {
    const menu = nav.querySelector('.product-menu');
    const submenu = menu?.querySelector('.product-submenu');
    const expanded = menu?.classList.toggle('open');
    submenu?.classList.toggle('hidden', !expanded);
    menu?.querySelector('.product-menu-toggle')?.setAttribute('aria-expanded', String(Boolean(expanded)));
  });
  managementState.ready = true;
  bindManagementEvents();
  initializeSalesMarkup();
}

function initializeSalesMarkup() {
  const page = $('#salesPage');
  if (!page || page.dataset.redesigned) return;
  page.innerHTML = `<div class="page-heading"><div><span class="eyebrow">عملیات فروش</span></div><label class="sale-date-field">تاریخ فروش<input id="saleDate" type="date"></label></div><div class="sale-modern-layout"><section class="panel product-picker"><div class="picker-header"><div><h3>لیست محصولات</h3><small>برای افزودن، یکی از قیمت‌ها را انتخاب کنید.</small></div><div class="toolbar-search"><span>⌕</span><input id="saleProductFilter" placeholder="جست‌وجوی محصول"></div></div><div id="saleProductCards" class="product-cards"></div></section><aside class="panel modern-cart"><div class="cart-heading"><div><h3>سبد فروش</h3><small id="cartCount">۰ قلم</small></div><button id="clearSaleCart" class="danger-button" type="button">پاک کردن سبد</button></div><div class="table-wrap"><table><thead><tr><th>محصول</th><th>قیمت</th><th>تعداد</th><th></th></tr></thead><tbody id="modernSaleItems"></tbody></table></div><div class="cart-total"><span>مبلغ کل</span><strong id="modernSaleTotal">${money(0)}</strong></div><div id="modernSaleError" class="form-error hidden"></div><button id="modernSaveSale" class="primary wide" type="button">ثبت فروش</button></aside></div>`;
  $('#saleDate').value = new Date().toISOString().slice(0, 10);
  page.dataset.redesigned = '1';
  bindSalesEvents();
  bindJalaliDatePickers();
  loadSaleProducts();
}

function renderSaleProducts() {
  const products = saleState.products;
  const unit = currencyLabel();
  $('#saleProductCards').innerHTML = products.length ? products.map((p) => `<article class="product-card"><div class="product-card-title"><strong>${esc(p.name)}</strong><small>${esc(p.code)} · موجودی ${p.stock}${Number(p.soldQuantity || 0) ? ` · فروش ${p.soldQuantity}` : ''}</small></div><div class="price-actions"><button class="price-choice retail add-daily-product" data-id="${p.id}" data-price-type="retail"><span>فروش (${unit})</span><b>${money(p.salePrice)}</b></button><button class="price-choice wholesale add-daily-product" data-id="${p.id}" data-price-type="wholesale" ${p.wholesalePrice > 0 ? '' : 'disabled'}><span>عمده (${unit})</span><b>${money(p.wholesalePrice)}</b></button></div></article>`).join('') : '<div class="empty-state compact"><span>⌕</span><p>محصولی با این کلیدواژه‌ها پیدا نشد.</p></div>';
}
function renderSaleCart() {
  const body = $('#modernSaleItems');
  body.innerHTML = saleState.cart.length ? saleState.cart.map((item, index) => `<tr><td><strong>${esc(item.name)}</strong><small>${item.priceType === 'wholesale' ? 'عمده' : 'فروش'}</small></td><td><input class="cart-price" data-index="${index}" type="number" min="0" value="${item.unitPrice / 100}"></td><td><input class="cart-quantity" data-index="${index}" type="number" min="1" step="1" value="${item.quantity}"></td><td><button class="delete-line" data-index="${index}">×</button></td></tr>`).join('') : '<tr class="empty-row"><td colspan="4">برای شروع یکی از قیمت‌های محصول را انتخاب کنید.</td></tr>';
  $('#cartCount').textContent = `${new Intl.NumberFormat('fa-IR').format(saleState.cart.reduce((sum, item) => sum + item.quantity, 0))} قلم`;
  $('#modernSaleTotal').textContent = money(saleState.cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));
}
async function loadSaleProducts(query = '') {
  saleState.products = await window.api.products.search(query);
  renderSaleProducts();
  renderSaleCart();
}
function addSaleProduct(id, unitPrice, priceType) { const product = saleState.products.find((p) => p.id === id); if (!product) return; saleState.cart.push({ productId: id, name: product.name, unitPrice: Number(unitPrice), quantity: 1, priceType }); renderSaleCart(); showToast('محصول به سبد فروش اضافه شد.'); }
function bindSalesEvents() {
  let saleSearchTimer;
  $('#saleProductFilter').addEventListener('input', () => {
    clearTimeout(saleSearchTimer);
    saleSearchTimer = setTimeout(() => loadSaleProducts($('#saleProductFilter').value), 120);
  });
  $('#saleProductCards').addEventListener('click', (e) => { const button = e.target.closest('.add-daily-product'); if (!button || button.disabled) return; const product = saleState.products.find((p) => p.id === Number(button.dataset.id)); const type = button.dataset.priceType; addSaleProduct(product.id, type === 'wholesale' ? product.wholesalePrice : product.salePrice, type); });
  $('#modernSaleItems').addEventListener('input', (e) => { const index = Number(e.target.dataset.index); if (e.target.classList.contains('cart-price')) saleState.cart[index].unitPrice = Math.max(0, Math.round(Number(e.target.value || 0) * 100)); else saleState.cart[index].quantity = Math.max(1, Math.round(Number(e.target.value || 1))); renderSaleCart(); });
  $('#modernSaleItems').addEventListener('click', (e) => { const button = e.target.closest('.delete-line'); if (button) { saleState.cart.splice(Number(button.dataset.index), 1); renderSaleCart(); } });
  $('#clearSaleCart').addEventListener('click', () => { if (!saleState.cart.length) return showToast('سبد فروش خالی است.', true); saleState.cart = []; renderSaleCart(); showToast('سبد فروش پاک شد.'); });
  $('#modernSaveSale').addEventListener('click', async () => { const error = $('#modernSaleError'); error.classList.add('hidden'); try { if (!saleState.cart.length) throw new Error('حداقل یک محصول به سبد اضافه کنید.'); const result = await window.api.sales.create({ items: saleState.cart.map((item) => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice / 100, discount: 0, priceType: item.priceType })), source: 'daily', date: jalaliInputToIso($('#saleDate').value) }); saleState.cart = []; renderSaleCart(); await loadSaleProducts(); await window.api.dashboard.summary().then(renderMetrics); showToast(`فروش ${result.invoiceNumber} با موفقیت ثبت شد. سود: ${money(result.profitTotal)}`); } catch (err) { error.textContent = err.message; error.classList.remove('hidden'); } });
}

function setManagedPage(page) {
  initializeManagementMarkup();
  const titles = { dashboard: 'داشبورد', sales: 'ثبت فروش روزانه', products: 'مدیریت کالاها', categories: 'دسته‌بندی‌ها', customers: 'مدیریت مشتریان', reports: 'گزارش‌ها', settings: 'تنظیمات' };
  const viewPage = page === 'customers' ? 'parties' : page;
  ['dashboard', 'sales', 'products', 'categories', 'parties', 'placeholder'].forEach((id) => { const node = $(`#${id}Page`); if (node) node.classList.toggle('hidden', id !== viewPage && !(id === 'placeholder' && !['dashboard', 'sales', 'products', 'categories', 'parties'].includes(viewPage))); });
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  $('#pageTitle').textContent = titles[page] || page; $('#windowContext').textContent = titles[page] || page;
  if (page === 'products') loadManagedProducts(); if (page === 'categories') loadManagedCategories(); if (page === 'customers') loadManagedParties();
}

function openManagementModal(kind, record = null) {
  initializeManagementMarkup();
  $('#managementModalBackdrop').classList.remove('hidden'); $('#productModal').classList.toggle('hidden', kind !== 'product'); $('#categoryModal').classList.toggle('hidden', kind !== 'category'); $('#partyModal').classList.toggle('hidden', kind !== 'party');
  if (kind === 'product') {
    $('#productModalTitle').textContent = record ? 'ویرایش کالا' : 'ثبت کالای جدید'; $('#productId').value = record?.id || '';
    [['productName', record?.name], ['productCode', record?.code], ['productBarcode', record?.barcode], ['productPurchasePrice', record ? record.purchasePrice / 100 : 0], ['productWholesalePrice', record ? record.wholesalePrice / 100 : 0], ['productRetailPrice', record ? record.salePrice / 100 : 0], ['productStock', record?.stock ?? 0], ['productMinimumStock', record?.minimumStock ?? 0], ['productDescription', record?.description || '']].forEach(([id, value]) => { $(`#${id}`).value = value ?? ''; });
    $('#productCategory').value = record?.categoryId || ''; $('#productUnit').value = record?.unitId || ''; if (!record) updateProductCodePreview(); $('#productName').focus();
  } else if (kind === 'category') {
    $('#categoryModalTitle').textContent = record ? 'ویرایش دسته‌بندی' : 'ثبت دسته‌بندی'; $('#categoryId').value = record?.id || ''; $('#categoryCode').value = record?.code || ''; $('#categoryName').value = record?.name || ''; $('#categoryDescription').value = record?.description || ''; $('#categoryCode').focus();
  } else {
    $('#partyModalTitle').textContent = record ? 'ویرایش طرف‌حساب' : 'ثبت طرف‌حساب جدید';
    $('#partyId').value = record?.id || '';
    $('#partyFirstName').value = record?.firstName || '';
    $('#partyLastName').value = record?.lastName || '';
    $('#partyPhone').value = record?.phone || '';
    $('#partyMobile').value = record?.mobile || '';
    $('#partyAddress').value = record?.address || '';
    $('#partyDescription').value = record?.description || '';
    $('#partyType').value = record?.partyType || 'customer';
    $('#partyFirstName').focus();
  }
}

function closeManagementModal() { $('#managementModalBackdrop').classList.add('hidden'); }
function renderProductOptions() { $('#productCategory').innerHTML = '<option value="">بدون دسته‌بندی</option>' + managementState.categories.filter((c) => c.isActive).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join(''); $('#productCategoryFilter').innerHTML = '<option value="">همه دسته‌بندی‌ها</option>' + managementState.categories.filter((c) => c.isActive).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join(''); $('#productUnit').innerHTML = '<option value="">انتخاب واحد</option>' + managementState.units.map((u) => `<option value="${u.id}">${esc(u.name)}${u.symbol ? ` (${esc(u.symbol)})` : ''}</option>`).join(''); }
function updateProductCodePreview() { const category = managementState.categories.find((c) => String(c.id) === String($('#productCategory')?.value)); if (category) $('#productCode').value = `${category.code}001`; else $('#productCode').value = ''; }
function renderManagedProducts() { const term = ($('#productsFilter')?.value || '').trim().toLowerCase(); const category = $('#productCategoryFilter')?.value || ''; const includeInactive = $('#showInactiveProducts')?.checked; const rows = managementState.products.filter((p) => (includeInactive || p.isActive) && (!category || String(p.categoryId) === category) && (!term || [p.name, p.code, p.barcode].some((v) => String(v || '').toLowerCase().includes(term)))); $('#productsTable').innerHTML = rows.length ? rows.map((p) => `<tr class="${p.isActive ? '' : 'muted-row'}"><td>${esc(p.code)}</td><td><strong>${esc(p.name)}</strong>${p.barcode ? `<small>${esc(p.barcode)}</small>` : ''}</td><td>${esc(p.categoryName || '—')}</td><td>${money(p.salePrice)}</td><td>${new Intl.NumberFormat('fa-IR').format(p.stock)}${p.stock <= p.minimumStock ? '<span class="stock-warning">کم</span>' : ''}</td><td>${esc(p.unitSymbol || p.unitName || '—')}</td><td><span class="status-badge ${p.isActive ? 'active' : 'inactive'}">${p.isActive ? 'فعال' : 'غیرفعال'}</span></td><td><button class="table-action edit-product" data-id="${p.id}">ویرایش</button><button class="table-action danger toggle-product" data-id="${p.id}" data-active="${p.isActive}">${p.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button></td></tr>`).join('') : '<tr class="empty-row"><td colspan="8">کالایی برای نمایش وجود ندارد.</td></tr>'; }
function renderManagedCategories() { const term = ($('#categoriesFilter')?.value || '').trim().toLowerCase(); const includeInactive = $('#showInactiveCategories')?.checked; const rows = managementState.categories.filter((c) => (includeInactive || c.isActive) && (!term || `${c.code} ${c.name}`.toLowerCase().includes(term))); $('#categoriesTable').innerHTML = rows.length ? rows.map((c) => `<tr class="${c.isActive ? '' : 'muted-row'}"><td><strong>${esc(c.code)}</strong></td><td><strong>${esc(c.name)}</strong></td><td>${esc(c.description || '—')}</td><td>${new Intl.NumberFormat('fa-IR').format(c.productCount || 0)}</td><td><span class="status-badge ${c.isActive ? 'active' : 'inactive'}">${c.isActive ? 'فعال' : 'غیرفعال'}</span></td><td><button class="table-action edit-category" data-id="${c.id}">ویرایش</button><button class="table-action danger toggle-category" data-id="${c.id}" data-active="${c.isActive}">${c.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button></td></tr>`).join('') : '<tr class="empty-row"><td colspan="6">دسته‌بندی‌ای برای نمایش وجود ندارد.</td></tr>'; }
function renderManagedParties() { const term = ($('#partiesFilter')?.value || '').trim().toLowerCase(); const type = $('#partyTypeFilter')?.value || ''; const includeInactive = $('#showInactiveParties')?.checked; const labels = { customer: 'مشتری', supplier: 'تأمین‌کننده', both: 'هر دو' }; const rows = managementState.parties.filter((p) => (includeInactive || p.isActive) && (!type || p.partyType === type) && (!term || [p.name, p.code, p.phone, p.mobile, p.address].some((v) => String(v || '').toLowerCase().includes(term)))); $('#partiesTable').innerHTML = rows.length ? rows.map((p) => `<tr class="${p.isActive ? '' : 'muted-row'}"><td><strong>${esc(p.code)}</strong></td><td><strong>${esc(p.name)}</strong></td><td><span class="status-badge ${p.partyType === 'supplier' ? 'inactive' : 'active'}">${labels[p.partyType] || p.partyType}</span></td><td>${esc(p.phone || p.mobile || '—')}</td><td>${esc(p.address || '—')}</td><td>${money(p.balance)}</td><td><span class="status-badge ${p.isActive ? 'active' : 'inactive'}">${p.isActive ? 'فعال' : 'غیرفعال'}</span></td><td><button class="table-action edit-party" data-id="${p.id}">ویرایش</button><button class="table-action danger toggle-party" data-id="${p.id}" data-active="${p.isActive}">${p.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button></td></tr>`).join('') : '<tr class="empty-row"><td colspan="8">طرف‌حسابی برای نمایش وجود ندارد.</td></tr>'; }
async function loadManagedProducts() { managementState.products = await window.api.products.list({ query: '', categoryId: '' }); managementState.categories = await window.api.categories.list(true); managementState.units = await window.api.units.list(); renderProductOptions(); renderManagedProducts(); }
async function loadManagedCategories() { managementState.categories = await window.api.categories.list(true); renderManagedCategories(); renderProductOptions(); }
async function loadManagedParties() { managementState.parties = await window.api.customers.list({ query: '', type: '', includeInactive: true }); renderManagedParties(); }

function bindManagementEvents() {
  document.addEventListener('click', (event) => { const pageButton = event.target.closest('[data-page]'); if (pageButton) { event.preventDefault(); setManagedPage(pageButton.dataset.page); } if (event.target.closest('#addProduct')) openManagementModal('product'); if (event.target.closest('#addCategory')) openManagementModal('category'); if (event.target.closest('#addParty')) openManagementModal('party'); if (event.target.closest('[data-close-management]') || event.target.id === 'managementModalBackdrop') closeManagementModal(); const editProduct = event.target.closest('.edit-product'); if (editProduct) openManagementModal('product', managementState.products.find((p) => p.id === Number(editProduct.dataset.id))); const editCategory = event.target.closest('.edit-category'); if (editCategory) openManagementModal('category', managementState.categories.find((c) => c.id === Number(editCategory.dataset.id))); const editParty = event.target.closest('.edit-party'); if (editParty) openManagementModal('party', managementState.parties.find((p) => p.id === Number(editParty.dataset.id))); const toggleProduct = event.target.closest('.toggle-product'); if (toggleProduct) { const active = toggleProduct.dataset.active !== '1'; window.api.products.setActive(Number(toggleProduct.dataset.id), active).then(() => { showToast(active ? 'کالا فعال شد.' : 'کالا غیرفعال شد.'); return loadManagedProducts(); }).catch((err) => showToast(err.message, true)); } const toggleCategory = event.target.closest('.toggle-category'); if (toggleCategory) { const active = toggleCategory.dataset.active !== '1'; window.api.categories.setActive(Number(toggleCategory.dataset.id), active).then(() => { showToast(active ? 'دسته‌بندی فعال شد.' : 'دسته‌بندی غیرفعال شد.'); return loadManagedCategories(); }).catch((err) => showToast(err.message, true)); } const toggleParty = event.target.closest('.toggle-party'); if (toggleParty) { const active = toggleParty.dataset.active !== '1'; window.api.customers.setActive(Number(toggleParty.dataset.id), active).then(() => { showToast(active ? 'طرف‌حساب فعال شد.' : 'طرف‌حساب غیرفعال شد.'); return loadManagedParties(); }).catch((err) => showToast(err.message, true)); } });
  ['productsFilter', 'productCategoryFilter', 'showInactiveProducts'].forEach((id) => $(`#${id}`)?.addEventListener('input', renderManagedProducts)); ['categoriesFilter', 'showInactiveCategories'].forEach((id) => $(`#${id}`)?.addEventListener('input', renderManagedCategories)); ['partiesFilter', 'partyTypeFilter', 'showInactiveParties'].forEach((id) => $(`#${id}`)?.addEventListener('input', renderManagedParties)); $('#productCategory').addEventListener('change', updateProductCodePreview);
  $('#productForm').addEventListener('submit', async (event) => { event.preventDefault(); const error = $('#productFormError'); error.classList.add('hidden'); const payload = { name: $('#productName').value, code: $('#productCode').value, barcode: $('#productBarcode').value, categoryId: $('#productCategory').value, unitId: $('#productUnit').value, purchasePrice: Number($('#productPurchasePrice').value || 0) * 100, wholesalePrice: Number($('#productWholesalePrice').value || 0) * 100, retailPrice: Number($('#productRetailPrice').value || 0) * 100, stock: Number($('#productStock').value || 0), minimumStock: Number($('#productMinimumStock').value || 0), description: $('#productDescription').value }; try { const id = $('#productId').value; if (id) await window.api.products.update(Number(id), payload); else await window.api.products.create(payload); closeManagementModal(); showToast(id ? 'کالا با موفقیت ویرایش شد.' : 'کالا با موفقیت ثبت شد.'); await loadManagedProducts(); } catch (err) { error.textContent = err.message; error.classList.remove('hidden'); } });
  $('#categoryForm').addEventListener('submit', async (event) => { event.preventDefault(); const error = $('#categoryFormError'); error.classList.add('hidden'); const payload = { code: $('#categoryCode').value, name: $('#categoryName').value, description: $('#categoryDescription').value }; try { const id = $('#categoryId').value; if (id) await window.api.categories.update(Number(id), payload); else await window.api.categories.create(payload); closeManagementModal(); showToast(id ? 'دسته‌بندی با موفقیت ویرایش شد.' : 'دسته‌بندی با موفقیت ثبت شد.'); await loadManagedCategories(); } catch (err) { error.textContent = err.message; error.classList.remove('hidden'); } });
  $('#partyForm').addEventListener('submit', async (event) => { event.preventDefault(); const error = $('#partyFormError'); error.classList.add('hidden'); const payload = { firstName: $('#partyFirstName').value, lastName: $('#partyLastName').value, phone: $('#partyPhone').value, mobile: $('#partyMobile').value, address: $('#partyAddress').value, partyType: $('#partyType').value, description: $('#partyDescription').value }; try { const id = $('#partyId').value; if (id) await window.api.customers.update(Number(id), payload); else await window.api.customers.create(payload); closeManagementModal(); showToast(id ? 'طرف‌حساب با موفقیت ویرایش شد.' : 'طرف‌حساب با موفقیت ثبت شد.'); await loadManagedParties(); } catch (err) { error.textContent = err.message; error.classList.remove('hidden'); } });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeManagementModal(); });
}

initializeManagementMarkup();
document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => setManagedPage(button.dataset.page)));
setManagedPage('dashboard');

function initializeImportMarkup() {
  const heading = document.querySelector('#productsPage .page-heading');
  if (heading && !$('#importProducts')) heading.insertAdjacentHTML('beforeend', '<button id="importProducts" class="secondary">ورود از اکسل</button>');
  const backdrop = $('#managementModalBackdrop');
  if (backdrop && !$('#importProductsModal')) backdrop.insertAdjacentHTML('beforeend', `<div id="importProductsModal" class="modal hidden"><div class="modal-header"><div><span class="eyebrow">ورود گروهی</span><h3>ورود محصولات از اکسل</h3></div><button class="modal-close" data-close-management>×</button></div><div id="importProductsSummary" class="import-summary">برای انتخاب فایل روی دکمه زیر کلیک کنید.</div><div id="importProductsSample" class="import-sample"></div><div id="importProductsError" class="form-error hidden"></div><div class="modal-actions"><button type="button" class="secondary" data-close-management>انصراف</button><button id="selectImportFile" type="button" class="secondary">انتخاب فایل</button><button id="confirmImportProducts" type="button" class="primary" disabled>ثبت محصولات</button></div></div>`);
  $('#importProducts')?.addEventListener('click', () => {
    $('#managementModalBackdrop').classList.remove('hidden');
    document.querySelectorAll('#managementModalBackdrop .modal').forEach((node) => node.classList.add('hidden'));
    $('#importProductsModal').classList.remove('hidden');
    $('#importProductsSummary').textContent = 'برای انتخاب فایل روی دکمه «انتخاب فایل» کلیک کنید.';
    $('#importProductsSample').innerHTML = '';
    $('#importProductsError').classList.add('hidden');
    $('#confirmImportProducts').disabled = true;
    $('#confirmImportProducts').dataset.token = '';
  });
  $('#selectImportFile')?.addEventListener('click', async () => {
    const error = $('#importProductsError');
    error.classList.add('hidden');
    try {
      const preview = await window.api.products.importPreview();
      if (preview.canceled) return;
      $('#importProductsSummary').textContent = `شیت ${preview.sheetName || ''} · ${preview.total} کالا · ${preview.categoryCount} دسته‌بندی · ${preview.missingCategories.length} دسته جدید · ${preview.duplicateCount} تکراری · ${preview.priceWarningCount} هشدار قیمت`;
      $('#importProductsSample').innerHTML = preview.sample.map((row) => `<div><span>${esc(row.category)}</span><strong>${esc(row.name)}</strong><small>موجودی: ${row.stock} · خرید: ${row.purchasePrice} · عمده: ${row.wholesalePrice} · فروش: ${row.retailPrice}</small></div>`).join('');
      if (preview.parseErrors?.length) $('#importProductsSummary').textContent += ` · ${preview.parseErrors.length} ردیف نامعتبر`;
      $('#confirmImportProducts').dataset.token = preview.token;
      $('#confirmImportProducts').disabled = false;
    } catch (err) {
      error.textContent = err.message || 'خواندن فایل انجام نشد.';
      error.classList.remove('hidden');
    }
  });
  $('#confirmImportProducts')?.addEventListener('click', async () => {
    const token = $('#confirmImportProducts').dataset.token;
    if (!token) return;
    const button = $('#confirmImportProducts');
    button.disabled = true;
    try {
      const result = await window.api.products.importConfirm(token, $('#importDuplicateMode')?.value || 'skip');
      closeManagementModal();
      showToast(`${result.imported} کالا وارد شد؛ ${result.updated || 0} کالا به‌روزرسانی و ${result.skipped} تکراری رد شد.`);
      await loadManagedProducts();
      await window.api.dashboard.summary().then(renderMetrics);
      if (result.errors?.length) showToast(`${result.errors.length} ردیف وارد نشد.`, true);
    } catch (err) {
      const error = $('#importProductsError');
      error.textContent = err.message || 'ورود محصولات انجام نشد.';
      error.classList.remove('hidden');
      button.disabled = false;
    }
  });
}

initializeImportMarkup();

function productPriceWarning(product) {
  const purchase = Number(product.purchasePrice || 0);
  const wholesale = Number(product.wholesalePrice || 0);
  const retail = Number(product.salePrice || 0);
  return purchase === 0 || wholesale === 0 || retail === 0 ||
    (purchase > 0 && wholesale > 0 && retail > 0 && (purchase > wholesale || wholesale > retail));
}

function enhanceProductManagementUi() {
  const heading = document.querySelector('#productsPage .page-heading');
  if (heading) {
    let actions = heading.querySelector('.page-heading-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'page-heading-actions';
      heading.appendChild(actions);
    }
    const addButton = heading.querySelector('#addProduct');
    const importButton = heading.querySelector('#importProducts');
    if (addButton && addButton.parentElement !== actions) actions.appendChild(addButton);
    if (importButton && importButton.parentElement !== actions) actions.insertBefore(importButton, actions.firstChild);
    if (!actions.querySelector('#exportProducts')) actions.insertAdjacentHTML('beforeend', '<button id="exportProducts" class="secondary">خروجی اکسل</button>');
    if (!actions.querySelector('#downloadProductTemplate')) actions.insertAdjacentHTML('beforeend', '<button id="downloadProductTemplate" class="ghost">فایل نمونه</button>');
  }
  const toolbar = document.querySelector('#productsPage .management-toolbar');
  if (toolbar && !$('#productQualityFilter')) {
    toolbar.insertAdjacentHTML('beforeend', '<select id="productQualityFilter" title="فیلتر کیفیت داده"><option value="">همه کالاها</option><option value="zero-price">قیمت صفر</option><option value="abnormal-price">قیمت نامتعارف</option><option value="zero-stock">موجودی صفر</option><option value="low-stock">موجودی کم</option><option value="no-barcode">بدون بارکد</option></select>');
  }
  const tablePanel = document.querySelector('#productsPage .table-panel');
  if (tablePanel && !$('#productsStats')) {
    tablePanel.insertAdjacentHTML('beforebegin', '<div id="productsStats" class="products-stats"></div>');
  }
  const importModal = $('#importProductsModal');
  if (importModal && !$('#importDuplicateMode')) {
    const actions = importModal.querySelector('.modal-actions');
    if (actions) actions.insertAdjacentHTML('afterbegin', '<label class="import-duplicate-field">محصول تکراری<select id="importDuplicateMode"><option value="skip">رد کردن</option><option value="update">به‌روزرسانی محصول موجود</option></select></label>');
  }
  if ($('#productQualityFilter') && !$('#productQualityFilter').dataset.bound) {
    $('#productQualityFilter').dataset.bound = '1';
    $('#productQualityFilter').addEventListener('change', () => renderManagedProducts());
  }
  if ($('#exportProducts') && !$('#exportProducts').dataset.bound) $('#exportProducts').addEventListener('click', async () => {
    try {
      const result = await window.api.products.export();
      if (!result.canceled) showToast(`${result.count} کالا خروجی گرفته شد.`);
    } catch (error) { showToast(error.message, true); }
  });
  if ($('#downloadProductTemplate') && !$('#downloadProductTemplate').dataset.bound) $('#downloadProductTemplate').addEventListener('click', async () => {
    try {
      const result = await window.api.products.template();
      if (!result.canceled) showToast('فایل نمونه ذخیره شد.');
    } catch (error) { showToast(error.message, true); }
  });
  if ($('#exportProducts')) $('#exportProducts').dataset.bound = '1';
  if ($('#downloadProductTemplate')) $('#downloadProductTemplate').dataset.bound = '1';
}

function renderEnhancedManagedProducts() {
  enhanceProductManagementUi();
  const term = ($('#productsFilter')?.value || '').trim().toLowerCase();
  const category = $('#productCategoryFilter')?.value || '';
  const quality = $('#productQualityFilter')?.value || '';
  const includeInactive = $('#showInactiveProducts')?.checked;
  const rows = managementState.products.filter((p) => {
    if (!includeInactive && !p.isActive) return false;
    if (category && String(p.categoryId) !== category) return false;
    if (term && ![p.name, p.code, p.barcode].some((v) => String(v || '').toLowerCase().includes(term))) return false;
    if (quality === 'zero-price' && !(Number(p.purchasePrice || 0) === 0 || Number(p.wholesalePrice || 0) === 0 || Number(p.salePrice || 0) === 0)) return false;
    if (quality === 'abnormal-price' && !productPriceWarning(p)) return false;
    if (quality === 'zero-stock' && Number(p.stock || 0) !== 0) return false;
    if (quality === 'low-stock' && !(Number(p.stock || 0) <= Number(p.minimumStock || 0))) return false;
    if (quality === 'no-barcode' && String(p.barcode || '').trim()) return false;
    return true;
  });
  const all = managementState.products;
  const zeroPrice = all.filter((p) => Number(p.purchasePrice || 0) === 0 || Number(p.wholesalePrice || 0) === 0 || Number(p.salePrice || 0) === 0).length;
  const zeroStock = all.filter((p) => Number(p.stock || 0) === 0).length;
  const lowStock = all.filter((p) => Number(p.stock || 0) <= Number(p.minimumStock || 0)).length;
  const inactive = all.filter((p) => !p.isActive).length;
  if ($('#productsStats')) $('#productsStats').innerHTML = `<span>کل: <b>${new Intl.NumberFormat('fa-IR').format(all.length)}</b></span><span>قیمت ناقص: <b>${new Intl.NumberFormat('fa-IR').format(zeroPrice)}</b></span><span>موجودی صفر: <b>${new Intl.NumberFormat('fa-IR').format(zeroStock)}</b></span><span>موجودی کم: <b>${new Intl.NumberFormat('fa-IR').format(lowStock)}</b></span><span>غیرفعال: <b>${new Intl.NumberFormat('fa-IR').format(inactive)}</b></span>`;
  $('#productsTable').innerHTML = rows.length ? rows.map((p) => `<tr class="${p.isActive ? '' : 'muted-row'}"><td>${esc(p.code)}</td><td><strong>${esc(p.name)}</strong>${p.barcode ? `<small>${esc(p.barcode)}</small>` : ''}</td><td>${esc(p.categoryName || '—')}</td><td><input class="quick-product-price" data-id="${p.id}" data-field="retailPrice" type="number" min="0" value="${Math.round(Number(p.salePrice || 0) / 100)}"></td><td><input class="quick-product-stock" data-id="${p.id}" type="number" min="0" step="0.01" value="${p.stock ?? 0}"></td><td>${esc(p.unitSymbol || p.unitName || '—')}</td><td><span class="status-badge ${p.isActive ? 'active' : 'inactive'}">${p.isActive ? 'فعال' : 'غیرفعال'}</span>${productPriceWarning(p) ? '<span class="quality-badge">بررسی قیمت</span>' : ''}</td><td><button class="table-action quick-product-save" data-id="${p.id}">ذخیره سریع</button><button class="table-action edit-product" data-id="${p.id}">ویرایش</button><button class="table-action danger toggle-product" data-id="${p.id}" data-active="${p.isActive}">${p.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button></td></tr>`).join('') : '<tr class="empty-row"><td colspan="8">کالایی برای نمایش وجود ندارد.</td></tr>';
}

renderManagedProducts = renderEnhancedManagedProducts;
enhanceProductManagementUi();

document.addEventListener('click', async (event) => {
  const button = event.target.closest('.quick-product-save');
  if (!button) return;
  const id = Number(button.dataset.id);
  const price = Number(document.querySelector(`.quick-product-price[data-id="${id}"]`)?.value || 0) * 100;
  const stock = Number(document.querySelector(`.quick-product-stock[data-id="${id}"]`)?.value || 0);
  button.disabled = true;
  try {
    await window.api.products.quickUpdate(id, { retailPrice: price, stock });
    showToast('قیمت فروش و موجودی با موفقیت به‌روزرسانی شد.');
    await loadManagedProducts();
  } catch (error) {
    showToast(error.message, true);
    button.disabled = false;
  }
});

function alignProductPageHeader() {
  const heading = document.querySelector('#productsPage .page-heading');
  if (!heading) return;
  let title = heading.querySelector('.products-title');
  const titleBlock = heading.firstElementChild;
  if (titleBlock && !title) {
    titleBlock.classList.add('products-title');
    title = titleBlock;
  }
  let actions = heading.querySelector('.page-heading-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'page-heading-actions';
    heading.appendChild(actions);
  }
  const addButton = heading.querySelector('#addProduct');
  const importButton = heading.querySelector('#importProducts');
  if (addButton && addButton.parentElement !== actions) actions.appendChild(addButton);
  if (importButton && importButton.parentElement !== actions) actions.insertBefore(importButton, actions.firstChild);
  if (title && !title.querySelector('#productsTotalCount')) {
    title.insertAdjacentHTML('beforeend', '<small id="productsTotalCount" class="products-total-count"></small>');
  }
}

function updateProductsTotalCount() {
  const count = $('#productsTotalCount');
  if (count) count.textContent = ` · ${new Intl.NumberFormat('fa-IR').format(managementState.products.length)} کالا`;
}

const originalRenderManagedProducts = renderManagedProducts;
renderManagedProducts = function renderManagedProductsWithCount() {
  originalRenderManagedProducts();
  alignProductPageHeader();
  updateProductsTotalCount();
};

alignProductPageHeader();

function initializeSettingsPage() {
  if ($('#settingsPage')) return;
  const placeholder = $('#placeholderPage');
  if (!placeholder) return;
  placeholder.insertAdjacentHTML('beforebegin', `
    <section id="settingsPage" class="page hidden settings-page">
      <div class="page-heading"><div><span class="eyebrow">تنظیمات برنامه</span><h2>تنظیمات فروشگاه و چاپ</h2></div><button id="reloadPrinters" class="secondary" type="button">به‌روزرسانی پرینترها</button></div>
      <div class="settings-grid">
        <form id="storeSettingsForm" class="panel settings-card">
          <div class="settings-card-heading"><div><h3>مشخصات فروشگاه</h3><small>این اطلاعات در سربرگ و پایین فاکتورها استفاده می‌شود.</small></div></div>
          <div class="form-grid">
            <label>نام فروشگاه *<input id="settingsStoreName" required></label>
            <label>شعار یا عنوان کوتاه<input id="settingsStoreSlogan"></label>
            <label>شماره تماس<input id="settingsStorePhone" inputmode="tel"></label>
            <label>کد پستی<input id="settingsStorePostalCode" inputmode="numeric"></label>
            <label class="full-field">آدرس فروشگاه<textarea id="settingsStoreAddress" rows="3"></textarea></label>
            <label>آدرس سایت<input id="settingsStoreWebsite" placeholder="https://"></label>
            <label>اینستاگرام<input id="settingsStoreInstagram" placeholder="@store"></label>
            <label>روبیکا<input id="settingsStoreRubika"></label>
            <label class="full-field">متن پایین فاکتور<textarea id="settingsInvoiceFooter" rows="3" placeholder="از خرید شما سپاسگزاریم"></textarea></label>
          </div>
          <div class="logo-picker"><div><strong>لوگوی فروشگاه</strong><small id="settingsLogoPath">لوگویی انتخاب نشده است.</small></div><button id="chooseStoreLogo" class="secondary" type="button">انتخاب تصویر</button><input id="settingsLogoPathValue" type="hidden"></div>
          <div id="storeSettingsError" class="form-error hidden"></div>
          <div class="modal-actions"><button class="primary" type="submit">ذخیره مشخصات فروشگاه</button></div>
        </form>
        <form id="printSettingsForm" class="panel settings-card">
          <div class="settings-card-heading"><div><h3>تنظیمات چاپ</h3><small>انتخاب پرینتر و اندازه کاغذ فاکتورها.</small></div></div>
          <label>پرینتر پیش‌فرض<select id="settingsPrinter"><option value="">پرینتر پیش‌فرض سیستم</option></select></label>
          <label>اندازه کاغذ<select id="settingsPaper"><option value="A4">A4</option><option value="A5">A5</option><option value="80mm">رول ۸۰ میلی‌متر</option><option value="58mm">رول ۵۸ میلی‌متر</option></select></label>
          <label class="settings-check"><input id="settingsColor" type="checkbox"> چاپ رنگی</label>
          <label class="settings-check"><input id="settingsAutoPrintSale" type="checkbox"> چاپ خودکار فاکتور فروش بعد از ثبت</label>
          <label class="settings-check"><input id="settingsAutoPrintPurchase" type="checkbox"> چاپ خودکار فاکتور خرید بعد از ثبت</label>
          <div id="printSettingsError" class="form-error hidden"></div>
          <div class="modal-actions"><button class="primary" type="submit">ذخیره تنظیمات چاپ</button></div>
        </form>
      </div>
    </section>`);

  async function loadPrinters(selected = '') {
    const select = $('#settingsPrinter');
    if (!select) return;
    try {
      const printers = await window.api.settings.printers();
      select.innerHTML = '<option value="">پرینتر پیش‌فرض سیستم</option>' +
        printers.map((printer) => `<option value="${esc(printer.name)}">${esc(printer.displayName)}${printer.isDefault ? ' (پیش‌فرض)' : ''}</option>`).join('');
      select.value = selected || '';
    } catch (error) {
      select.innerHTML = '<option value="">دریافت فهرست پرینترها ناموفق بود</option>';
    }
  }

  async function loadSettings() {
    const settings = await window.api.settings.get();
    const store = settings.store || {};
    const print = settings.print || {};
    $('#settingsStoreName').value = store.name || '';
    $('#settingsStoreSlogan').value = store.slogan || '';
    $('#settingsStorePhone').value = store.phone || '';
    $('#settingsStorePostalCode').value = store.postalCode || '';
    $('#settingsStoreAddress').value = store.address || '';
    $('#settingsStoreWebsite').value = store.website || '';
    $('#settingsStoreInstagram').value = store.instagram || '';
    $('#settingsStoreRubika').value = store.rubika || '';
    $('#settingsInvoiceFooter').value = store.footer || '';
    $('#settingsLogoPathValue').value = store.logoPath || '';
    $('#settingsLogoPath').textContent = store.logoPath ? store.logoPath : 'لوگویی انتخاب نشده است.';
    $('#settingsPaper').value = print.paperSize || 'A4';
    $('#settingsColor').checked = print.color !== false;
    $('#settingsAutoPrintSale').checked = print.autoPrintSale === true;
    $('#settingsAutoPrintPurchase').checked = print.autoPrintPurchase === true;
    await loadPrinters(print.printerName || '');
  }

  $('#reloadPrinters').addEventListener('click', () => loadPrinters($('#settingsPrinter').value));
  $('#chooseStoreLogo').addEventListener('click', async () => {
    const result = await window.api.settings.chooseLogo();
    if (!result.canceled) {
      $('#settingsLogoPathValue').value = result.path;
      $('#settingsLogoPath').textContent = result.path;
    }
  });
  $('#storeSettingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('#storeSettingsError');
    error.classList.add('hidden');
    try {
      const current = await window.api.settings.get();
      await window.api.settings.save({
        ...current,
        store: {
          name: $('#settingsStoreName').value,
          slogan: $('#settingsStoreSlogan').value,
          phone: $('#settingsStorePhone').value,
          postalCode: $('#settingsStorePostalCode').value,
          address: $('#settingsStoreAddress').value,
          website: $('#settingsStoreWebsite').value,
          instagram: $('#settingsStoreInstagram').value,
          rubika: $('#settingsStoreRubika').value,
          footer: $('#settingsInvoiceFooter').value,
          logoPath: $('#settingsLogoPathValue').value
        }
      });
      showToast('مشخصات فروشگاه ذخیره شد.');
    } catch (err) { error.textContent = err.message; error.classList.remove('hidden'); }
  });
  $('#printSettingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('#printSettingsError');
    error.classList.add('hidden');
    try {
      const current = await window.api.settings.get();
      await window.api.settings.save({
        ...current,
        print: {
          printerName: $('#settingsPrinter').value,
          paperSize: $('#settingsPaper').value,
          color: $('#settingsColor').checked,
          autoPrintSale: $('#settingsAutoPrintSale').checked,
          autoPrintPurchase: $('#settingsAutoPrintPurchase').checked
        }
      });
      showToast('تنظیمات چاپ ذخیره شد.');
    } catch (err) { error.textContent = err.message; error.classList.remove('hidden'); }
  });
  loadSettings().catch(() => {});
}

const originalManagedPageForSettings = setManagedPage;
setManagedPage = function setManagedPageWithSettings(page) {
  initializeSettingsPage();
  originalManagedPageForSettings(page);
  if (page === 'settings') {
    $('#settingsPage')?.classList.remove('hidden');
    $('#placeholderPage')?.classList.add('hidden');
  } else {
    $('#settingsPage')?.classList.add('hidden');
  }
};
initializeSettingsPage();

/* Extended settings workspace: replaces the initial two-card screen with
   tabbed, persisted configuration while keeping backward-compatible APIs. */
function initializeSettingsPageV2() {
  const root = $('#settingsPage');
  if (!root || root.dataset.v2) return;
  root.dataset.v2 = '1';
  root.innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">\u062a\u0646\u0638\u06cc\u0645\u0627\u062a \u0628\u0631\u0646\u0627\u0645\u0647</span><h2>\u0645\u0631\u06a9\u0632 \u062a\u0646\u0638\u06cc\u0645\u0627\u062a</h2></div><button id="saveAllSettings" class="primary">\u0630\u062e\u06cc\u0631\u0647 \u0647\u0645\u0647 \u062a\u063a\u06cc\u06cc\u0631\u0627\u062a</button></div>
    <div class="settings-shell"><aside class="settings-tabs">
      <button class="settings-tab active" data-settings-tab="store">\u0641\u0631\u0648\u0634\u06af\u0627\u0647</button><button class="settings-tab" data-settings-tab="print">\u0686\u0627\u067e \u0648 \u0641\u0627\u06a9\u062a\u0648\u0631</button><button class="settings-tab" data-settings-tab="currency">\u0648\u0627\u062d\u062f \u067e\u0648\u0644\u06cc</button><button class="settings-tab" data-settings-tab="units">\u0648\u0627\u062d\u062f \u0645\u062d\u0635\u0648\u0644\u0627\u062a</button><button class="settings-tab" data-settings-tab="sales">\u0641\u0631\u0648\u0634</button><button class="settings-tab" data-settings-tab="products">\u06a9\u0627\u0644\u0627 \u0648 \u0627\u0646\u0628\u0627\u0631</button><button class="settings-tab" data-settings-tab="financial">\u0645\u0627\u0644\u06cc \u0648 \u0645\u0627\u0644\u06cc\u0627\u062a</button><button class="settings-tab" data-settings-tab="appearance">\u0638\u0627\u0647\u0631 \u0648 \u0631\u0641\u062a\u0627\u0631</button><button class="settings-tab" data-settings-tab="backup">\u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc \u0648 \u062f\u0627\u062f\u0647</button>
    </aside><div class="settings-panels">
      <section class="settings-panel active" data-settings-panel="store"><form id="v2Store" class="panel settings-card"><h3>\u0645\u0634\u062e\u0635\u0627\u062a \u0641\u0631\u0648\u0634\u06af\u0627\u0647</h3><div class="form-grid"><label>\u0646\u0627\u0645 *<input id="v2Name" required></label><label>\u0634\u0639\u0627\u0631<input id="v2Slogan"></label><label>\u062a\u0644\u0641\u0646<input id="v2Phone"></label><label>\u06a9\u062f \u067e\u0633\u062a\u06cc<input id="v2Postal"></label><label class="full-field">\u0622\u062f\u0631\u0633<textarea id="v2Address"></textarea></label><label>\u0648\u0628\u200c\u0633\u0627\u06cc\u062a<input id="v2Website"></label><label>\u0627\u06cc\u0646\u0633\u062a\u0627\u06af\u0631\u0627\u0645<input id="v2Instagram"></label><label>\u0631\u0648\u0628\u06cc\u06a9\u0627<input id="v2Rubika"></label><label class="full-field">\u067e\u0627\u06cc\u06db\u0627\u0646 \u0641\u0627\u06a9\u062a\u0648\u0631<textarea id="v2Footer"></textarea></label></div><div class="logo-picker"><span id="v2LogoLabel"></span><button id="v2ChooseLogo" type="button" class="secondary">\u0627\u0646\u062a\u062e\u0627\u0628 \u0644\u0648\u06af\u0648</button><input id="v2Logo" type="hidden"></div><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647</button></form></section>
      <section class="settings-panel" data-settings-panel="print"><form id="v2Print" class="panel settings-card"><h3>\u0686\u0627\u067e \u0648 \u0641\u0627\u06a9\u062a\u0648\u0631</h3><div class="form-grid"><label>\u067e\u0631\u06cc\u0646\u062a\u0631<select id="v2Printer"></select></label><label>\u06a9\u0627\u063a\u0630<select id="v2Paper"><option>A4</option><option>A5</option><option value="80mm">\u0631\u0648\u0644 ۸۰</option><option value="58mm">\u0631\u0648\u0644 ۵۸</option></select></label><label>\u062a\u0639\u062f\u0627\u062f \u0646\u0633\u062e\u0647<input id="v2Copies" type="number" min="1" max="10"></label><label>\u062d\u0627\u0634\u06cc\u0647<select id="v2Margin"><option value="narrow">\u06a9\u0645</option><option value="normal">\u0645\u0639\u0645\u0648\u0644\u06cc</option><option value="wide">\u0632\u06cc\u0627\u062f</option></select></label></div><div class="settings-checks"><label class="settings-check"><input id="v2Color" type="checkbox">\u0631\u0646\u06af\u06cc</label><label class="settings-check"><input id="v2ShowLogo" type="checkbox">\u0646\u0645\u0627\u06cc\u0634 \u0644\u0648\u06af\u0648</label><label class="settings-check"><input id="v2ShowInfo" type="checkbox">\u0646\u0645\u0627\u06cc\u0634 \u0627\u0637\u0644\u0627\u0639\u0627\u062a</label><label class="settings-check"><input id="v2ShowDiscount" type="checkbox">\u0646\u0645\u0627\u06cc\u0634 \u062a\u062e\u0641\u06cc\u0641</label><label class="settings-check"><input id="v2ShowTax" type="checkbox">\u0646\u0645\u0627\u06cc\u0634 \u0645\u0627\u0644\u06cc\u0627\u062a</label><label class="settings-check"><input id="v2Preview" type="checkbox">\u067e\u06cc\u0634\u200c\u0646\u0645\u0627\u06cc\u0634</label><label class="settings-check"><input id="v2AutoSale" type="checkbox">\u0686\u0627\u067e \u062e\u0648\u062f\u06a9\u0627\u0631 \u0641\u0631\u0648\u0634</label><label class="settings-check"><input id="v2AutoPurchase" type="checkbox">\u0686\u0627\u067e \u062e\u0648\u062f\u06a9\u0627\u0631 \u062e\u0631\u06cc\u062f</label></div><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647</button></form></section>
      <section class="settings-panel" data-settings-panel="currency"><form id="v2Currency" class="panel settings-card"><h3>\u0648\u0627\u062d\u062f \u067e\u0648\u0644\u06cc</h3><div class="form-grid"><label>\u06a9\u062f<input id="v2CurCode"></label><label>\u0646\u0627\u0645<input id="v2CurName"></label><label>\u0646\u0645\u0627\u062f<input id="v2CurSymbol"></label><label>\u0645\u0648\u0642\u0639\u06cc\u062a<select id="v2CurPosition"><option value="suffix">\u067e\u0633</option><option value="prefix">\u0642\u0628\u0644</option></select></label><label>\u0627\u0639\u0634\u0627\u0631<input id="v2CurDecimals" type="number" min="0" max="4"></label><label>\u0648\u0627\u062d\u062f \u0648\u0631\u0648\u062f<select id="v2CurInput"><option value="toman">\u062a\u0648\u0645\u0627\u0646</option><option value="rial">\u0631\u06cc\u0627\u0644</option></select></label><label>\u06af\u0631\u062f \u06a9\u0631\u062f\u0646<select id="v2CurRound"><option value="none">\u0628\u062f\u0648\u0646</option><option value="100">\u06cc\u06a9\u0635\u062f</option><option value="1000">\u0647\u0632\u0627\u0631</option></select></label></div><label class="settings-check"><input id="v2CurSep" type="checkbox">\u062c\u062f\u0627\u06a9\u0646\u0646\u062f\u0647 \u0647\u0632\u0627\u0631\u06af\u0627\u0646</label><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647</button></form></section>
      <section class="settings-panel" data-settings-panel="units"><div class="panel settings-card"><h3>\u0648\u0627\u062d\u062f\u0647\u0627\u06cc \u0645\u062d\u0635\u0648\u0644</h3><form id="v2Unit" class="unit-editor"><input id="v2UnitId" type="hidden"><input id="v2UnitName" placeholder="\u0646\u0627\u0645" required><input id="v2UnitSymbol" placeholder="\u0646\u0645\u0627\u062f"><input id="v2UnitDecimals" type="number" min="0" max="6" value="0" placeholder="\u0627\u0639\u0634\u0627\u0631"><input id="v2UnitFactor" type="number" min="0.0001" step="any" value="1" placeholder="\u0636\u0631\u06cc\u0628"><label class="settings-check"><input id="v2UnitFraction" type="checkbox">\u06a9\u0633\u0631\u06cc</label><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647 \u0648\u0627\u062d\u062f</button><button id="v2UnitCancel" type="button" class="secondary">\u067e\u0627\u06a9 \u06a9\u0631\u062f\u0646</button></form><div class="table-wrap"><table><thead><tr><th>\u0646\u0627\u0645</th><th>\u0646\u0645\u0627\u062f</th><th>\u0627\u0639\u0634\u0627\u0631</th><th>\u06a9\u0633\u0631\u06cc</th><th>\u0648\u06cc\u0631\u0627\u06cc\u0634</th></tr></thead><tbody id="v2UnitsTable"></tbody></table></div></div></section>
      <section class="settings-panel" data-settings-panel="sales"><form id="v2Sales" class="panel settings-card"><h3>\u0641\u0631\u0648\u0634</h3><div class="form-grid"><label>\u0642\u06cc\u0645\u062a \u067e\u06cc\u0634\u200c\u0641\u0631\u0636<select id="v2PriceType"><option value="retail">\u062e\u0631\u062f\u0647</option><option value="wholesale">\u0639\u0645\u062f\u0647</option></select></label><label>\u0645\u0627\u0644\u06cc\u0627\u062a (%)<input id="v2SaleTax" type="number" min="0"></label><label>\u067e\u06cc\u0634\u0648\u0646\u062f \u0641\u0627\u06a9\u062a\u0648\u0631<input id="v2InvoicePrefix"></label><label>\u067e\u0631\u062f\u0627\u062e\u062a<select id="v2Payment"><option value="cash">\u0646\u0642\u062f\u06cc</option><option value="card">\u06a9\u0627\u0631\u062a</option><option value="credit">\u0646\u0633\u06cc\u0647</option></select></label></div><div class="settings-checks"><label class="settings-check"><input id="v2Oversell" type="checkbox">\u062c\u0644\u0648\u06af\u06cc\u0631\u06cc \u0627\u0632 \u0641\u0631\u0648\u0634 \u0628\u06cc\u0634\u062a\u0631 \u0627\u0632 \u0645\u0648\u062c\u0648\u062f\u06cc</label><label class="settings-check"><input id="v2AutoDate" type="checkbox">\u062a\u0627\u0631\u06cc\u062e \u062e\u0648\u062f\u06a9\u0627\u0631</label></div><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647</button></form></section>
      <section class="settings-panel" data-settings-panel="products"><form id="v2Products" class="panel settings-card"><h3>\u06a9\u0627\u0644\u0627 \u0648 \u0627\u0646\u0628\u0627\u0631</h3><div class="form-grid"><label>\u067e\u06cc\u0634\u0648\u0646\u062f \u06a9\u062f<input id="v2ProductPrefix"></label><label>\u062d\u062f\u0627\u0642\u0644 \u0645\u0648\u062c\u0648\u062f\u06cc<input id="v2MinStock" type="number" min="0" step="0.01"></label><label>\u0648\u0627\u062d\u062f \u067e\u06cc\u0634\u200c\u0641\u0631\u0636<select id="v2DefaultUnit"></select></label></div><div class="settings-checks"><label class="settings-check"><input id="v2RequireBarcode" type="checkbox">\u0628\u0627\u0631\u06a9\u062f \u0627\u0644\u0632\u0627\u0645\u06cc</label><label class="settings-check"><input id="v2Negative" type="checkbox">\u0645\u0648\u062c\u0648\u062f\u06cc \u0645\u0646\u0641\u06cc</label><label class="settings-check"><input id="v2LowStock" type="checkbox">\u0647\u0634\u062f\u0627\u0631 \u0645\u0648\u062c\u0648\u062f\u06cc \u06a9\u0645</label><label class="settings-check"><input id="v2Fractional" type="checkbox">\u0641\u0631\u0648\u0634 \u06a9\u0633\u0631\u06cc</label></div><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647</button></form></section>
      <section class="settings-panel" data-settings-panel="financial"><form id="v2Financial" class="panel settings-card"><h3>\u0645\u0627\u0644\u06cc \u0648 \u0645\u0627\u0644\u06cc\u0627\u062a</h3><div class="form-grid"><label>\u0646\u0631\u062e \u0645\u0627\u0644\u06cc\u0627\u062a (%)<input id="v2TaxRate" type="number" min="0"></label><label>\u062d\u062f\u0627\u06a9\u062b\u0631 \u062a\u062e\u0641\u06cc\u0641 (%)<input id="v2MaxDiscount" type="number" min="0"></label><label>\u06af\u0631\u062f \u06a9\u0631\u062f\u0646<select id="v2FinRound"><option value="none">\u0628\u062f\u0648\u0646</option><option value="100">\u06cc\u06a9\u0635\u062f</option><option value="1000">\u0647\u0632\u0627\u0631</option></select></label></div><div class="settings-checks"><label class="settings-check"><input id="v2TaxEnabled" type="checkbox">\u0645\u0627\u0644\u06cc\u0627\u062a \u0641\u0639\u0627\u0644</label><label class="settings-check"><input id="v2TaxAfter" type="checkbox">\u0645\u062d\u0627\u0633\u0628\u0647 \u067e\u0633 \u0627\u0632 \u062a\u062e\u0641\u06cc\u0641</label></div><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647</button></form></section>
      <section class="settings-panel" data-settings-panel="appearance"><form id="v2Appearance" class="panel settings-card"><h3>\u0638\u0627\u0647\u0631 \u0648 \u0631\u0641\u062a\u0627\u0631</h3><div class="form-grid"><label>\u067e\u0648\u0633\u062a\u0647<select id="v2Theme"><option value="dark">\u062a\u0627\u0631\u06cc\u06a9</option><option value="light">\u0631\u0648\u0634\u0646</option><option value="system">\u0633\u06cc\u0633\u062a\u0645</option></select></label><label>\u062a\u0642\u0648\u06cc\u0645<select id="v2Calendar"><option value="gregorian">\u0645\u06cc\u0644\u0627\u062f\u06cc</option><option value="jalali">\u0634\u0645\u0633\u06cc</option></select></label><label>\u0641\u0648\u0646\u062a (%)<input id="v2Font" type="number" min="80" max="130"></label></div><div class="settings-checks"><label class="settings-check"><input id="v2Notify" type="checkbox">\u0627\u0639\u0644\u0627\u0646\u200c\u0647\u0627</label><label class="settings-check"><input id="v2Shortcuts" type="checkbox">\u0645\u06cc\u0627\u0646\u0628\u0631\u0647\u0627</label></div><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647</button></form></section>
      <section class="settings-panel" data-settings-panel="backup"><form id="v2Backup" class="panel settings-card"><h3>\u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc \u0648 \u062f\u0627\u062f\u0647</h3><label>\u0645\u0633\u06cc\u0631 \u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc<div class="input-with-action"><input id="v2BackupPath" readonly><button id="v2ChooseBackup" type="button">...</button></div></label><label>\u062f\u0648\u0631\u0647<select id="v2BackupFrequency"><option value="daily">\u0631\u0648\u0632\u0627\u0646\u0647</option><option value="weekly">\u0647\u0641\u062a\u06af\u06cc</option></select></label><label class="settings-check"><input id="v2BackupAuto" type="checkbox">\u062e\u0648\u062f\u06a9\u0627\u0631</label><div class="modal-actions"><button id="v2BackupNow" type="button" class="secondary">\u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc \u0647\u0645\u06cc\u0646 \u0627\u0644\u0627\u0646</button><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647</button></div></form></section>
    </div></div>`;
  const printForm = $('#v2Print');
  const paperField = $('#v2Paper')?.closest('label');
  if (printForm && !$('#v2Orientation')) {
    paperField?.insertAdjacentHTML('afterend', '<label>جهت صفحه<select id="v2Orientation"><option value="portrait">عمودی</option><option value="landscape">افقی</option></select></label>');
    $('#v2ShowInfo')?.closest('label')?.insertAdjacentHTML('afterend', '<label class="settings-check"><input id="v2ShowUnit" type="checkbox">نمایش واحد</label>');
  }
  if (printForm && !$('#v2ShowPrintDialog')) {
    const printChecks = printForm.querySelector('.settings-checks');
    printChecks?.insertAdjacentHTML('beforeend', '<label class="settings-check"><input id="v2ShowPrintDialog" type="checkbox">نمایش پنجره چاپ ویندوز</label>');
  }
  let settings = {};
  const val = (id, value) => { const n = $(`#${id}`); if (n) n.value = value ?? ''; };
  const chk = (id, value) => { const n = $(`#${id}`); if (n) n.checked = Boolean(value); };
  const renderUnits = () => { const units = managementState.units || []; $('#v2UnitsTable').innerHTML = units.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.symbol || '—')}</td><td>${u.decimals || 0}</td><td>${u.allowFraction ? '✓' : '—'}</td><td><button class="table-action v2-edit-unit" data-id="${u.id}">\u0648\u06cc\u0631\u0627\u06cc\u0634</button></td></tr>`).join(''); $('#v2DefaultUnit').innerHTML = '<option value="">\u0628\u062f\u0648\u0646 \u0648\u0627\u062d\u062f</option>' + units.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join(''); };
  const loadPrinters = async (selected) => { try { const list = await window.api.settings.printers(); $('#v2Printer').innerHTML = '<option value="">\u067e\u06cc\u0634\u200c\u0641\u0631\u0636 \u0633\u06cc\u0633\u062a\u0645</option>' + list.map((p) => `<option value="${esc(p.name)}">${esc(p.displayName)}</option>`).join(''); $('#v2Printer').value = selected || ''; } catch {} };
  const load = async () => { settings = await window.api.settings.get(); if (settings.currency) uiCurrency = { ...uiCurrency, ...settings.currency }; const s = settings.store || {}, p = settings.print || {}, c = settings.currency || {}, sl = settings.sales || {}, pr = settings.product || {}, f = settings.financial || {}, a = settings.appearance || {}, b = settings.backup || {}; [['v2Name',s.name],['v2Slogan',s.slogan],['v2Phone',s.phone],['v2Postal',s.postalCode],['v2Address',s.address],['v2Website',s.website],['v2Instagram',s.instagram],['v2Rubika',s.rubika],['v2Footer',s.footer],['v2Logo',s.logoPath],['v2Paper',p.paperSize],['v2Copies',p.copies],['v2Margin',p.margin],['v2CurCode',c.code],['v2CurName',c.name],['v2CurSymbol',c.symbol],['v2CurPosition',c.position],['v2CurDecimals',c.decimals],['v2CurInput',c.inputUnit],['v2CurRound',c.rounding],['v2PriceType',sl.defaultPriceType],['v2SaleTax',sl.defaultTax],['v2InvoicePrefix',sl.invoicePrefix],['v2Payment',sl.paymentMethod],['v2ProductPrefix',pr.codePrefix],['v2MinStock',pr.defaultMinimumStock],['v2DefaultUnit',pr.defaultUnitId],['v2TaxRate',f.taxRate],['v2MaxDiscount',f.maxDiscount],['v2FinRound',f.rounding],['v2Theme',a.theme],['v2Calendar',a.calendar],['v2Font',a.fontScale],['v2BackupPath',b.path],['v2BackupFrequency',b.frequency]].forEach(([id,v]) => val(id,v)); [['v2Color',p.color],['v2ShowLogo',p.showLogo],['v2ShowInfo',p.showStoreInfo],['v2ShowDiscount',p.showDiscount],['v2ShowTax',p.showTax],['v2Preview',p.previewBeforePrint],['v2ShowPrintDialog',p.showPrintDialog],['v2AutoSale',p.autoPrintSale],['v2AutoPurchase',p.autoPrintPurchase],['v2CurSep',c.separator],['v2Oversell',sl.preventOversell],['v2AutoDate',sl.autoDate],['v2RequireBarcode',pr.requireBarcode],['v2Negative',pr.allowNegativeStock],['v2LowStock',pr.warnLowStock],['v2Fractional',pr.allowFractional],['v2TaxEnabled',f.taxEnabled],['v2TaxAfter',f.taxAfterDiscount],['v2Notify',a.notifications],['v2Shortcuts',a.shortcuts],['v2BackupAuto',b.auto]].forEach(([id,v]) => chk(id,v)); managementState.units = await window.api.units.list(); renderUnits(); loadPrinters(p.printerName); $('#v2LogoLabel').textContent = s.logoPath || '\u0644\u0648\u06af\u0648\u06cc\u06cc \u0627\u0646\u062a\u062e\u0627\u0628 \u0646\u0634\u062f\u0647'; };
  const collect = () => ({ ...settings, store: { name: $('#v2Name').value, slogan: $('#v2Slogan').value, phone: $('#v2Phone').value, postalCode: $('#v2Postal').value, address: $('#v2Address').value, website: $('#v2Website').value, instagram: $('#v2Instagram').value, rubika: $('#v2Rubika').value, footer: $('#v2Footer').value, logoPath: $('#v2Logo').value }, print: { printerName: $('#v2Printer').value, paperSize: $('#v2Paper').value, copies: Number($('#v2Copies').value || 1), margin: $('#v2Margin').value, color: $('#v2Color').checked, showLogo: $('#v2ShowLogo').checked, showStoreInfo: $('#v2ShowInfo').checked, showDiscount: $('#v2ShowDiscount').checked, showTax: $('#v2ShowTax').checked, previewBeforePrint: $('#v2Preview').checked, showPrintDialog: $('#v2ShowPrintDialog').checked, autoPrintSale: $('#v2AutoSale').checked, autoPrintPurchase: $('#v2AutoPurchase').checked }, currency: { code: $('#v2CurCode').value, name: $('#v2CurName').value, symbol: $('#v2CurSymbol').value, position: $('#v2CurPosition').value, decimals: Number($('#v2CurDecimals').value || 0), separator: $('#v2CurSep').checked, rounding: $('#v2CurRound').value, inputUnit: $('#v2CurInput').value }, sales: { defaultPriceType: $('#v2PriceType').value, defaultTax: Number($('#v2SaleTax').value || 0), preventOversell: $('#v2Oversell').checked, invoicePrefix: $('#v2InvoicePrefix').value, paymentMethod: $('#v2Payment').value, autoDate: $('#v2AutoDate').checked }, product: { codePrefix: $('#v2ProductPrefix').value, defaultMinimumStock: Number($('#v2MinStock').value || 0), defaultUnitId: $('#v2DefaultUnit').value, requireBarcode: $('#v2RequireBarcode').checked, allowNegativeStock: $('#v2Negative').checked, warnLowStock: $('#v2LowStock').checked, allowFractional: $('#v2Fractional').checked }, financial: { taxRate: Number($('#v2TaxRate').value || 0), maxDiscount: Number($('#v2MaxDiscount').value || 0), rounding: $('#v2FinRound').value, taxEnabled: $('#v2TaxEnabled').checked, taxAfterDiscount: $('#v2TaxAfter').checked }, appearance: { theme: $('#v2Theme').value, calendar: $('#v2Calendar').value, fontScale: Number($('#v2Font').value || 100), notifications: $('#v2Notify').checked, shortcuts: $('#v2Shortcuts').checked }, backup: { path: $('#v2BackupPath').value, frequency: $('#v2BackupFrequency').value, auto: $('#v2BackupAuto').checked } });
  const save = async () => {
    const payload = collect();
    payload.print.orientation = $('#v2Orientation')?.value || 'portrait';
    payload.print.showUnit = $('#v2ShowUnit')?.checked !== false;
    settings = await window.api.settings.save(payload);
    const appearance = settings.appearance || {};
    applyAppearanceSettings(appearance);
    if (settings.currency) {
      uiCurrency = { ...uiCurrency, ...settings.currency };
      await refreshCurrencyDisplays();
    }
    const configuredMethod = settings.sales?.paymentMethod;
    if (['cash', 'card', 'check'].includes(configuredMethod)) defaultSettlementMethod = configuredMethod;
    showToast('\u062a\u0645\u0627\u0645 \u062a\u0646\u0638\u06cc\u0645\u0627\u062a \u0630\u062e\u06cc\u0631\u0647 \u0634\u062f.');
  };
  document.querySelectorAll('.settings-tab').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('.settings-tab,.settings-panel').forEach((n) => n.classList.remove('active')); tab.classList.add('active'); $(`[data-settings-panel="${tab.dataset.settingsTab}"]`).classList.add('active'); }));
  document.querySelectorAll('#settingsPage form').forEach((form) => form.addEventListener('submit', (e) => { e.preventDefault(); save().catch((err) => showToast(err.message, true)); }));
  $('#saveAllSettings').addEventListener('click', () => save().catch((err) => showToast(err.message, true)));
  $('#v2ChooseLogo').addEventListener('click', async () => { const r = await window.api.settings.chooseLogo(); if (!r.canceled) { $('#v2Logo').value = r.path; $('#v2LogoLabel').textContent = r.path; } });
  $('#v2ChooseBackup').addEventListener('click', async () => { const r = await window.api.settings.chooseBackupPath(); if (!r.canceled) $('#v2BackupPath').value = r.path; });
  $('#v2BackupNow').addEventListener('click', async () => { try { const r = await window.api.settings.backupNow($('#v2BackupPath').value); showToast(`\u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc \u0630\u062e\u06cc\u0631\u0647 \u0634\u062f: ${r.path}`); } catch (e) { showToast(e.message, true); } });
  $('#v2Unit').addEventListener('submit', async (e) => { e.preventDefault(); try { const p = { name: $('#v2UnitName').value, symbol: $('#v2UnitSymbol').value, decimals: Number($('#v2UnitDecimals').value || 0), conversionFactor: Number($('#v2UnitFactor').value || 1), allowFraction: $('#v2UnitFraction').checked }; const id = $('#v2UnitId').value; if (id) await window.api.units.update(Number(id), p); else await window.api.units.create(p); $('#v2Unit').reset(); $('#v2UnitFactor').value = 1; $('#v2UnitId').value = ''; managementState.units = await window.api.units.list(); renderUnits(); showToast('\u0648\u0627\u062d\u062f \u0630\u062e\u06cc\u0631\u0647 \u0634\u062f.'); } catch (e) { showToast(e.message, true); } });
  $('#v2UnitCancel').addEventListener('click', () => { $('#v2Unit').reset(); $('#v2UnitId').value = ''; $('#v2UnitFactor').value = 1; });
  $('#settingsPage').addEventListener('click', (e) => { const b = e.target.closest('.v2-edit-unit'); if (!b) return; const u = managementState.units.find((x) => x.id === Number(b.dataset.id)); if (!u) return; $('#v2UnitId').value = u.id; $('#v2UnitName').value = u.name; $('#v2UnitSymbol').value = u.symbol || ''; $('#v2UnitDecimals').value = u.decimals || 0; $('#v2UnitFactor').value = u.conversionFactor || 1; $('#v2UnitFraction').checked = Boolean(u.allowFraction); });
  load().then(() => {
    $('#v2Orientation').value = settings.print?.orientation || 'portrait';
    $('#v2ShowUnit').checked = settings.print?.showUnit !== false;
  }).catch((e) => showToast(e.message, true));
}
initializeSettingsPage = initializeSettingsPageV2;
initializeSettingsPageV2();
window.api.settings.get().then((settings) => {
  applyAppearanceSettings(settings.appearance || {});
  if (settings.currency) uiCurrency = { ...uiCurrency, ...settings.currency };
  const configuredMethod = settings.sales?.paymentMethod;
  if (['cash', 'card', 'check'].includes(configuredMethod)) defaultSettlementMethod = configuredMethod;
  applyDefaultPaymentMethod(document);
}).catch(() => {});

function applyDefaultPaymentMethod(root = document) {
  root.querySelectorAll?.('.payment-method,#detailPaymentMethod').forEach((select) => {
    if (['cash', 'card', 'check'].includes(defaultSettlementMethod)) select.value = defaultSettlementMethod;
    if (select.id === 'detailPaymentMethod') $('#detailCheckFields')?.classList.toggle('hidden', select.value !== 'check');
  });
}

function printPaymentReceipt(invoice, payment) {
  document.querySelector('#paymentReceipt')?.remove();
  const receipt = document.createElement('section');
  receipt.id = 'paymentReceipt';
  receipt.className = 'payment-receipt';
  const party = invoice.partyName || 'بدون طرف حساب';
  const methodLabel = payment.method === 'card' ? 'کارت' : payment.method === 'check' ? `چک ${payment.checkNumber || ''}` : 'نقدی';
  receipt.innerHTML = `<div class="payment-receipt-heading"><h2>رسید پرداخت</h2><small>Acclectron</small></div><div class="payment-receipt-row"><span>شماره فاکتور</span><strong>${esc(invoice.invoice_number || '')}</strong></div><div class="payment-receipt-row"><span>طرف حساب</span><strong>${esc(party)}</strong></div><div class="payment-receipt-row"><span>تاریخ</span><strong>${isoToJalali(new Date().toISOString().slice(0, 10))}</strong></div><div class="payment-receipt-row"><span>روش پرداخت</span><strong>${esc(methodLabel)}</strong></div><div class="payment-receipt-total"><span>مبلغ پرداختی</span><strong>${money(payment.amount)}</strong></div><p>این رسید بابت تسویه فاکتور صادر شده است.</p></section>`;
  document.body.append(receipt);
  document.body.classList.add('printing-payment-receipt');
  const cleanup = () => {
    receipt.remove();
    document.body.classList.remove('printing-payment-receipt');
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
  setTimeout(cleanup, 15000);
}

const faDigits = (value) => String(value ?? '').replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
function invoicePrintMarkup(invoice, settings, kind = 'sale') {
  const store = settings.store || {};
  const print = settings.print || {};
  const paperSize = ['A4', 'A5', '80mm', '58mm'].includes(String(print.paperSize)) ? String(print.paperSize) : 'A4';
  const orientation = ['portrait', 'landscape'].includes(String(print.orientation)) ? String(print.orientation) : 'portrait';
  const isPurchase = kind === 'purchase';
  const invoiceTitle = isPurchase ? 'فاکتور خرید' : 'فاکتور فروش';
  const showUnit = print.showUnit !== false;
  const showDiscount = print.showDiscount !== false;
  const visibleColumns = 5 + (showUnit ? 1 : 0) + (showDiscount ? 1 : 0);
  const number = (value) => faDigits(value);
  const rows = (invoice.items || []).map((item, index) => `<tr>
    <td>${number(index + 1)}</td>
    <td class="product-name"><strong>${number(esc(item.productName || ''))}</strong><small>${number(esc(item.productCode || ''))}</small></td>
    ${showUnit ? `<td>${number(esc(item.unitName || item.unitSymbol || 'عدد'))}</td>` : ''}
    <td>${number(new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(Number(item.quantity || 0)))}</td>
    <td>${money(item.unit_price)}</td>
    ${showDiscount ? `<td>${money(item.discount)}</td>` : ''}
    <td>${money(item.total)}</td>
  </tr>`).join('');
  const logoUrl = store.logoPath ? encodeURI(`file:///${String(store.logoPath).replace(/\\/g, '/')}`) : '';
  const logo = logoUrl ? `<img class="invoice-print-logo" src="${esc(logoUrl)}" alt="لوگو">` : '';
  const storeInfo = print.showStoreInfo !== false ? `<section class="invoice-print-store-info invoice-print-store-info-bottom"><div><b>تلفن:</b> ${number(esc(store.phone || '—'))}</div><div><b>کد پستی:</b> ${number(esc(store.postalCode || '—'))}</div><div class="wide"><b>آدرس:</b> ${number(esc(store.address || '—'))}</div></section>` : '';
  const margin = ['narrow', 'normal', 'wide'].includes(String(print.margin)) ? String(print.margin) : 'normal';
  return `<article class="invoice-print-sheet paper-${paperSize.replace(/[^a-zA-Z0-9]/g, '')} orientation-${orientation} margin-${margin}" dir="rtl">
    <header class="invoice-print-header">
      <div class="invoice-print-logo-side">${print.showLogo !== false ? logo : ''}</div>
      <div class="invoice-print-store-centered"><h1>${number(esc(store.name || 'فروشگاه'))}</h1>${store.slogan ? `<p>${number(esc(store.slogan))}</p>` : ''}</div>
      <div class="invoice-print-title"><h2>${invoiceTitle}</h2><div>شماره: <strong>${number(esc(invoice.invoice_number || ''))}</strong></div><div>تاریخ: <strong>${number(isoToJalali(invoice.date))}</strong></div></div>
    </header>
    <section class="invoice-print-customer"><div><b>طرف حساب:</b> ${number(esc(invoice.partyName || 'بدون طرف حساب'))}</div><div><b>تلفن:</b> ${number(esc(invoice.partyPhone || '—'))}</div><div><b>آدرس:</b> ${number(esc(invoice.partyAddress || '—'))}</div></section>
    <table class="invoice-print-items columns-${visibleColumns} ${showUnit ? 'has-unit' : 'no-unit'} ${showDiscount ? 'has-discount' : 'no-discount'}"><thead><tr><th>ردیف</th><th>شرح کالا</th>${showUnit ? '<th>واحد</th>' : ''}<th>تعداد</th><th>قیمت واحد</th>${showDiscount ? '<th>تخفیف</th>' : ''}<th>مبلغ کل</th></tr></thead><tbody>${rows || `<tr><td colspan="${visibleColumns}">قلمی ثبت نشده است.</td></tr>`}</tbody></table>
    <section class="invoice-print-summary"><div><span>جمع کالاها</span><strong>${money(Number(invoice.subtotal || 0))}</strong></div>${showDiscount ? `<div><span>تخفیف کل</span><strong>${money(Number(invoice.discount || 0))}</strong></div>` : ''}${print.showTax !== false ? `<div><span>مالیات</span><strong>${money(Number(invoice.tax || 0))}</strong></div>` : ''}<div class="grand"><span>مبلغ نهایی</span><strong>${money(Number(invoice.total || 0))}</strong></div><div><span>مبلغ پرداختی</span><strong>${money(Number(invoice.paid_amount || 0))}</strong></div><div><span>مانده</span><strong>${money(Number(invoice.remaining_amount || 0))}</strong></div></section>
    ${storeInfo}
    <footer class="invoice-print-footer">${number(esc(store.footer || 'از خرید شما سپاسگزاریم.'))}</footer>
  </article>`;
}

function invoicePrintPageStyle(settings, heightMm) {
  const print = settings.print || {};
  const paper = ['A4', 'A5', '80mm', '58mm'].includes(String(print.paperSize)) ? String(print.paperSize) : 'A4';
  const orientation = ['portrait', 'landscape'].includes(String(print.orientation)) ? String(print.orientation) : 'portrait';
  const sizes = { A4: [210, 297], A5: [148, 210], '80mm': [80, heightMm || 200], '58mm': [58, heightMm || 200] };
  let [width, height] = sizes[paper];
  if (orientation === 'landscape' && paper !== '80mm' && paper !== '58mm') [width, height] = [height, width];
  return `@page{size:${width}mm ${height}mm;margin:0}`;
}

function syncInvoicePrintPageStyle(settings, heightMm) {
  let style = document.querySelector('#invoicePrintPageStyle');
  if (!style) {
    style = document.createElement('style');
    style.id = 'invoicePrintPageStyle';
    document.head.append(style);
  }
  style.textContent = invoicePrintPageStyle(settings, heightMm);
}

function invoicePrintPayload(settings) {
  const sheet = document.querySelector('.invoice-print-sheet');
  const print = settings.print || {};
  const paper = String(print.paperSize || 'A4');
  if (!sheet || !['80mm', '58mm'].includes(paper)) return {};
  const heightMm = Math.max(40, Math.ceil((sheet.scrollHeight * 25.4) / 96 + 2));
  syncInvoicePrintPageStyle(settings, heightMm);
  return { contentHeightMicrons: Math.ceil(heightMm * 1000) };
}
const afterPaint = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function openInvoicePrintPreview(kind, id) {
  const [invoice, settings] = await Promise.all([window.api.invoices.details(kind, id), window.api.settings.get()]);
  if (settings.currency) uiCurrency = { ...uiCurrency, ...settings.currency };
  const previousPrintZoom = document.documentElement.style.zoom;
  document.querySelector('#invoicePrintPreviewBackdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.id = 'invoicePrintPreviewBackdrop';
  backdrop.className = 'modal-backdrop invoice-print-preview-backdrop';
  const invoiceTitle = kind === 'purchase' ? 'فاکتور خرید' : 'فاکتور فروش';
  backdrop.innerHTML = `<div class="modal invoice-print-preview-modal"><div class="modal-header"><div><span class="eyebrow">پیش‌نمایش چاپ</span><h3>${invoiceTitle}</h3></div><div class="invoice-preview-actions"><label class="invoice-preview-setting">کاغذ<select class="invoice-preview-paper"><option value="A4">A4</option><option value="A5">A5</option><option value="80mm">رول ۸۰</option><option value="58mm">رول ۵۸</option></select></label><label class="invoice-preview-setting">جهت<select class="invoice-preview-orientation"><option value="portrait">عمودی</option><option value="landscape">افقی</option></select></label><button type="button" class="secondary invoice-preview-pdf">PDF</button><button type="button" class="secondary invoice-preview-print">چاپ</button><button type="button" class="modal-close invoice-preview-close">×</button></div></div><div class="invoice-print-preview-content">${invoicePrintMarkup(invoice, settings, kind)}</div></div>`;
  document.body.append(backdrop);
  const paperSelect = backdrop.querySelector('.invoice-preview-paper');
  const orientationSelect = backdrop.querySelector('.invoice-preview-orientation');
  paperSelect.value = settings.print?.paperSize || 'A4';
  orientationSelect.value = settings.print?.orientation || 'portrait';
  syncInvoicePrintPageStyle(settings);
  const rerender = () => {
    settings.print = { ...(settings.print || {}), paperSize: paperSelect.value, orientation: orientationSelect.value };
    backdrop.querySelector('.invoice-print-preview-content').innerHTML = invoicePrintMarkup(invoice, settings, kind);
    syncInvoicePrintPageStyle(settings);
  };
  paperSelect.addEventListener('change', rerender);
  orientationSelect.addEventListener('change', rerender);
  const setPrintMode = (enabled) => {
    if (enabled) {
      document.documentElement.style.zoom = '1';
      document.body.style.zoom = '1';
      document.body.classList.add('printing-invoice');
    } else {
      document.documentElement.style.zoom = previousPrintZoom;
      document.body.style.zoom = '';
      document.body.classList.remove('printing-invoice');
    }
  };
  const close = () => {
    backdrop.remove();
    setPrintMode(false);
    document.querySelector('#invoicePrintPageStyle')?.remove();
  };
  backdrop.querySelector('.invoice-preview-close').addEventListener('click', close);
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  backdrop.querySelector('.invoice-preview-print').addEventListener('click', () => {
    setPrintMode(true);
    afterPaint().then(() => window.api.print.invoice({ print: settings.print, ...invoicePrintPayload(settings) }))
      .then(close)
      .catch((error) => {
        setPrintMode(false);
        showToast(error.message || 'چاپ فاکتور انجام نشد.', true);
      });
  });
  backdrop.querySelector('.invoice-preview-pdf').addEventListener('click', () => {
    setPrintMode(true);
    afterPaint().then(() => window.api.print.invoicePdf({ print: settings.print, fileName: `${invoiceTitle}-${faDigits(invoice.invoice_number || '')}`, ...invoicePrintPayload(settings) }))
      .then((result) => {
        setPrintMode(false);
        if (!result?.canceled) showToast(`PDF ذخیره شد: ${result.filePath}`);
      })
      .catch((error) => {
        setPrintMode(false);
        showToast(error.message || 'خروجی PDF ساخته نشد.', true);
      });
  });
}

/* Keyboard-first invoice editor. It intentionally replaces the original
   card-based sales view while keeping the same IPC contract. */
function invoiceMarkup(kind) {
  const sale = kind === 'sale';
  const id = sale ? 'sale' : 'purchase';
  return `<div class="page-heading"><div><span class="eyebrow">عملیات ${sale ? 'فروش' : 'خرید'}</span><h2>فاکتور ${sale ? 'فروش' : 'خرید'}</h2></div><label class="sale-date-field">تاریخ<input class="invoice-date" id="${id}Date" type="date"></label></div>
  <div class="invoice-layout"><section class="panel invoice-editor"><div class="invoice-toolbar"><label>${sale ? 'مشتری' : 'تأمین‌کننده'}<input class="party-input" data-kind="${kind}" id="${id}Party" placeholder="جست‌وجو..." autocomplete="off"><div class="party-suggestions hidden" id="${id}PartySuggestions"></div></label><button type="button" class="secondary invoice-new-row" data-kind="${kind}">＋ ردیف جدید</button></div>
  <div class="table-wrap invoice-table-wrap"><table class="invoice-table"><thead><tr><th>محصول</th><th>تعداد</th><th>قیمت واحد</th><th>تخفیف</th><th>مبلغ کل</th><th></th></tr></thead><tbody id="${id}InvoiceItems"></tbody></table></div>
  <div id="${id}InvoiceError" class="form-error hidden"></div><div class="shortcut-guide"><span>راهنما</span><kbd>↑↓</kbd> پیمایش <kbd>Enter</kbd> انتخاب/مرحله بعد <kbd>Tab</kbd> پرداخت <kbd>Ctrl+Delete</kbd> حذف ردیف <kbd>Ctrl+Enter</kbd> ثبت <kbd>Esc</kbd> بستن پیشنهادها</div></section>
  <aside class="panel invoice-summary"><h3>خلاصه فاکتور</h3><div class="summary-lines"><div><span>جمع کالاها</span><strong id="${id}Subtotal">${money(0)}</strong></div><div><span>تخفیف</span><input class="money-input invoice-discount" id="${id}Discount" value="0" inputmode="decimal"></div><div><span>مالیات</span><input class="money-input invoice-tax" id="${id}Tax" value="0" inputmode="decimal"></div><div class="grand-total"><span>مبلغ نهایی</span><strong id="${id}Total">${money(0)}</strong></div></div>
  <div class="payment-box"><div class="payment-heading"><h4>پرداخت</h4><button type="button" class="text-button payment-full" data-kind="${kind}">تسویه کامل</button></div><div class="payment-entry"><select class="payment-method" id="${id}PaymentMethod"><option value="cash">نقدی</option><option value="card">کارت</option><option value="check">چک</option></select><input class="money-input payment-amount" id="${id}PaymentAmount" value="0" inputmode="decimal" placeholder="مبلغ"></div><div class="check-fields hidden" id="${id}CheckFields"><input id="${id}CheckNumber" placeholder="شماره چک"><input id="${id}BankName" placeholder="بانک"><input id="${id}DueDate" type="date"></div><button class="ghost add-payment" data-kind="${kind}" type="button">＋ افزودن پرداخت</button><div class="payment-list" id="${id}Payments"></div></div><div class="summary-lines"><div class="remaining"><span>مانده</span><strong id="${id}Remaining">${money(0)}</strong></div></div><button class="primary wide invoice-save" data-kind="${kind}" type="button">ثبت فاکتور</button><button class="secondary wide invoice-print" data-kind="${kind}" type="button">ثبت و چاپ</button><button class="text-button invoice-clear" data-kind="${kind}" type="button">پاک‌کردن فاکتور</button></aside></div>`;
}

function newInvoiceItem(kind) {
  return { query: '', productId: null, name: '', code: '', stock: 0, quantity: 1, unitPrice: 0, discount: 0, priceType: kind === 'sale' ? 'retail' : 'purchase' };
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
  if (nav && !nav.querySelector('.invoice-menu')) nav.insertAdjacentHTML('beforeend', `<div class="invoice-menu"><button type="button" class="nav-item invoice-menu-toggle" aria-expanded="false"><span>▤</span><span class="nav-label">فاکتورها</span><span class="invoice-menu-chevron">⌄</span></button><div class="invoice-submenu hidden"><button class="nav-item invoice-submenu-item" data-page="sales-invoice"><span>＋</span><span class="nav-label">ثبت فاکتور فروش</span></button><button class="nav-item invoice-submenu-item" data-page="purchases"><span>↙</span><span class="nav-label">ثبت فاکتور خرید</span></button><button class="nav-item invoice-submenu-item" data-page="sales-invoices"><span>☷</span><span class="nav-label">فاکتورهای فروش</span></button><button class="nav-item invoice-submenu-item" data-page="purchase-invoices"><span>☷</span><span class="nav-label">فاکتورهای خرید</span></button></div></div>`);
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
  return `<section id="${pageKey}InvoicesPage" class="page hidden invoice-list-page"><div class="page-heading"><div><span class="eyebrow">مدیریت سوابق</span><h2>فاکتورهای ${sale ? 'فروش' : 'خرید'}</h2></div><button class="primary" data-page="${sale ? 'sales-invoice' : 'purchases'}">＋ فاکتور جدید</button></div><div class="panel invoice-list-filters"><input class="invoice-list-query" data-kind="${kind}" placeholder="جست‌وجوی شماره، طرف‌حساب یا تلفن"><input class="invoice-list-from" data-kind="${kind}" placeholder="از تاریخ شمسی"><input class="invoice-list-to" data-kind="${kind}" placeholder="تا تاریخ شمسی"><select class="invoice-list-status" data-kind="${kind}"><option value="">همه وضعیت‌ها</option><option value="${sale ? 'active' : 'completed'}">دارای مانده/فعال</option><option value="cancelled">لغوشده</option></select></div><div class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>شماره</th><th>تاریخ</th><th>طرف‌حساب</th><th>مبلغ کل</th><th>پرداخت‌شده</th><th>مانده</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody id="${kind}Table"></tbody></table></div></div></section>`;
}

function invoiceListKindToApi(kind) { return kind === 'sales' ? 'sale' : 'purchase'; }
function invoiceListPageSelector(kind) { return `#${kind === 'purchases' ? 'purchase' : kind}InvoicesPage`; }
function invoiceStatusLabel(status, row = {}) {
  if (status === 'cancelled') return 'لغوشده';
  if (Number(row.remainingAmount || 0) === 0) return 'تسویه‌شده';
  return 'دارای مانده';
}
async function loadInvoiceList(kind) {
  const apiKind = invoiceListKindToApi(kind);
  const pageSelector = invoiceListPageSelector(kind);
  const query = $(`${pageSelector} .invoice-list-query`)?.value || '';
  const fromValue = $(`${pageSelector} .invoice-list-from`)?.value || '';
  const toValue = $(`${pageSelector} .invoice-list-to`)?.value || '';
  const rows = await (apiKind === 'sale' ? window.api.sales.list : window.api.purchases.list)({ query, from: jalaliInputToIso(fromValue), to: jalaliInputToIso(toValue), status: $(`${pageSelector} .invoice-list-status`)?.value || '' });
  const body = $(`#${kind}Table`);
  body.innerHTML = rows.length ? rows.map((row) => `<tr><td><strong>${esc(row.invoiceNumber)}</strong></td><td>${isoToJalali(row.date)}</td><td>${apiKind === 'sale' && row.source === 'daily' ? '<span class="daily-sale-party">فروش روزانه</span>' : esc(row.partyName || 'بدون طرف‌حساب')}</td><td>${money(row.total)}</td><td>${money(row.paidAmount)}</td><td class="${row.remainingAmount > 0 ? 'debt-amount' : ''}">${money(row.remainingAmount)}</td><td><span class="status-badge ${row.status === 'cancelled' ? 'inactive' : row.remainingAmount > 0 ? 'warning' : 'active'}">${invoiceStatusLabel(row.status, row)}</span></td><td><button class="table-action view-invoice" data-kind="${apiKind}" data-id="${row.id}">مشاهده</button><button class="table-action print-invoice" data-kind="${apiKind}" data-id="${row.id}">چاپ</button>${row.remainingAmount > 0 && row.status !== 'cancelled' ? `<button class="table-action settle-invoice" data-kind="${apiKind}" data-id="${row.id}">تسویه</button>` : ''}${row.status !== 'cancelled' ? `<button class="table-action danger cancel-invoice" data-kind="${apiKind}" data-id="${row.id}">لغو</button>` : ''}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="8">فاکتوری برای نمایش وجود ندارد.</td></tr>';
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

function bindInvoiceLists() {
  ['sales', 'purchases'].forEach((kind) => {
    const page = $(invoiceListPageSelector(kind));
    ['input', 'change'].forEach((eventName) => page.addEventListener(eventName, () => loadInvoiceList(kind)));
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
        if (!confirm(`مانده ${money(invoice.remaining_amount)} با روش ${method === 'card' ? 'کارت' : method === 'check' ? 'چک' : 'نقدی'} تسویه شود؟`)) return;
        await window.api.invoices.settle(fullSettle.dataset.kind, Number(fullSettle.dataset.id), { method, amount });
        $('#invoiceDetailsBackdrop').classList.add('hidden');
        showToast('فاکتور به‌طور کامل تسویه شد.');
        if (confirm('رسید پرداخت چاپ شود؟')) printPaymentReceipt(invoice, { method, amount: Number(invoice.remaining_amount || 0) });
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
    const view = event.target.closest('.view-invoice');
    if (view) { try { await openInvoiceDetails(view.dataset.kind, Number(view.dataset.id)); } catch (error) { showToast(error.message || 'جزئیات فاکتور بارگذاری نشد.', true); } return; }
    const settle = event.target.closest('.settle-invoice');
    if (settle) { try { await openInvoiceDetails(settle.dataset.kind, Number(settle.dataset.id)); } catch (error) { showToast(error.message || 'فاکتور بارگذاری نشد.', true); } return; }
    const cancel = event.target.closest('.cancel-invoice');
    if (cancel && confirm('این فاکتور لغو شود؟ موجودی و مانده حساب اصلاح خواهد شد.')) {
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
  body.innerHTML = state.items.map((item, index) => `<tr data-index="${index}"><td class="product-cell"><input class="invoice-product-input" data-kind="${kind}" data-index="${index}" value="${esc(item.query || item.name)}" placeholder="نام، کد یا بارکد" autocomplete="off"><div class="invoice-suggestions hidden"></div>${item.name ? `<small>${esc(item.code)} · موجودی ${item.stock}</small>` : ''}</td><td><input class="invoice-quantity" data-kind="${kind}" data-index="${index}" type="number" min="1" step="1" value="${Math.max(1, Math.round(Number(item.quantity) || 1))}"></td><td class="price-cell"><select class="invoice-price-combo" data-kind="${kind}" data-index="${index}"><option value="retail" ${item.priceType === 'retail' ? 'selected' : ''}>فروش — ${money(item.retailPrice || item.unitPrice)}</option><option value="wholesale" ${item.priceType === 'wholesale' ? 'selected' : ''} ${item.wholesalePrice > 0 ? '' : 'disabled'}>عمده — ${money(item.wholesalePrice || 0)}</option>${kind === 'purchase' ? `<option value="purchase" ${item.priceType === 'purchase' ? 'selected' : ''}>خرید — ${money(item.purchasePrice || item.unitPrice)}</option>` : ''}<option value="custom" ${!['retail', 'wholesale', 'purchase'].includes(item.priceType) ? 'selected' : ''}>قیمت دستی</option></select><input class="invoice-price-custom ${['retail', 'wholesale', 'purchase'].includes(item.priceType) ? 'hidden' : ''}" data-kind="${kind}" data-index="${index}" type="text" inputmode="decimal" value="${formatPriceInput(item.unitPrice)}" placeholder="قیمت دستی"></td><td><input class="invoice-discount-line" data-kind="${kind}" data-index="${index}" type="text" inputmode="decimal" value="${formatPriceInput(item.discount)}"></td><td class="line-total" tabindex="0">${money(Math.max(0, item.quantity * item.unitPrice - item.discount))}</td><td><button class="delete-line" data-kind="${kind}" data-index="${index}" title="حذف">×</button></td></tr>`).join('');
  if (focus) { const node = body.querySelector(`[data-index="${focus.index}"] .${focus.className}`); if (node) { node.focus(); node.select?.(); } }
}

function keyboardInvoiceTotals(kind) {
  const state = invoiceState[kind];
  const subtotal = state.items.reduce((sum, item) => sum + Math.max(0, item.quantity * item.unitPrice - item.discount), 0);
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
  box.innerHTML = rows.map((p) => `<button type="button" class="invoice-suggestion" data-kind="${kind}" data-index="${index}" data-id="${p.id}"><span>${esc(p.name)}<small>${esc(p.code)} · موجودی ${p.stock}</small></span><b>${money(kind === 'purchase' ? p.purchasePrice : p.salePrice)}</b></button>`).join('');
  box.classList.toggle('hidden', !rows.length);
}

function chooseKeyboardProduct(kind, index, product) {
  if (!product) return; const item = invoiceState[kind].items[index];
  Object.assign(item, { productId: product.id, name: product.name, code: product.code, query: product.name, stock: product.stock, retailPrice: product.salePrice, wholesalePrice: product.wholesalePrice, purchasePrice: product.purchasePrice, unitPrice: kind === 'purchase' ? product.purchasePrice : product.salePrice, priceType: kind === 'purchase' ? 'purchase' : 'retail' });
  const duplicate = invoiceState[kind].items.findIndex((candidate, candidateIndex) => candidateIndex !== index && candidate.productId === item.productId && candidate.unitPrice === item.unitPrice);
  if (duplicate >= 0) {
    invoiceState[kind].items[duplicate].quantity += item.quantity || 1;
    invoiceState[kind].items.splice(index, 1);
    renderKeyboardItems(kind, { index: duplicate, className: 'invoice-quantity' }); renderKeyboardSummary(kind); return;
  }
  renderKeyboardItems(kind, { index, className: 'invoice-quantity' }); renderKeyboardSummary(kind);
}

function addKeyboardRow(kind) { invoiceState[kind].items.push(newInvoiceItem(kind)); renderKeyboardItems(kind, { index: invoiceState[kind].items.length - 1, className: 'invoice-product-input' }); }

function addKeyboardPayment(kind) {
  const amount = parsePriceInput($(`#${kind}PaymentAmount`).value); const method = $(`#${kind}PaymentMethod`).value;
  if (!amount) return showToast('مبلغ پرداخت را وارد کنید.', true);
  if (method === 'check' && !$(`#${kind}CheckNumber`).value.trim()) return showToast('شماره چک را وارد کنید.', true);
  invoiceState[kind].payments.push({ method, amount, checkNumber: $(`#${kind}CheckNumber`).value, bankName: $(`#${kind}BankName`).value, dueDate: $(`#${kind}DueDate`).value });
  $(`#${kind}PaymentAmount`).value = '0'; $(`#${kind}CheckNumber`).value = ''; $(`#${kind}BankName`).value = ''; $(`#${kind}DueDate`).value = ''; renderKeyboardSummary(kind);
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
    const items = state.items.filter((item) => item.productId).map((item) => ({
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
    editor.addEventListener('input', (event) => {
      const t = event.target; const kind = t.dataset.kind; if (!kind) return; const item = invoiceState[kind].items[Number(t.dataset.index)];
      if (t.classList.contains('invoice-product-input')) { item.query = t.value; showKeyboardSuggestions(kind, Number(t.dataset.index)); }
      else if (t.classList.contains('invoice-quantity')) item.quantity = Math.max(1, Math.round(Number(t.value) || 1));
      else if (t.classList.contains('invoice-price-custom')) item.unitPrice = parsePriceInput(t.value);
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
      } else if (event.key === 'Enter' && t.classList.contains('invoice-quantity')) { event.preventDefault(); t.closest('tr').querySelector('.invoice-price')?.focus(); }
      else if (event.key === 'Enter' && (t.classList.contains('invoice-price-custom') || t.classList.contains('invoice-price-combo') || t.classList.contains('invoice-discount-line') || t.classList.contains('line-total'))) { event.preventDefault(); addKeyboardRow(kind); }
      if (event.ctrlKey && event.key === 'Delete') { event.preventDefault(); invoiceState[kind].items.splice(index, 1); if (!invoiceState[kind].items.length) invoiceState[kind].items.push(newInvoiceItem(kind)); renderKeyboardItems(kind); renderKeyboardSummary(kind); }
    });
    editor.addEventListener('change', (event) => {
      const combo = event.target.closest('.invoice-price-combo');
      if (!combo) return;
      const kind = combo.dataset.kind;
      const index = Number(combo.dataset.index);
      const item = invoiceState[kind]?.items[index];
      const custom = combo.closest('td')?.querySelector('.invoice-price-custom');
      if (!item || !custom) return;
      item.priceType = combo.value;
      if (combo.value === 'custom') {
        item.unitPrice = 0;
        custom.value = '';
        custom.classList.remove('hidden');
        requestAnimationFrame(() => { custom.focus(); });
      } else {
        item.unitPrice = combo.value === 'wholesale' ? item.wholesalePrice
          : combo.value === 'purchase' ? item.purchasePrice : item.retailPrice;
        custom.value = '';
        custom.classList.add('hidden');
      }
      renderKeyboardSummary(kind);
    });
    editor.addEventListener('click', (event) => {
      const s = event.target.closest('.invoice-suggestion'); if (s) { chooseKeyboardProduct(s.dataset.kind, Number(s.dataset.index), invoiceState[s.dataset.kind].products.find((p) => p.id === Number(s.dataset.id))); return; }
      const combo = event.target.closest('.invoice-price-combo'); if (combo) { const item = invoiceState[combo.dataset.kind].items[Number(combo.dataset.index)]; if (combo.value === 'custom') { item.priceType = 'custom'; item.unitPrice = 0; const custom = combo.closest('td').querySelector('.invoice-price-custom'); custom.value = ''; custom.classList.remove('hidden'); requestAnimationFrame(() => custom.focus()); } }
      const remove = event.target.closest('.delete-line'); if (remove) { const state = invoiceState[remove.dataset.kind]; state.items.splice(Number(remove.dataset.index), 1); if (!state.items.length) state.items.push(newInvoiceItem(remove.dataset.kind)); renderKeyboardItems(remove.dataset.kind); renderKeyboardSummary(remove.dataset.kind); }
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
  page.innerHTML = `<div class="page-heading"><div><span class="eyebrow">عملیات فروش</span></div><label class="sale-date-field">تاریخ فروش<input id="saleDate" type="date"></label></div><div class="sale-modern-layout"><section class="panel product-picker"><div class="picker-header"><div><h3>لیست محصولات</h3><small id="dailySalePriceHint">قیمت‌ها به ${currencyLabel()} نمایش داده می‌شوند.</small></div><div class="toolbar-search"><span>⌕</span><input id="saleProductFilter" placeholder="کلیدواژه: نام، کد یا بارکد"></div></div><div id="saleProductCards" class="product-cards"></div></section><aside class="panel modern-cart"><div class="cart-heading"><div><h3>سبد فروش</h3><small id="cartCount">۰ قلم</small></div><button id="clearSaleCart" class="danger-button" type="button">پاک کردن سبد</button></div><div class="table-wrap"><table><thead><tr><th>محصول</th><th id="dailySalePriceHeader">قیمت (${currencyLabel()})</th><th>تعداد</th><th></th></tr></thead><tbody id="modernSaleItems"></tbody></table></div><div class="cart-total"><span id="dailySaleTotalLabel">مبلغ کل (${currencyLabel()})</span><strong id="modernSaleTotal">${money(0)}</strong></div><div id="modernSaleError" class="form-error hidden"></div><button id="modernSaveSale" class="primary wide" type="button">ثبت فروش</button><button id="modernSaveSalePrint" class="secondary wide" type="button">ثبت و چاپ فاکتور رسمی</button></aside></div>`;
  $('#saleDate').type = 'text';
  $('#saleDate').inputMode = 'numeric';
  $('#saleDate').autocomplete = 'off';
  $('#saleDate').placeholder = '۱۴۰۵/۰۶/۰۸';
  $('#saleDate').value = isoToJalali(new Date().toISOString().slice(0, 10));
  page.dataset.dailyRestored = '1';
  refreshDailySaleCurrencyLabels();
  bindSalesEvents();
  bindJalaliDatePickers();
  loadSaleProducts();
}

function initializeSalesMarkup() { restoreDailySalesMarkup(); invoiceMarkupAndBind(); }
function setManagedPage(page) {
  initializeManagementMarkup();
  const titles = { dashboard: 'داشبورد', sales: 'فروش روزانه', 'sales-invoice': 'فاکتور فروش', purchases: 'فاکتور خرید', 'sales-invoices': 'فاکتورهای فروش', 'purchase-invoices': 'فاکتورهای خرید', products: 'مدیریت کالاها', categories: 'دسته‌بندی‌ها', customers: 'مدیریت مشتریان', reports: 'گزارش‌ها', settings: 'تنظیمات' };
  const view = page === 'customers' ? 'parties' : page;
  const pageId = view === 'sales-invoice' ? 'salesInvoice' : view === 'sales-invoices' ? 'salesInvoices' : view === 'purchase-invoices' ? 'purchaseInvoices' : view;
  ['dashboard', 'sales', 'salesInvoice', 'purchases', 'salesInvoices', 'purchaseInvoices', 'products', 'categories', 'parties', 'reports', 'placeholder'].forEach((id) => { const node = $(`#${id}Page`); if (node) node.classList.toggle('hidden', id !== pageId && !(id === 'placeholder' && !['dashboard', 'sales', 'salesInvoice', 'purchases', 'salesInvoices', 'purchaseInvoices', 'products', 'categories', 'parties', 'reports'].includes(pageId))); });
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
  if (page === 'sales-invoices') loadInvoiceList('sales'); if (page === 'purchase-invoices') loadInvoiceList('purchases');
  if (page === 'reports') loadSalesReport();
}

function initializeReportsPage() {
  if ($('#reportsPage')) return;
  const placeholder = $('#placeholderPage');
  if (!placeholder) return;
  placeholder.insertAdjacentHTML('beforebegin', `
    <section id="reportsPage" class="page hidden report-page">
      <div class="page-heading"><div><span class="eyebrow">تحلیل جامع فروش</span><h2>گزارش فروش و سود و زیان</h2></div>
        <button id="reportRefresh" class="secondary" type="button">به‌روزرسانی گزارش</button></div>
      <div class="panel report-filters">
        <label>از تاریخ<input id="reportFrom" class="report-date" type="date"></label>
        <label>تا تاریخ<input id="reportTo" class="report-date" type="date"></label>
        <label>نوع فروش<select id="reportSource"><option value="">همه فروش‌ها</option><option value="daily">فروش روزانه</option><option value="invoice">فاکتور فروش</option></select></label>
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
      <div class="report-grid">
        <section class="panel report-chart-panel"><div class="panel-heading"><h3>روند فروش و سود</h3><small>بر اساس روز</small></div><div id="reportTrendChart" class="report-chart"></div></section>
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
  const labels = points.map((p, i) => (i % Math.max(1, Math.ceil(points.length / 6)) === 0 ? `<text x="${x(i)}" y="${height - 8}" text-anchor="middle">${esc(/^\d{4}-\d{2}-\d{2}$/.test(String(p.date)) ? reportIsoToJalali(p.date).slice(5) : String(p.date))}</text>` : '')).join('');
  const legend = series.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('');
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img">${grid}${paths}${labels}</svg><div class="chart-legend">${legend}</div>`;
}

function reportSvgBars(container, rows, valueKey, labelKey, color = '#6ee7b7') {
  if (!container) return;
  if (!rows.length) { container.innerHTML = '<div class="empty-state compact">داده‌ای وجود ندارد.</div>'; return; }
  const max = Math.max(...rows.map((r) => Number(r[valueKey] || 0)), 1);
  container.innerHTML = `<div class="report-bars">${rows.slice(0, 8).map((row) => {
    const value = Number(row[valueKey] || 0);
    return `<div class="report-bar-row"><div class="report-bar-label"><span>${esc(String(row[labelKey] || '—'))}</span><strong>${money(value)}</strong></div><div class="report-bar-track"><i style="width:${Math.max(2, value / max * 100)}%;background:${color}"></i></div></div>`;
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
    const data = await window.api.reports.sales({ from: reportDateValue('reportFrom'), to: reportDateValue('reportTo'), source: $('#reportSource')?.value || '' });
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
    const daily = reportFillDates(data.byDate || []);
    reportSvgLine($('#reportTrendChart'), daily, [{ key: 'netSales', label: 'فروش خالص', color: '#6ee7b7' }, { key: 'profitTotal', label: 'سود', color: '#60a5fa' }]);
    const recent = daily.slice(-7);
    const avg = recent.length ? recent.reduce((sum, row) => sum + Number(row.netSales || 0), 0) / recent.length : 0;
    const forecast = Array.from({ length: 7 }, (_, i) => ({ date: `پیش‌بینی ${i + 1}`, netSales: avg, profitTotal: avg * (Number(s.profitTotal || 0) / Math.max(1, Number(s.netSales || 0))) }));
    reportSvgLine($('#reportForecastChart'), forecast, [{ key: 'netSales', label: 'فروش پیش‌بینی‌شده', color: '#fbbf24' }]);
    $('#reportForecastNote').textContent = recent.length >= 3 ? `میانگین ۷ روز اخیر: ${money(avg)} در روز` : 'داده کافی برای پیش‌بینی وجود ندارد';
    const sourceRows = (data.bySource || []).map((row) => ({ ...row, sourceLabel: row.source === 'daily' ? 'فروش روزانه' : 'فاکتور فروش' }));
    reportSvgBars($('#reportSourceChart'), sourceRows, 'netSales', 'sourceLabel', '#c084fc');
    reportSvgBars($('#reportProductChart'), data.byProduct || [], 'netSales', 'name');
    $('#reportDailyTable').innerHTML = daily.length ? `<table><thead><tr><th>تاریخ</th><th>فروش خالص</th><th>هزینه</th><th>سود</th><th>فاکتور</th></tr></thead><tbody>${daily.slice().reverse().map((row) => `<tr><td>${esc(reportIsoToJalali(row.date))}</td><td>${money(row.netSales)}</td><td>${money(row.costTotal)}</td><td class="${Number(row.profitTotal) < 0 ? 'negative' : ''}">${money(row.profitTotal)}</td><td>${Number(row.invoiceCount || 0)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state compact">داده‌ای وجود ندارد.</div>';
    $('#reportCustomerTable').innerHTML = (data.byCustomer || []).length ? `<table><thead><tr><th>مشتری</th><th>فروش</th><th>سود</th></tr></thead><tbody>${data.byCustomer.map((row) => `<tr><td>${esc(row.customerName)}</td><td>${money(row.total)}</td><td class="${Number(row.profitTotal) < 0 ? 'negative' : ''}">${money(row.profitTotal)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state compact">داده‌ای وجود ندارد.</div>';
  } catch (err) {
    error.textContent = err.message || 'دریافت گزارش ناموفق بود.';
    error.classList.remove('hidden');
  }
}

initializeReportsPage();

/* Daily-sales refinements: keep identical product/price rows together,
   accept keyboard prices with grouping separators, and persist Jalali dates. */
renderSaleCart = function renderDailySaleCart() {
  const body = $('#modernSaleItems');
  if (!body) return;
  body.innerHTML = saleState.cart.length
    ? saleState.cart.map((item, index) => `<tr><td><strong>${esc(item.name)}</strong><small>${item.priceType === 'wholesale' ? 'عمده' : 'فروش'}</small></td><td><input class="cart-price" data-index="${index}" type="text" inputmode="decimal" value="${formatPriceInput(item.unitPrice)}"></td><td><input class="cart-quantity" data-index="${index}" type="number" min="1" step="1" value="${item.quantity}"></td><td><button class="delete-line" data-index="${index}">×</button></td></tr>`).join('')
    : '<tr class="empty-row"><td colspan="4">برای شروع یکی از قیمت‌های محصول را انتخاب کنید.</td></tr>';
  $('#cartCount').textContent = `${new Intl.NumberFormat('fa-IR').format(saleState.cart.reduce((sum, item) => sum + item.quantity, 0))} قلم`;
  $('#modernSaleTotal').textContent = money(saleState.cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));
};

addSaleProduct = function addDailySaleProduct(id, unitPrice, priceType) {
  const product = saleState.products.find((p) => p.id === id);
  if (!product) return;
  const normalizedPrice = Math.max(0, Math.round(Number(unitPrice) || 0));
  const existing = saleState.cart.find((item) => item.productId === id && item.unitPrice === normalizedPrice);
  if (existing) existing.quantity += 1;
  else saleState.cart.push({ productId: id, name: product.name, unitPrice: normalizedPrice, quantity: 1, priceType });
  renderSaleCart();
  showToast('محصول به سبد فروش اضافه شد.');
};

bindSalesEvents = function bindDailySalesEvents() {
  let saleSearchTimer;
  $('#saleProductFilter')?.addEventListener('input', () => {
    clearTimeout(saleSearchTimer);
    saleSearchTimer = setTimeout(() => loadSaleProducts($('#saleProductFilter').value), 120);
  });
  $('#saleProductCards')?.addEventListener('click', (event) => {
    const button = event.target.closest('.add-daily-product');
    if (!button || button.disabled) return;
    const product = saleState.products.find((p) => p.id === Number(button.dataset.id));
    if (!product) return;
    const type = button.dataset.priceType;
    addSaleProduct(product.id, type === 'wholesale' ? product.wholesalePrice : product.salePrice, type);
  });
  $('#modernSaleItems')?.addEventListener('input', (event) => {
    const item = saleState.cart[Number(event.target.dataset.index)];
    if (!item) return;
    if (event.target.classList.contains('cart-price')) item.unitPrice = parsePriceInput(event.target.value);
    if (event.target.classList.contains('cart-quantity')) item.quantity = Math.max(1, Math.round(Number(event.target.value || 1)));
    $('#modernSaleTotal').textContent = money(saleState.cart.reduce((sum, row) => sum + row.unitPrice * row.quantity, 0));
  });
  $('#modernSaleItems')?.addEventListener('blur', (event) => {
    if (event.target.classList.contains('cart-price')) {
      const item = saleState.cart[Number(event.target.dataset.index)];
      if (item) event.target.value = formatPriceInput(item.unitPrice);
    }
  }, true);
  $('#modernSaleItems')?.addEventListener('click', (event) => {
    const button = event.target.closest('.delete-line');
    if (button) { saleState.cart.splice(Number(button.dataset.index), 1); renderSaleCart(); }
  });
  $('#clearSaleCart')?.addEventListener('click', () => {
    if (!saleState.cart.length) return showToast('سبد فروش خالی است.', true);
    saleState.cart = []; renderSaleCart(); showToast('سبد فروش پاک شد.');
  });
  const saveDailySale = async (print = false) => {
    const error = $('#modernSaleError'); error.classList.add('hidden');
    try {
      if (!saleState.cart.length) throw new Error('حداقل یک محصول به سبد اضافه کنید.');
      const date = jalaliInputToIso($('#saleDate').value);
      if (!date) throw new Error('تاریخ فروش را به صورت شمسی و معتبر وارد کنید.');
      const total = saleState.cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
      const result = await window.api.sales.create({
        items: saleState.cart.map((item) => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice / 100, discount: 0, priceType: item.priceType })),
        source: 'daily',
        paidAmount: total / 100,
        date
      });
      saleState.cart = []; renderSaleCart(); await loadSaleProducts(); await window.api.dashboard.summary().then(renderMetrics);
      if (!$('#reportsPage')?.classList.contains('hidden')) loadSalesReport();
      showToast(`فروش ${result.invoiceNumber} با موفقیت ثبت شد. سود: ${money(result.profitTotal)}`);
      if (print) await openInvoicePrintPreview('sale', result.id);
    } catch (err) { error.textContent = readableError(err, 'ثبت فروش انجام نشد.'); error.classList.remove('hidden'); }
  };
  $('#modernSaveSale')?.addEventListener('click', () => saveDailySale(false));
  $('#modernSaveSalePrint')?.addEventListener('click', () => saveDailySale(true));
};

const dailySalesNodes = ['saleProductFilter', 'saleProductCards', 'modernSaleItems', 'clearSaleCart', 'modernSaveSale', 'modernSaveSalePrint']
  .map((id) => document.getElementById(id)).filter(Boolean);
dailySalesNodes.forEach((node) => node.replaceWith(node.cloneNode(true)));
const dailySaleDate = $('#saleDate');
if (dailySaleDate) {
  dailySaleDate.type = 'text';
  dailySaleDate.inputMode = 'numeric';
  dailySaleDate.value = isoToJalali(new Date().toISOString().slice(0, 10));
}
bindSalesEvents();
bindJalaliDatePickers();
renderSaleCart();

// Confirmation is intentionally limited to actions that discard current work
// or make a record unavailable, while routine edits remain uninterrupted.
document.addEventListener('click', (event) => {
  const toggle = event.target.closest('.toggle-product,.toggle-category,.toggle-party');
  if (toggle?.dataset.active === '1') {
    const label = toggle.classList.contains('toggle-product')
      ? 'کالا'
      : toggle.classList.contains('toggle-category')
        ? 'دسته‌بندی'
        : 'طرف‌حساب';
    if (!confirm(`${label} غیرفعال شود؟ تا زمان فعال‌سازی دوباره، در عملیات جدید قابل انتخاب نخواهد بود.`)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    return;
  }

  if (event.target.closest('#clearSaleCart') && saleState.cart.length
    && !confirm('سبد فروش پاک شود؟ این مورد ثبت نشده و قابل بازگردانی نیست.')) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);
