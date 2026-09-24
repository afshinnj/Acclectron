const state = { page: 'dashboard', items: [], products: [] };
const $ = (selector) => document.querySelector(selector);
const dailySaleDraftStorageKey = 'accletron.daily-sale.draft.v1';
// Close the dynamically-created product details drawer at capture phase so
// other delegated handlers cannot swallow the click.
document.addEventListener('click', (event) => {
  const closeButton = event.target?.closest?.('[data-close-product-details]');
  if (!closeButton) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  document.querySelector('#productDetailsDrawer')?.classList.add('hidden');
}, true);
document.addEventListener('pointerdown', (event) => {
  const closeButton = event.target?.closest?.('[data-close-product-details]');
  if (!closeButton) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  document.querySelector('#productDetailsDrawer')?.classList.add('hidden');
}, true);
// Bind login at document level so it remains available even while the
// dashboard/settings markup is being initialized asynchronously.
document.addEventListener('click', async (event) => {
  if (!event.target?.closest?.('#loginSubmit')) return;
  event.preventDefault();
  const error = $('#loginError');
  error?.classList.add('hidden');
  try {
    const session = await window.api.auth.login($('#loginUsername')?.value || '', $('#loginPassword')?.value || '');
    $('#loginBackdrop')?.classList.add('hidden');
    warnDefaultPassword(session);
    refreshAfterLogin();
  } catch (e) {
    if (error) {
      error.textContent = String(e?.message || 'ورود ناموفق بود.');
      error.classList.remove('hidden');
    }
  }
}, true);
document.addEventListener('submit', (event) => {
  if (event.target?.id === 'loginForm') event.preventDefault();
}, true);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target?.closest?.('#loginForm')) {
    event.preventDefault();
    $('#loginSubmit')?.click();
  }
}, true);
// Data loads that run at boot are rejected before login by the main-process
// IPC guard; re-run them once a session actually exists.
function refreshAfterLogin() {
  loadNotifications().catch(() => {});
  window.api.dashboard.summary().then((summary) => { renderMetrics(summary); renderDashboard(summary); }).catch(() => {});
}
let uiCurrency = { code: 'IRR', name: '\u0631\u06cc\u0627\u0644', symbol: '\u0631\u06cc\u0627\u0644', position: 'suffix', decimals: 0, separator: true, inputUnit: 'rial' };
let defaultSettlementMethod = 'cash';
let uiTheme = 'dark';
let uiThemePreference = 'dark';
let uiCalendar = 'jalali';
let uiNotifications = true;
let uiShortcuts = true;
let systemThemeMediaQuery;
let systemThemeListenerBound = false;

function applyAppearanceSettings(appearance = {}) {
  const previousCalendar = uiCalendar;
  const theme = ['dark', 'light', 'system', 'hacker'].includes(String(appearance.theme))
    ? String(appearance.theme)
    : 'dark';
  const resolvedTheme = theme === 'system'
    ? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme;
  uiTheme = resolvedTheme;
  uiThemePreference = theme;
  uiCalendar = 'jalali';
  uiNotifications = appearance.notifications !== false;
  uiShortcuts = appearance.shortcuts !== false;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themeMode = theme;
  if (!systemThemeMediaQuery && window.matchMedia) systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: light)');
  if (systemThemeMediaQuery && !systemThemeListenerBound) {
    const refreshSystemTheme = () => {
      if (uiThemePreference === 'system') applyAppearanceSettings({ theme: 'system', notifications: uiNotifications, shortcuts: uiShortcuts, fontScale: Number(document.documentElement.style.getPropertyValue('--font-scale') || 1) * 100 });
    };
    if (systemThemeMediaQuery.addEventListener) systemThemeMediaQuery.addEventListener('change', refreshSystemTheme);
    else systemThemeMediaQuery.addListener?.(refreshSystemTheme);
    systemThemeListenerBound = true;
  }
  // Keep the native Windows 11 caption buttons in sync with the active theme.
  const overlayColors = {
    dark: { color: '#111b2b', symbolColor: '#dbe7f5' },
    light: { color: '#ffffff', symbolColor: '#3b4a5f' },
    hacker: { color: '#04120a', symbolColor: '#d6ffe3' }
  };
  window.api?.window?.setOverlay?.(overlayColors[resolvedTheme] || overlayColors.dark)?.catch?.(() => {});
  const scale = Math.max(80, Math.min(130, Number(appearance.fontScale || 100))) / 100;
  document.documentElement.style.setProperty('--font-scale', String(scale));
  document.documentElement.style.zoom = String(scale);
  document.documentElement.style.setProperty('--calendar', uiCalendar);
  document.querySelectorAll('input[type="date"], input.jalali-date-input').forEach((input) => {
    const parsed = previousCalendar === 'jalali' && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.value || ''))
      ? parseJalaliDate(input.value)
      : null;
    const iso = parsed ? jalaliToGregorian(parsed.year, parsed.month, parsed.day) : input.value;
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.classList.add('jalali-date-input');
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) input.value = isoToJalali(iso);
  });
}

