import { renderer, registerRendererBindings } from '../shared/runtime.mjs';
import { localDateIso } from '../shared/date-utils.mjs';

/* Management screens are injected here so existing installations keep their
   original shell while gaining product/category CRUD without a migration. */
const managementState = { ready: false, products: [], categories: [], units: [], parties: [] };
let productModalInvoiceTarget = null;
const saleState = { products: [], cart: [] };
const invoiceState = {
  sale: { products: [], items: [], parties: [], party: null, payments: [], editingId: null, paymentDraft: { method: 'cash', amount: 0 } },
  purchase: { products: [], items: [], parties: [], party: null, payments: [], editingId: null, paymentDraft: { method: 'cash', amount: 0 } }
};
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const readableError = (error, fallback) => String(error?.message || fallback)
  .replace(/^Error invoking remote method '[^']+': Error:\s*/i, '').trim() || fallback;
const toman = (value) => renderer.formatCurrencyNumber(value, renderer.uiCurrency);
const parsePriceInput = (value) => {
  const normalized = String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٬,،\s]/g, '')
    .replace(/[٫]/g, '.');
  const parsedNormalized = Number(normalized);
  if (Number.isFinite(parsedNormalized)) return Math.max(0, Math.round(parsedNormalized * 100 / renderer.currencyFactor(renderer.uiCurrency)));
  const latin = String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[,\u066c٬\s]/g, '')
    .replace(/[٫]/g, '.');
  const parsed = Number(latin);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100 / renderer.currencyFactor(renderer.uiCurrency))) : 0;
};
const formatPriceInput = (cents) => new Intl.NumberFormat('fa-IR', {
  useGrouping: renderer.uiCurrency.separator !== false,
  minimumFractionDigits: Number(renderer.uiCurrency.decimals || 0),
  maximumFractionDigits: Math.max(2, Number(renderer.uiCurrency.decimals || 0))
}).format((Number(cents || 0) / 100) * renderer.currencyFactor(renderer.uiCurrency));
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
  if (renderer.uiCalendar === 'gregorian') return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return gregorianToJalali(y, m, d).map((n) => String(n).padStart(2, '0')).join('/');
}
function dateTimeToJalali(value) {
  if (!value) return '—';
  const text = String(value);
  const datePart = text.slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? isoToJalali(datePart) : datePart;
  const time = text.length > 10 ? text.slice(11, 16) : '';
  return time ? `${date} ${time}` : date;
}
function jalaliInputToIso(value) {
  if (renderer.uiCalendar === 'gregorian') return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
  const parts = renderer.normalizeDigits(value).replace(/-/g, '/').split('/').map(Number);
  return parts.length === 3 ? jalaliToGregorian(parts[0], parts[1], parts[2]) : '';
}
const jalaliMonthNames = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
function jalaliMonthDays(month) { return month <= 6 ? 31 : month <= 11 ? 30 : 29; }
function parseJalaliDate(value) {
  const parts = renderer.normalizeDigits(value).replace(/-/g, '/').split('/').map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) && parts[0] > 0 && parts[1] >= 1 && parts[1] <= 12 && parts[2] >= 1
    ? { year: parts[0], month: parts[1], day: parts[2] } : null;
}
function renderJalaliPicker(input, year, month) {
  let popup = renderer.$('#jalaliDatePickerPopup');
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
  document.querySelectorAll('input[type="date"], input.jalali-date-input').forEach((input) => {
    input.type = 'text'; input.inputMode = 'numeric'; input.autocomplete = 'off'; input.classList.add('jalali-date-input');
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.value || ''))) input.value = isoToJalali(input.value);
    if (input.dataset.jalaliPickerBound) return;
    input.dataset.jalaliPickerBound = '1';
    input.addEventListener('focus', () => {
      const today = localDateIso();
      const current = parseJalaliDate(input.value)
        || parseJalaliDate(isoToJalali(today));
      renderJalaliPicker(input, current.year, current.month);
    });
  });
  if (document.body.dataset.jalaliPickerBound) return;
  document.body.dataset.jalaliPickerBound = '1';
  document.addEventListener('click', (event) => {
    const popup = renderer.$('#jalaliDatePickerPopup');
    if (event.target.closest('.jalali-date-input')) return;
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
  const placeholder = renderer.$('#placeholderPage');
  placeholder.insertAdjacentHTML('beforebegin', `<section id="productsPage" class="page hidden"><div class="page-heading"><div><span class="eyebrow">مدیریت موجودی</span><h2>کالاها</h2></div><button id="addProduct" class="primary">＋ ثبت کالای جدید</button></div><div class="panel management-toolbar"><div class="toolbar-search"><span>⌕</span><input id="productsFilter" placeholder="جست‌وجوی هوشمند نام، کد یا بارکد (کلمات را جدا بنویسید)"></div><button id="semanticSearchToggle" class="secondary semantic-toggle" type="button">🤖 جست‌وجوی هوشمند</button><select id="productCategoryFilter"><option value="">همه دسته‌بندی‌ها</option></select><label class="check-label"><input id="showInactiveProducts" type="checkbox"> نمایش غیرفعال‌ها</label></div><div class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>کد</th><th>نام کالا</th><th>دسته‌بندی</th><th>قیمت‌ها</th><th>موجودی</th><th>واحد</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody id="productsTable"></tbody></table></div></div></section><section id="categoriesPage" class="page hidden"><div class="page-heading"><div><span class="eyebrow">ساختار کالاها</span><h2>دسته‌بندی‌ها</h2></div><button id="addCategory" class="primary">＋ ثبت دسته‌بندی</button></div><div class="panel management-toolbar"><div class="toolbar-search"><span>⌕</span><input id="categoriesFilter" placeholder="جست‌وجوی دسته‌بندی"></div><label class="check-label"><input id="showInactiveCategories" type="checkbox"> نمایش غیرفعال‌ها</label></div><div class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>کد</th><th>نام دسته‌بندی</th><th>توضیحات</th><th>تعداد کالا</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody id="categoriesTable"></tbody></table></div></div></section>`);
  document.body.insertAdjacentHTML('beforeend', `<div id="managementModalBackdrop" class="modal-backdrop hidden"><div id="productModal" class="modal hidden"><div class="modal-header"><div><span class="eyebrow">اطلاعات کالا</span><h3 id="productModalTitle">ثبت کالای جدید</h3></div><button class="modal-close" data-close-management>×</button></div><form id="productForm"><input id="productId" type="hidden"><div class="form-grid"><label>نام کالا *<input id="productName" required></label><label>کد کالا <input id="productCode" readonly placeholder="پس از انتخاب دسته‌بندی ساخته می‌شود"></label><label>بارکد<input id="productBarcode"></label><label>دسته‌بندی *<select id="productCategory" required><option value="">انتخاب دسته‌بندی</option></select></label><label>واحد<select id="productUnit"><option value="">انتخاب واحد</option></select></label><label>قیمت خرید<input id="productPurchasePrice" type="number" min="0"></label><label>قیمت عمده<input id="productWholesalePrice" type="number" min="0"></label><label>قیمت فروش *<input id="productRetailPrice" type="number" min="0" required></label><label>موجودی اولیه<input id="productStock" type="number" min="0" step="0.01" value="0"></label><label>حداقل موجودی<input id="productMinimumStock" type="number" min="0" step="0.01" value="0"></label></div><label>توضیحات<textarea id="productDescription" rows="3"></textarea></label><div id="productFormError" class="form-error hidden"></div><div class="modal-actions"><button type="button" class="secondary" data-close-management>انصراف</button><button type="submit" class="primary">ذخیره کالا</button></div></form></div><div id="categoryModal" class="modal hidden"><div class="modal-header"><div><span class="eyebrow">ساختار کالاها</span><h3 id="categoryModalTitle">ثبت دسته‌بندی</h3></div><button class="modal-close" data-close-management>×</button></div><form id="categoryForm"><input id="categoryId" type="hidden"><label>کد دسته‌بندی *<input id="categoryCode" required inputmode="numeric" pattern="\\d{1,4}"></label><label>نام دسته‌بندی *<input id="categoryName" required></label><label>توضیحات<textarea id="categoryDescription" rows="4"></textarea></label><div id="categoryFormError" class="form-error hidden"></div><div class="modal-actions"><button type="button" class="secondary" data-close-management>انصراف</button><button type="submit" class="primary">ذخیره دسته‌بندی</button></div></form></div></div>`);
  placeholder.insertAdjacentHTML('beforebegin', `<section id="partiesPage" class="page hidden"><div class="page-heading"><div><span class="eyebrow">مدیریت اشخاص</span><h2>طرف‌حساب‌ها</h2></div><button id="addParty" class="primary">＋ ثبت طرف‌حساب</button></div><div class="panel management-toolbar"><div class="toolbar-search"><span>⌕</span><input id="partiesFilter" placeholder="جست‌وجوی نام، کد یا شماره تماس"></div><select id="partyTypeFilter"><option value="">همه انواع</option><option value="customer">مشتری</option><option value="supplier">تأمین‌کننده</option><option value="both">هر دو</option></select><label class="check-label"><input id="showInactiveParties" type="checkbox"> نمایش غیرفعال‌ها</label></div><div class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>کد</th><th>نام و نام خانوادگی</th><th>نوع</th><th>شماره تماس</th><th>آدرس</th><th>مانده</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody id="partiesTable"></tbody></table></div></div></section>`);
  renderer.$('#managementModalBackdrop').insertAdjacentHTML('beforeend', `<div id="partyModal" class="modal hidden"><div class="modal-header"><div><span class="eyebrow">اطلاعات طرف‌حساب</span><h3 id="partyModalTitle">ثبت طرف‌حساب جدید</h3></div><button class="modal-close" data-close-management>×</button></div><form id="partyForm"><input id="partyId" type="hidden"><div class="form-grid"><label>نام *<input id="partyFirstName" required></label><label>نام خانوادگی<input id="partyLastName"></label><label>شماره تماس<input id="partyPhone" inputmode="tel"></label><label>شماره همراه<input id="partyMobile" inputmode="tel"></label><label>نوع طرف‌حساب *<select id="partyType" required><option value="customer">مشتری</option><option value="supplier">تأمین‌کننده</option><option value="both">هر دو</option></select></label></div><label>آدرس<textarea id="partyAddress" rows="3"></textarea></label><label>توضیحات<textarea id="partyDescription" rows="3"></textarea></label><div id="partyFormError" class="form-error hidden"></div><div class="modal-actions"><button type="button" class="secondary" data-close-management>انصراف</button><button type="submit" class="primary">ذخیره طرف‌حساب</button></div></form></div>`);
  renderer.$('#productForm .modal-actions')?.insertAdjacentHTML('beforebegin', `<section id="productPurchaseHistory" class="product-purchase-history hidden"><div class="product-purchase-history-heading"><div><h4>سوابق خرید کالا</h4><small id="productPurchaseHistorySummary"></small></div></div><div class="table-wrap"><table><thead><tr><th>تاریخ</th><th>تأمین‌کننده</th><th>فاکتور</th><th>تعداد</th><th>قیمت واحد</th><th>تخفیف</th><th>قیمت خالص</th></tr></thead><tbody id="productPurchaseHistoryRows"></tbody></table></div></section>`);
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
  // Resolved at call time: 04-invoices-assistant-reports.js loads later and
  // supersedes this file's partial initializer with the full one that also
  // builds the keyboard-invoice sections (salesInvoicePage, purchasesPage and
  // the invoice list pages). Calling our own partial version here would leave
  // #salesPage flagged as redesigned and make the full initializer bail out.
  (typeof renderer.initializeSalesMarkupFinal === 'function' ? renderer.initializeSalesMarkupFinal : initializeSalesMarkupLegacy)();
  // The sales markup (and its .modern-cart node) is only created above, so the
  // cart-modal wiring must run afterwards: it relocates that node into a modal
  // opened from a topbar icon. Running it at chunk-parse time bails out because
  // the node does not exist yet.
  if (typeof renderer.initializeSaleCartModal === 'function') renderer.initializeSaleCartModal();
}

function groupSidebarMenu(className, label, icon, pages) {
  const nav = document.querySelector('nav');
  if (!nav) return;
  const existing = nav.querySelector(`.${className}`);
  if (existing) {
    const submenu = existing.querySelector('.sidebar-submenu');
    pages.forEach((page) => {
      const button = [...nav.children].find((node) => node.matches?.(`button[data-page="${page}"]`));
      if (button) submenu?.appendChild(button);
    });
    return;
  }
  const directButtons = pages.map((page) => [...nav.children].find((node) => node.matches?.(`button[data-page="${page}"]`))).filter(Boolean);
  if (!directButtons.length) return;
  const group = document.createElement('div');
  group.className = `sidebar-menu-group ${className}`;
  group.innerHTML = `<button type="button" class="nav-item sidebar-menu-toggle" aria-expanded="false"><span>${icon}</span><span class="nav-label">${label}</span><span class="sidebar-menu-chevron">⌄</span></button><div class="sidebar-submenu hidden"></div>`;
  const submenu = group.querySelector('.sidebar-submenu');
  directButtons[0].before(group);
  directButtons.forEach((button) => submenu.appendChild(button));
  group.querySelector('.sidebar-menu-toggle').addEventListener('click', () => {
    const expanded = group.classList.toggle('open');
    submenu.classList.toggle('hidden', !expanded);
    group.querySelector('.sidebar-menu-toggle').setAttribute('aria-expanded', String(expanded));
  });
}

function initializeSidebarGroups() {
  groupSidebarMenu('operations-menu', 'عملیات و پیگیری', '◫', ['inventory', 'returns', 'checks', 'installments']);
  groupSidebarMenu('finance-menu', 'مالی و حساب‌ها', '∑', ['ledger', 'cash', 'profit-loss']);
  groupSidebarMenu('system-menu', 'گزارش و مدیریت', '⚙', ['users', 'reports', 'settings']);
}

// Named distinctly from 04-invoices-assistant-reports.js's initializeSalesMarkup:
// in the original monolith a single hoisted declaration won, but as separate
// <script> tags this duplicate global declaration would shadow the full
// initializer (which builds the keyboard-invoice pages) for any caller that
// resolves the name before chunk 04 has loaded.
function initializeSalesMarkupLegacy() {
  const page = renderer.$('#salesPage');
  if (!page || page.dataset.redesigned) return;
  page.innerHTML = `<div class="page-heading daily-sale-heading"><div><span class="eyebrow">عملیات فروش</span><h2>ثبت فروش روزانه</h2><div class="daily-sale-shortcuts"><kbd>F2</kbd> جست‌وجو <kbd>Enter</kbd> افزودن <kbd>F9</kbd> ثبت فروش</div></div><label class="sale-date-field daily-sale-date-field"><span class="sale-date-caption"><i aria-hidden="true">◷</i>تاریخ فروش</span><input id="saleDate" type="date"></label></div><div class="sale-modern-layout"><section class="panel product-picker"><div class="picker-header"><div><h3>افزودن کالا</h3><small>بارکد را اسکن کنید یا نام، کد و بارکد را جست‌وجو کنید.</small></div><div class="toolbar-search daily-sale-search"><span>⌕</span><input id="saleProductFilter" placeholder="اسکن بارکد یا جست‌وجوی کالا" autocomplete="off"><kbd>F2</kbd></div></div><div class="daily-sale-hint">با اسکن دوبارهٔ یک کالا، تعداد همان ردیف افزایش پیدا می‌کند.</div><div id="saleProductCards" class="product-cards"></div></section><aside class="panel modern-cart"><div class="cart-heading"><div><h3>سبد فروش</h3><small id="cartCount">۰ قلم</small></div><button id="clearSaleCart" class="danger-button" type="button">پاک کردن سبد</button></div><div class="table-wrap"><table><thead><tr><th>محصول</th><th>قیمت</th><th>تعداد</th><th></th></tr></thead><tbody id="modernSaleItems"></tbody></table></div><div class="cart-summary"><div><span>اقلام</span><strong id="cartItemCount">۰</strong></div><div><span>مبلغ کل</span><strong id="modernSaleTotal">${renderer.money(0)}</strong></div></div><div id="modernSaleError" class="form-error hidden"></div><div class="daily-sale-actions"><button id="modernSaveSale" class="primary wide" type="button">ثبت فروش <kbd>F9</kbd></button><button id="modernSaveSalePrint" class="secondary wide" type="button">ثبت و چاپ</button></div></aside></div>`;
  renderer.$('#saleDate').value = localDateIso();
  page.dataset.redesigned = '1';
  bindSalesEvents();
  bindJalaliDatePickers();
  loadSaleProducts();
}

function renderSaleProducts() {
  const products = saleState.products;
  const unit = renderer.currencyLabel();
  renderer.$('#saleProductCards').innerHTML = products.length ? products.map((p) => `<article class="product-card"><div class="product-card-title"><strong>${esc(p.name)}</strong><small>${esc(p.code)} · موجودی ${p.stock}${Number(p.soldQuantity || 0) ? ` · فروش ${p.soldQuantity}` : ''}</small></div><div class="price-actions"><button class="price-choice retail add-daily-product" data-id="${p.id}" data-price-type="retail"><span>فروش (${unit})</span><b>${renderer.money(p.salePrice)}</b></button><button class="price-choice wholesale add-daily-product" data-id="${p.id}" data-price-type="wholesale" ${p.wholesalePrice > 0 ? '' : 'disabled'}><span>عمده (${unit})</span><b>${renderer.money(p.wholesalePrice)}</b></button></div></article>`).join('') : '<div class="empty-state compact"><span>⌕</span><p>محصولی با این کلیدواژه‌ها پیدا نشد.</p></div>';
}
function renderSaleCart() {
  const body = renderer.$('#modernSaleItems');
  body.innerHTML = saleState.cart.length ? saleState.cart.map((item, index) => `<tr><td><strong>${esc(item.name)}</strong><small>${item.priceType === 'wholesale' ? 'عمده' : 'فروش'}</small></td><td><input class="cart-price" data-index="${index}" type="number" min="0" value="${(item.unitPrice / 100) * renderer.currencyFactor()}"></td><td><input class="cart-quantity" data-index="${index}" type="number" min="1" step="1" value="${item.quantity}"></td><td><button class="delete-line" data-index="${index}">×</button></td></tr>`).join('') : '<tr class="empty-row"><td colspan="4">برای شروع یکی از قیمت‌های محصول را انتخاب کنید.</td></tr>';
  renderer.$('#cartCount').textContent = `${new Intl.NumberFormat('fa-IR').format(saleState.cart.reduce((sum, item) => sum + item.quantity, 0))} قلم`;
  renderer.$('#cartItemCount') && (renderer.$('#cartItemCount').textContent = new Intl.NumberFormat('fa-IR').format(saleState.cart.reduce((sum, item) => sum + item.quantity, 0)));
  renderer.$('#modernSaleTotal').textContent = renderer.money(saleState.cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));
}
async function loadSaleProducts(query = '') {
  // Rejected before login by the main-process guard; retried via refreshAfterLogin.
  saleState.products = await window.api.products.search(query).catch(() => saleState.products || []);
  renderSaleProducts();
  renderSaleCart();
}
function addSaleProduct(id, unitPrice, priceType) { const product = saleState.products.find((p) => p.id === id); if (!product) return; saleState.cart.push({ productId: id, name: product.name, unitPrice: Number(unitPrice), quantity: 1, priceType }); renderSaleCart(); renderer.showToast('محصول به سبد فروش اضافه شد.'); }
function bindSalesEvents() {
  let saleSearchTimer;
  renderer.$('#saleProductFilter').addEventListener('input', () => {
    clearTimeout(saleSearchTimer);
    saleSearchTimer = setTimeout(() => loadSaleProducts(renderer.$('#saleProductFilter').value), 120);
  });
  renderer.$('#saleProductCards').addEventListener('click', (e) => { const button = e.target.closest('.add-daily-product'); if (!button || button.disabled) return; const product = saleState.products.find((p) => p.id === Number(button.dataset.id)); const type = button.dataset.priceType; addSaleProduct(product.id, type === 'wholesale' ? product.wholesalePrice : product.salePrice, type); });
  renderer.$('#modernSaleItems').addEventListener('input', (e) => { const index = Number(e.target.dataset.index); if (e.target.classList.contains('cart-price')) saleState.cart[index].unitPrice = parsePriceInput(e.target.value); else saleState.cart[index].quantity = Math.max(1, Math.round(Number(e.target.value || 1))); renderSaleCart(); });
  renderer.$('#modernSaleItems').addEventListener('click', (e) => { const button = e.target.closest('.delete-line'); if (button) { saleState.cart.splice(Number(button.dataset.index), 1); renderSaleCart(); } });
  renderer.$('#clearSaleCart').addEventListener('click', () => { if (!saleState.cart.length) return renderer.showToast('سبد فروش خالی است.', true); saleState.cart = []; renderSaleCart(); renderer.showToast('سبد فروش پاک شد.'); });
  renderer.$('#modernSaveSale').addEventListener('click', async () => { const error = renderer.$('#modernSaleError'); error.classList.add('hidden'); try { if (!saleState.cart.length) throw new Error('حداقل یک محصول به سبد اضافه کنید.'); const result = await window.api.sales.create({ items: saleState.cart.map((item) => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice / 100, discount: 0, priceType: item.priceType })), source: 'daily', date: jalaliInputToIso(renderer.$('#saleDate').value) }); saleState.cart = []; renderSaleCart(); await loadSaleProducts(); await window.api.dashboard.summary().then(renderer.renderMetrics); renderer.showToast(`فروش ${result.invoiceNumber} با موفقیت ثبت شد. سود: ${renderer.money(result.profitTotal)}`); } catch (err) { error.textContent = err.message; error.classList.remove('hidden'); } });
}