const currencyIsRial = (currency = uiCurrency) => {
  const inputUnit = String(currency.inputUnit || '').toLowerCase();
  if (inputUnit === 'rial') return true;
  if (inputUnit === 'toman') {
    // Older saved settings sometimes kept inputUnit=toman while the user
    // changed the visible currency to ریال. Respect the visible choice.
    const text = `${currency.name || ''} ${currency.symbol || ''}`.toLowerCase();
    if (text.includes('\u0631\u06cc\u0627\u0644') || text.includes('rial')) return true;
  }
  return String(currency.code || '').toUpperCase() === 'IRR'
    && !String(currency.name || '').toLowerCase().includes('\u062a\u0648\u0645\u0627\u0646')
    && !String(currency.symbol || '').toLowerCase().includes('\u062a\u0648\u0645\u0627\u0646');
};
const currencyFactor = (currency = uiCurrency) => currencyIsRial(currency) ? 10 : 1;
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
  renderDashboardSkeleton();
  try { const summary = await window.api.dashboard.summary(); renderMetrics(summary); renderDashboard(summary); } catch {}
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
// Unifies Persian/Arabic letter and digit variants so search ignores them:
// ۰-۹ and ٠-٩ map to 0-9, ي/ك map to ی/ک and ZWNJ becomes a space.
const normalizeSearchText = (value) => String(value ?? '')
  .replace(/[يى]/g, 'ی')
  .replace(/[ك]/g, 'ک')
  .replace(/\u0640/g, '')
  .replace(/[\u200c\u200d\u200e\u200f]/g, ' ')
  .replace(/[\u06F0-\u06F9]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  .replace(/[\u0660-\u0669]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .toLowerCase();

// ── Inline SVG icon set (Fluent-style line icons, theme-aware via currentColor) ──
const svgIcon = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const NAV_ICONS = {
  dashboard: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  sales: '<path d="M12 5v14M5 12h14"/>',
  'sales-invoice': '<path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5"/><path d="M9.5 13h5M9.5 17h5"/>',
  purchases: '<path d="M12 3v11M7.5 10 12 14.5 16.5 10"/><path d="M5 20h14"/>',
  'sales-invoices': '<path d="M8 3h8l4 4v13a1 1 0 0 1-1 1H8z"/><path d="M16 3v4h4"/><path d="M4 7v13h4"/>',
  'purchase-invoices': '<path d="M8 3h8l4 4v13a1 1 0 0 1-1 1H8z"/><path d="M16 3v4h4"/><path d="M4 7v13h4"/><path d="M11 12l2 2 3.5-3.5"/>',
  products: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  categories: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  customers: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5"/>',
  ledger: '<path d="M8.5 6H20M8.5 12H20M8.5 18H20"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  inventory: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  returns: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12H8"/>',
  checks: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  installments: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  cash: '<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 12h.01M17.5 12h.01"/>',
  'profit-loss': '<path d="m3 17 6-6 4 4 8-8"/><path d="M14.5 7H21v6.5"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c1-3 3-4.5 5.5-4.5s4.5 1.5 5.5 4.5"/><path d="M15.5 5.4a3 3 0 0 1 0 5.7M16.5 14.8c1.9.7 3.3 2.1 4 4.2"/>',
  reports: '<path d="M5 20v-6M11 20V6M17 20v-9"/><path d="M3 20h18"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.8 4.8l2.1 2.1M17.1 17.1l2.1 2.1M2.5 12h3M18.5 12h3M4.8 19.2 6.9 17M17.1 6.9l2.1-2.1"/>',
  assistant: '<path d="M11 4l1.6 4.7L17.3 10l-4.7 1.6L11 16.4 9.4 11.6 4.7 10l4.7-1.3z"/><path d="M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  bell: '<path d="M6 9.5a6 6 0 0 1 12 0c0 4.8 2 6 2 6H4s2-1.2 2-6"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>'
};

function applySvgIcons() {
  document.querySelectorAll('.nav-item[data-page]').forEach((button) => {
    const paths = NAV_ICONS[button.dataset.page];
    const holder = button.querySelector('span');
    if (!paths || !holder || holder.dataset.svgIcon === '1') return;
    holder.innerHTML = svgIcon(paths);
    holder.dataset.svgIcon = '1';
  });
  document.querySelectorAll('.icon-button[data-page]').forEach((button) => {
    const paths = NAV_ICONS[button.dataset.page];
    if (!paths || button.dataset.svgIcon === '1') return;
    button.innerHTML = svgIcon(paths);
    button.dataset.svgIcon = '1';
  });
  document.querySelectorAll('.invoice-menu-toggle, .product-menu-toggle, .sidebar-menu-toggle').forEach((button) => {
    const holder = button.querySelector('span');
    if (!holder || holder.dataset.svgIcon === '1') return;
    holder.innerHTML = svgIcon(button.classList.contains('product-menu-toggle') || button.classList.contains('sidebar-menu-toggle') ? NAV_ICONS.products : NAV_ICONS['sales-invoices']);
    holder.dataset.svgIcon = '1';
  });
  const bell = $('#notificationButton');
  if (bell && bell.dataset.svgIcon !== '1') {
    const badge = bell.querySelector('#notificationBadge');
    bell.innerHTML = svgIcon(NAV_ICONS.bell) + (badge ? badge.outerHTML : '<span id="notificationBadge" class="notification-badge hidden">۰</span>');
    bell.dataset.svgIcon = '1';
  }
}
applySvgIcons();
document.addEventListener('DOMContentLoaded', applySvgIcons);
window.addEventListener('load', applySvgIcons);
setTimeout(applySvgIcons, 600);
const number = (value) => Number(normalizeDigits(value).replace(/[^\d.]/g, '')) || 0;

let toastTimer;
function showToast(message, error = false) {
  if (!uiNotifications) return;
  const toast = $('#toast');
  toast.innerHTML = `<span class="toast-icon" aria-hidden="true">${error ? '✕' : '✓'}</span><span>${esc(message)}</span>`;
  toast.style.background = error ? '#4b252f' : '#163c34';
  toast.style.color = error ? '#ffb0b2' : '#8af1c6';
  clearTimeout(toastTimer);
  toast.classList.remove('hidden');
  toastTimer = setTimeout(() => toast.classList.add('hidden'), error ? 5200 : 3200);
}

function warnDefaultPassword(session) {
  if (!session?.passwordIsDefault) return;
  showToast('رمز عبور کاربر admin هنوز پیش‌فرض (admin123) است؛ از صفحه «کاربران و لاگ» آن را تغییر دهید.', true);
}

let confirmDialogResolver = null;
function ensureConfirmDialog() {
  let backdrop = $('#confirmDialogBackdrop');
  if (backdrop) return backdrop;
  backdrop = document.createElement('div');
  backdrop.id = 'confirmDialogBackdrop';
  backdrop.className = 'modal-backdrop confirm-dialog-backdrop hidden';
  backdrop.innerHTML = `<section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmDialogTitle" aria-describedby="confirmDialogMessage"><div class="confirm-dialog-icon" aria-hidden="true">!</div><div class="confirm-dialog-content"><span id="confirmDialogEyebrow" class="eyebrow">تأیید عملیات</span><h3 id="confirmDialogTitle"></h3><p id="confirmDialogMessage"></p><div class="confirm-dialog-actions"><button id="confirmDialogCancel" type="button" class="secondary">انصراف</button><button id="confirmDialogAccept" type="button" class="primary">تأیید</button></div></div></section>`;
  document.body.append(backdrop);
  const finish = (accepted) => {
    if (!confirmDialogResolver) return;
    const resolve = confirmDialogResolver;
    confirmDialogResolver = null;
    backdrop.classList.add('hidden');
    resolve(accepted);
  };
  $('#confirmDialogCancel').addEventListener('click', () => finish(false));
  $('#confirmDialogAccept').addEventListener('click', () => finish(true));
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) finish(false); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !backdrop.classList.contains('hidden')) finish(false);
  });
  return backdrop;
}

function showConfirmDialog({ title = 'تأیید عملیات', message, confirmText = 'تأیید', cancelText = 'انصراف', eyebrow = 'تأیید عملیات', destructive = false } = {}) {
  const backdrop = ensureConfirmDialog();
  if (confirmDialogResolver) return Promise.resolve(false);
  $('#confirmDialogEyebrow').textContent = eyebrow;
  $('#confirmDialogTitle').textContent = title;
  $('#confirmDialogMessage').textContent = message || '';
  $('#confirmDialogAccept').textContent = confirmText;
  $('#confirmDialogCancel').textContent = cancelText;
  $('#confirmDialogAccept').classList.toggle('danger-button', destructive);
  $('#confirmDialogAccept').classList.toggle('primary', !destructive);
  backdrop.classList.remove('hidden');
  setTimeout(() => $('#confirmDialogCancel')?.focus(), 0);
  return new Promise((resolve) => { confirmDialogResolver = resolve; });
}

let applicationClosePromptOpen = false;
async function requestApplicationClose() {
  if (applicationClosePromptOpen) return;
  applicationClosePromptOpen = true;
  const confirmed = await showConfirmDialog({
    eyebrow: 'کوچک کردن به سیستم‌تری',
    title: 'نرم‌افزار در سیستم‌تری نگه داشته شود؟',
    message: 'سبد فروش روزانهٔ ثبت‌نشده به‌صورت موقت ذخیره می‌شود و در اجرای بعدی قابل بازیابی است. برای خروج کامل، از منوی سیستم‌تری «خروج کامل» را انتخاب کنید.',
    confirmText: 'کوچک کردن به سیستم‌تری',
    destructive: true
  });
  applicationClosePromptOpen = false;
  if (confirmed) window.api.window.confirmClose();
}