function setManagedPage(page) {
  initializeManagementMarkup();
  initializeSidebarGroups();
  const titles = { dashboard: 'داشبورد', sales: 'ثبت فروش روزانه', products: 'مدیریت کالاها', categories: 'دسته‌بندی‌ها', customers: 'مدیریت مشتریان', reports: 'گزارش‌ها', settings: 'تنظیمات' };
  const viewPage = page === 'customers' ? 'parties' : page;
  ['dashboard', 'sales', 'products', 'categories', 'parties', 'placeholder'].forEach((id) => { const node = renderer.$(`#${id}Page`); if (node) node.classList.toggle('hidden', id !== viewPage && !(id === 'placeholder' && !['dashboard', 'sales', 'products', 'categories', 'parties'].includes(viewPage))); });
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  renderer.$('#pageTitle').textContent = titles[page] || page; renderer.$('#windowContext').textContent = titles[page] || page;
  if (page === 'products') loadManagedProducts(); if (page === 'categories') loadManagedCategories(); if (page === 'customers') loadManagedParties();
  // Page-entry data loads live in setPageRouter (04-invoices-assistant-reports.js),
  // which supersedes this router for the real UI.
}

function openManagementModal(kind, record = null, options = {}) {
  initializeManagementMarkup();
  // همهٔ مودال‌های مدیریت (از جمله ورود محصولات) باید قبل از نمایش مودال جدید بسته شوند.
  // در غیر این صورت مودال ورود اکسلِ بازمانده روی فرم ثبت مشتری نمایش داده می‌شود.
  document.querySelectorAll('#managementModalBackdrop .modal').forEach((node) => node.classList.add('hidden'));
  productModalInvoiceTarget = kind === 'product' && !record && options.invoiceTarget
    ? { kind: options.invoiceTarget.kind, index: Number(options.invoiceTarget.index) }
    : null;
  renderer.$('#managementModalBackdrop').classList.remove('hidden');
  renderer.$(`#${kind}Modal`)?.classList.remove('hidden');
  if (kind === 'product') {
    renderer.$('#productModalTitle').textContent = record ? 'ویرایش کالا' : 'ثبت کالای جدید'; renderer.$('#productId').value = record?.id || '';
    renderer.$('#productForm').dataset.originalCategoryId = record?.categoryId || '';
    const productRetailPrice = record?.retailPrice ?? record?.salePrice ?? 0;
    [['productName', record?.name], ['productCode', record?.code], ['productBarcode', record?.barcode], ['productPurchasePrice', record ? formatPriceInput(record.purchasePrice) : formatPriceInput(0)], ['productWholesalePrice', record ? formatPriceInput(record.wholesalePrice) : formatPriceInput(0)], ['productRetailPrice', record ? formatPriceInput(productRetailPrice) : formatPriceInput(0)], ['productStock', record?.stock ?? 0], ['productMinimumStock', record?.minimumStock ?? 0], ['productDescription', record?.description || '']].forEach(([id, value]) => { renderer.$(`#${id}`).value = value ?? ''; });
    // Entering a purchase price refreshes wholesale/retail automatically; a manual
    // edit of either field switches that field back to manual for this session.
    productSellingPriceAuto = { wholesale: true, retail: true };
    setupProductPriceFields();
    if (!record) updateProductSellingPrices();
    renderer.$('#productCategory').value = record?.categoryId || ''; renderer.$('#productUnit').value = record?.unitId || '';
    syncProductLookupValues();
    const stockField = renderer.$('#productStock')?.closest('label');
    stockField?.classList.toggle('hidden', Boolean(productModalInvoiceTarget));
    if (productModalInvoiceTarget) renderer.$('#productStock').value = '0';
    loadProductPurchaseHistory(record?.id);
    if (!record) updateProductCodePreview(); renderer.$('#productName').focus();
  } else if (kind === 'category') {
    renderer.$('#categoryModalTitle').textContent = record ? 'ویرایش دسته‌بندی' : 'ثبت دسته‌بندی'; renderer.$('#categoryId').value = record?.id || ''; renderer.$('#categoryCode').value = record?.code || ''; renderer.$('#categoryName').value = record?.name || ''; renderer.$('#categoryDescription').value = record?.description || ''; renderer.$('#categoryCode').focus();
  } else {
    renderer.$('#partyModalTitle').textContent = record ? 'ویرایش طرف‌حساب' : 'ثبت طرف‌حساب جدید';
    renderer.$('#partyId').value = record?.id || '';
    renderer.$('#partyFirstName').value = record?.firstName || '';
    renderer.$('#partyLastName').value = record?.lastName || '';
    renderer.$('#partyPhone').value = record?.phone || '';
    renderer.$('#partyMobile').value = record?.mobile || '';
    renderer.$('#partyAddress').value = record?.address || '';
    renderer.$('#partyDescription').value = record?.description || '';
    renderer.$('#partyType').value = record?.partyType || 'customer';
    renderer.$('#partyFirstName').focus();
  }
}

function closeManagementModal() {
  document.querySelectorAll('#managementModalBackdrop .modal').forEach((node) => node.classList.add('hidden'));
  renderer.$('#managementModalBackdrop').classList.add('hidden');
}
async function loadProductPurchaseHistory(productId) {
  const section = renderer.$('#productPurchaseHistory');
  const summary = renderer.$('#productPurchaseHistorySummary');
  const rows = renderer.$('#productPurchaseHistoryRows');
  if (!section || !summary || !rows) return;
  if (!productId) {
    section.classList.add('hidden');
    section.dataset.productId = '';
    return;
  }
  section.dataset.productId = String(productId);
  section.classList.remove('hidden');
  summary.textContent = 'در حال دریافت سوابق…';
  rows.innerHTML = '<tr class="empty-row"><td colspan="7">در حال دریافت سوابق خرید…</td></tr>';
  try {
    const history = await window.api.purchases.priceHistory(productId, { limit: 50 });
    if (section.dataset.productId !== String(productId)) return;
    const data = history.items || [];
    const stats = history.summary || {};
    summary.textContent = data.length
      ? `${stats.count || data.length} سابقه · کمینه ${renderer.money(stats.minUnitPrice)} · بیشینه ${renderer.money(stats.maxUnitPrice)} · میانگین خالص ${renderer.money(stats.averageEffectiveUnitPrice)}`
      : 'برای این کالا سابقهٔ خرید فعال ثبت نشده است.';
    rows.innerHTML = data.length ? data.map((row) => `<tr><td>${isoToJalali(row.date)}</td><td>${esc(row.supplierName)}</td><td>${esc(row.invoiceNumber)}</td><td>${Number(row.quantity || 0)}${Number(row.returnedQuantity || 0) ? `<small>${Number(row.returnedQuantity)} مرجوعی</small>` : ''}</td><td>${renderer.money(row.unitPrice)}</td><td>${renderer.money(row.discount)}</td><td><strong>${renderer.money(row.effectiveUnitPrice)}</strong></td></tr>`).join('') : '<tr class="empty-row"><td colspan="7">سابقه‌ای برای نمایش وجود ندارد.</td></tr>';
  } catch (error) {
    if (section.dataset.productId !== String(productId)) return;
    summary.textContent = '';
    rows.innerHTML = `<tr class="empty-row"><td colspan="7">${esc(readableError(error, 'سوابق خرید بارگذاری نشد.'))}</td></tr>`;
  }
}
async function openProductForInvoice(kind, index) {
  try {
    const [categories, units] = await Promise.all([
      window.api.categories.list(true),
      window.api.units.list()
    ]);
    managementState.categories = categories;
    managementState.units = units;
    renderProductOptions();
  } catch {
    // The regular form error will explain a missing required category if the
    // database refresh is unavailable.
  }
  openManagementModal('product', null, { invoiceTarget: { kind, index } });
}
async function openProductForEdit(id) {
  let record = managementState.products.find((product) => product.id === Number(id));
  const hasPrices = record && ['purchasePrice', 'wholesalePrice'].every((key) => record[key] !== undefined)
    && (record.salePrice !== undefined || record.retailPrice !== undefined);
  if (!hasPrices) {
    try {
      const products = await window.api.products.list({ query: '', categoryId: '' });
      record = products.find((product) => product.id === Number(id)) || record;
    } catch (error) {
      renderer.showToast(readableError(error, 'اطلاعات کالا بارگذاری نشد.'), true);
    }
  }
  if (record) openManagementModal('product', record);
}
let productSellingPriceAuto = { wholesale: true, retail: true };
function setupProductPriceFields() {
  const purchaseField = renderer.$('#productPurchasePrice');
  const wholesaleField = renderer.$('#productWholesalePrice');
  const retailField = renderer.$('#productRetailPrice');
  if (!purchaseField || !wholesaleField || !retailField) return;
  [purchaseField, wholesaleField, retailField].forEach((field) => {
    field.type = 'text';
    field.inputMode = 'decimal';
    field.removeAttribute('min');
  });
  ['productStock', 'productMinimumStock'].forEach((id) => {
    const field = renderer.$(`#${id}`);
    if (field) field.step = '1';
  });
  const recalculate = () => updateProductSellingPrices();
  purchaseField.removeEventListener('input', recalculate);
  purchaseField.removeEventListener('change', recalculate);
  purchaseField.removeEventListener('keyup', recalculate);
  purchaseField.oninput = recalculate;
  purchaseField.onchange = recalculate;
  purchaseField.onkeyup = recalculate;
  wholesaleField.oninput = () => { productSellingPriceAuto.wholesale = false; };
  wholesaleField.onchange = () => { productSellingPriceAuto.wholesale = false; };
  retailField.oninput = () => { productSellingPriceAuto.retail = false; };
  retailField.onchange = () => { productSellingPriceAuto.retail = false; };
}
function updateProductSellingPrices() {
  const purchaseField = renderer.$('#productPurchasePrice');
  const wholesaleField = renderer.$('#productWholesalePrice');
  const retailField = renderer.$('#productRetailPrice');
  if (!purchaseField || !wholesaleField || !retailField) return;
  const purchase = parsePriceInput(purchaseField.value);
  // Selling prices are the purchase price plus 20% (wholesale) and 30% (retail).
  if (productSellingPriceAuto.wholesale) {
    wholesaleField.value = purchase > 0 ? formatPriceInput(Math.ceil(purchase * 1.2)) : formatPriceInput(0);
  }
  if (productSellingPriceAuto.retail) {
    retailField.value = purchase > 0 ? formatPriceInput(Math.ceil(purchase * 1.3)) : formatPriceInput(0);
  }
  updateProductProfitPreview();
}
function bindProductPriceAutoEvents() {
  if (document.body.dataset.productPriceAutoBound === '1') return;
  document.body.dataset.productPriceAutoBound = '1';
  document.addEventListener('input', (event) => {
    if (['productPurchasePrice', 'productWholesalePrice', 'productRetailPrice'].includes(event.target.id)) {
      event.target.value = formatPriceInput(parsePriceInput(event.target.value));
    }
    if (event.target.id === 'productPurchasePrice') updateProductSellingPrices();
    if (event.target.id === 'productWholesalePrice') productSellingPriceAuto.wholesale = false;
    if (event.target.id === 'productRetailPrice') productSellingPriceAuto.retail = false;
  });
}
function normalizeProductLookupText(value) {
  return renderer.normalizeDigits(String(value ?? '').trim().toLowerCase())
    .replace(/ي/g, 'ی').replace(/ى/g, 'ی').replace(/ك/g, 'ک');
}
function productLookupItems(selectId) {
  if (selectId === 'productCategory') {
    return managementState.categories.filter((category) => category.isActive)
      .map((category) => ({ id: category.id, name: category.name, label: category.name }));
  }
  return managementState.units.map((unit) => ({
    id: unit.id,
    name: unit.name,
    label: `${unit.name}${unit.symbol ? ` (${unit.symbol})` : ''}`
  }));
}
function syncProductLookupValues() {
  [['productCategory', 'productCategorySearch'], ['productUnit', 'productUnitSearch']].forEach(([selectId, inputId]) => {
    const select = renderer.$(`#${selectId}`);
    const input = renderer.$(`#${inputId}`);
    if (!select || !input) return;
    const item = productLookupItems(selectId).find((option) => String(option.id) === String(select.value));
    input.value = item?.label || '';
  });
}
function initializeProductLookups() {
  [['productCategory', 'productCategorySearch', 'productCategoryOptions', 'جست‌وجوی دسته‌بندی...'],
    ['productUnit', 'productUnitSearch', 'productUnitOptions', 'جست‌وجوی واحد...']].forEach(([selectId, inputId, datalistId, placeholder]) => {
    const select = renderer.$(`#${selectId}`);
    if (!select || renderer.$(`#${inputId}`)) return;
    const input = document.createElement('input');
    input.id = inputId;
    input.type = 'search';
    input.setAttribute('list', datalistId);
    input.setAttribute('autocomplete', 'off');
    input.placeholder = placeholder;
    input.className = 'product-lookup-input';
    select.parentElement.insertBefore(input, select);
    select.hidden = true;
    const datalist = document.createElement('datalist');
    datalist.id = datalistId;
    select.parentElement.appendChild(datalist);
    input.addEventListener('input', () => {
      const query = normalizeProductLookupText(input.value);
      const options = productLookupItems(selectId);
      const match = query
        ? (options.find((option) => normalizeProductLookupText(option.name).startsWith(query))
          || options.find((option) => normalizeProductLookupText(option.label).includes(query)))
        : null;
      select.value = match ? String(match.id) : '';
      if (match && query && normalizeProductLookupText(input.value) !== normalizeProductLookupText(match.label)) {
        input.value = match.label;
        input.select();
      }
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { input.value = ''; select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  });
}
function renderProductOptions() {
  // Rebuilding the options happens after a product save. Keep the current
  // product-list category filter so the user stays in the same group.
  const selectedCategoryFilter = renderer.$('#productCategoryFilter')?.value || '';
  const categories = managementState.categories.filter((c) => c.isActive);
  const units = managementState.units;
  renderer.$('#productCategory').innerHTML = '<option value="">بدون دسته‌بندی</option>' + categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  renderer.$('#productCategoryFilter').innerHTML = '<option value="">همه دسته‌بندی‌ها</option>' + categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if ([...renderer.$('#productCategoryFilter').options].some((option) => option.value === selectedCategoryFilter)) {
    renderer.$('#productCategoryFilter').value = selectedCategoryFilter;
  }
  renderer.$('#productUnit').innerHTML = '<option value="">انتخاب واحد</option>' + units.map((u) => `<option value="${u.id}">${esc(u.name)}${u.symbol ? ` (${esc(u.symbol)})` : ''}</option>`).join('');
  [['productCategoryOptions', categories.map((c) => c.name)],
    ['productUnitOptions', units.map((u) => `${u.name}${u.symbol ? ` (${u.symbol})` : ''}`)]].forEach(([id, values]) => {
    const list = renderer.$(`#${id}`);
    if (list) list.innerHTML = values.map((value) => `<option value="${esc(value)}"></option>`).join('');
  });
  syncProductLookupValues();
}
let productCodePreviewSerial = 0;
async function updateProductCodePreview() {
  const codeField = renderer.$('#productCode');
  const categoryId = renderer.$('#productCategory')?.value;
  if (!codeField || !categoryId) {
    if (codeField) codeField.value = '';
    return;
  }

  const productId = renderer.$('#productId')?.value;
  const originalCategoryId = renderer.$('#productForm')?.dataset.originalCategoryId || '';
  if (productId && String(categoryId) === String(originalCategoryId)) return;

  const requestSerial = ++productCodePreviewSerial;
  codeField.value = 'در حال محاسبه…';
  try {
    const nextCode = await window.api.products.nextCode(categoryId, productId || null);
    if (requestSerial === productCodePreviewSerial && String(renderer.$('#productCategory')?.value) === String(categoryId)) {
      codeField.value = nextCode;
    }
  } catch (error) {
    if (requestSerial === productCodePreviewSerial) {
      codeField.value = '';
      renderer.showToast(readableError(error, 'محاسبه کد بعدی کالا انجام نشد.'), true);
    }
  }
}
function renderManagedProducts() {
  // Keep every caller (including search/filter listeners bound earlier) on the
  // enhanced table renderer with editable purchase, wholesale and retail fields.
  if (typeof renderEnhancedManagedProducts === 'function') return renderEnhancedManagedProducts();
}
function renderManagedCategories() { const term = (renderer.$('#categoriesFilter')?.value || '').trim().toLowerCase(); const includeInactive = renderer.$('#showInactiveCategories')?.checked; const rows = managementState.categories.filter((c) => (includeInactive || c.isActive) && (!term || `${c.code} ${c.name}`.toLowerCase().includes(term))); renderer.$('#categoriesTable').innerHTML = rows.length ? rows.map((c) => `<tr class="${c.isActive ? '' : 'muted-row'}"><td><strong>${esc(c.code)}</strong></td><td><strong>${esc(c.name)}</strong></td><td>${esc(c.description || '—')}</td><td>${new Intl.NumberFormat('fa-IR').format(c.productCount || 0)}</td><td><span class="status-badge ${c.isActive ? 'active' : 'inactive'}">${c.isActive ? 'فعال' : 'غیرفعال'}</span></td><td><button class="table-action edit-category" data-id="${c.id}">ویرایش</button><button class="table-action danger toggle-category" data-id="${c.id}" data-active="${c.isActive}">${c.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button></td></tr>`).join('') : '<tr class="empty-row"><td colspan="6">دسته‌بندی‌ای برای نمایش وجود ندارد.</td></tr>'; }
function renderManagedParties() { const term = (renderer.$('#partiesFilter')?.value || '').trim().toLowerCase(); const type = renderer.$('#partyTypeFilter')?.value || ''; const includeInactive = renderer.$('#showInactiveParties')?.checked; const labels = { customer: 'مشتری', supplier: 'تأمین‌کننده', both: 'هر دو' }; const rows = managementState.parties.filter((p) => (includeInactive || p.isActive) && (!type || p.partyType === type) && (!term || [p.name, p.code, p.phone, p.mobile, p.address].some((v) => String(v || '').toLowerCase().includes(term)))); renderer.$('#partiesTable').innerHTML = rows.length ? rows.map((p) => `<tr class="${p.isActive ? '' : 'muted-row'}"><td><strong>${esc(p.code)}</strong></td><td><strong>${esc(p.name)}</strong></td><td><span class="status-badge ${p.partyType === 'supplier' ? 'inactive' : 'active'}">${labels[p.partyType] || p.partyType}</span></td><td>${esc(p.phone || p.mobile || '—')}</td><td>${esc(p.address || '—')}</td><td>${renderer.money(p.balance)}</td><td><span class="status-badge ${p.isActive ? 'active' : 'inactive'}">${p.isActive ? 'فعال' : 'غیرفعال'}</span></td><td><button class="table-action edit-party" data-id="${p.id}">ویرایش</button><button class="table-action danger toggle-party" data-id="${p.id}" data-active="${p.isActive}">${p.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button></td></tr>`).join('') : '<tr class="empty-row"><td colspan="8">طرف‌حسابی برای نمایش وجود ندارد.</td></tr>'; }
let managedProductsLoadSerial = 0;
async function loadManagedProducts() {
  const serial = ++managedProductsLoadSerial;
  const tablePanel = document.querySelector('#productsPage .table-panel');
  const loader = renderer.$('#productsLoading') || (() => {
    if (!tablePanel) return null;
    tablePanel.insertAdjacentHTML('afterbegin', '<div id="productsLoading" class="products-loading hidden" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><span>در حال بارگذاری کالاها...</span></div>');
    return renderer.$('#productsLoading');
  })();
  loader?.classList.remove('hidden');
  tablePanel?.classList.add('is-loading');
  const [products, categories, units] = await Promise.all([
    window.api.products.list({ query: '', categoryId: '' }),
    window.api.categories.list(true),
    window.api.units.list()
  ]);
  // Ignore an older response if the user refreshed/navigated again while it was loading.
  if (serial !== managedProductsLoadSerial) return;
  managementState.products = Array.isArray(products) ? products : [];
  managementState.categories = Array.isArray(categories) ? categories : [];
  managementState.units = Array.isArray(units) ? units : [];
  renderProductOptions();
  renderManagedProducts();
  loader?.classList.add('hidden');
  tablePanel?.classList.remove('is-loading');
}
async function loadManagedCategories() { managementState.categories = await window.api.categories.list(true); renderManagedCategories(); renderProductOptions(); }
async function loadManagedParties() { managementState.parties = await window.api.customers.list({ query: '', type: '', includeInactive: true }); renderManagedParties(); }

function bindManagementEvents() {
  initializeProductLookups();
  bindProductPriceAutoEvents();
  let duplicateCheckSerial = 0;
  const checkProductDuplicateOnBlur = async (event) => {
    const input = event.target;
    const value = String(input.value || '').trim();
    if (!value) return;
    const serial = ++duplicateCheckSerial;
    try {
      const result = await window.api.products.checkDuplicate({ name: renderer.$('#productName').value, barcode: renderer.$('#productBarcode').value }, renderer.$('#productId').value || null);
      if (serial !== duplicateCheckSerial || !result?.duplicate) return;
      const error = renderer.$('#productFormError');
      input.setAttribute('aria-invalid', 'true');
      error.textContent = result.field === 'barcode'
        ? `بارکد واردشده قبلاً برای کالای «${result.name}» با کد ${result.code} ثبت شده است.`
        : `کالای «${result.name}» با کد ${result.code} قبلاً ثبت شده است.`;
      error.classList.remove('hidden');
      input.focus();
    } catch {
      // The submit-time database validation remains authoritative.
    }
  };
  renderer.$('#productName').addEventListener('blur', checkProductDuplicateOnBlur);
  renderer.$('#productBarcode').addEventListener('blur', checkProductDuplicateOnBlur);
  document.addEventListener('click', (event) => { const pageButton = event.target.closest('[data-page]'); if (pageButton) { event.preventDefault(); renderer.setManagedPage(pageButton.dataset.page); } const invoiceProduct = event.target.closest('.invoice-new-product'); if (invoiceProduct) { const kind = invoiceProduct.dataset.kind; const emptyRow = invoiceState[kind].items.findIndex((item) => !item.productId); openProductForInvoice(kind, emptyRow >= 0 ? emptyRow : invoiceState[kind].items.length - 1); } if (event.target.closest('#addProduct')) openManagementModal('product'); if (event.target.closest('#addCategory')) openManagementModal('category'); if (event.target.closest('#addParty')) openManagementModal('party'); if (event.target.closest('[data-close-management]')) closeManagementModal(); const editProduct = event.target.closest('.edit-product'); if (editProduct) openProductForEdit(editProduct.dataset.id); const editCategory = event.target.closest('.edit-category'); if (editCategory) openManagementModal('category', managementState.categories.find((c) => c.id === Number(editCategory.dataset.id))); const editParty = event.target.closest('.edit-party'); if (editParty) openManagementModal('party', managementState.parties.find((p) => p.id === Number(editParty.dataset.id))); const toggleProduct = event.target.closest('.toggle-product'); if (toggleProduct) { const active = toggleProduct.dataset.active !== '1'; window.api.products.setActive(Number(toggleProduct.dataset.id), active).then(() => { renderer.showToast(active ? 'کالا فعال شد.' : 'کالا غیرفعال شد.'); return loadManagedProducts(); }).catch((err) => renderer.showToast(err.message, true)); } const toggleCategory = event.target.closest('.toggle-category'); if (toggleCategory) { const active = toggleCategory.dataset.active !== '1'; window.api.categories.setActive(Number(toggleCategory.dataset.id), active).then(() => { renderer.showToast(active ? 'دسته‌بندی فعال شد.' : 'دسته‌بندی غیرفعال شد.'); return loadManagedCategories(); }).catch((err) => renderer.showToast(err.message, true)); } const toggleParty = event.target.closest('.toggle-party'); if (toggleParty) { const active = toggleParty.dataset.active !== '1'; window.api.customers.setActive(Number(toggleParty.dataset.id), active).then(() => { renderer.showToast(active ? 'طرف‌حساب فعال شد.' : 'طرف‌حساب غیرفعال شد.'); return loadManagedParties(); }).catch((err) => renderer.showToast(err.message, true)); } });
  ['productsFilter', 'productCategoryFilter', 'showInactiveProducts'].forEach((id) => renderer.$(`#${id}`)?.addEventListener('input', renderManagedProducts)); ['categoriesFilter', 'showInactiveCategories'].forEach((id) => renderer.$(`#${id}`)?.addEventListener('input', renderManagedCategories)); ['partiesFilter', 'partyTypeFilter', 'showInactiveParties'].forEach((id) => renderer.$(`#${id}`)?.addEventListener('input', renderManagedParties)); renderer.$('#productCategory').addEventListener('change', updateProductCodePreview); renderer.$('#productPurchasePrice').addEventListener('input', updateProductSellingPrices); renderer.$('#productWholesalePrice').addEventListener('input', () => { productSellingPriceAuto.wholesale = false; }); renderer.$('#productRetailPrice').addEventListener('input', () => { productSellingPriceAuto.retail = false; });
  renderer.$('#productForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = renderer.$('#productFormError');
    error.classList.add('hidden');
    document.querySelectorAll('#productForm [aria-invalid="true"]').forEach((field) => field.removeAttribute('aria-invalid'));
    const payload = {
      name: renderer.$('#productName').value,
      code: renderer.$('#productCode').value,
      barcode: renderer.$('#productBarcode').value,
      categoryId: renderer.$('#productCategory').value,
      unitId: renderer.$('#productUnit').value,
      purchasePrice: parsePriceInput(renderer.$('#productPurchasePrice').value),
      wholesalePrice: parsePriceInput(renderer.$('#productWholesalePrice').value),
      retailPrice: parsePriceInput(renderer.$('#productRetailPrice').value),
      stock: productModalInvoiceTarget ? 0 : Math.max(0, Math.round(Number(renderer.$('#productStock').value || 0))),
      minimumStock: Math.max(0, Math.round(Number(renderer.$('#productMinimumStock').value || 0))),
      description: renderer.$('#productDescription').value
    };
    try {
      const id = renderer.$('#productId').value;
      const saved = id
        ? await window.api.products.update(Number(id), payload)
        : await window.api.products.create(payload);
      const target = productModalInvoiceTarget;
      renderer.showToast(id ? 'کالا با موفقیت ویرایش شد.' : 'کالا با موفقیت ثبت شد.');
      await loadManagedProducts();

      if (id) {
        closeManagementModal();
        productModalInvoiceTarget = null;
      } else if (target?.kind && Number.isInteger(target.index)) {
        closeManagementModal();
        productModalInvoiceTarget = null;
        await renderer.loadKeyboardInvoice(target.kind);
        const product = invoiceState[target.kind].products.find((item) => item.id === Number(saved?.id));
        if (product) renderer.chooseKeyboardProduct(target.kind, target.index, product);
      } else {
        // Keep the product dialog open and clear it for fast consecutive entry.
        productModalInvoiceTarget = null;
        openManagementModal('product');
      }
    } catch (err) {
      const message = readableError(err, 'ثبت کالا انجام نشد.');
      error.textContent = message;
      error.classList.remove('hidden');
      if (message.includes('بارکد')) renderer.$('#productBarcode').focus();
      else if (message.includes('قبلاً ثبت شده')) renderer.$('#productName').focus();
    }
  });
  ['productPurchasePrice', 'productWholesalePrice', 'productRetailPrice'].forEach((id) => renderer.$(`#${id}`)?.addEventListener('input', updateProductProfitPreview));
  renderer.$('#categoryForm').addEventListener('submit', async (event) => { event.preventDefault(); const error = renderer.$('#categoryFormError'); error.classList.add('hidden'); const payload = { code: renderer.$('#categoryCode').value, name: renderer.$('#categoryName').value, description: renderer.$('#categoryDescription').value }; try { const id = renderer.$('#categoryId').value; if (id) await window.api.categories.update(Number(id), payload); else await window.api.categories.create(payload); closeManagementModal(); renderer.showToast(id ? 'دسته‌بندی با موفقیت ویرایش شد.' : 'دسته‌بندی با موفقیت ثبت شد.'); await loadManagedCategories(); } catch (err) { error.textContent = err.message; error.classList.remove('hidden'); } });
  renderer.$('#partyForm').addEventListener('submit', async (event) => { event.preventDefault(); const error = renderer.$('#partyFormError'); error.classList.add('hidden'); const payload = { firstName: renderer.$('#partyFirstName').value, lastName: renderer.$('#partyLastName').value, phone: renderer.$('#partyPhone').value, mobile: renderer.$('#partyMobile').value, address: renderer.$('#partyAddress').value, partyType: renderer.$('#partyType').value, description: renderer.$('#partyDescription').value }; try { const id = renderer.$('#partyId').value; if (id) await window.api.customers.update(Number(id), payload); else await window.api.customers.create(payload); closeManagementModal(); renderer.showToast(id ? 'طرف‌حساب با موفقیت ویرایش شد.' : 'طرف‌حساب با موفقیت ثبت شد.'); await loadManagedParties(); } catch (err) { error.textContent = err.message; error.classList.remove('hidden'); } });
}

// Deferred to the end of 07-auth-boot.js. These used to run here, but the
// renderer split into separate <script> tags changed the resolution order:
// initializeManagementMarkup() calls initializeSalesMarkupFinal(), which is
// declared in 04-invoices-assistant-reports.js and did not exist yet at this
// point in load order. In the original monolith a single hoisted declaration
// was visible everywhere before any of this ran.

let productBarcodeBuffer = '';
let productBarcodeStartedAt = 0;
document.addEventListener('keydown', (event) => {
  const productsPage = renderer.$('#productsPage');
  if (!productsPage || productsPage.classList.contains('hidden')) return;
  const target = event.target;
  const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
  if ((event.key === '/' || event.key === 'F2') && !typing) { event.preventDefault(); renderer.$('#productsFilter')?.focus(); return; }
  if (event.key.toLowerCase() === 'n' && !typing) { event.preventDefault(); renderer.$('#addProduct')?.click(); return; }
  if (event.key === 'Escape') { renderer.$('#productColumnsMenu')?.classList.add('hidden'); renderer.$('#productDetailsDrawer')?.classList.add('hidden'); }
  if (event.key === 'Enter' && !typing) { const first = document.querySelector('#productsTable .edit-product'); if (first) first.click(); }
  if (typing && target.id === 'productsFilter') {
    const now = performance.now();
    if (!productBarcodeStartedAt || now - productBarcodeStartedAt > 120) productBarcodeBuffer = '';
    productBarcodeStartedAt = now;
    if (event.key === 'Enter' && productBarcodeBuffer.length >= 4) { event.preventDefault(); target.value = productBarcodeBuffer; target.dispatchEvent(new Event('input', { bubbles: true })); productBarcodeBuffer = ''; }
    else if (event.key.length === 1 && !event.ctrlKey && !event.altKey) productBarcodeBuffer += event.key;
  }
});
document.addEventListener('click', (event) => { if (!event.target.closest('#productColumnsButton, #productColumnsMenu')) renderer.$('#productColumnsMenu')?.classList.add('hidden'); });

function initializeImportMarkup() {
  const heading = document.querySelector('#productsPage .page-heading');
  if (heading && !renderer.$('#importProducts')) heading.insertAdjacentHTML('beforeend', '<button id="importProducts" class="secondary">ورود از اکسل</button>');
  const backdrop = renderer.$('#managementModalBackdrop');
  if (backdrop && !renderer.$('#importProductsModal')) backdrop.insertAdjacentHTML('beforeend', `<div id="importProductsModal" class="modal hidden"><div class="modal-header"><div><span class="eyebrow">ورود گروهی</span><h3>ورود محصولات از اکسل</h3></div><button class="modal-close" data-close-management>×</button></div><div id="importProductsSummary" class="import-summary">برای انتخاب فایل روی دکمه زیر کلیک کنید.</div><div id="importProductsSample" class="import-sample"></div><div id="importProductsError" class="form-error hidden"></div><div class="modal-actions"><button type="button" class="secondary" data-close-management>انصراف</button><button id="selectImportFile" type="button" class="secondary">انتخاب فایل</button><button id="confirmImportProducts" type="button" class="primary" disabled>ثبت محصولات</button></div></div>`);
  renderer.$('#importProducts')?.addEventListener('click', () => {
    renderer.$('#managementModalBackdrop').classList.remove('hidden');
    document.querySelectorAll('#managementModalBackdrop .modal').forEach((node) => node.classList.add('hidden'));
    renderer.$('#importProductsModal').classList.remove('hidden');
    renderer.$('#importProductsSummary').textContent = 'برای انتخاب فایل روی دکمه «انتخاب فایل» کلیک کنید.';
    renderer.$('#importProductsSample').innerHTML = '';
    renderer.$('#importProductsError').classList.add('hidden');
    renderer.$('#confirmImportProducts').disabled = true;
    renderer.$('#confirmImportProducts').dataset.token = '';
  });
  renderer.$('#selectImportFile')?.addEventListener('click', async () => {
    const error = renderer.$('#importProductsError');
    error.classList.add('hidden');
    try {
      const preview = await window.api.products.importPreview();
      if (preview.canceled) return;
      renderer.$('#importProductsSummary').textContent = `شیت ${preview.sheetName || ''} · ${preview.total} کالا · ${preview.categoryCount} دسته‌بندی · ${preview.missingCategories.length} دسته جدید · ${preview.duplicateCount} تکراری · ${preview.priceWarningCount} هشدار قیمت`;
      renderer.$('#importProductsSample').innerHTML = preview.sample.map((row) => `<div><span>${esc(row.category)}</span><strong>${esc(row.name)}</strong><small>موجودی: ${row.stock} · خرید: ${row.purchasePrice} · عمده: ${row.wholesalePrice} · فروش: ${row.retailPrice}</small></div>`).join('');
      if (preview.parseErrors?.length) renderer.$('#importProductsSummary').textContent += ` · ${preview.parseErrors.length} ردیف نامعتبر`;
      renderer.$('#confirmImportProducts').dataset.token = preview.token;
      renderer.$('#confirmImportProducts').disabled = false;
    } catch (err) {
      error.textContent = err.message || 'خواندن فایل انجام نشد.';
      error.classList.remove('hidden');
    }
  });
  renderer.$('#confirmImportProducts')?.addEventListener('click', async () => {
    const token = renderer.$('#confirmImportProducts').dataset.token;
    if (!token) return;
    const button = renderer.$('#confirmImportProducts');
    button.disabled = true;
    try {
      const result = await window.api.products.importConfirm(token, renderer.$('#importDuplicateMode')?.value || 'skip');
      closeManagementModal();
      renderer.showToast(`${result.imported} کالا وارد شد؛ ${result.updated || 0} کالا به‌روزرسانی و ${result.skipped} تکراری رد شد.`);
      await loadManagedProducts();
      await window.api.dashboard.summary().then(renderer.renderMetrics);
      if (result.errors?.length) renderer.showToast(`${result.errors.length} ردیف وارد نشد.`, true);
    } catch (err) {
      const error = renderer.$('#importProductsError');
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
    if (!actions.querySelector('#productColumnsButton')) actions.insertAdjacentHTML('beforeend', '<button id="productColumnsButton" class="ghost" type="button">ستون‌ها</button><div id="productColumnsMenu" class="product-columns-menu hidden"></div>');
  }
  const toolbar = document.querySelector('#productsPage .management-toolbar');
  if (toolbar && !renderer.$('#productQualityFilter')) {
    toolbar.insertAdjacentHTML('beforeend', '<select id="productQualityFilter" title="فیلتر کیفیت داده"><option value="">همه کالاها</option><option value="zero-price">بدون قیمت</option><option value="abnormal-price">قیمت نامتعارف</option><option value="zero-stock">موجودی صفر</option><option value="low-stock">موجودی کم</option><option value="no-barcode">بدون بارکد</option><option value="inactive">کالاهای غیرفعال</option></select>');
  }
  const tablePanel = document.querySelector('#productsPage .table-panel');
  const productTable = document.querySelector('#productsPage table');
  if (productTable && !productTable.querySelector('.select-col')) {
    productTable.querySelector('thead tr')?.insertAdjacentHTML('afterbegin', '<th class="select-col"><input id="selectAllProducts" type="checkbox" aria-label="انتخاب همه کالاها"></th>');
  }
  if (tablePanel && !renderer.$('#productsBulkBar')) tablePanel.insertAdjacentHTML('beforebegin', '<div id="productsBulkBar" class="products-bulk-bar hidden"><strong><span id="selectedProductsCount">۰</span> کالا انتخاب شده</strong><button type="button" class="secondary" id="bulkActivateProducts">فعال‌سازی</button><button type="button" class="secondary" id="bulkDeactivateProducts">غیرفعال‌سازی</button><button type="button" class="ghost" id="bulkClearProducts">لغو انتخاب</button></div>');
  if (tablePanel && !renderer.$('#productsStats')) {
    tablePanel.insertAdjacentHTML('beforebegin', '<div id="productsStats" class="products-stats"></div>');
  }
  const importModal = renderer.$('#importProductsModal');
  if (importModal && !renderer.$('#importDuplicateMode')) {
    const actions = importModal.querySelector('.modal-actions');
    if (actions) actions.insertAdjacentHTML('afterbegin', '<label class="import-duplicate-field">محصول تکراری<select id="importDuplicateMode"><option value="skip">رد کردن</option><option value="update">به‌روزرسانی محصول موجود</option></select></label>');
  }
  if (renderer.$('#productQualityFilter') && !renderer.$('#productQualityFilter').dataset.bound) {
    renderer.$('#productQualityFilter').dataset.bound = '1';
    renderer.$('#productQualityFilter').addEventListener('change', () => renderManagedProducts());
  }
  if (renderer.$('#exportProducts') && !renderer.$('#exportProducts').dataset.bound) renderer.$('#exportProducts').addEventListener('click', async () => {
    try {
      const result = await window.api.products.export();
      if (!result.canceled) renderer.showToast(`${result.count} کالا خروجی گرفته شد.`);
    } catch (error) { renderer.showToast(error.message, true); }
  });
  if (renderer.$('#downloadProductTemplate') && !renderer.$('#downloadProductTemplate').dataset.bound) renderer.$('#downloadProductTemplate').addEventListener('click', async () => {
    try {
      const result = await window.api.products.template();
      if (!result.canceled) renderer.showToast('فایل نمونه ذخیره شد.');
    } catch (error) { renderer.showToast(error.message, true); }
  });
  if (renderer.$('#exportProducts')) renderer.$('#exportProducts').dataset.bound = '1';
  if (renderer.$('#downloadProductTemplate')) renderer.$('#downloadProductTemplate').dataset.bound = '1';
  initializeProductColumnMenu();
  if (!renderer.$('#productDetailsDrawer')) document.body.insertAdjacentHTML('beforeend', `<aside id="productDetailsDrawer" class="product-details-drawer hidden"><div class="product-details-head"><div><span class="eyebrow">اطلاعات کالا</span><h3 id="productDetailsTitle">کالا</h3></div><button type="button" class="modal-close" data-close-product-details>×</button></div><div id="productDetailsSummary" class="product-details-form"></div><div class="product-details-tabs"><button type="button" class="product-detail-tab active" data-detail-tab="prices">تاریخچه قیمت</button><button type="button" class="product-detail-tab" data-detail-tab="movements">گردش موجودی</button></div><div id="productDetailsContent" class="product-details-content"></div></aside>`);
  const closeDetailsButton = document.querySelector('[data-close-product-details]');
  if (closeDetailsButton && !closeDetailsButton.dataset.bound) { closeDetailsButton.dataset.bound = '1'; closeDetailsButton.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); renderer.$('#productDetailsDrawer')?.classList.add('hidden'); }); }
  const priceField = document.querySelector('#productRetailPrice');
  if (priceField && !renderer.$('#productProfitPreview')) priceField.closest('label')?.insertAdjacentHTML('afterend', '<div id="productProfitPreview" class="product-profit-preview" aria-live="polite"></div>');
  if (!renderer.$('#productsBulkBar')?.dataset.bound) {
    renderer.$('#productsBulkBar')?.setAttribute('data-bound', '1');
    renderer.$('#selectAllProducts')?.addEventListener('change', (event) => { document.querySelectorAll('#productsTable .product-select').forEach((input) => { input.checked = event.target.checked; }); updateProductSelectionUi(); });
    renderer.$('#productsBulkBar')?.addEventListener('click', async (event) => {
      const action = event.target.closest('#bulkActivateProducts, #bulkDeactivateProducts');
      if (event.target.closest('#bulkClearProducts')) { document.querySelectorAll('.product-select').forEach((input) => { input.checked = false; }); updateProductSelectionUi(); return; }
      if (!action) return;
      const ids = [...document.querySelectorAll('#productsTable .product-select:checked')].map((input) => Number(input.dataset.id));
      if (!ids.length) return;
      action.disabled = true;
      try { await Promise.all(ids.map((id) => window.api.products.setActive(id, action.id === 'bulkActivateProducts'))); renderer.showToast(`${ids.length} کالا به‌روزرسانی شد.`); await loadManagedProducts(); } catch (error) { renderer.showToast(error.message, true); } finally { action.disabled = false; }
    });
  }
}

function initializeProductColumnMenu() {
  const menu = renderer.$('#productColumnsMenu');
  if (!menu || menu.dataset.ready) return;
  const columns = [{ key: 'code', label: 'کد' }, { key: 'name', label: 'نام کالا' }, { key: 'category', label: 'دسته‌بندی' }, { key: 'prices', label: 'قیمت‌ها' }, { key: 'stock', label: 'موجودی' }, { key: 'unit', label: 'واحد' }, { key: 'status', label: 'وضعیت' }, { key: 'actions', label: 'عملیات' }];
  const saved = JSON.parse(localStorage.getItem('accletron.products.columns') || '{}');
  menu.innerHTML = '<strong>ستون‌های قابل نمایش</strong>' + columns.map((column) => `<label><input type="checkbox" data-column="${column.key}" ${saved[column.key] !== false ? 'checked' : ''}>${column.label}</label>`).join('') + '<button type="button" class="text-button" id="resetProductColumns">بازنشانی</button>';
  menu.dataset.ready = '1';
  renderer.$('#productColumnsButton')?.addEventListener('click', (event) => { event.stopPropagation(); menu.classList.toggle('hidden'); });
  menu.addEventListener('click', (event) => event.stopPropagation());
  menu.querySelectorAll('input').forEach((input) => input.addEventListener('change', applyProductColumnPrefs));
  renderer.$('#resetProductColumns')?.addEventListener('click', () => { localStorage.removeItem('accletron.products.columns'); menu.querySelectorAll('input').forEach((input) => { input.checked = true; }); applyProductColumnPrefs(); });
  applyProductColumnPrefs();
}
function applyProductColumnPrefs() {
  const menu = renderer.$('#productColumnsMenu'); if (!menu) return;
  const prefs = {}; menu.querySelectorAll('input[data-column]').forEach((input) => { prefs[input.dataset.column] = input.checked; });
  localStorage.setItem('accletron.products.columns', JSON.stringify(prefs));
  const keys = ['code', 'name', 'category', 'prices', 'stock', 'unit', 'status', 'actions'];
  document.querySelectorAll('#productsPage table tr').forEach((row) => { [...row.children].forEach((cell, index) => { if (index === 0) return; cell.style.display = prefs[keys[index - 1]] === false ? 'none' : ''; }); });
}

function updateProductProfitPreview() {
  const purchase = parsePriceInput(renderer.$('#productPurchasePrice')?.value || 0);
  const wholesale = parsePriceInput(renderer.$('#productWholesalePrice')?.value || 0);
  const retail = parsePriceInput(renderer.$('#productRetailPrice')?.value || 0);
  const formatPercent = (value) => `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(value)}٪`;
  const margin = (price) => purchase > 0 ? ((price - purchase) / purchase * 100) : 0;
  const preview = renderer.$('#productProfitPreview');
  if (preview) preview.innerHTML = `<span>پیشنهاد فروش: <b>${formatPriceInput(Math.ceil(purchase * 1.3))}</b></span><span>سود عمده: <b>${formatPercent(margin(wholesale))}</b></span><span>سود خرده: <b>${formatPercent(margin(retail))}</b></span>`;
}

function updateProductSelectionUi() {
  const selected = document.querySelectorAll('#productsTable .product-select:checked').length;
  const bar = renderer.$('#productsBulkBar'); if (bar) bar.classList.toggle('hidden', selected === 0);
  if (renderer.$('#selectedProductsCount')) renderer.$('#selectedProductsCount').textContent = new Intl.NumberFormat('fa-IR').format(selected);
}

async function openProductDetails(product) {
  const drawer = renderer.$('#productDetailsDrawer'); if (!drawer || !product) return;
  drawer.dataset.productId = String(product.id); drawer.classList.remove('hidden');
  renderer.$('#productDetailsTitle').textContent = product.name;
  renderer.$('#productDetailsSummary').innerHTML = `<div class="details-card details-card-code"><span>کد کالا</span><b>${esc(product.code || '—')}</b></div><div class="details-card details-card-stock"><span>موجودی</span><b>${esc(product.stock)} ${esc(product.unitSymbol || product.unitName || '')}</b></div><div class="details-card details-card-price"><span>قیمت فروش</span><b>${renderer.money(product.salePrice)}</b></div>`;
  await renderProductDetailsTab('prices', product);
}
async function renderProductDetailsTab(tab, product) {
  const content = renderer.$('#productDetailsContent'); if (!content) return;
  content.innerHTML = '<div class="empty-state compact">در حال بارگذاری...</div>';
  try {
    if (tab === 'prices') {
      const response = await window.api.purchases.priceHistory(product.id, { limit: 50 });
      const rows = Array.isArray(response) ? response : (response?.items || []);
      content.innerHTML = rows?.length ? `<table class="details-table"><thead><tr><th>تاریخ</th><th>تأمین‌کننده</th><th>قیمت واحد</th><th>تعداد</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${dateTimeToJalali(row.date || row.createdAt)}</td><td>${esc(row.partyName || row.supplierName || '—')}</td><td>${renderer.money(row.unitPrice || row.purchasePrice || 0)}</td><td>${esc(row.quantity ?? '—')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state compact">تاریخچه قیمتی ثبت نشده است.</div>';
    } else {
      const rows = await window.api.inventory.movements({ productId: product.id });
      const labels = { purchase: 'خرید', sale: 'فروش', adjustment: 'اصلاح', return: 'مرجوعی' };
      content.innerHTML = rows?.length ? `<table class="details-table"><thead><tr><th>تاریخ</th><th>نوع</th><th>تغییر</th><th>شرح</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${dateTimeToJalali(row.createdAt)}</td><td>${labels[row.type] || esc(row.type)}</td><td class="${Number(row.quantity) < 0 ? 'loss-amount' : 'profit-amount'}">${esc(row.quantity)}</td><td>${esc(row.description || '—')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state compact">گردش موجودی ثبت نشده است.</div>';
    }
  } catch (error) { content.innerHTML = `<div class="form-error">${esc(error.message || 'بارگذاری اطلاعات انجام نشد.')}</div>`; }
}

// ── Local semantic product search (offline embeddings, no internet) ───────
let semanticSearchEnabled = localStorage.getItem('accletron.products.semantic') === '1';
let semanticSearchAvailable = null;
let semanticDebounceTimer;
// Cosine-similarity floor for semantic-only matches (keyword matches are exempt).
const SEMANTIC_MIN_SCORE = 0.32;
const semanticRankingCache = new Map();

function semanticRankingForTerm(term) {
  if (!semanticSearchEnabled || semanticSearchAvailable === false) return null;
  const key = renderer.normalizeSearchText(String(term || ''));
  if (key.length < 2) return null;
  return semanticRankingCache.get(key) || null;
}

function semanticPending(term) {
  return semanticSearchEnabled && semanticSearchAvailable !== false
    && String(term || '').trim().length >= 2 && !semanticRankingCache.has(renderer.normalizeSearchText(term));
}

function updateSemanticToggle() {
  const button = renderer.$('#semanticSearchToggle');
  if (!button) return;
  const unavailable = semanticSearchAvailable === false;
  button.classList.toggle('active', semanticSearchEnabled && !unavailable);
  button.disabled = unavailable;
  button.title = unavailable
    ? 'سرویس جست‌وجوی هوشمند در دسترس نیست — برای نصب مدل لوکال دستور npm run ai:fetch را اجرا کنید.'
    : 'جست‌وجوی معنایی لوکال (بدون اینترنت) — کالاها بر اساس شباهت معنایی مرتب می‌شوند';
}

function requestSemanticSearch() {
  const term = (renderer.$('#productsFilter')?.value || '').trim();
  if (!semanticSearchEnabled || semanticSearchAvailable === false || term.length < 2) return;
  const key = renderer.normalizeSearchText(term);
  if (semanticRankingCache.has(key)) return;
  clearTimeout(semanticDebounceTimer);
  semanticDebounceTimer = setTimeout(async () => {
    try {
      const response = await window.api.ai.semanticSearch({ query: term, limit: 60 });
      if (response?.available) {
        if (semanticRankingCache.size > 30) semanticRankingCache.clear();
        semanticRankingCache.set(key, new Map(response.results.map((row) => [Number(row.id), Number(row.score)])));
        semanticSearchAvailable = true;
        renderManagedProducts();
      } else {
        semanticSearchAvailable = false;
      }
    } catch {
      semanticSearchAvailable = false;
    }
    updateSemanticToggle();
  }, 350);
}

document.addEventListener('input', (event) => {
  if (event.target?.id === 'productsFilter') requestSemanticSearch();
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('#semanticSearchToggle')) return;
  if (semanticSearchAvailable === false) {
    renderer.showToast('مدل جست‌وجوی هوشمند نصب نیست؛ یک بار با اتصال اینترنت دستور npm run ai:fetch را اجرا کنید.', true);
    return;
  }
  semanticSearchEnabled = !semanticSearchEnabled;
  localStorage.setItem('accletron.products.semantic', semanticSearchEnabled ? '1' : '0');
  updateSemanticToggle();
  renderManagedProducts();
  if (semanticSearchEnabled) requestSemanticSearch();
});
// Probed from refreshAfterLogin: the boot copy is rejected by the IPC guard
// before a session exists, so the semantic toggle must be re-checked after login.
function refreshSemanticStatus() {
  window.api?.ai?.status?.().then((status) => {
    semanticSearchAvailable = Boolean(status?.available);
    updateSemanticToggle();
  }).catch(() => {
    semanticSearchAvailable = false;
    updateSemanticToggle();
  });
}
if (renderer.sessionReady) refreshSemanticStatus();

function renderEnhancedManagedProducts() {
  enhanceProductManagementUi();
  const term = (renderer.$('#productsFilter')?.value || '').trim().toLowerCase();
  const searchTokens = renderer.normalizeSearchText(term).split(/\s+/).filter(Boolean);
  const category = renderer.$('#productCategoryFilter')?.value || '';
  const quality = renderer.$('#productQualityFilter')?.value || '';
  const includeInactive = renderer.$('#showInactiveProducts')?.checked;
  const semanticRanking = semanticRankingForTerm(term);
  const semanticWaiting = !semanticRanking && semanticPending(term);
  // Hybrid precision: an exact keyword match always qualifies, while a pure
  // semantic hit must clear the relevance floor so loosely related products
  // never pollute the results.
  const matchInfo = new Map();
  const haystackCache = new Map();
  const haystackOf = (p) => {
    let haystack = haystackCache.get(p);
    if (haystack === undefined) {
      haystack = renderer.normalizeSearchText([p.name, p.code, p.barcode, p.categoryName].filter(Boolean).join(' '));
      haystackCache.set(p, haystack);
    }
    return haystack;
  };
  const rows = managementState.products.filter((p) => {
    if (!includeInactive && quality !== 'inactive' && !p.isActive) return false;
    if (quality === 'inactive' && p.isActive) return false;
    if (category && String(p.categoryId) !== category) return false;
    const keywordMatched = !searchTokens.length
      || searchTokens.every((token) => haystackOf(p).includes(token));
    const score = semanticRanking ? Number(semanticRanking.get(Number(p.id)) || 0) : 0;
    if (semanticRanking) {
      if (!keywordMatched && score < SEMANTIC_MIN_SCORE) return false;
    } else if (!keywordMatched) {
      return false;
    }
    if (quality === 'zero-price' && !(Number(p.purchasePrice || 0) === 0 || Number(p.wholesalePrice || 0) === 0 || Number(p.salePrice || 0) === 0)) return false;
    if (quality === 'abnormal-price' && !productPriceWarning(p)) return false;
    if (quality === 'zero-stock' && Number(p.stock || 0) !== 0) return false;
    if (quality === 'low-stock' && !(Number(p.stock || 0) <= Number(p.minimumStock || 0))) return false;
    if (quality === 'no-barcode' && String(p.barcode || '').trim()) return false;
    matchInfo.set(p, { keywordMatched, score });
    return true;
  });
  if (semanticRanking) {
    // Keyword matches outrank semantic-only hits; within each group, order by similarity.
    rows.sort((a, b) => {
      const infoA = matchInfo.get(a) || { keywordMatched: false, score: 0 };
      const infoB = matchInfo.get(b) || { keywordMatched: false, score: 0 };
      return (Number(infoB.keywordMatched) + infoB.score) - (Number(infoA.keywordMatched) + infoA.score);
    });
  }
  const all = managementState.products;
  const zeroPrice = all.filter((p) => Number(p.purchasePrice || 0) === 0 || Number(p.wholesalePrice || 0) === 0 || Number(p.salePrice || 0) === 0).length;
  const zeroStock = all.filter((p) => Number(p.stock || 0) === 0).length;
  const lowStock = all.filter((p) => Number(p.stock || 0) <= Number(p.minimumStock || 0)).length;
  const inactive = all.filter((p) => !p.isActive).length;
  if (renderer.$('#productsStats')) renderer.$('#productsStats').innerHTML = `<button type="button" class="product-stat-filter ${!quality ? 'selected' : ''}" data-quality="">همه <b>${new Intl.NumberFormat('fa-IR').format(all.length)}</b></button><button type="button" class="product-stat-filter ${quality === 'low-stock' ? 'selected' : ''}" data-quality="low-stock">موجودی کم <b>${new Intl.NumberFormat('fa-IR').format(lowStock)}</b></button><button type="button" class="product-stat-filter ${quality === 'zero-stock' ? 'selected' : ''}" data-quality="zero-stock">ناموجود <b>${new Intl.NumberFormat('fa-IR').format(zeroStock)}</b></button><button type="button" class="product-stat-filter ${quality === 'zero-price' ? 'selected' : ''}" data-quality="zero-price">قیمت ناقص <b>${new Intl.NumberFormat('fa-IR').format(zeroPrice)}</b></button><button type="button" class="product-stat-filter ${quality === 'inactive' ? 'selected' : ''}" data-quality="inactive">غیرفعال <b>${new Intl.NumberFormat('fa-IR').format(inactive)}</b></button>`;
  renderer.$('#productsTable').innerHTML = rows.length ? rows.map((p) => { const stock = Number(p.stock || 0); const minimum = Number(p.minimumStock || 0); const stockState = stock <= 0 ? 'out' : (stock <= minimum ? 'low' : 'ok'); const stockLabel = stock <= 0 ? 'ناموجود' : (stock <= minimum ? 'کمبود' : 'مناسب'); return `<tr class="${p.isActive ? '' : 'muted-row'}"><td>${esc(p.code)}</td><td><button type="button" class="product-details-trigger" data-id="${p.id}" aria-label="نمایش جزئیات ${esc(p.name)}">${esc(p.name)}</button>${semanticRanking && matchInfo.get(p)?.score > 0 ? `<span class="semantic-score" title="شباهت معنایی">${Math.max(0, Math.min(100, Math.round(matchInfo.get(p).score * 100)))}٪</span>` : ''}${p.barcode ? `<small>${esc(p.barcode)}</small>` : ''}</td><td>${esc(p.categoryName || '—')}</td><td class="product-prices-cell"><label>خرید<input class="quick-product-purchase" type="number" min="0" value="${Math.round((Number(p.purchasePrice || 0) / 100) * renderer.currencyFactor())}"></label><label>عمده<input class="quick-product-wholesale" type="number" min="0" value="${Math.round((Number(p.wholesalePrice || 0) / 100) * renderer.currencyFactor())}"></label><label>فروش<input class="quick-product-price" data-id="${p.id}" data-field="retailPrice" type="number" min="0" value="${Math.round((Number(p.salePrice || 0) / 100) * renderer.currencyFactor())}"></label></td><td class="product-stock-cell"><input class="quick-product-stock" data-id="${p.id}" type="number" min="0" step="0.01" value="${p.stock ?? 0}"><span class="stock-indicator ${stockState}">${stockLabel}</span></td><td>${esc(p.unitSymbol || p.unitName || '—')}</td><td><span class="status-badge ${p.isActive ? 'active' : 'inactive'}">${p.isActive ? 'فعال' : 'غیرفعال'}</span>${productPriceWarning(p) ? '<span class="quality-badge">بررسی قیمت</span>' : ''}</td><td><button class="table-action quick-product-save" data-id="${p.id}">ذخیره</button><button class="table-action edit-product" data-id="${p.id}">ویرایش</button><button class="table-action danger toggle-product" data-id="${p.id}" data-active="${p.isActive}">${p.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button></td></tr>`; }).join('') : `<tr class="empty-row"><td colspan="8">${semanticWaiting ? 'در حال آماده‌سازی نتایج جست‌وجوی هوشمند…' : 'کالایی برای نمایش وجود ندارد.'}</td></tr>`;
  renderer.$('#productsTable .empty-row td')?.setAttribute('colspan', '9');
  renderer.$('#productsTable').querySelectorAll('tr').forEach((row, index) => {
    const product = rows[index];
    if (!product) return;
    const currentStock = Number(product.stock || 0);
    const minimumStock = Number(product.minimumStock || 0);
    row.classList.remove('stock-row-out', 'stock-row-low', 'stock-row-ok');
    row.classList.add(currentStock <= 0 ? 'stock-row-out' : (currentStock <= minimumStock ? 'stock-row-low' : 'stock-row-ok'));
    if (!row.querySelector('.product-select')) row.insertAdjacentHTML('afterbegin', `<td class="select-col"><input class="product-select" type="checkbox" data-id="${product.id}" aria-label="انتخاب ${esc(product.name)}"></td>`);
    [[row.querySelector('.quick-product-purchase'), product.purchasePrice], [row.querySelector('.quick-product-wholesale'), product.wholesalePrice], [row.querySelector('.quick-product-price'), product.salePrice]].forEach(([field, price]) => {
      if (!field) return;
      field.type = 'text';
      field.inputMode = 'decimal';
      field.removeAttribute('min');
      field.value = formatPriceInput(price);
    });
    const stockField = row.querySelector('.quick-product-stock');
    if (stockField) { stockField.step = '1'; stockField.value = String(Math.round(Number(product.stock || 0))); }
  });
  applyProductColumnPrefs();
}

document.addEventListener('click', (event) => {
  const filter = event.target.closest('.product-stat-filter');
  if (!filter) return;
  const quality = renderer.$('#productQualityFilter');
  if (quality) { quality.value = filter.dataset.quality || ''; renderManagedProducts(); }
});

function bindQuickProductPriceEvents() {
  if (document.body.dataset.quickProductPriceBound === '1') return;
  document.body.dataset.quickProductPriceBound = '1';
  document.addEventListener('input', (event) => {
    const field = event.target;
    const row = field.closest('#productsTable tr');
    if (!row) return;
    const isPriceField = field.classList.contains('quick-product-purchase') || field.classList.contains('quick-product-wholesale') || field.classList.contains('quick-product-price');
    if (isPriceField) field.value = formatPriceInput(parsePriceInput(field.value));
    if (field.classList.contains('quick-product-wholesale')) field.dataset.manual = '1';
    if (field.classList.contains('quick-product-price')) field.dataset.manual = '1';
    if (!field.classList.contains('quick-product-purchase')) return;
    const purchase = parsePriceInput(field.value);
    const wholesale = row.querySelector('.quick-product-wholesale');
    const retail = row.querySelector('.quick-product-price');
    if (wholesale && wholesale.dataset.manual !== '1') wholesale.value = purchase > 0 ? formatPriceInput(Math.ceil(purchase * 1.2)) : formatPriceInput(0);
    if (retail && retail.dataset.manual !== '1') retail.value = purchase > 0 ? formatPriceInput(Math.ceil(purchase * 1.3)) : formatPriceInput(0);
  });
}

renderManagedProducts = renderEnhancedManagedProducts;
enhanceProductManagementUi();
bindQuickProductPriceEvents();

document.addEventListener('click', async (event) => {
  if (event.target.closest('[data-close-product-details]')) { renderer.$('#productDetailsDrawer')?.classList.add('hidden'); return; }
  const detailTab = event.target.closest('[data-detail-tab]');
  if (detailTab) { const drawer = renderer.$('#productDetailsDrawer'); const product = managementState.products.find((item) => item.id === Number(drawer?.dataset.productId)); if (product) { document.querySelectorAll('.product-detail-tab').forEach((tab) => tab.classList.toggle('active', tab === detailTab)); await renderProductDetailsTab(detailTab.dataset.detailTab, product); } return; }
  if (event.target.closest('.product-select')) { updateProductSelectionUi(); return; }
  const detailsTrigger = event.target.closest('.product-details-trigger');
  if (detailsTrigger) {
    const product = managementState.products.find((item) => item.id === Number(detailsTrigger.dataset.id));
    if (product) openProductDetails(product);
    return;
  }
  const button = event.target.closest('.quick-product-save');
  if (!button) return;
  const id = Number(button.dataset.id);
  // Read values from the clicked row itself. A filtered list can contain
  // multiple matching products, so a global selector may accidentally read
  // another row's input and overwrite the wrong product's price.
  const row = button.closest('tr');
  const purchasePrice = parsePriceInput(row?.querySelector('.quick-product-purchase')?.value || 0);
  const wholesalePrice = parsePriceInput(row?.querySelector('.quick-product-wholesale')?.value || 0);
  const price = parsePriceInput(row?.querySelector('.quick-product-price')?.value || 0);
  const stock = Math.max(0, Math.round(Number(row?.querySelector('.quick-product-stock')?.value || 0)));
  button.disabled = true;
  try {
    await window.api.products.quickUpdate(id, { purchasePrice, wholesalePrice, retailPrice: price, stock });
    renderer.showToast('قیمت فروش و موجودی با موفقیت به‌روزرسانی شد.');
    await loadManagedProducts();
  } catch (error) {
    renderer.showToast(error.message, true);
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
  const count = renderer.$('#productsTotalCount');
  if (count) count.textContent = ` · ${new Intl.NumberFormat('fa-IR').format(managementState.products.length)} کالا`;
}

const originalRenderManagedProducts = renderManagedProducts;
renderManagedProducts = function renderManagedProductsWithCount() {
  originalRenderManagedProducts();
  alignProductPageHeader();
  updateProductsTotalCount();
};

alignProductPageHeader();

registerRendererBindings(renderer, {
  constants: { managementState, saleState, invoiceState, esc, readableError, toman, parsePriceInput, formatPriceInput, jalaliMonthNames, SEMANTIC_MIN_SCORE, semanticRankingCache, originalRenderManagedProducts },
  mutable: {
    productModalInvoiceTarget: { get: () => productModalInvoiceTarget, set: (value) => { productModalInvoiceTarget = value; } },
    productSellingPriceAuto: { get: () => productSellingPriceAuto, set: (value) => { productSellingPriceAuto = value; } },
    productCodePreviewSerial: { get: () => productCodePreviewSerial, set: (value) => { productCodePreviewSerial = value; } },
    managedProductsLoadSerial: { get: () => managedProductsLoadSerial, set: (value) => { managedProductsLoadSerial = value; } },
    productBarcodeBuffer: { get: () => productBarcodeBuffer, set: (value) => { productBarcodeBuffer = value; } },
    productBarcodeStartedAt: { get: () => productBarcodeStartedAt, set: (value) => { productBarcodeStartedAt = value; } },
    semanticSearchEnabled: { get: () => semanticSearchEnabled, set: (value) => { semanticSearchEnabled = value; } },
    semanticSearchAvailable: { get: () => semanticSearchAvailable, set: (value) => { semanticSearchAvailable = value; } },
    semanticDebounceTimer: { get: () => semanticDebounceTimer, set: (value) => { semanticDebounceTimer = value; } }
  },
  functions: {
    gregorianToJalali: { get: () => gregorianToJalali, set: (value) => { gregorianToJalali = value; } },
    jalaliToGregorian: { get: () => jalaliToGregorian, set: (value) => { jalaliToGregorian = value; } },
    isoToJalali: { get: () => isoToJalali, set: (value) => { isoToJalali = value; } },
    dateTimeToJalali: { get: () => dateTimeToJalali, set: (value) => { dateTimeToJalali = value; } },
    jalaliInputToIso: { get: () => jalaliInputToIso, set: (value) => { jalaliInputToIso = value; } },
    jalaliMonthDays: { get: () => jalaliMonthDays, set: (value) => { jalaliMonthDays = value; } },
    parseJalaliDate: { get: () => parseJalaliDate, set: (value) => { parseJalaliDate = value; } },
    renderJalaliPicker: { get: () => renderJalaliPicker, set: (value) => { renderJalaliPicker = value; } },
    bindJalaliDatePickers: { get: () => bindJalaliDatePickers, set: (value) => { bindJalaliDatePickers = value; } },
    initializeManagementMarkup: { get: () => initializeManagementMarkup, set: (value) => { initializeManagementMarkup = value; } },
    groupSidebarMenu: { get: () => groupSidebarMenu, set: (value) => { groupSidebarMenu = value; } },
    initializeSidebarGroups: { get: () => initializeSidebarGroups, set: (value) => { initializeSidebarGroups = value; } },
    initializeSalesMarkupLegacy: { get: () => initializeSalesMarkupLegacy, set: (value) => { initializeSalesMarkupLegacy = value; } },
    renderSaleProducts: { get: () => renderSaleProducts, set: (value) => { renderSaleProducts = value; } },
    renderSaleCart: { get: () => renderSaleCart, set: (value) => { renderSaleCart = value; } },
    loadSaleProducts: { get: () => loadSaleProducts, set: (value) => { loadSaleProducts = value; } },
    addSaleProduct: { get: () => addSaleProduct, set: (value) => { addSaleProduct = value; } },
    bindSalesEvents: { get: () => bindSalesEvents, set: (value) => { bindSalesEvents = value; } },
    setManagedPage: { get: () => setManagedPage, set: (value) => { setManagedPage = value; } },
    openManagementModal: { get: () => openManagementModal, set: (value) => { openManagementModal = value; } },
    closeManagementModal: { get: () => closeManagementModal, set: (value) => { closeManagementModal = value; } },
    loadProductPurchaseHistory: { get: () => loadProductPurchaseHistory, set: (value) => { loadProductPurchaseHistory = value; } },
    openProductForInvoice: { get: () => openProductForInvoice, set: (value) => { openProductForInvoice = value; } },
    openProductForEdit: { get: () => openProductForEdit, set: (value) => { openProductForEdit = value; } },
    setupProductPriceFields: { get: () => setupProductPriceFields, set: (value) => { setupProductPriceFields = value; } },
    updateProductSellingPrices: { get: () => updateProductSellingPrices, set: (value) => { updateProductSellingPrices = value; } },
    bindProductPriceAutoEvents: { get: () => bindProductPriceAutoEvents, set: (value) => { bindProductPriceAutoEvents = value; } },
    normalizeProductLookupText: { get: () => normalizeProductLookupText, set: (value) => { normalizeProductLookupText = value; } },
    productLookupItems: { get: () => productLookupItems, set: (value) => { productLookupItems = value; } },
    syncProductLookupValues: { get: () => syncProductLookupValues, set: (value) => { syncProductLookupValues = value; } },
    initializeProductLookups: { get: () => initializeProductLookups, set: (value) => { initializeProductLookups = value; } },
    renderProductOptions: { get: () => renderProductOptions, set: (value) => { renderProductOptions = value; } },
    updateProductCodePreview: { get: () => updateProductCodePreview, set: (value) => { updateProductCodePreview = value; } },
    renderManagedProducts: { get: () => renderManagedProducts, set: (value) => { renderManagedProducts = value; } },
    renderManagedCategories: { get: () => renderManagedCategories, set: (value) => { renderManagedCategories = value; } },
    renderManagedParties: { get: () => renderManagedParties, set: (value) => { renderManagedParties = value; } },
    loadManagedProducts: { get: () => loadManagedProducts, set: (value) => { loadManagedProducts = value; } },
    loadManagedCategories: { get: () => loadManagedCategories, set: (value) => { loadManagedCategories = value; } },
    loadManagedParties: { get: () => loadManagedParties, set: (value) => { loadManagedParties = value; } },
    bindManagementEvents: { get: () => bindManagementEvents, set: (value) => { bindManagementEvents = value; } },
    initializeImportMarkup: { get: () => initializeImportMarkup, set: (value) => { initializeImportMarkup = value; } },
    productPriceWarning: { get: () => productPriceWarning, set: (value) => { productPriceWarning = value; } },
    enhanceProductManagementUi: { get: () => enhanceProductManagementUi, set: (value) => { enhanceProductManagementUi = value; } },
    initializeProductColumnMenu: { get: () => initializeProductColumnMenu, set: (value) => { initializeProductColumnMenu = value; } },
    applyProductColumnPrefs: { get: () => applyProductColumnPrefs, set: (value) => { applyProductColumnPrefs = value; } },
    updateProductProfitPreview: { get: () => updateProductProfitPreview, set: (value) => { updateProductProfitPreview = value; } },
    updateProductSelectionUi: { get: () => updateProductSelectionUi, set: (value) => { updateProductSelectionUi = value; } },
    openProductDetails: { get: () => openProductDetails, set: (value) => { openProductDetails = value; } },
    renderProductDetailsTab: { get: () => renderProductDetailsTab, set: (value) => { renderProductDetailsTab = value; } },
    semanticRankingForTerm: { get: () => semanticRankingForTerm, set: (value) => { semanticRankingForTerm = value; } },
    semanticPending: { get: () => semanticPending, set: (value) => { semanticPending = value; } },
    updateSemanticToggle: { get: () => updateSemanticToggle, set: (value) => { updateSemanticToggle = value; } },
    requestSemanticSearch: { get: () => requestSemanticSearch, set: (value) => { requestSemanticSearch = value; } },
    refreshSemanticStatus: { get: () => refreshSemanticStatus, set: (value) => { refreshSemanticStatus = value; } },
    renderEnhancedManagedProducts: { get: () => renderEnhancedManagedProducts, set: (value) => { renderEnhancedManagedProducts = value; } },
    bindQuickProductPriceEvents: { get: () => bindQuickProductPriceEvents, set: (value) => { bindQuickProductPriceEvents = value; } },
    alignProductPageHeader: { get: () => alignProductPageHeader, set: (value) => { alignProductPageHeader = value; } },
    updateProductsTotalCount: { get: () => updateProductsTotalCount, set: (value) => { updateProductsTotalCount = value; } }
  }
});