let notificationState = { alerts: [], counts: { total: 0 } };
function initializeNotifications() {
  const actions = $('.topbar-actions');
  if (!actions || $('#notificationButton')) return;
  actions.insertAdjacentHTML('afterbegin', '<button id="notificationButton" class="icon-button notification-button" title="مرکز اعلان‌ها" aria-label="مرکز اعلان‌ها">🔔<span id="notificationBadge" class="notification-badge hidden">۰</span></button>');
  document.body.insertAdjacentHTML('beforeend', '<div id="notificationModal" class="modal-backdrop hidden"><div class="modal notification-modal"><div class="modal-header"><div><span class="eyebrow">مرکز کنترل</span><h3>اعلان‌ها و هشدارها</h3></div><button class="modal-close" id="closeNotifications">×</button></div><div id="notificationSummary" class="notification-summary"></div><div id="notificationList" class="notification-list"></div></div></div>');
  $('#notificationButton').addEventListener('click', async () => {
    await loadNotifications();
    $('#notificationModal').classList.remove('hidden');
  });
  $('#closeNotifications').addEventListener('click', () => $('#notificationModal').classList.add('hidden'));
  $('#notificationModal').addEventListener('click', (event) => {
    if (event.target.id === 'notificationModal') event.currentTarget.classList.add('hidden');
  });
}
function initializeInstallmentNavigation() {
  const nav = document.querySelector('nav');
  if (nav && !nav.querySelector('[data-page="installments"]')) {
    const checks = nav.querySelector('[data-page="checks"]');
    checks?.insertAdjacentHTML('afterend', '<button class="nav-item" data-page="installments"><span>◫</span><span class="nav-label">اقساط و دریافت‌ها</span></button>');
    nav.querySelector('[data-page="installments"]')?.addEventListener('click', () => setManagedPage('installments'));
  }
}
async function loadNotifications() {
  initializeNotifications();
  try {
    notificationState = await window.api.notifications.list({ daysAhead: 7 });
    const counts = notificationState.counts || {};
    const badge = $('#notificationBadge');
    badge.textContent = new Intl.NumberFormat('fa-IR').format(Number(counts.total || 0));
    badge.classList.toggle('hidden', !counts.total);
    $('#notificationSummary').innerHTML = `<span>همه: ${counts.total || 0}</span><span class="danger-text">مهم: ${counts.danger || 0}</span><span class="warning-text">هشدار: ${counts.warning || 0}</span><span>اطلاع: ${counts.info || 0}</span>`;
    const labels = { danger: 'مهم', warning: 'هشدار', info: 'اطلاع' };
    $('#notificationList').innerHTML = notificationState.alerts?.length
      ? notificationState.alerts.map((item) => `<button class="notification-item ${item.severity}" data-page="${esc(item.actionPage || 'dashboard')}"><span class="notification-icon">${item.severity === 'danger' ? '!' : item.severity === 'warning' ? '⚠' : 'i'}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.message)}</small><em>${labels[item.severity] || ''}</em></span></button>`).join('')
      : '<div class="empty-state compact">هشداری برای نمایش وجود ندارد.</div>';
    $('#notificationList').onclick = (event) => {
      const item = event.target.closest('.notification-item');
      if (!item) return;
      $('#notificationModal').classList.add('hidden');
      setManagedPage(item.dataset.page);
    };
  } catch (e) {
    showToast(readableError(e, 'دریافت اعلان‌ها ناموفق بود.'), true);
  }
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

function initializeDashboardMarkup() {
  const page = $('#dashboardPage');
  if (!page || page.dataset.redesigned === '1') return;
  page.dataset.redesigned = '1';
  page.innerHTML = `
    <div class="dashboard-heading"><div class="dashboard-heading-copy"><span class="eyebrow">مرکز کنترل مدیریتی</span><h2 id="dashboardGreeting">وضعیت کسب‌وکار در یک نگاه</h2><p>آخرین اطلاعات فروشگاه، دریافت‌ها و هشدارهای عملیاتی</p><div class="dashboard-chips"><span class="dashboard-chip hidden" id="dashboardUserChip"></span><span class="dashboard-chip" id="dashboardBackupChip"><b>وضعیت پشتیبان‌گیری…</b></span><span class="dashboard-chip" id="dashboardDateChip"></span></div></div><svg class="dashboard-motif" viewBox="0 0 140 90" aria-hidden="true"><path d="M6 76 L38 52 L64 60 L94 28 L134 12" class="motif-line"/><path d="M6 76 L38 52 L64 60 L94 28 L134 12 L134 88 L6 88 Z" class="motif-area"/><circle cx="94" cy="28" r="3.5" class="motif-dot"/><circle cx="38" cy="52" r="3" class="motif-dot"/></svg><div class="dashboard-actions"><button id="refreshDashboard" class="secondary">به‌روزرسانی</button><button class="primary" data-page="sales">ثبت فروش جدید <span>F9</span></button></div></div>
    <div class="dashboard-kpis">
      <article class="dashboard-kpi blue"><span>فروش امروز</span><strong id="todaySales">۰ تومان</strong><small id="todayCount">۰ فاکتور</small><em id="todaySalesChange" class="dashboard-kpi-trend">—</em><i id="kpiSalesSpark" class="kpi-spark-holder" aria-hidden="true"></i></article><article class="dashboard-kpi purple"><span>فروش ماه جاری</span><strong id="monthSales">۰ تومان</strong><small>مجموع فروش فعال</small></article><article class="dashboard-kpi green"><span>سود ماه جاری</span><strong id="dashboardProfit">۰ تومان</strong><small id="dashboardMargin">حاشیه سود: ۰٪</small><i id="kpiProfitSpark" class="kpi-spark-holder" aria-hidden="true"></i></article><article class="dashboard-kpi orange"><span>مطالبات باز</span><strong id="dashboardReceivables">۰ تومان</strong><small>فاکتورهای تسویه‌نشده</small></article><article class="dashboard-kpi cyan"><span>موجودی کالا</span><strong id="inventory">۰ عدد</strong><small id="productCount">۰ کالا</small></article><article class="dashboard-kpi red"><span>نیازمند بررسی</span><strong id="lowStock">۰ کالا</strong><small>موجودی کم</small></article>
    </div>
    <div class="dashboard-value-strip"><div><span>ارزش خرید موجودی</span><strong id="dashboardInventoryPurchase">۰ تومان</strong></div><div><span>ارزش فروش موجودی</span><strong id="dashboardInventoryRetail">۰ تومان</strong></div><div><span>جریان نقدی ماه</span><strong id="dashboardCashFlow">۰ تومان</strong></div></div>
    <div class="dashboard-alert-strip"><div><strong>هشدارهای فوری</strong><small id="dashboardAlertHint">در حال بررسی...</small></div><button id="dashboardAlertsButton" class="secondary">مشاهده اعلان‌ها</button></div>
    <div class="dashboard-grid dashboard-grid-main"><section class="panel dashboard-panel"><div class="panel-heading"><h3>روند فروش و سود</h3><small id="dashboardSalesTrendRange">هفته جاری</small></div><div id="dashboardSalesChart" class="dashboard-chart"></div></section><section class="panel dashboard-panel"><div class="panel-heading"><h3>دریافت بر اساس روش پرداخت</h3><small>ماه جاری</small></div><div id="dashboardPaymentsChart" class="dashboard-bars"></div></section></div>
    <div class="dashboard-grid dashboard-grid-main"><section class="panel dashboard-panel"><div class="panel-heading"><h3>فروش بر اساس دسته‌بندی</h3><small>ماه جاری</small></div><div id="dashboardCategoryChart" class="dashboard-bars"></div></section><section class="panel dashboard-panel"><div class="panel-heading"><h3>وضعیت نقدینگی ماه</h3><small>دریافت و هزینه</small></div><div id="dashboardCashChart" class="dashboard-bars"></div></section></div>
    <div class="dashboard-grid dashboard-grid-lists"><section class="panel dashboard-panel"><div class="panel-heading"><h3>آخرین فروش‌ها</h3><button class="text-button dashboard-link" data-page="sales-invoices">همه فروش‌ها</button></div><div id="dashboardRecentSales" class="dashboard-list"></div></section><section class="panel dashboard-panel"><div class="panel-heading"><h3>بدهکارترین اشخاص</h3><button class="text-button dashboard-link" data-page="ledger">گردش حساب</button></div><div id="dashboardDebtors" class="dashboard-list"></div></section><section class="panel dashboard-panel"><div class="panel-heading"><h3>پرفروش‌ترین کالاها</h3><button class="text-button dashboard-link" data-page="reports">گزارش کامل</button></div><div id="dashboardProducts" class="dashboard-list"></div></section></div>
    <section class="panel dashboard-report-panel"><div class="panel-heading"><div><h3>داشبورد تحلیلی فروش</h3><small id="dashboardReportHint">نمای کلی فروش و سود</small></div><div class="dashboard-report-controls"><select id="dashboardReportPeriod"><option value="day">روزانه</option><option value="week">هفتگی</option><option value="month" selected>ماهانه</option><option value="year">سالانه</option></select><button id="dashboardReportOpen" class="text-button">گزارش کامل</button></div></div><div class="dashboard-report-kpis"><div><span>فروش خالص</span><strong id="dashboardReportSales">۰</strong></div><div><span>سود</span><strong id="dashboardReportProfit">۰</strong></div><div><span>تعداد فاکتور</span><strong id="dashboardReportInvoices">۰</strong></div><div><span>رشد آخرین دوره</span><strong id="dashboardReportGrowth">—</strong></div></div><div id="dashboardReportChart" class="dashboard-report-chart"></div><div class="dashboard-forecast-box"><div class="panel-heading"><div><h3>پیش‌بینی فروش آینده</h3><small id="dashboardForecastNote">بر اساس روند ماه‌های اخیر</small></div><div class="dashboard-report-controls"><select id="dashboardForecastPeriod"><option value="month" selected>ماهانه</option><option value="year">سالانه</option></select><select id="dashboardForecastHorizon"><option value="3">۳ دوره</option><option value="6">۶ دوره</option><option value="12">۱۲ دوره</option></select></div></div><div id="dashboardForecastChart" class="dashboard-report-chart"></div></div></section>`;
  $('#refreshDashboard').onclick = () => { renderDashboardSkeleton(); window.api.dashboard.summary().then((summary) => { renderMetrics(summary); renderDashboard(summary); }).catch((e) => showToast(e.message, true)); };
  $('#dashboardAlertsButton').onclick = () => $('#notificationButton')?.click();
  $('#dashboardReportPeriod').onchange = loadDashboardSalesPanel;
  $('#dashboardForecastPeriod').onchange = loadDashboardForecast;
  $('#dashboardForecastHorizon').onchange = loadDashboardForecast;
  $('#dashboardReportOpen').onclick = () => setManagedPage('reports');
  loadDashboardSalesPanel();
  loadDashboardForecast();
}

async function loadDashboardForecast() {
  const chart = $('#dashboardForecastChart');
  if (!chart) return;
  try {
    const period = $('#dashboardForecastPeriod')?.value || 'month';
    const horizon = Number($('#dashboardForecastHorizon')?.value || 3);
    const data = await window.api.reports.forecast({ period, horizon });
    const history = (data.history || []).map((row) => ({ ...row, date: row.period, forecast: 0 }));
    const predictions = (data.predictions || []).map((row) => ({ ...row, date: row.period, forecast: row.netSales }));
    reportSvgLine(chart, [...history, ...predictions], [{ key: 'netSales', label: 'فروش واقعی/پیش‌بینی', color: '#fbbf24' }, { key: 'forecast', label: 'پیش‌بینی', color: '#c084fc' }]);
    $('#dashboardForecastNote').textContent = `${data.note} · اطمینان: ${data.confidence}`;
  } catch {
    chart.innerHTML = '<div class="empty-state compact">پیش‌بینی برای این بازه در دسترس نیست.</div>';
  }
}

async function loadDashboardSalesPanel() {
  const chart = $('#dashboardReportChart');
  if (!chart) return;
  try {
    const period = $('#dashboardReportPeriod')?.value || 'month';
    const data = await window.api.reports.sales({ period });
    const rows = data.byPeriod || [];
    const totalSales = rows.reduce((sum, row) => sum + Number(row.netSales || 0), 0);
    const totalProfit = rows.reduce((sum, row) => sum + Number(row.profitTotal || 0), 0);
    const latest = rows.length ? Number(rows[rows.length - 1].netSales || 0) : 0;
    const previous = rows.length > 1 ? Number(rows[rows.length - 2].netSales || 0) : 0;
    const growth = previous ? ((latest - previous) / previous) * 100 : null;
    const labels = { day: 'روزانه', week: 'هفتگی', month: 'ماهانه', year: 'سالانه' };
    $('#dashboardReportHint').textContent = `تجمیع ${labels[period]} · ${rows.length} دوره`;
    $('#dashboardReportSales').textContent = money(totalSales);
    $('#dashboardReportProfit').textContent = money(totalProfit);
    $('#dashboardReportProfit').classList.toggle('negative', totalProfit < 0);
    $('#dashboardReportInvoices').textContent = new Intl.NumberFormat('fa-IR').format(Number(data.summary?.invoiceCount || 0));
    $('#dashboardReportGrowth').textContent = growth === null ? '—' : `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}٪`;
    $('#dashboardReportGrowth').classList.toggle('negative', growth !== null && growth < 0);
    const chartRows = rows.map((row) => ({ ...row, date: row.period }));
    reportSvgLine(chart, chartRows, [{ key: 'netSales', label: 'فروش خالص', color: '#38bdf8' }, { key: 'profitTotal', label: 'سود', color: '#4ade80' }]);
  } catch (error) {
    chart.innerHTML = '<div class="empty-state compact">داده‌ای برای داشبورد تحلیلی وجود ندارد.</div>';
  }
}

function renderDashboardSkeleton() {
  initializeDashboardMarkup();
  ['#dashboardSalesChart', '#dashboardPaymentsChart', '#dashboardCategoryChart', '#dashboardCashChart'].forEach((id) => { const node = $(id); if (node) node.innerHTML = '<div class="skeleton chart-skeleton"></div>'; });
  ['#dashboardRecentSales', '#dashboardDebtors', '#dashboardProducts'].forEach((id) => { const node = $(id); if (node) node.innerHTML = '<div class="skeleton row-skeleton"></div>'.repeat(4); });
  ['#kpiSalesSpark', '#kpiProfitSpark'].forEach((id) => { const node = $(id); if (node) node.innerHTML = ''; });
}

function sparklineSvg(values) {
  if (!values || values.length < 2) return '';
  const width = 110; const height = 30;
  const max = Math.max(1, ...values);
  const x = (index) => width - (index * (width / (values.length - 1)));
  const y = (value) => height - 3 - (Number(value || 0) / max) * (height - 6);
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function renderDashboard(summary) {
  initializeDashboardMarkup();
  const trend = summary.salesTrend || [];
  const profit = Number(summary.monthProfit ?? trend.reduce((sum, row) => sum + Number(row.profit || 0), 0));
  $('#dashboardProfit').textContent = money(profit);
  const monthSales = Number(summary.monthSales || 0);
  const margin = monthSales > 0 ? (profit / monthSales * 100) : 0;
  $('#dashboardMargin').textContent = `حاشیه سود: ${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(margin)}٪`;
  const change = Number(summary.salesChangePct || 0);
  $('#todaySalesChange').textContent = summary.yesterdaySales > 0 ? `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toLocaleString('fa-IR')}٪ نسبت به دیروز` : 'مقایسه با دیروز: داده‌ای نیست';
  $('#todaySalesChange').classList.toggle('negative', change < 0);
  const receivables = Number(summary.receivables ?? 0);
  $('#dashboardReceivables').textContent = money(receivables);
  $('#dashboardInventoryPurchase').textContent = money(summary.inventoryValue?.purchase || 0);
  $('#dashboardInventoryRetail').textContent = money(summary.inventoryValue?.retail || 0);
  const cashFlow = Number(summary.cashMonth?.income || 0) - Number(summary.cashMonth?.expense || 0);
  $('#dashboardCashFlow').textContent = money(cashFlow);
  Promise.all([
    window.api.notifications?.list({ daysAhead: 7 }).catch(() => null),
    window.api.settings.get().catch(() => null)
  ]).then(([notifications, settings]) => {
    $('#dashboardAlertHint').textContent = notifications?.counts?.total ? `${notifications.counts.total} مورد برای بررسی وجود دارد.` : 'مورد فوری وجود ندارد.';
    const chip = $('#dashboardBackupChip');
    if (!chip) return;
    const alerts = notifications?.alerts || [];
    const missing = alerts.find((alert) => alert.type === 'backup-missing');
    const stale = alerts.find((alert) => alert.type === 'backup-stale');
    const auto = settings?.backup?.auto;
    const kind = missing ? 'danger' : stale ? 'warning' : auto ? 'success' : 'muted';
    const label = missing ? 'پشتیبان‌گیری انجام نشده' : stale ? 'پشتیبان‌گیری قدیمی است' : auto ? 'پشتیبان‌گیری به‌روز است' : 'پشتیبان‌گیری خودکار خاموش است';
    chip.className = `dashboard-chip ${kind}`;
    chip.innerHTML = `<i aria-hidden="true"></i><b>${esc(label)}</b>`;
  }).catch(() => {});
  const weekdayNames = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
  const toPersianDigits = (value) => String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[digit]);
  const trendByDate = new Map(trend.map((row) => [String(row.date).slice(0, 10), row]));
  const anchorDate = summary.salesTrendEnd || new Date().toISOString().slice(0, 10);
  const weekStart = summary.salesTrendStart || (() => {
    const date = new Date(`${anchorDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 1) % 7));
    return date.toISOString().slice(0, 10);
  })();
  const weekDates = [];
  const end = new Date(`${anchorDate}T00:00:00Z`);
  const cursor = new Date(`${weekStart}T00:00:00Z`);
  while (cursor <= end) {
    weekDates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  $('#dashboardSalesTrendRange').textContent = 'هفته جاری؛ شنبه تا امروز';
  const chartRows = weekDates.map((date) => ({ date, sales: 0, profit: 0, ...(trendByDate.get(date) || {}) }));
  const compactMoney = (cents) => {
    const value = (Number(cents || 0) / 100) * currencyFactor();
    if (value >= 1e9) return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(value / 1e9)} میلیارد`;
    if (value >= 1e6) return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(value / 1e6)} میلیون`;
    return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(value);
  };
  const roleLabels = { admin: 'مدیر سیستم', manager: 'مدیر اجرایی', cashier: 'صندوقدار', warehouse: 'انباردار', viewer: 'فقط‌خواندنی' };
  window.api.auth?.current?.().then((user) => {
    const chip = $('#dashboardUserChip');
    if (!chip) return;
    if (!user) { chip.classList.add('hidden'); return; }
    chip.classList.remove('hidden');
    chip.innerHTML = `<b>${esc(user.displayName || user.username)}</b><small>${esc(roleLabels[user.role] || user.role || '')}</small>`;
    const greeting = $('#dashboardGreeting');
    if (greeting) greeting.textContent = `خوش آمدید، ${user.displayName || user.username}`;
  }).catch(() => {});
  const dateChip = $('#dashboardDateChip');
  if (dateChip) dateChip.innerHTML = `<b>${esc(isoToJalali(anchorDate))}</b><small>${esc(weekdayNames[(new Date(`${anchorDate}T00:00:00Z`).getUTCDay() + 1) % 7])}</small>`;
  const sparkValues = chartRows.map((row) => Number(row.sales || 0));
  const profitValues = chartRows.map((row) => Number(row.profit || 0));
  const salesSpark = $('#kpiSalesSpark');
  if (salesSpark) salesSpark.innerHTML = sparklineSvg(sparkValues);
  const profitSpark = $('#kpiProfitSpark');
  if (profitSpark) profitSpark.innerHTML = sparklineSvg(profitValues);
  const chartW = 640; const chartH = 230; const padX = 34; const padTop = 16; const padBottom = 30;
  const innerW = chartW - padX * 2; const innerH = chartH - padTop - padBottom;
  const maxVal = Math.max(1, ...sparkValues, ...profitValues);
  const pointX = (index) => chartW - padX - (sparkValues.length === 1 ? innerW / 2 : index * (innerW / (sparkValues.length - 1)));
  const pointY = (value) => padTop + innerH - (Number(value || 0) / maxVal) * innerH;
  const linePath = (values) => values.map((value, index) => `${index ? 'L' : 'M'}${pointX(index).toFixed(1)} ${pointY(value).toFixed(1)}`).join(' ');
  const areaPath = `${linePath(sparkValues)} L${pointX(sparkValues.length - 1).toFixed(1)} ${(padTop + innerH).toFixed(1)} L${pointX(0).toFixed(1)} ${(padTop + innerH).toFixed(1)} Z`;
  const dayLabels = chartRows.map((row, index) => {
    const dayName = weekdayNames[(new Date(`${row.date}T00:00:00Z`).getUTCDay() + 1) % 7];
    return `<text x="${pointX(index).toFixed(1)}" y="${chartH - 8}" text-anchor="middle" class="trend-axis-text">${esc(dayName)}</text>`;
  }).join('');
  const gridLines = [0.25, 0.5, 0.75, 1].map((fraction) => {
    const gy = (padTop + innerH - innerH * fraction).toFixed(1);
    return `<line x1="${padX}" x2="${chartW - padX}" y1="${gy}" y2="${gy}" class="trend-grid"/>`;
  }).join('');
  const trendPoints = chartRows.map((row, index) => {
    const [gy, gm, gd] = row.date.split('-').map(Number);
    const jalaliDate = toPersianDigits(gregorianToJalali(gy, gm, gd).join('/'));
    const dayName = weekdayNames[(new Date(`${row.date}T00:00:00Z`).getUTCDay() + 1) % 7];
    return `<g class="trend-point"><title>${esc(`${dayName} ${jalaliDate} — فروش ${money(row.sales)} · سود ${money(row.profit)}`)}</title><circle cx="${pointX(index).toFixed(1)}" cy="${pointY(row.sales).toFixed(1)}" r="3.4" class="trend-dot-sales"/><circle cx="${pointX(index).toFixed(1)}" cy="${pointY(row.profit).toFixed(1)}" r="2.6" class="trend-dot-profit"/></g>`;
  }).join('');
  $('#dashboardSalesChart').innerHTML = `<svg class="trend-chart" viewBox="0 0 ${chartW} ${chartH}" aria-hidden="true">${gridLines}<path d="${areaPath}" class="trend-area"/><path d="${linePath(sparkValues)}" class="trend-sales"/><path d="${linePath(profitValues)}" class="trend-profit"/><text x="${padX - 6}" y="${(padTop + 4).toFixed(1)}" text-anchor="end" class="trend-axis-text">${esc(compactMoney(maxVal))}</text>${dayLabels}${trendPoints}</svg><div class="chart-legend"><span><i class="legend-sales"></i>فروش</span><span><i class="legend-profit"></i>سود</span></div>`;
  const paymentLabels = { cash: 'نقدی', card: 'کارت', check: 'چک', credit: 'اعتباری' };
  const donutPalette = ['var(--accent)', '#a78bfa', '#f59e0b', '#34d399', '#f87171'];
  const payments = summary.paymentBreakdown || [];
  const paymentTotal = payments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  if (payments.length && paymentTotal > 0) {
    const radius = 52; const circumference = 2 * Math.PI * radius;
    let dashOffset = 0;
    const segments = payments.map((row, index) => {
      const fraction = Number(row.amount || 0) / paymentTotal;
      const dash = fraction * circumference;
      const color = donutPalette[index % donutPalette.length];
      const segment = `<circle cx="70" cy="70" r="${radius}" fill="none" stroke="${color}" stroke-width="15" stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" stroke-dashoffset="${(-dashOffset).toFixed(2)}" transform="rotate(-90 70 70)"><title>${esc(`${paymentLabels[row.method] || row.method}: ${money(row.amount)}`)}</title></circle>`;
      dashOffset += dash;
      return segment;
    }).join('');
    const legend = payments.map((row, index) => `<div class="donut-legend-row"><i style="background:${donutPalette[index % donutPalette.length]}"></i><span>${paymentLabels[row.method] || esc(row.method)}</span><b>${money(row.amount)}</b><small>${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(Number(row.amount || 0) / paymentTotal * 100)}٪</small></div>`).join('');
    $('#dashboardPaymentsChart').innerHTML = `<div class="donut-wrap"><svg class="donut" viewBox="0 0 140 140" role="img">${segments}<text x="70" y="66" text-anchor="middle" class="donut-total">${esc(compactMoney(paymentTotal))}</text><text x="70" y="84" text-anchor="middle" class="donut-caption">دریافت ماه</text></svg><div class="donut-legend">${legend}</div></div>`;
  } else {
    $('#dashboardPaymentsChart').innerHTML = '<div class="empty-state compact">پرداختی برای این ماه ثبت نشده است.</div>';
  }
  const categoryRows = summary.categorySales || [];
  const categoryMax = Math.max(1, ...categoryRows.map((row) => Number(row.netSales || 0)));
  $('#dashboardCategoryChart').innerHTML = categoryRows.length ? categoryRows.map((row) => `<div class="dashboard-bar-row"><span>${esc(row.categoryName)}</span><div><i style="width:${Number(row.netSales || 0) / categoryMax * 100}%"></i></div><b>${money(row.netSales)}</b></div>`).join('') : '<div class="empty-state compact">فروشی برای دسته‌بندی‌ها ثبت نشده است.</div>';
  const cashRows = [{ label: 'دریافت', amount: Number(summary.cashMonth?.income || 0) }, { label: 'هزینه', amount: Number(summary.cashMonth?.expense || 0) }];
  const cashMax = Math.max(1, ...cashRows.map((row) => row.amount));
  $('#dashboardCashChart').innerHTML = cashRows.map((row) => `<div class="dashboard-bar-row"><span>${row.label}</span><div><i style="width:${row.amount / cashMax * 100}%;background:${row.label === 'هزینه' ? '#f87171' : ''}"></i></div><b>${money(row.amount)}</b></div>`).join('');
  $('#dashboardRecentSales').innerHTML = (summary.recentSales || []).length ? summary.recentSales.map((row) => `<button class="dashboard-list-row" data-page="sales-invoices"><span><strong>${esc(row.invoiceNumber)}</strong><small>${row.source === 'daily' ? '<span class="daily-sale-party">فروش روزانه</span>' : esc(row.partyName || 'بدون طرف‌حساب')} · ${isoToJalali(row.date)}</small></span><b>${money(row.total)}</b></button>`).join('') : '<div class="empty-state compact">فروشی ثبت نشده است.</div>';
  $('#dashboardDebtors').innerHTML = (summary.topDebtors || []).length ? summary.topDebtors.map((row) => `<button class="dashboard-list-row" data-page="ledger"><span><strong>${esc(row.partyName)}</strong><small>مانده بدهی</small></span><b class="debt-amount">${money(row.balance)}</b></button>`).join('') : '<div class="empty-state compact">بدهی ثبت‌شده‌ای وجود ندارد.</div>';
  const dashboardTopProducts = [...(summary.topProducts || [])].sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0) || Number(b.netSales || 0) - Number(a.netSales || 0));
  $('#dashboardProducts').innerHTML = dashboardTopProducts.length ? dashboardTopProducts.map((row) => `<button class="dashboard-list-row" data-page="reports"><span><strong>${esc(row.name)}</strong><small>${new Intl.NumberFormat('fa-IR').format(Number(row.quantity || 0))} عدد فروش</small></span><b>${money(row.netSales)}</b></button>`).join('') : '<div class="empty-state compact">فروشی برای کالاها ثبت نشده است.</div>';
  document.querySelectorAll('#dashboardPage [data-page]').forEach((node) => { node.onclick = () => setManagedPage(node.dataset.page); });
  loadDashboardSalesPanel();
  loadDashboardForecast();
}

function renderResults() {
  const box = $('#productResults');
  if (!state.products.length) { box.classList.add('hidden'); return; }
  box.innerHTML = state.products.map((product) => `<button class="result-item" data-id="${product.id}"><span>${esc(product.name)}<small>${esc(product.code)} · موجودی ${product.stock}</small></span><b>${money(product.salePrice)}</b></button>`).join('');
  box.classList.remove('hidden');
  box.querySelectorAll('.result-item').forEach((button) => button.addEventListener('click', () => addProduct(Number(button.dataset.id))));
}

function renderItems() {
  const body = $('#saleItems');
  if (!state.items.length) { body.innerHTML = '<tr class="empty-row"><td colspan="6">برای شروع، کالا را جستجو و انتخاب کنید.</td></tr>'; return; }
  body.innerHTML = state.items.map((item, index) => `<tr><td><strong>${esc(item.name)}</strong><small>${esc(item.code)} · موجودی ${item.stock}</small></td><td><input class="line-quantity" data-index="${index}" type="number" min="0.01" step="0.01" value="${item.quantity}" /></td><td>${money(item.unitPrice)}</td><td><input class="line-discount" data-index="${index}" type="number" min="0" value="${formatPriceInput(item.discount)}" /></td><td>${money(Math.max(0, item.quantity * item.unitPrice - item.discount))}</td><td><button class="delete-line" data-index="${index}" title="حذف">×</button></td></tr>`).join('');
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

$('#collapseSidebar').addEventListener('click', () => { const sidebar = $('#sidebar'); sidebar.classList.toggle('collapsed'); $('#collapseSidebar').textContent = sidebar.classList.contains('collapsed') ? '›' : '‹'; });
window.api.window.onCloseRequested(requestApplicationClose);
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
  if (event.key === 'F9') {
    event.preventDefault();
    if ($('#salesPage')?.classList.contains('hidden')) {
      setManagedPage('sales');
      setTimeout(() => $('#saleProductFilter')?.focus(), 0);
    } else {
      $('#modernSaveSale')?.click() || saveSale();
    }
  }
  if (event.ctrlKey && event.key === 'Enter') {
    event.preventDefault();
    if (!$('#salesInvoicePage')?.classList.contains('hidden')) saveKeyboardInvoice('sale');
    else if (!$('#purchasesPage')?.classList.contains('hidden')) saveKeyboardInvoice('purchase');
  }
});
$('#version').textContent = window.appInfo?.version || '۱.۰.۰';
$('#saleDate').value = new Date().toISOString().slice(0, 10);
$('#clock').textContent = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(new Date());
initializeDashboardMarkup();
renderDashboardSkeleton();
window.api.dashboard.summary().then((summary) => { renderMetrics(summary); renderDashboard(summary); }).catch(() => {});
setPage('dashboard');

