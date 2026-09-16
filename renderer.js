const state = { page: 'dashboard', items: [], products: [] };
const $ = (selector) => document.querySelector(selector);
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
    await window.api.auth.login($('#loginUsername')?.value || '', $('#loginPassword')?.value || '');
    $('#loginBackdrop')?.classList.add('hidden');
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
let uiCurrency = { code: 'IRR', name: '\u0631\u06cc\u0627\u0644', symbol: '\u0631\u06cc\u0627\u0644', position: 'suffix', decimals: 0, separator: true, inputUnit: 'rial' };
let defaultSettlementMethod = 'cash';
let uiTheme = 'dark';
let uiCalendar = 'jalali';
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
  uiCalendar = 'jalali';
  uiNotifications = appearance.notifications !== false;
  uiShortcuts = appearance.shortcuts !== false;
  document.documentElement.dataset.theme = resolvedTheme;
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
    <div class="dashboard-heading"><div><span class="eyebrow">مرکز کنترل مدیریتی</span><h2>وضعیت کسب‌وکار در یک نگاه</h2><p>آخرین اطلاعات فروشگاه، دریافت‌ها و هشدارهای عملیاتی</p></div><div class="dashboard-actions"><button id="refreshDashboard" class="secondary">به‌روزرسانی</button><button class="primary" data-page="sales">ثبت فروش جدید <span>F9</span></button></div></div>
    <div class="dashboard-kpis">
      <article class="dashboard-kpi blue"><span>فروش امروز</span><strong id="todaySales">۰ تومان</strong><small id="todayCount">۰ فاکتور</small><em id="todaySalesChange" class="dashboard-kpi-trend">—</em></article><article class="dashboard-kpi purple"><span>فروش ماه جاری</span><strong id="monthSales">۰ تومان</strong><small>مجموع فروش فعال</small></article><article class="dashboard-kpi green"><span>سود ماه جاری</span><strong id="dashboardProfit">۰ تومان</strong><small id="dashboardMargin">حاشیه سود: ۰٪</small></article><article class="dashboard-kpi orange"><span>مطالبات باز</span><strong id="dashboardReceivables">۰ تومان</strong><small>فاکتورهای تسویه‌نشده</small></article><article class="dashboard-kpi cyan"><span>موجودی کالا</span><strong id="inventory">۰ عدد</strong><small id="productCount">۰ کالا</small></article><article class="dashboard-kpi red"><span>نیازمند بررسی</span><strong id="lowStock">۰ کالا</strong><small>موجودی کم</small></article>
    </div>
    <div class="dashboard-value-strip"><div><span>ارزش خرید موجودی</span><strong id="dashboardInventoryPurchase">۰ تومان</strong></div><div><span>ارزش فروش موجودی</span><strong id="dashboardInventoryRetail">۰ تومان</strong></div><div><span>جریان نقدی ماه</span><strong id="dashboardCashFlow">۰ تومان</strong></div></div>
    <div class="dashboard-alert-strip"><div><strong>هشدارهای فوری</strong><small id="dashboardAlertHint">در حال بررسی...</small></div><button id="dashboardAlertsButton" class="secondary">مشاهده اعلان‌ها</button></div>
    <div class="dashboard-grid dashboard-grid-main"><section class="panel dashboard-panel"><div class="panel-heading"><h3>روند فروش و سود</h3><small>۶ روز کاری اخیر</small></div><div id="dashboardSalesChart" class="dashboard-chart"></div></section><section class="panel dashboard-panel"><div class="panel-heading"><h3>دریافت بر اساس روش پرداخت</h3><small>ماه جاری</small></div><div id="dashboardPaymentsChart" class="dashboard-bars"></div></section></div>
    <div class="dashboard-grid dashboard-grid-main"><section class="panel dashboard-panel"><div class="panel-heading"><h3>فروش بر اساس دسته‌بندی</h3><small>ماه جاری</small></div><div id="dashboardCategoryChart" class="dashboard-bars"></div></section><section class="panel dashboard-panel"><div class="panel-heading"><h3>وضعیت نقدینگی ماه</h3><small>دریافت و هزینه</small></div><div id="dashboardCashChart" class="dashboard-bars"></div></section></div>
    <div class="dashboard-grid dashboard-grid-lists"><section class="panel dashboard-panel"><div class="panel-heading"><h3>آخرین فروش‌ها</h3><button class="text-button dashboard-link" data-page="sales-invoices">همه فروش‌ها</button></div><div id="dashboardRecentSales" class="dashboard-list"></div></section><section class="panel dashboard-panel"><div class="panel-heading"><h3>بدهکارترین اشخاص</h3><button class="text-button dashboard-link" data-page="ledger">گردش حساب</button></div><div id="dashboardDebtors" class="dashboard-list"></div></section><section class="panel dashboard-panel"><div class="panel-heading"><h3>پرفروش‌ترین کالاها</h3><button class="text-button dashboard-link" data-page="reports">گزارش کامل</button></div><div id="dashboardProducts" class="dashboard-list"></div></section></div>
    <section class="panel dashboard-report-panel"><div class="panel-heading"><div><h3>داشبورد تحلیلی فروش</h3><small id="dashboardReportHint">نمای کلی فروش و سود</small></div><div class="dashboard-report-controls"><select id="dashboardReportPeriod"><option value="day">روزانه</option><option value="week">هفتگی</option><option value="month" selected>ماهانه</option><option value="year">سالانه</option></select><button id="dashboardReportOpen" class="text-button">گزارش کامل</button></div></div><div class="dashboard-report-kpis"><div><span>فروش خالص</span><strong id="dashboardReportSales">۰</strong></div><div><span>سود</span><strong id="dashboardReportProfit">۰</strong></div><div><span>تعداد فاکتور</span><strong id="dashboardReportInvoices">۰</strong></div><div><span>رشد آخرین دوره</span><strong id="dashboardReportGrowth">—</strong></div></div><div id="dashboardReportChart" class="dashboard-report-chart"></div><div class="dashboard-forecast-box"><div class="panel-heading"><div><h3>پیش‌بینی فروش آینده</h3><small id="dashboardForecastNote">بر اساس روند ماه‌های اخیر</small></div><div class="dashboard-report-controls"><select id="dashboardForecastPeriod"><option value="month" selected>ماهانه</option><option value="year">سالانه</option></select><select id="dashboardForecastHorizon"><option value="3">۳ دوره</option><option value="6">۶ دوره</option><option value="12">۱۲ دوره</option></select></div></div><div id="dashboardForecastChart" class="dashboard-report-chart"></div></div></section>`;
  $('#refreshDashboard').onclick = () => window.api.dashboard.summary().then((summary) => { renderMetrics(summary); renderDashboard(summary); }).catch((e) => showToast(e.message, true));
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
  window.api.notifications?.list({ daysAhead: 7 }).then((data) => { $('#dashboardAlertHint').textContent = data.counts?.total ? `${data.counts.total} مورد برای بررسی وجود دارد.` : 'مورد فوری وجود ندارد.'; }).catch(() => {});
  const weekdayNames = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
  const toPersianDigits = (value) => String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[digit]);
  const businessDates = [];
  const trendByDate = new Map(trend.map((row) => [String(row.date).slice(0, 10), row]));
  const anchorDate = new Date().toISOString().slice(0, 10);
  const cursor = new Date(`${anchorDate}T00:00:00Z`);
  while (businessDates.length < 6) {
    if (cursor.getUTCDay() !== 5) businessDates.unshift(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  const chartRows = businessDates
    .map((date) => ({ date, sales: 0, profit: 0, ...(trendByDate.get(date) || {}) }))
    .sort((a, b) => {
      const aDay = (new Date(`${a.date}T00:00:00Z`).getUTCDay() + 1) % 7;
      const bDay = (new Date(`${b.date}T00:00:00Z`).getUTCDay() + 1) % 7;
      return aDay - bDay;
    });
  const max = Math.max(1, ...chartRows.map((row) => Number(row.sales || 0)));
  $('#dashboardSalesChart').innerHTML = `<div class="dashboard-chart-bars">${chartRows.map((row) => {
    const dateObj = new Date(`${row.date}T00:00:00Z`);
    const [gy, gm, gd] = row.date.split('-').map(Number);
    const jalaliDate = toPersianDigits(gregorianToJalali(gy, gm, gd).join('/'));
    const dayName = weekdayNames[(dateObj.getUTCDay() + 1) % 7];
    return `<div class="dashboard-chart-column"><div class="dashboard-chart-values"><i style="height:${Math.max(4, Number(row.sales || 0) / max * 100)}%" title="فروش ${money(row.sales)}"></i><b style="height:${Math.max(3, Math.abs(Number(row.profit || 0)) / max * 100)}%" title="سود ${money(row.profit)}"></b></div><small title="${esc(`${dayName} ${jalaliDate}`)}"><span>${esc(dayName)}</span><span>${esc(jalaliDate)}</span></small></div>`;
  }).join('')}</div><div class="chart-legend"><span><i class="legend-sales"></i>فروش</span><span><i class="legend-profit"></i>سود</span></div>`;
  const paymentLabels = { cash: 'نقدی', card: 'کارت', check: 'چک', credit: 'اعتباری' };
  const payments = summary.paymentBreakdown || [];
  const paymentMax = Math.max(1, ...payments.map((row) => Number(row.amount || 0)));
  $('#dashboardPaymentsChart').innerHTML = payments.length ? payments.map((row) => `<div class="dashboard-bar-row"><span>${paymentLabels[row.method] || esc(row.method)}</span><div><i style="width:${Number(row.amount || 0) / paymentMax * 100}%"></i></div><b>${money(row.amount)}</b></div>`).join('') : '<div class="empty-state compact">پرداختی برای این ماه ثبت نشده است.</div>';
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
initializeDashboardMarkup();
window.api.dashboard.summary().then((summary) => { renderMetrics(summary); renderDashboard(summary); }).catch(() => {});
setPage('dashboard');

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
const toman = (value) => formatCurrencyNumber(value, uiCurrency);
const parsePriceInput = (value) => {
  const normalized = String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٬,،\s]/g, '')
    .replace(/[٫]/g, '.');
  const parsedNormalized = Number(normalized);
  if (Number.isFinite(parsedNormalized)) return Math.max(0, Math.round(parsedNormalized * 100 / currencyFactor(uiCurrency)));
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
function dateTimeToJalali(value) {
  if (!value) return '—';
  const text = String(value);
  const datePart = text.slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? isoToJalali(datePart) : datePart;
  const time = text.length > 10 ? text.slice(11, 16) : '';
  return time ? `${date} ${time}` : date;
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
  document.querySelectorAll('input[type="date"], input.jalali-date-input').forEach((input) => {
    input.type = 'text'; input.inputMode = 'numeric'; input.autocomplete = 'off'; input.classList.add('jalali-date-input');
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.value || ''))) input.value = isoToJalali(input.value);
    if (input.dataset.jalaliPickerBound) return;
    input.dataset.jalaliPickerBound = '1';
    input.addEventListener('focus', () => {
      const today = new Date().toISOString().slice(0, 10);
      const current = parseJalaliDate(input.value)
        || parseJalaliDate(isoToJalali(today));
      renderJalaliPicker(input, current.year, current.month);
    });
  });
  if (document.body.dataset.jalaliPickerBound) return;
  document.body.dataset.jalaliPickerBound = '1';
  document.addEventListener('click', (event) => {
    const popup = $('#jalaliDatePickerPopup');
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
  const placeholder = $('#placeholderPage');
  placeholder.insertAdjacentHTML('beforebegin', `<section id="productsPage" class="page hidden"><div class="page-heading"><div><span class="eyebrow">مدیریت موجودی</span><h2>کالاها</h2></div><button id="addProduct" class="primary">＋ ثبت کالای جدید</button></div><div class="panel management-toolbar"><div class="toolbar-search"><span>⌕</span><input id="productsFilter" placeholder="جست‌وجوی نام، کد یا بارکد"></div><select id="productCategoryFilter"><option value="">همه دسته‌بندی‌ها</option></select><label class="check-label"><input id="showInactiveProducts" type="checkbox"> نمایش غیرفعال‌ها</label></div><div class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>کد</th><th>نام کالا</th><th>دسته‌بندی</th><th>قیمت‌ها</th><th>موجودی</th><th>واحد</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody id="productsTable"></tbody></table></div></div></section><section id="categoriesPage" class="page hidden"><div class="page-heading"><div><span class="eyebrow">ساختار کالاها</span><h2>دسته‌بندی‌ها</h2></div><button id="addCategory" class="primary">＋ ثبت دسته‌بندی</button></div><div class="panel management-toolbar"><div class="toolbar-search"><span>⌕</span><input id="categoriesFilter" placeholder="جست‌وجوی دسته‌بندی"></div><label class="check-label"><input id="showInactiveCategories" type="checkbox"> نمایش غیرفعال‌ها</label></div><div class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>کد</th><th>نام دسته‌بندی</th><th>توضیحات</th><th>تعداد کالا</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody id="categoriesTable"></tbody></table></div></div></section>`);
  document.body.insertAdjacentHTML('beforeend', `<div id="managementModalBackdrop" class="modal-backdrop hidden"><div id="productModal" class="modal hidden"><div class="modal-header"><div><span class="eyebrow">اطلاعات کالا</span><h3 id="productModalTitle">ثبت کالای جدید</h3></div><button class="modal-close" data-close-management>×</button></div><form id="productForm"><input id="productId" type="hidden"><div class="form-grid"><label>نام کالا *<input id="productName" required></label><label>کد کالا <input id="productCode" readonly placeholder="پس از انتخاب دسته‌بندی ساخته می‌شود"></label><label>بارکد<input id="productBarcode"></label><label>دسته‌بندی *<select id="productCategory" required><option value="">انتخاب دسته‌بندی</option></select></label><label>واحد<select id="productUnit"><option value="">انتخاب واحد</option></select></label><label>قیمت خرید<input id="productPurchasePrice" type="number" min="0"></label><label>قیمت عمده<input id="productWholesalePrice" type="number" min="0"></label><label>قیمت فروش *<input id="productRetailPrice" type="number" min="0" required></label><label>موجودی اولیه<input id="productStock" type="number" min="0" step="0.01" value="0"></label><label>حداقل موجودی<input id="productMinimumStock" type="number" min="0" step="0.01" value="0"></label></div><label>توضیحات<textarea id="productDescription" rows="3"></textarea></label><div id="productFormError" class="form-error hidden"></div><div class="modal-actions"><button type="button" class="secondary" data-close-management>انصراف</button><button type="submit" class="primary">ذخیره کالا</button></div></form></div><div id="categoryModal" class="modal hidden"><div class="modal-header"><div><span class="eyebrow">ساختار کالاها</span><h3 id="categoryModalTitle">ثبت دسته‌بندی</h3></div><button class="modal-close" data-close-management>×</button></div><form id="categoryForm"><input id="categoryId" type="hidden"><label>کد دسته‌بندی *<input id="categoryCode" required inputmode="numeric" pattern="\\d{1,4}"></label><label>نام دسته‌بندی *<input id="categoryName" required></label><label>توضیحات<textarea id="categoryDescription" rows="4"></textarea></label><div id="categoryFormError" class="form-error hidden"></div><div class="modal-actions"><button type="button" class="secondary" data-close-management>انصراف</button><button type="submit" class="primary">ذخیره دسته‌بندی</button></div></form></div></div>`);
  placeholder.insertAdjacentHTML('beforebegin', `<section id="partiesPage" class="page hidden"><div class="page-heading"><div><span class="eyebrow">مدیریت اشخاص</span><h2>طرف‌حساب‌ها</h2></div><button id="addParty" class="primary">＋ ثبت طرف‌حساب</button></div><div class="panel management-toolbar"><div class="toolbar-search"><span>⌕</span><input id="partiesFilter" placeholder="جست‌وجوی نام، کد یا شماره تماس"></div><select id="partyTypeFilter"><option value="">همه انواع</option><option value="customer">مشتری</option><option value="supplier">تأمین‌کننده</option><option value="both">هر دو</option></select><label class="check-label"><input id="showInactiveParties" type="checkbox"> نمایش غیرفعال‌ها</label></div><div class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>کد</th><th>نام و نام خانوادگی</th><th>نوع</th><th>شماره تماس</th><th>آدرس</th><th>مانده</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody id="partiesTable"></tbody></table></div></div></section>`);
  $('#managementModalBackdrop').insertAdjacentHTML('beforeend', `<div id="partyModal" class="modal hidden"><div class="modal-header"><div><span class="eyebrow">اطلاعات طرف‌حساب</span><h3 id="partyModalTitle">ثبت طرف‌حساب جدید</h3></div><button class="modal-close" data-close-management>×</button></div><form id="partyForm"><input id="partyId" type="hidden"><div class="form-grid"><label>نام *<input id="partyFirstName" required></label><label>نام خانوادگی<input id="partyLastName"></label><label>شماره تماس<input id="partyPhone" inputmode="tel"></label><label>شماره همراه<input id="partyMobile" inputmode="tel"></label><label>نوع طرف‌حساب *<select id="partyType" required><option value="customer">مشتری</option><option value="supplier">تأمین‌کننده</option><option value="both">هر دو</option></select></label></div><label>آدرس<textarea id="partyAddress" rows="3"></textarea></label><label>توضیحات<textarea id="partyDescription" rows="3"></textarea></label><div id="partyFormError" class="form-error hidden"></div><div class="modal-actions"><button type="button" class="secondary" data-close-management>انصراف</button><button type="submit" class="primary">ذخیره طرف‌حساب</button></div></form></div>`);
  $('#productForm .modal-actions')?.insertAdjacentHTML('beforebegin', `<section id="productPurchaseHistory" class="product-purchase-history hidden"><div class="product-purchase-history-heading"><div><h4>سوابق خرید کالا</h4><small id="productPurchaseHistorySummary"></small></div></div><div class="table-wrap"><table><thead><tr><th>تاریخ</th><th>تأمین‌کننده</th><th>فاکتور</th><th>تعداد</th><th>قیمت واحد</th><th>تخفیف</th><th>قیمت خالص</th></tr></thead><tbody id="productPurchaseHistoryRows"></tbody></table></div></section>`);
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

function initializeSalesMarkup() {
  const page = $('#salesPage');
  if (!page || page.dataset.redesigned) return;
  page.innerHTML = `<div class="page-heading daily-sale-heading"><div><span class="eyebrow">عملیات فروش</span><h2>ثبت فروش روزانه</h2><div class="daily-sale-shortcuts"><kbd>F2</kbd> جست‌وجو <kbd>Enter</kbd> افزودن <kbd>F9</kbd> ثبت فروش</div></div><label class="sale-date-field daily-sale-date-field"><span class="sale-date-caption"><i aria-hidden="true">◷</i>تاریخ فروش</span><input id="saleDate" type="date"></label></div><div class="sale-modern-layout"><section class="panel product-picker"><div class="picker-header"><div><h3>افزودن کالا</h3><small>بارکد را اسکن کنید یا نام، کد و بارکد را جست‌وجو کنید.</small></div><div class="toolbar-search daily-sale-search"><span>⌕</span><input id="saleProductFilter" placeholder="اسکن بارکد یا جست‌وجوی کالا" autocomplete="off"><kbd>F2</kbd></div></div><div class="daily-sale-hint">با اسکن دوبارهٔ یک کالا، تعداد همان ردیف افزایش پیدا می‌کند.</div><div id="saleProductCards" class="product-cards"></div></section><aside class="panel modern-cart"><div class="cart-heading"><div><h3>سبد فروش</h3><small id="cartCount">۰ قلم</small></div><button id="clearSaleCart" class="danger-button" type="button">پاک کردن سبد</button></div><div class="table-wrap"><table><thead><tr><th>محصول</th><th>قیمت</th><th>تعداد</th><th></th></tr></thead><tbody id="modernSaleItems"></tbody></table></div><div class="cart-summary"><div><span>اقلام</span><strong id="cartItemCount">۰</strong></div><div><span>مبلغ کل</span><strong id="modernSaleTotal">${money(0)}</strong></div></div><div id="modernSaleError" class="form-error hidden"></div><div class="daily-sale-actions"><button id="modernSaveSale" class="primary wide" type="button">ثبت فروش <kbd>F9</kbd></button><button id="modernSaveSalePrint" class="secondary wide" type="button">ثبت و چاپ</button></div></aside></div>`;
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
  body.innerHTML = saleState.cart.length ? saleState.cart.map((item, index) => `<tr><td><strong>${esc(item.name)}</strong><small>${item.priceType === 'wholesale' ? 'عمده' : 'فروش'}</small></td><td><input class="cart-price" data-index="${index}" type="number" min="0" value="${(item.unitPrice / 100) * currencyFactor()}"></td><td><input class="cart-quantity" data-index="${index}" type="number" min="1" step="1" value="${item.quantity}"></td><td><button class="delete-line" data-index="${index}">×</button></td></tr>`).join('') : '<tr class="empty-row"><td colspan="4">برای شروع یکی از قیمت‌های محصول را انتخاب کنید.</td></tr>';
  $('#cartCount').textContent = `${new Intl.NumberFormat('fa-IR').format(saleState.cart.reduce((sum, item) => sum + item.quantity, 0))} قلم`;
  $('#cartItemCount') && ($('#cartItemCount').textContent = new Intl.NumberFormat('fa-IR').format(saleState.cart.reduce((sum, item) => sum + item.quantity, 0)));
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
  $('#modernSaleItems').addEventListener('input', (e) => { const index = Number(e.target.dataset.index); if (e.target.classList.contains('cart-price')) saleState.cart[index].unitPrice = parsePriceInput(e.target.value); else saleState.cart[index].quantity = Math.max(1, Math.round(Number(e.target.value || 1))); renderSaleCart(); });
  $('#modernSaleItems').addEventListener('click', (e) => { const button = e.target.closest('.delete-line'); if (button) { saleState.cart.splice(Number(button.dataset.index), 1); renderSaleCart(); } });
  $('#clearSaleCart').addEventListener('click', () => { if (!saleState.cart.length) return showToast('سبد فروش خالی است.', true); saleState.cart = []; renderSaleCart(); showToast('سبد فروش پاک شد.'); });
  $('#modernSaveSale').addEventListener('click', async () => { const error = $('#modernSaleError'); error.classList.add('hidden'); try { if (!saleState.cart.length) throw new Error('حداقل یک محصول به سبد اضافه کنید.'); const result = await window.api.sales.create({ items: saleState.cart.map((item) => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice / 100, discount: 0, priceType: item.priceType })), source: 'daily', date: jalaliInputToIso($('#saleDate').value) }); saleState.cart = []; renderSaleCart(); await loadSaleProducts(); await window.api.dashboard.summary().then(renderMetrics); showToast(`فروش ${result.invoiceNumber} با موفقیت ثبت شد. سود: ${money(result.profitTotal)}`); } catch (err) { error.textContent = err.message; error.classList.remove('hidden'); } });
}

function setManagedPage(page) {
  initializeManagementMarkup();
  initializeSidebarGroups();
  const titles = { dashboard: 'داشبورد', sales: 'ثبت فروش روزانه', products: 'مدیریت کالاها', categories: 'دسته‌بندی‌ها', customers: 'مدیریت مشتریان', reports: 'گزارش‌ها', settings: 'تنظیمات' };
  const viewPage = page === 'customers' ? 'parties' : page;
  ['dashboard', 'sales', 'products', 'categories', 'parties', 'placeholder'].forEach((id) => { const node = $(`#${id}Page`); if (node) node.classList.toggle('hidden', id !== viewPage && !(id === 'placeholder' && !['dashboard', 'sales', 'products', 'categories', 'parties'].includes(viewPage))); });
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  $('#pageTitle').textContent = titles[page] || page; $('#windowContext').textContent = titles[page] || page;
  if (page === 'products') loadManagedProducts(); if (page === 'categories') loadManagedCategories(); if (page === 'customers') loadManagedParties();
}

function openManagementModal(kind, record = null, options = {}) {
  initializeManagementMarkup();
  // همهٔ مودال‌های مدیریت (از جمله ورود محصولات) باید قبل از نمایش مودال جدید بسته شوند.
  // در غیر این صورت مودال ورود اکسلِ بازمانده روی فرم ثبت مشتری نمایش داده می‌شود.
  document.querySelectorAll('#managementModalBackdrop .modal').forEach((node) => node.classList.add('hidden'));
  productModalInvoiceTarget = kind === 'product' && !record && options.invoiceTarget
    ? { kind: options.invoiceTarget.kind, index: Number(options.invoiceTarget.index) }
    : null;
  $('#managementModalBackdrop').classList.remove('hidden');
  $(`#${kind}Modal`)?.classList.remove('hidden');
  if (kind === 'product') {
    $('#productModalTitle').textContent = record ? 'ویرایش کالا' : 'ثبت کالای جدید'; $('#productId').value = record?.id || '';
    $('#productForm').dataset.originalCategoryId = record?.categoryId || '';
    const productRetailPrice = record?.retailPrice ?? record?.salePrice ?? 0;
    [['productName', record?.name], ['productCode', record?.code], ['productBarcode', record?.barcode], ['productPurchasePrice', record ? formatPriceInput(record.purchasePrice) : formatPriceInput(0)], ['productWholesalePrice', record ? formatPriceInput(record.wholesalePrice) : formatPriceInput(0)], ['productRetailPrice', record ? formatPriceInput(productRetailPrice) : formatPriceInput(0)], ['productStock', record?.stock ?? 0], ['productMinimumStock', record?.minimumStock ?? 0], ['productDescription', record?.description || '']].forEach(([id, value]) => { $(`#${id}`).value = value ?? ''; });
    // Preserve saved prices when opening edit, but allow a new purchase price
    // to recalculate wholesale and retail prices just like the create form.
    productSellingPriceAuto = { wholesale: true, retail: true };
    setupProductPriceFields();
    if (!record) updateProductSellingPrices();
    $('#productCategory').value = record?.categoryId || ''; $('#productUnit').value = record?.unitId || '';
    syncProductLookupValues();
    const stockField = $('#productStock')?.closest('label');
    stockField?.classList.toggle('hidden', Boolean(productModalInvoiceTarget));
    if (productModalInvoiceTarget) $('#productStock').value = '0';
    loadProductPurchaseHistory(record?.id);
    if (!record) updateProductCodePreview(); $('#productName').focus();
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

function closeManagementModal() {
  document.querySelectorAll('#managementModalBackdrop .modal').forEach((node) => node.classList.add('hidden'));
  $('#managementModalBackdrop').classList.add('hidden');
}
async function loadProductPurchaseHistory(productId) {
  const section = $('#productPurchaseHistory');
  const summary = $('#productPurchaseHistorySummary');
  const rows = $('#productPurchaseHistoryRows');
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
      ? `${stats.count || data.length} سابقه · کمینه ${money(stats.minUnitPrice)} · بیشینه ${money(stats.maxUnitPrice)} · میانگین خالص ${money(stats.averageEffectiveUnitPrice)}`
      : 'برای این کالا سابقهٔ خرید فعال ثبت نشده است.';
    rows.innerHTML = data.length ? data.map((row) => `<tr><td>${isoToJalali(row.date)}</td><td>${esc(row.supplierName)}</td><td>${esc(row.invoiceNumber)}</td><td>${Number(row.quantity || 0)}${Number(row.returnedQuantity || 0) ? `<small>${Number(row.returnedQuantity)} مرجوعی</small>` : ''}</td><td>${money(row.unitPrice)}</td><td>${money(row.discount)}</td><td><strong>${money(row.effectiveUnitPrice)}</strong></td></tr>`).join('') : '<tr class="empty-row"><td colspan="7">سابقه‌ای برای نمایش وجود ندارد.</td></tr>';
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
      showToast(readableError(error, 'اطلاعات کالا بارگذاری نشد.'), true);
    }
  }
  if (record) openManagementModal('product', record);
}
let productSellingPriceAuto = { wholesale: true, retail: true };
function setupProductPriceFields() {
  const purchaseField = $('#productPurchasePrice');
  const wholesaleField = $('#productWholesalePrice');
  const retailField = $('#productRetailPrice');
  if (!purchaseField || !wholesaleField || !retailField) return;
  [purchaseField, wholesaleField, retailField].forEach((field) => {
    field.type = 'text';
    field.inputMode = 'decimal';
    field.removeAttribute('min');
  });
  ['productStock', 'productMinimumStock'].forEach((id) => {
    const field = $(`#${id}`);
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
  const purchaseField = $('#productPurchasePrice');
  const wholesaleField = $('#productWholesalePrice');
  const retailField = $('#productRetailPrice');
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
  return normalizeDigits(String(value ?? '').trim().toLowerCase())
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
    const select = $(`#${selectId}`);
    const input = $(`#${inputId}`);
    if (!select || !input) return;
    const item = productLookupItems(selectId).find((option) => String(option.id) === String(select.value));
    input.value = item?.label || '';
  });
}
function initializeProductLookups() {
  [['productCategory', 'productCategorySearch', 'productCategoryOptions', 'جست‌وجوی دسته‌بندی...'],
    ['productUnit', 'productUnitSearch', 'productUnitOptions', 'جست‌وجوی واحد...']].forEach(([selectId, inputId, datalistId, placeholder]) => {
    const select = $(`#${selectId}`);
    if (!select || $(`#${inputId}`)) return;
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
  const categories = managementState.categories.filter((c) => c.isActive);
  const units = managementState.units;
  $('#productCategory').innerHTML = '<option value="">بدون دسته‌بندی</option>' + categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('#productCategoryFilter').innerHTML = '<option value="">همه دسته‌بندی‌ها</option>' + categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('#productUnit').innerHTML = '<option value="">انتخاب واحد</option>' + units.map((u) => `<option value="${u.id}">${esc(u.name)}${u.symbol ? ` (${esc(u.symbol)})` : ''}</option>`).join('');
  [['productCategoryOptions', categories.map((c) => c.name)],
    ['productUnitOptions', units.map((u) => `${u.name}${u.symbol ? ` (${u.symbol})` : ''}`)]].forEach(([id, values]) => {
    const list = $(`#${id}`);
    if (list) list.innerHTML = values.map((value) => `<option value="${esc(value)}"></option>`).join('');
  });
  syncProductLookupValues();
}
let productCodePreviewSerial = 0;
async function updateProductCodePreview() {
  const codeField = $('#productCode');
  const categoryId = $('#productCategory')?.value;
  if (!codeField || !categoryId) {
    if (codeField) codeField.value = '';
    return;
  }

  const productId = $('#productId')?.value;
  const originalCategoryId = $('#productForm')?.dataset.originalCategoryId || '';
  if (productId && String(categoryId) === String(originalCategoryId)) return;

  const requestSerial = ++productCodePreviewSerial;
  codeField.value = 'در حال محاسبه…';
  try {
    const nextCode = await window.api.products.nextCode(categoryId, productId || null);
    if (requestSerial === productCodePreviewSerial && String($('#productCategory')?.value) === String(categoryId)) {
      codeField.value = nextCode;
    }
  } catch (error) {
    if (requestSerial === productCodePreviewSerial) {
      codeField.value = '';
      showToast(readableError(error, 'محاسبه کد بعدی کالا انجام نشد.'), true);
    }
  }
}
function renderManagedProducts() {
  // Keep every caller (including search/filter listeners bound earlier) on the
  // enhanced table renderer with editable purchase, wholesale and retail fields.
  if (typeof renderEnhancedManagedProducts === 'function') return renderEnhancedManagedProducts();
}
function renderManagedCategories() { const term = ($('#categoriesFilter')?.value || '').trim().toLowerCase(); const includeInactive = $('#showInactiveCategories')?.checked; const rows = managementState.categories.filter((c) => (includeInactive || c.isActive) && (!term || `${c.code} ${c.name}`.toLowerCase().includes(term))); $('#categoriesTable').innerHTML = rows.length ? rows.map((c) => `<tr class="${c.isActive ? '' : 'muted-row'}"><td><strong>${esc(c.code)}</strong></td><td><strong>${esc(c.name)}</strong></td><td>${esc(c.description || '—')}</td><td>${new Intl.NumberFormat('fa-IR').format(c.productCount || 0)}</td><td><span class="status-badge ${c.isActive ? 'active' : 'inactive'}">${c.isActive ? 'فعال' : 'غیرفعال'}</span></td><td><button class="table-action edit-category" data-id="${c.id}">ویرایش</button><button class="table-action danger toggle-category" data-id="${c.id}" data-active="${c.isActive}">${c.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button></td></tr>`).join('') : '<tr class="empty-row"><td colspan="6">دسته‌بندی‌ای برای نمایش وجود ندارد.</td></tr>'; }
function renderManagedParties() { const term = ($('#partiesFilter')?.value || '').trim().toLowerCase(); const type = $('#partyTypeFilter')?.value || ''; const includeInactive = $('#showInactiveParties')?.checked; const labels = { customer: 'مشتری', supplier: 'تأمین‌کننده', both: 'هر دو' }; const rows = managementState.parties.filter((p) => (includeInactive || p.isActive) && (!type || p.partyType === type) && (!term || [p.name, p.code, p.phone, p.mobile, p.address].some((v) => String(v || '').toLowerCase().includes(term)))); $('#partiesTable').innerHTML = rows.length ? rows.map((p) => `<tr class="${p.isActive ? '' : 'muted-row'}"><td><strong>${esc(p.code)}</strong></td><td><strong>${esc(p.name)}</strong></td><td><span class="status-badge ${p.partyType === 'supplier' ? 'inactive' : 'active'}">${labels[p.partyType] || p.partyType}</span></td><td>${esc(p.phone || p.mobile || '—')}</td><td>${esc(p.address || '—')}</td><td>${money(p.balance)}</td><td><span class="status-badge ${p.isActive ? 'active' : 'inactive'}">${p.isActive ? 'فعال' : 'غیرفعال'}</span></td><td><button class="table-action edit-party" data-id="${p.id}">ویرایش</button><button class="table-action danger toggle-party" data-id="${p.id}" data-active="${p.isActive}">${p.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button></td></tr>`).join('') : '<tr class="empty-row"><td colspan="8">طرف‌حسابی برای نمایش وجود ندارد.</td></tr>'; }
let managedProductsLoadSerial = 0;
async function loadManagedProducts() {
  const serial = ++managedProductsLoadSerial;
  const tablePanel = document.querySelector('#productsPage .table-panel');
  const loader = $('#productsLoading') || (() => {
    if (!tablePanel) return null;
    tablePanel.insertAdjacentHTML('afterbegin', '<div id="productsLoading" class="products-loading hidden" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><span>در حال بارگذاری کالاها...</span></div>');
    return $('#productsLoading');
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
      const result = await window.api.products.checkDuplicate({ name: $('#productName').value, barcode: $('#productBarcode').value }, $('#productId').value || null);
      if (serial !== duplicateCheckSerial || !result?.duplicate) return;
      const error = $('#productFormError');
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
  $('#productName').addEventListener('blur', checkProductDuplicateOnBlur);
  $('#productBarcode').addEventListener('blur', checkProductDuplicateOnBlur);
  document.addEventListener('click', (event) => { const pageButton = event.target.closest('[data-page]'); if (pageButton) { event.preventDefault(); setManagedPage(pageButton.dataset.page); } const invoiceProduct = event.target.closest('.invoice-new-product'); if (invoiceProduct) { const kind = invoiceProduct.dataset.kind; const emptyRow = invoiceState[kind].items.findIndex((item) => !item.productId); openProductForInvoice(kind, emptyRow >= 0 ? emptyRow : invoiceState[kind].items.length - 1); } if (event.target.closest('#addProduct')) openManagementModal('product'); if (event.target.closest('#addCategory')) openManagementModal('category'); if (event.target.closest('#addParty')) openManagementModal('party'); if (event.target.closest('[data-close-management]') || event.target.id === 'managementModalBackdrop') closeManagementModal(); const editProduct = event.target.closest('.edit-product'); if (editProduct) openProductForEdit(editProduct.dataset.id); const editCategory = event.target.closest('.edit-category'); if (editCategory) openManagementModal('category', managementState.categories.find((c) => c.id === Number(editCategory.dataset.id))); const editParty = event.target.closest('.edit-party'); if (editParty) openManagementModal('party', managementState.parties.find((p) => p.id === Number(editParty.dataset.id))); const toggleProduct = event.target.closest('.toggle-product'); if (toggleProduct) { const active = toggleProduct.dataset.active !== '1'; window.api.products.setActive(Number(toggleProduct.dataset.id), active).then(() => { showToast(active ? 'کالا فعال شد.' : 'کالا غیرفعال شد.'); return loadManagedProducts(); }).catch((err) => showToast(err.message, true)); } const toggleCategory = event.target.closest('.toggle-category'); if (toggleCategory) { const active = toggleCategory.dataset.active !== '1'; window.api.categories.setActive(Number(toggleCategory.dataset.id), active).then(() => { showToast(active ? 'دسته‌بندی فعال شد.' : 'دسته‌بندی غیرفعال شد.'); return loadManagedCategories(); }).catch((err) => showToast(err.message, true)); } const toggleParty = event.target.closest('.toggle-party'); if (toggleParty) { const active = toggleParty.dataset.active !== '1'; window.api.customers.setActive(Number(toggleParty.dataset.id), active).then(() => { showToast(active ? 'طرف‌حساب فعال شد.' : 'طرف‌حساب غیرفعال شد.'); return loadManagedParties(); }).catch((err) => showToast(err.message, true)); } });
  ['productsFilter', 'productCategoryFilter', 'showInactiveProducts'].forEach((id) => $(`#${id}`)?.addEventListener('input', renderManagedProducts)); ['categoriesFilter', 'showInactiveCategories'].forEach((id) => $(`#${id}`)?.addEventListener('input', renderManagedCategories)); ['partiesFilter', 'partyTypeFilter', 'showInactiveParties'].forEach((id) => $(`#${id}`)?.addEventListener('input', renderManagedParties)); $('#productCategory').addEventListener('change', updateProductCodePreview); $('#productPurchasePrice').addEventListener('input', updateProductSellingPrices); $('#productWholesalePrice').addEventListener('input', () => { productSellingPriceAuto.wholesale = false; }); $('#productRetailPrice').addEventListener('input', () => { productSellingPriceAuto.retail = false; });
  $('#productForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('#productFormError');
    error.classList.add('hidden');
    document.querySelectorAll('#productForm [aria-invalid="true"]').forEach((field) => field.removeAttribute('aria-invalid'));
    const payload = {
      name: $('#productName').value,
      code: $('#productCode').value,
      barcode: $('#productBarcode').value,
      categoryId: $('#productCategory').value,
      unitId: $('#productUnit').value,
      purchasePrice: parsePriceInput($('#productPurchasePrice').value),
      wholesalePrice: parsePriceInput($('#productWholesalePrice').value),
      retailPrice: parsePriceInput($('#productRetailPrice').value),
      stock: productModalInvoiceTarget ? 0 : Math.max(0, Math.round(Number($('#productStock').value || 0))),
      minimumStock: Math.max(0, Math.round(Number($('#productMinimumStock').value || 0))),
      description: $('#productDescription').value
    };
    try {
      const id = $('#productId').value;
      const saved = id
        ? await window.api.products.update(Number(id), payload)
        : await window.api.products.create(payload);
      const target = productModalInvoiceTarget;
      showToast(id ? 'کالا با موفقیت ویرایش شد.' : 'کالا با موفقیت ثبت شد.');
      await loadManagedProducts();

      if (id) {
        closeManagementModal();
        productModalInvoiceTarget = null;
      } else if (target?.kind && Number.isInteger(target.index)) {
        closeManagementModal();
        productModalInvoiceTarget = null;
        await loadKeyboardInvoice(target.kind);
        const product = invoiceState[target.kind].products.find((item) => item.id === Number(saved?.id));
        if (product) chooseKeyboardProduct(target.kind, target.index, product);
      } else {
        // Keep the product dialog open and clear it for fast consecutive entry.
        productModalInvoiceTarget = null;
        openManagementModal('product');
      }
    } catch (err) {
      const message = readableError(err, 'ثبت کالا انجام نشد.');
      error.textContent = message;
      error.classList.remove('hidden');
      if (message.includes('بارکد')) $('#productBarcode').focus();
      else if (message.includes('قبلاً ثبت شده')) $('#productName').focus();
    }
  });
  ['productPurchasePrice', 'productWholesalePrice', 'productRetailPrice'].forEach((id) => $(`#${id}`)?.addEventListener('input', updateProductProfitPreview));
  $('#categoryForm').addEventListener('submit', async (event) => { event.preventDefault(); const error = $('#categoryFormError'); error.classList.add('hidden'); const payload = { code: $('#categoryCode').value, name: $('#categoryName').value, description: $('#categoryDescription').value }; try { const id = $('#categoryId').value; if (id) await window.api.categories.update(Number(id), payload); else await window.api.categories.create(payload); closeManagementModal(); showToast(id ? 'دسته‌بندی با موفقیت ویرایش شد.' : 'دسته‌بندی با موفقیت ثبت شد.'); await loadManagedCategories(); } catch (err) { error.textContent = err.message; error.classList.remove('hidden'); } });
  $('#partyForm').addEventListener('submit', async (event) => { event.preventDefault(); const error = $('#partyFormError'); error.classList.add('hidden'); const payload = { firstName: $('#partyFirstName').value, lastName: $('#partyLastName').value, phone: $('#partyPhone').value, mobile: $('#partyMobile').value, address: $('#partyAddress').value, partyType: $('#partyType').value, description: $('#partyDescription').value }; try { const id = $('#partyId').value; if (id) await window.api.customers.update(Number(id), payload); else await window.api.customers.create(payload); closeManagementModal(); showToast(id ? 'طرف‌حساب با موفقیت ویرایش شد.' : 'طرف‌حساب با موفقیت ثبت شد.'); await loadManagedParties(); } catch (err) { error.textContent = err.message; error.classList.remove('hidden'); } });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeManagementModal(); });
}

initializeManagementMarkup();
setManagedPage('dashboard');

let productBarcodeBuffer = '';
let productBarcodeStartedAt = 0;
document.addEventListener('keydown', (event) => {
  const productsPage = $('#productsPage');
  if (!productsPage || productsPage.classList.contains('hidden')) return;
  const target = event.target;
  const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
  if ((event.key === '/' || event.key === 'F2') && !typing) { event.preventDefault(); $('#productsFilter')?.focus(); return; }
  if (event.key.toLowerCase() === 'n' && !typing) { event.preventDefault(); $('#addProduct')?.click(); return; }
  if (event.key === 'Escape') { $('#productColumnsMenu')?.classList.add('hidden'); $('#productDetailsDrawer')?.classList.add('hidden'); }
  if (event.key === 'Enter' && !typing) { const first = document.querySelector('#productsTable .edit-product'); if (first) first.click(); }
  if (typing && target.id === 'productsFilter') {
    const now = performance.now();
    if (!productBarcodeStartedAt || now - productBarcodeStartedAt > 120) productBarcodeBuffer = '';
    productBarcodeStartedAt = now;
    if (event.key === 'Enter' && productBarcodeBuffer.length >= 4) { event.preventDefault(); target.value = productBarcodeBuffer; target.dispatchEvent(new Event('input', { bubbles: true })); productBarcodeBuffer = ''; }
    else if (event.key.length === 1 && !event.ctrlKey && !event.altKey) productBarcodeBuffer += event.key;
  }
});
document.addEventListener('click', (event) => { if (!event.target.closest('#productColumnsButton, #productColumnsMenu')) $('#productColumnsMenu')?.classList.add('hidden'); });

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
    if (!actions.querySelector('#productColumnsButton')) actions.insertAdjacentHTML('beforeend', '<button id="productColumnsButton" class="ghost" type="button">ستون‌ها</button><div id="productColumnsMenu" class="product-columns-menu hidden"></div>');
  }
  const toolbar = document.querySelector('#productsPage .management-toolbar');
  if (toolbar && !$('#productQualityFilter')) {
    toolbar.insertAdjacentHTML('beforeend', '<select id="productQualityFilter" title="فیلتر کیفیت داده"><option value="">همه کالاها</option><option value="zero-price">بدون قیمت</option><option value="abnormal-price">قیمت نامتعارف</option><option value="zero-stock">موجودی صفر</option><option value="low-stock">موجودی کم</option><option value="no-barcode">بدون بارکد</option><option value="inactive">کالاهای غیرفعال</option></select>');
  }
  const tablePanel = document.querySelector('#productsPage .table-panel');
  const productTable = document.querySelector('#productsPage table');
  if (productTable && !productTable.querySelector('.select-col')) {
    productTable.querySelector('thead tr')?.insertAdjacentHTML('afterbegin', '<th class="select-col"><input id="selectAllProducts" type="checkbox" aria-label="انتخاب همه کالاها"></th>');
  }
  if (tablePanel && !$('#productsBulkBar')) tablePanel.insertAdjacentHTML('beforebegin', '<div id="productsBulkBar" class="products-bulk-bar hidden"><strong><span id="selectedProductsCount">۰</span> کالا انتخاب شده</strong><button type="button" class="secondary" id="bulkActivateProducts">فعال‌سازی</button><button type="button" class="secondary" id="bulkDeactivateProducts">غیرفعال‌سازی</button><button type="button" class="ghost" id="bulkClearProducts">لغو انتخاب</button></div>');
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
  initializeProductColumnMenu();
  if (!$('#productDetailsDrawer')) document.body.insertAdjacentHTML('beforeend', `<aside id="productDetailsDrawer" class="product-details-drawer hidden"><div class="product-details-head"><div><span class="eyebrow">اطلاعات کالا</span><h3 id="productDetailsTitle">کالا</h3></div><button type="button" class="modal-close" data-close-product-details>×</button></div><div id="productDetailsSummary" class="product-details-form"></div><div class="product-details-tabs"><button type="button" class="product-detail-tab active" data-detail-tab="prices">تاریخچه قیمت</button><button type="button" class="product-detail-tab" data-detail-tab="movements">گردش موجودی</button></div><div id="productDetailsContent" class="product-details-content"></div></aside>`);
  const closeDetailsButton = document.querySelector('[data-close-product-details]');
  if (closeDetailsButton && !closeDetailsButton.dataset.bound) { closeDetailsButton.dataset.bound = '1'; closeDetailsButton.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); $('#productDetailsDrawer')?.classList.add('hidden'); }); }
  const priceField = document.querySelector('#productRetailPrice');
  if (priceField && !$('#productProfitPreview')) priceField.closest('label')?.insertAdjacentHTML('afterend', '<div id="productProfitPreview" class="product-profit-preview" aria-live="polite"></div>');
  if (!$('#productsBulkBar')?.dataset.bound) {
    $('#productsBulkBar')?.setAttribute('data-bound', '1');
    $('#selectAllProducts')?.addEventListener('change', (event) => { document.querySelectorAll('#productsTable .product-select').forEach((input) => { input.checked = event.target.checked; }); updateProductSelectionUi(); });
    $('#productsBulkBar')?.addEventListener('click', async (event) => {
      const action = event.target.closest('#bulkActivateProducts, #bulkDeactivateProducts');
      if (event.target.closest('#bulkClearProducts')) { document.querySelectorAll('.product-select').forEach((input) => { input.checked = false; }); updateProductSelectionUi(); return; }
      if (!action) return;
      const ids = [...document.querySelectorAll('#productsTable .product-select:checked')].map((input) => Number(input.dataset.id));
      if (!ids.length) return;
      action.disabled = true;
      try { await Promise.all(ids.map((id) => window.api.products.setActive(id, action.id === 'bulkActivateProducts'))); showToast(`${ids.length} کالا به‌روزرسانی شد.`); await loadManagedProducts(); } catch (error) { showToast(error.message, true); } finally { action.disabled = false; }
    });
  }
}

function initializeProductColumnMenu() {
  const menu = $('#productColumnsMenu');
  if (!menu || menu.dataset.ready) return;
  const columns = [{ key: 'code', label: 'کد' }, { key: 'name', label: 'نام کالا' }, { key: 'category', label: 'دسته‌بندی' }, { key: 'prices', label: 'قیمت‌ها' }, { key: 'stock', label: 'موجودی' }, { key: 'unit', label: 'واحد' }, { key: 'status', label: 'وضعیت' }, { key: 'actions', label: 'عملیات' }];
  const saved = JSON.parse(localStorage.getItem('accletron.products.columns') || '{}');
  menu.innerHTML = '<strong>ستون‌های قابل نمایش</strong>' + columns.map((column) => `<label><input type="checkbox" data-column="${column.key}" ${saved[column.key] !== false ? 'checked' : ''}>${column.label}</label>`).join('') + '<button type="button" class="text-button" id="resetProductColumns">بازنشانی</button>';
  menu.dataset.ready = '1';
  $('#productColumnsButton')?.addEventListener('click', (event) => { event.stopPropagation(); menu.classList.toggle('hidden'); });
  menu.addEventListener('click', (event) => event.stopPropagation());
  menu.querySelectorAll('input').forEach((input) => input.addEventListener('change', applyProductColumnPrefs));
  $('#resetProductColumns')?.addEventListener('click', () => { localStorage.removeItem('accletron.products.columns'); menu.querySelectorAll('input').forEach((input) => { input.checked = true; }); applyProductColumnPrefs(); });
  applyProductColumnPrefs();
}
function applyProductColumnPrefs() {
  const menu = $('#productColumnsMenu'); if (!menu) return;
  const prefs = {}; menu.querySelectorAll('input[data-column]').forEach((input) => { prefs[input.dataset.column] = input.checked; });
  localStorage.setItem('accletron.products.columns', JSON.stringify(prefs));
  const keys = ['code', 'name', 'category', 'prices', 'stock', 'unit', 'status', 'actions'];
  document.querySelectorAll('#productsPage table tr').forEach((row) => { [...row.children].forEach((cell, index) => { if (index === 0) return; cell.style.display = prefs[keys[index - 1]] === false ? 'none' : ''; }); });
}

function updateProductProfitPreview() {
  const purchase = parsePriceInput($('#productPurchasePrice')?.value || 0);
  const wholesale = parsePriceInput($('#productWholesalePrice')?.value || 0);
  const retail = parsePriceInput($('#productRetailPrice')?.value || 0);
  const formatPercent = (value) => `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(value)}٪`;
  const margin = (price) => purchase > 0 ? ((price - purchase) / purchase * 100) : 0;
  const preview = $('#productProfitPreview');
  if (preview) preview.innerHTML = `<span>پیشنهاد فروش: <b>${formatPriceInput(Math.ceil(purchase * 1.3))}</b></span><span>سود عمده: <b>${formatPercent(margin(wholesale))}</b></span><span>سود خرده: <b>${formatPercent(margin(retail))}</b></span>`;
}

function updateProductSelectionUi() {
  const selected = document.querySelectorAll('#productsTable .product-select:checked').length;
  const bar = $('#productsBulkBar'); if (bar) bar.classList.toggle('hidden', selected === 0);
  if ($('#selectedProductsCount')) $('#selectedProductsCount').textContent = new Intl.NumberFormat('fa-IR').format(selected);
}

async function openProductDetails(product) {
  const drawer = $('#productDetailsDrawer'); if (!drawer || !product) return;
  drawer.dataset.productId = String(product.id); drawer.classList.remove('hidden');
  $('#productDetailsTitle').textContent = product.name;
  $('#productDetailsSummary').innerHTML = `<div class="details-card details-card-code"><span>کد کالا</span><b>${esc(product.code || '—')}</b></div><div class="details-card details-card-stock"><span>موجودی</span><b>${esc(product.stock)} ${esc(product.unitSymbol || product.unitName || '')}</b></div><div class="details-card details-card-price"><span>قیمت فروش</span><b>${money(product.salePrice)}</b></div>`;
  await renderProductDetailsTab('prices', product);
}
async function renderProductDetailsTab(tab, product) {
  const content = $('#productDetailsContent'); if (!content) return;
  content.innerHTML = '<div class="empty-state compact">در حال بارگذاری...</div>';
  try {
    if (tab === 'prices') {
      const response = await window.api.purchases.priceHistory(product.id, { limit: 50 });
      const rows = Array.isArray(response) ? response : (response?.items || []);
      content.innerHTML = rows?.length ? `<table class="details-table"><thead><tr><th>تاریخ</th><th>تأمین‌کننده</th><th>قیمت واحد</th><th>تعداد</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${dateTimeToJalali(row.date || row.createdAt)}</td><td>${esc(row.partyName || row.supplierName || '—')}</td><td>${money(row.unitPrice || row.purchasePrice || 0)}</td><td>${esc(row.quantity ?? '—')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state compact">تاریخچه قیمتی ثبت نشده است.</div>';
    } else {
      const rows = await window.api.inventory.movements({ productId: product.id });
      const labels = { purchase: 'خرید', sale: 'فروش', adjustment: 'اصلاح', return: 'مرجوعی' };
      content.innerHTML = rows?.length ? `<table class="details-table"><thead><tr><th>تاریخ</th><th>نوع</th><th>تغییر</th><th>شرح</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${dateTimeToJalali(row.createdAt)}</td><td>${labels[row.type] || esc(row.type)}</td><td class="${Number(row.quantity) < 0 ? 'loss-amount' : 'profit-amount'}">${esc(row.quantity)}</td><td>${esc(row.description || '—')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state compact">گردش موجودی ثبت نشده است.</div>';
    }
  } catch (error) { content.innerHTML = `<div class="form-error">${esc(error.message || 'بارگذاری اطلاعات انجام نشد.')}</div>`; }
}

function renderEnhancedManagedProducts() {
  enhanceProductManagementUi();
  const term = ($('#productsFilter')?.value || '').trim().toLowerCase();
  const category = $('#productCategoryFilter')?.value || '';
  const quality = $('#productQualityFilter')?.value || '';
  const includeInactive = $('#showInactiveProducts')?.checked;
  const rows = managementState.products.filter((p) => {
    if (!includeInactive && quality !== 'inactive' && !p.isActive) return false;
    if (quality === 'inactive' && p.isActive) return false;
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
  if ($('#productsStats')) $('#productsStats').innerHTML = `<button type="button" class="product-stat-filter ${!quality ? 'selected' : ''}" data-quality="">همه <b>${new Intl.NumberFormat('fa-IR').format(all.length)}</b></button><button type="button" class="product-stat-filter ${quality === 'low-stock' ? 'selected' : ''}" data-quality="low-stock">موجودی کم <b>${new Intl.NumberFormat('fa-IR').format(lowStock)}</b></button><button type="button" class="product-stat-filter ${quality === 'zero-stock' ? 'selected' : ''}" data-quality="zero-stock">ناموجود <b>${new Intl.NumberFormat('fa-IR').format(zeroStock)}</b></button><button type="button" class="product-stat-filter ${quality === 'zero-price' ? 'selected' : ''}" data-quality="zero-price">قیمت ناقص <b>${new Intl.NumberFormat('fa-IR').format(zeroPrice)}</b></button><button type="button" class="product-stat-filter ${quality === 'inactive' ? 'selected' : ''}" data-quality="inactive">غیرفعال <b>${new Intl.NumberFormat('fa-IR').format(inactive)}</b></button>`;
  $('#productsTable').innerHTML = rows.length ? rows.map((p) => { const stock = Number(p.stock || 0); const minimum = Number(p.minimumStock || 0); const stockState = stock <= 0 ? 'out' : (stock <= minimum ? 'low' : 'ok'); const stockLabel = stock <= 0 ? 'ناموجود' : (stock <= minimum ? 'کمبود' : 'مناسب'); return `<tr class="${p.isActive ? '' : 'muted-row'}"><td>${esc(p.code)}</td><td><strong>${esc(p.name)}</strong>${p.barcode ? `<small>${esc(p.barcode)}</small>` : ''}</td><td>${esc(p.categoryName || '—')}</td><td class="product-prices-cell"><label>خرید<input class="quick-product-purchase" type="number" min="0" value="${Math.round((Number(p.purchasePrice || 0) / 100) * currencyFactor())}"></label><label>عمده<input class="quick-product-wholesale" type="number" min="0" value="${Math.round((Number(p.wholesalePrice || 0) / 100) * currencyFactor())}"></label><label>فروش<input class="quick-product-price" data-id="${p.id}" data-field="retailPrice" type="number" min="0" value="${Math.round((Number(p.salePrice || 0) / 100) * currencyFactor())}"></label></td><td class="product-stock-cell"><input class="quick-product-stock" data-id="${p.id}" type="number" min="0" step="0.01" value="${p.stock ?? 0}"><span class="stock-indicator ${stockState}">${stockLabel}</span></td><td>${esc(p.unitSymbol || p.unitName || '—')}</td><td><span class="status-badge ${p.isActive ? 'active' : 'inactive'}">${p.isActive ? 'فعال' : 'غیرفعال'}</span>${productPriceWarning(p) ? '<span class="quality-badge">بررسی قیمت</span>' : ''}</td><td><button class="table-action quick-product-save" data-id="${p.id}">ذخیره</button><button class="table-action edit-product" data-id="${p.id}">ویرایش</button><button class="table-action danger toggle-product" data-id="${p.id}" data-active="${p.isActive}">${p.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button></td></tr>`; }).join('') : '<tr class="empty-row"><td colspan="8">کالایی برای نمایش وجود ندارد.</td></tr>';
  $('#productsTable .empty-row td')?.setAttribute('colspan', '9');
  $('#productsTable').querySelectorAll('tr').forEach((row, index) => {
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
  const quality = $('#productQualityFilter');
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
  if (event.target.closest('[data-close-product-details]')) { $('#productDetailsDrawer')?.classList.add('hidden'); return; }
  const detailTab = event.target.closest('[data-detail-tab]');
  if (detailTab) { const drawer = $('#productDetailsDrawer'); const product = managementState.products.find((item) => item.id === Number(drawer?.dataset.productId)); if (product) { document.querySelectorAll('.product-detail-tab').forEach((tab) => tab.classList.toggle('active', tab === detailTab)); await renderProductDetailsTab(detailTab.dataset.detailTab, product); } return; }
  if (event.target.closest('.product-select')) { updateProductSelectionUi(); return; }
  const productRow = event.target.closest('#productsTable tr');
  if (productRow && !event.target.closest('button,input,select')) { const code = productRow.children[1]?.textContent?.trim(); const product = managementState.products.find((item) => String(item.code) === code); if (product) openProductDetails(product); return; }
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
      <section class="settings-panel" data-settings-panel="appearance"><form id="v2Appearance" class="panel settings-card"><h3>\u0638\u0627\u0647\u0631 \u0648 \u0631\u0641\u062a\u0627\u0631</h3><div class="form-grid"><label>\u067e\u0648\u0633\u062a\u0647<select id="v2Theme"><option value="dark">\u062a\u0627\u0631\u06cc\u06a9</option><option value="light">\u0631\u0648\u0634\u0646</option><option value="system">\u0633\u06cc\u0633\u062a\u0645</option></select></label><label>\u062a\u0642\u0648\u06cc\u0645<select id="v2Calendar"><option value="gregorian">\u0645\u06cc\u0644\u0627\u062f\u06cc</option><option value="jalali">\u0634\u0645\u0633\u06cc</option></select></label><label>\u0641\u0648\u0646\u062a (%)<input id="v2Font" type="number" min="80" max="130"></label></div><div class="settings-checks"><label class="settings-check"><input id="v2Notify" type="checkbox">\u0627\u0639\u0644\u0627\u0646\u200c\u0647\u0627</label><label class="settings-check"><input id="v2Shortcuts" type="checkbox">\u0645\u06cc\u0627\u0646\u0628\u0631\u0647\u0627</label><label class="settings-check"><input id="v2Passwordless" type="checkbox">\u0648\u0631\u0648\u062f \u0628\u062f\u0648\u0646 \u0631\u0645\u0632 \u0641\u0642\u0637 \u0628\u0627 \u0646\u0627\u0645 \u06a9\u0627\u0631\u0628\u0631\u06cc</label></div><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647</button></form></section>
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
  const load = async () => { settings = await window.api.settings.get(); if (settings.currency) uiCurrency = { ...uiCurrency, ...settings.currency }; const s = settings.store || {}, p = settings.print || {}, c = settings.currency || {}, sl = settings.sales || {}, pr = settings.product || {}, f = settings.financial || {}, a = settings.appearance || {}, b = settings.backup || {}, sec = settings.security || {}; [['v2Name',s.name],['v2Slogan',s.slogan],['v2Phone',s.phone],['v2Postal',s.postalCode],['v2Address',s.address],['v2Website',s.website],['v2Instagram',s.instagram],['v2Rubika',s.rubika],['v2Footer',s.footer],['v2Logo',s.logoPath],['v2Paper',p.paperSize],['v2Copies',p.copies],['v2Margin',p.margin],['v2CurCode',c.code],['v2CurName',c.name],['v2CurSymbol',c.symbol],['v2CurPosition',c.position],['v2CurDecimals',c.decimals],['v2CurInput',c.inputUnit],['v2CurRound',c.rounding],['v2PriceType',sl.defaultPriceType],['v2SaleTax',sl.defaultTax],['v2InvoicePrefix',sl.invoicePrefix],['v2Payment',sl.paymentMethod],['v2ProductPrefix',pr.codePrefix],['v2MinStock',pr.defaultMinimumStock],['v2DefaultUnit',pr.defaultUnitId],['v2TaxRate',f.taxRate],['v2MaxDiscount',f.maxDiscount],['v2FinRound',f.rounding],['v2Theme',a.theme],['v2Calendar',a.calendar],['v2Font',a.fontScale],['v2BackupPath',b.path],['v2BackupFrequency',b.frequency]].forEach(([id,v]) => val(id,v)); [['v2Color',p.color],['v2ShowLogo',p.showLogo],['v2ShowInfo',p.showStoreInfo],['v2ShowDiscount',p.showDiscount],['v2ShowTax',p.showTax],['v2Preview',p.previewBeforePrint],['v2ShowPrintDialog',p.showPrintDialog],['v2AutoSale',p.autoPrintSale],['v2AutoPurchase',p.autoPrintPurchase],['v2CurSep',c.separator],['v2Oversell',sl.preventOversell],['v2AutoDate',sl.autoDate],['v2RequireBarcode',pr.requireBarcode],['v2Negative',pr.allowNegativeStock],['v2LowStock',pr.warnLowStock],['v2Fractional',pr.allowFractional],['v2TaxEnabled',f.taxEnabled],['v2TaxAfter',f.taxAfterDiscount],['v2Notify',a.notifications],['v2Shortcuts',a.shortcuts],['v2Passwordless',sec.passwordlessLogin],['v2BackupAuto',b.auto]].forEach(([id,v]) => chk(id,v)); managementState.units = await window.api.units.list(); renderUnits(); loadPrinters(p.printerName); $('#v2LogoLabel').textContent = s.logoPath || '\u0644\u0648\u06af\u0648\u06cc\u06cc \u0627\u0646\u062a\u062e\u0627\u0628 \u0646\u0634\u062f\u0647'; };
  const collect = () => ({ ...settings, store: { name: $('#v2Name').value, slogan: $('#v2Slogan').value, phone: $('#v2Phone').value, postalCode: $('#v2Postal').value, address: $('#v2Address').value, website: $('#v2Website').value, instagram: $('#v2Instagram').value, rubika: $('#v2Rubika').value, footer: $('#v2Footer').value, logoPath: $('#v2Logo').value }, print: { printerName: $('#v2Printer').value, paperSize: $('#v2Paper').value, copies: Number($('#v2Copies').value || 1), margin: $('#v2Margin').value, color: $('#v2Color').checked, showLogo: $('#v2ShowLogo').checked, showStoreInfo: $('#v2ShowInfo').checked, showDiscount: $('#v2ShowDiscount').checked, showTax: $('#v2ShowTax').checked, previewBeforePrint: $('#v2Preview').checked, showPrintDialog: $('#v2ShowPrintDialog').checked, autoPrintSale: $('#v2AutoSale').checked, autoPrintPurchase: $('#v2AutoPurchase').checked }, currency: { code: $('#v2CurCode').value, name: $('#v2CurName').value, symbol: $('#v2CurSymbol').value, position: $('#v2CurPosition').value, decimals: Number($('#v2CurDecimals').value || 0), separator: $('#v2CurSep').checked, rounding: $('#v2CurRound').value, inputUnit: $('#v2CurInput').value }, sales: { defaultPriceType: $('#v2PriceType').value, defaultTax: Number($('#v2SaleTax').value || 0), preventOversell: $('#v2Oversell').checked, invoicePrefix: $('#v2InvoicePrefix').value, paymentMethod: $('#v2Payment').value, autoDate: $('#v2AutoDate').checked }, product: { codePrefix: $('#v2ProductPrefix').value, defaultMinimumStock: Number($('#v2MinStock').value || 0), defaultUnitId: $('#v2DefaultUnit').value, requireBarcode: $('#v2RequireBarcode').checked, allowNegativeStock: $('#v2Negative').checked, warnLowStock: $('#v2LowStock').checked, allowFractional: $('#v2Fractional').checked }, financial: { taxRate: Number($('#v2TaxRate').value || 0), maxDiscount: Number($('#v2MaxDiscount').value || 0), rounding: $('#v2FinRound').value, taxEnabled: $('#v2TaxEnabled').checked, taxAfterDiscount: $('#v2TaxAfter').checked }, appearance: { theme: $('#v2Theme').value, calendar: $('#v2Calendar').value, fontScale: Number($('#v2Font').value || 100), notifications: $('#v2Notify').checked, shortcuts: $('#v2Shortcuts').checked }, security: { passwordlessLogin: $('#v2Passwordless').checked }, backup: { path: $('#v2BackupPath').value, frequency: $('#v2BackupFrequency').value, auto: $('#v2BackupAuto').checked } });
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
  return `<section id="${pageKey}InvoicesPage" class="page hidden invoice-list-page"><div class="page-heading"><div><span class="eyebrow">مدیریت سوابق</span><h2>فاکتورهای ${sale ? 'فروش' : 'خرید'}</h2></div><div class="invoice-list-actions">${mergeButton}<button class="primary" data-page="${sale ? 'sales-invoice' : 'purchases'}">＋ فاکتور جدید</button></div></div><div class="panel invoice-list-filters"><input class="invoice-list-query" data-kind="${kind}" placeholder="جست‌وجوی شماره، طرف‌حساب یا تلفن"><input class="invoice-list-from" data-kind="${kind}" type="date" placeholder="از تاریخ شمسی"><input class="invoice-list-to" data-kind="${kind}" type="date" placeholder="تا تاریخ شمسی"><select class="invoice-list-status" data-kind="${kind}"><option value="">همه وضعیت‌ها</option><option value="${sale ? 'active' : 'completed'}">دارای مانده/فعال</option><option value="cancelled">لغوشده</option>${sale ? '<option value="merged">فاکتورهای ادغام‌شده</option>' : ''}</select></div><div class="panel table-panel"><div class="table-wrap"><table><thead><tr>${selectionHeader}<th>شماره</th><th>تاریخ</th><th>طرف‌حساب</th><th>مبلغ کل</th><th>پرداخت‌شده</th><th>مانده</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody id="${kind}Table"></tbody></table></div></div></section>`;
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
  const fromValue = $(`${pageSelector} .invoice-list-from`)?.value || '';
  const toValue = $(`${pageSelector} .invoice-list-to`)?.value || '';
  const rows = await (apiKind === 'sale' ? window.api.sales.list : window.api.purchases.list)({ query, from: jalaliInputToIso(fromValue), to: jalaliInputToIso(toValue), status: $(`${pageSelector} .invoice-list-status`)?.value || '' });
  const body = $(`#${kind}Table`);
  const columnCount = apiKind === 'sale' ? 9 : 8;
  body.innerHTML = rows.length ? rows.map((row) => {
    const eligibleForMerge = apiKind === 'sale' && row.source === 'daily' && row.status === 'active';
    const selection = apiKind === 'sale' ? `<td class="invoice-selection-column">${eligibleForMerge ? `<input class="daily-sale-merge-select" type="checkbox" value="${row.id}" data-date="${row.date}" aria-label="انتخاب ${esc(row.invoiceNumber)} برای ادغام">` : ''}</td>` : '';
    return `<tr>${selection}<td><strong>${esc(row.invoiceNumber)}</strong></td><td>${isoToJalali(row.date)}</td><td>${apiKind === 'sale' && row.source === 'daily' ? '<span class="daily-sale-party">فروش روزانه</span>' : esc(row.partyName || 'بدون طرف‌حساب')}</td><td>${money(row.total)}</td><td>${money(row.paidAmount)}</td><td class="${row.remainingAmount > 0 ? 'debt-amount' : ''}">${money(row.remainingAmount)}</td><td><span class="status-badge ${row.status === 'cancelled' ? 'inactive' : row.remainingAmount > 0 ? 'warning' : 'active'}">${invoiceStatusLabel(row.status, row)}</span></td><td><button class="table-action view-invoice" data-kind="${apiKind}" data-id="${row.id}">مشاهده</button><button class="table-action print-invoice" data-kind="${apiKind}" data-id="${row.id}">چاپ</button>${row.remainingAmount > 0 && row.status !== 'cancelled' ? `<button class="table-action settle-invoice" data-kind="${apiKind}" data-id="${row.id}">تسویه</button>` : ''}${row.status !== 'cancelled' ? `<button class="table-action danger cancel-invoice" data-kind="${apiKind}" data-id="${row.id}">لغو</button>` : ''}</td></tr>`;
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
    if (!confirm(`فروش‌های روزانهٔ انتخاب‌شده در فاکتور جدیدِ تاریخ ${isoToJalali(date)} ادغام شوند؟`)) return;
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
      if (event.target.matches('.invoice-list-query, .invoice-list-from, .invoice-list-to, .invoice-list-status')) loadInvoiceList(kind);
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

function initializeSalesMarkup() { restoreDailySalesMarkup(); invoiceMarkupAndBind(); }
function setManagedPage(page) {
  initializeManagementMarkup();
  const titles = { dashboard: 'داشبورد', sales: 'فروش روزانه', 'sales-invoice': 'فاکتور فروش', purchases: 'فاکتور خرید', 'sales-invoices': 'فاکتورهای فروش', 'purchase-invoices': 'فاکتورهای خرید', products: 'مدیریت کالاها', categories: 'دسته‌بندی‌ها', customers: 'مدیریت مشتریان', ledger: 'گردش حساب', inventory: 'انبارگردانی', returns: 'مرجوعی‌ها', checks: 'چک‌ها و سررسیدها', installments: 'مدیریت اقساط', cash: 'صندوق و هزینه‌ها', 'profit-loss': 'سود و زیان', users: 'کاربران و لاگ', reports: 'گزارش‌ها', settings: 'تنظیمات' };
  const view = page === 'customers' ? 'parties' : page;
  const pageId = view === 'sales-invoice' ? 'salesInvoice' : view === 'sales-invoices' ? 'salesInvoices' : view === 'purchase-invoices' ? 'purchaseInvoices' : view === 'profit-loss' ? 'profitLoss' : view;
  ['dashboard', 'sales', 'salesInvoice', 'purchases', 'salesInvoices', 'purchaseInvoices', 'products', 'categories', 'parties', 'ledger', 'inventory', 'returns', 'checks', 'installments', 'cash', 'profitLoss', 'users', 'reports', 'placeholder'].forEach((id) => { const node = $(`#${id}Page`); if (node) node.classList.toggle('hidden', id !== pageId && !(id === 'placeholder' && !['dashboard', 'sales', 'salesInvoice', 'purchases', 'salesInvoices', 'purchaseInvoices', 'products', 'categories', 'parties', 'ledger', 'inventory', 'returns', 'checks', 'installments', 'cash', 'profitLoss', 'users', 'reports'].includes(pageId))); });
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

/* Daily-sales refinements: keep identical product/price rows together,
   accept keyboard prices with grouping separators, and persist Jalali dates. */
renderSaleCart = function renderDailySaleCart() {
  const body = $('#modernSaleItems');
  if (!body) return;
  body.innerHTML = saleState.cart.length
    ? saleState.cart.map((item, index) => `<tr><td><strong>${esc(item.name)}</strong><small>${item.priceType === 'wholesale' ? 'عمده' : 'فروش'}</small></td><td><input class="cart-price" data-index="${index}" type="text" inputmode="decimal" value="${formatPriceInput(item.unitPrice)}"></td><td><div class="cart-quantity-control"><button class="cart-quantity-step" data-index="${index}" data-delta="-1" type="button">−</button><input class="cart-quantity" data-index="${index}" type="number" min="1" step="1" value="${item.quantity}"><button class="cart-quantity-step" data-index="${index}" data-delta="1" type="button">+</button></div></td><td><button class="delete-line" data-index="${index}">×</button></td></tr>`).join('')
    : '<tr class="empty-row"><td colspan="4">برای شروع یکی از قیمت‌های محصول را انتخاب کنید.</td></tr>';
  const itemCount = saleState.cart.reduce((sum, item) => sum + item.quantity, 0);
  const formattedItemCount = new Intl.NumberFormat('fa-IR').format(itemCount);
  $('#cartCount').textContent = `${formattedItemCount} قلم`;
  $('#cartItemCount').textContent = formattedItemCount;
  $('#modernSaleTotal').textContent = money(saleState.cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));
  const badge = $('#saleCartBadge');
  if (badge) { const count = saleState.cart.reduce((sum, item) => sum + item.quantity, 0); badge.textContent = new Intl.NumberFormat('fa-IR').format(count); badge.classList.toggle('hidden', count === 0); }
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
    if (event.target.classList.contains('cart-price')) {
      item.unitPrice = parsePriceInput(event.target.value);
      if (String(event.target.value).trim()) {
        event.target.value = formatPriceInput(item.unitPrice);
        event.target.setSelectionRange(event.target.value.length, event.target.value.length);
      }
    }
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
    const quantityButton = event.target.closest('.cart-quantity-step');
    if (quantityButton) {
      const item = saleState.cart[Number(quantityButton.dataset.index)];
      if (item) item.quantity = Math.max(1, item.quantity + Number(quantityButton.dataset.delta));
      renderSaleCart();
      return;
    }
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
  $('#saleProductFilter')?.addEventListener('keydown', (event) => {
    if (event.key === 'F2') { event.preventDefault(); event.target.select(); }
    if (event.key === 'F9') { event.preventDefault(); saveDailySale(false); }
    if (event.key === 'Enter' && saleState.products[0]) {
      event.preventDefault();
      const product = saleState.products[0];
      addSaleProduct(product.id, product.salePrice, 'retail');
      event.target.value = '';
      loadSaleProducts('');
    }
  });
  $('#saleProductFilter')?.focus();
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

function initializeSaleCartModal() {
  const actions = document.querySelector('.topbar-actions');
  const cart = document.querySelector('#salesPage .modern-cart');
  if (!actions || !cart || $('#saleCartButton')) return;
  actions.insertAdjacentHTML('afterbegin', '<button id="saleCartButton" class="icon-button sale-cart-button" title="سبد خرید" aria-label="سبد خرید">🛒<span id="saleCartBadge" class="notification-badge hidden">۰</span></button>');
  document.body.insertAdjacentHTML('beforeend', '<div id="saleCartModal" class="modal-backdrop hidden"><div class="sale-cart-modal-shell"><div class="sale-cart-modal-head"><div><span class="eyebrow">فروش روزانه</span><h3>سبد خرید</h3></div><button type="button" class="modal-close" id="closeSaleCart">×</button></div><div id="saleCartModalBody"></div></div></div>');
  $('#saleCartModalBody').appendChild(cart);
  $('#saleCartButton').addEventListener('click', () => { $('#saleCartModal').classList.remove('hidden'); renderSaleCart(); });
  $('#closeSaleCart').addEventListener('click', () => $('#saleCartModal').classList.add('hidden'));
  $('#saleCartModal').addEventListener('click', (event) => { if (event.target.id === 'saleCartModal') event.currentTarget.classList.add('hidden'); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') $('#saleCartModal')?.classList.add('hidden');
    if (event.key === 'F8' && !event.target.matches('input,textarea,select')) { event.preventDefault(); $('#saleCartButton')?.click(); }
  });
  renderSaleCart();
}
initializeSaleCartModal();
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

/* Returns, cashbook and restore workspace. */
function initializeOperationsPages() {
  if ($('#returnsPage')) return;
  const footer = document.querySelector('footer');
  footer?.insertAdjacentHTML('beforebegin', `
    <section id="returnsPage" class="page hidden">
      <div class="page-heading"><div><span class="eyebrow">برگشت کالا</span><h2>مرجوعی فروش</h2></div><button id="refreshReturns" class="secondary">به‌روزرسانی</button></div>
      <div class="panel form-grid">
        <label>فاکتور فروش<select id="returnSaleSelect"><option value="">انتخاب فاکتور</option></select></label>
        <label>روش استرداد<select id="returnMethod"><option value="cash">نقدی</option><option value="card">کارت</option><option value="bank">بانک</option></select></label>
        <label>مبلغ استرداد<input id="returnRefund" class="money-input" inputmode="decimal" value="0"></label>
        <label class="full-field">علت مرجوعی<input id="returnReason"></label>
      </div>
      <div class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>کالا</th><th>فروخته‌شده</th><th>تعداد مرجوعی</th><th>مبلغ</th></tr></thead><tbody id="returnItemsTable"><tr class="empty-row"><td colspan="4">ابتدا فاکتور را انتخاب کنید.</td></tr></tbody></table></div></div>
      <div id="returnError" class="form-error hidden"></div><button id="saveReturn" class="primary">ثبت مرجوعی</button>
      <div class="panel table-panel" style="margin-top:16px"><div class="panel-heading"><h3>سوابق مرجوعی</h3></div><div class="table-wrap"><table><thead><tr><th>شماره</th><th>فاکتور</th><th>تاریخ</th><th>مبلغ</th><th>استرداد</th><th>وضعیت</th></tr></thead><tbody id="returnsHistory"></tbody></table></div></div>
      <hr style="margin:28px 0;border-color:#293b55">
      <div class="page-heading"><div><span class="eyebrow">برگشت به تأمین‌کننده</span><h2>مرجوعی خرید</h2></div></div>
      <div class="panel form-grid">
        <label>فاکتور خرید<select id="purchaseReturnSelect"><option value="">انتخاب فاکتور</option></select></label>
        <label>روش دریافت<select id="purchaseReturnMethod"><option value="cash">نقدی</option><option value="card">کارت</option><option value="bank">بانک</option></select></label>
        <label>مبلغ دریافتی<input id="purchaseReturnRefund" class="money-input" inputmode="decimal" value="0"></label>
        <label class="full-field">علت مرجوعی<input id="purchaseReturnReason"></label>
      </div>
      <div class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>کالا</th><th>خریدشده</th><th>تعداد مرجوعی</th><th>مبلغ</th></tr></thead><tbody id="purchaseReturnItemsTable"><tr class="empty-row"><td colspan="4">ابتدا فاکتور خرید را انتخاب کنید.</td></tr></tbody></table></div></div>
      <div id="purchaseReturnError" class="form-error hidden"></div><button id="savePurchaseReturn" class="primary">ثبت مرجوعی خرید</button>
      <div class="panel table-panel" style="margin-top:16px"><div class="panel-heading"><h3>سوابق مرجوعی خرید</h3></div><div class="table-wrap"><table><thead><tr><th>شماره</th><th>فاکتور</th><th>تاریخ</th><th>مبلغ</th><th>دریافتی</th><th>وضعیت</th></tr></thead><tbody id="purchaseReturnsHistory"></tbody></table></div></div>
    </section>
    <section id="cashPage" class="page hidden">
      <div class="page-heading"><div><span class="eyebrow">مدیریت مالی روزانه</span></div><button id="refreshCash" class="secondary">به‌روزرسانی</button></div>
      <div class="report-metrics"><div class="metric-card"><span>دریافت</span><strong id="cashIncome">${money(0)}</strong></div><div class="metric-card"><span>پرداخت</span><strong id="cashExpense">${money(0)}</strong></div><div class="metric-card"><span>مانده</span><strong id="cashBalance">${money(0)}</strong></div></div>
      <form id="cashForm" class="panel form-grid"><label>نوع<select id="cashType"><option value="expense">هزینه / پرداخت</option><option value="income">دریافت</option></select></label><label>دسته‌بندی<input id="cashCategory" value="general"></label><label>روش<select id="cashMethod"><option value="cash">نقدی</option><option value="card">کارت</option><option value="bank">بانک</option><option value="other">سایر</option></select></label><label>مبلغ<input id="cashAmount" class="money-input" inputmode="decimal" required></label><label class="full-field">شرح<input id="cashDescription"></label><button class="primary" type="submit">ثبت تراکنش</button></form>
      <div id="cashError" class="form-error hidden"></div><div class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>تاریخ</th><th>نوع</th><th>دسته‌بندی</th><th>روش</th><th>مبلغ</th><th>شرح</th></tr></thead><tbody id="cashTable"></tbody></table></div></div>
    </section>`);
  footer?.insertAdjacentHTML('beforebegin', `
    <section id="ledgerPage" class="page hidden">
      <div class="page-heading"><div><span class="eyebrow">حسابداری طرف‌حساب</span><h2>گردش حساب</h2></div><button id="refreshLedger" class="secondary">به‌روزرسانی</button></div>
      <div class="panel form-grid"><label>طرف‌حساب<select id="ledgerPartySelect"><option value="">انتخاب طرف‌حساب</option></select></label><label>از تاریخ<input id="ledgerFrom" type="date"></label><label>تا تاریخ<input id="ledgerTo" type="date"></label></div>
      <div class="report-metrics"><div class="metric-card"><span>مانده ابتدای بازه</span><strong id="ledgerOpening">${money(0)}</strong></div><div class="metric-card"><span>جمع بدهکار</span><strong id="ledgerDebit">${money(0)}</strong></div><div class="metric-card"><span>جمع بستانکار</span><strong id="ledgerCredit">${money(0)}</strong></div><div class="metric-card"><span>مانده پایان بازه</span><strong id="ledgerBalance">${money(0)}</strong></div></div>
      <div id="ledgerError" class="form-error hidden"></div><div class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>تاریخ</th><th>نوع</th><th>شرح</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th></tr></thead><tbody id="ledgerTable"><tr class="empty-row"><td colspan="6">طرف‌حسابی انتخاب نشده است.</td></tr></tbody></table></div></div>
    </section>
    <section id="inventoryPage" class="page hidden">
      <div class="page-heading"><div><span class="eyebrow">کنترل موجودی</span><h2>انبارگردانی و اصلاح موجودی</h2></div><button id="refreshInventory" class="secondary">به‌روزرسانی</button></div>
      <form id="inventoryAdjustForm" class="panel form-grid"><label>کالا<div class="inventory-product-picker"><input id="inventoryProductSearch" placeholder="جست‌وجوی نام، کد یا بارکد" autocomplete="off"><input id="inventoryProductSelect" type="hidden"><div id="inventoryProductSuggestions" class="inventory-product-suggestions hidden"></div></div></label><label>موجودی شمارش‌شده<input id="inventoryCountedStock" type="number" min="0" step="0.01" required></label><label class="full-field">علت اصلاح<input id="inventoryAdjustmentReason" placeholder="مثلاً کسری، خرابی یا انبارگردانی دوره‌ای"></label><button class="primary" type="submit">ثبت اصلاح موجودی</button></form>
      <div id="inventoryError" class="form-error hidden"></div><div class="panel table-panel inventory-products-panel"><div class="table-wrap"><table><thead><tr><th>کد</th><th>کالا</th><th>موجودی فعلی</th><th>حداقل</th><th>وضعیت</th></tr></thead><tbody id="inventoryProductsTable"></tbody></table></div></div>
      <div class="panel table-panel inventory-movements-panel"><div class="panel-heading"><h3>آخرین گردش موجودی</h3></div><div class="table-wrap"><table><thead><tr><th>تاریخ</th><th>کالا</th><th>نوع</th><th>تغییر</th><th>شرح</th></tr></thead><tbody id="inventoryMovementsTable"></tbody></table></div></div>
    </section>`);
  footer?.insertAdjacentHTML('beforebegin', `
    <section id="usersPage" class="page hidden">
      <div class="page-heading"><div><span class="eyebrow">امنیت و مسئولیت‌پذیری</span><h2>کاربران، نقش‌ها و لاگ عملیات</h2></div><button id="refreshUsers" class="secondary">به‌روزرسانی</button></div>
      <form id="userForm" class="panel form-grid"><label>نام کاربری<input id="newUsername" required></label><label>نام نمایشی<input id="newDisplayName" required></label><label>رمز عبور<input id="newPassword" type="password" minlength="6" required></label><label>نقش<select id="newRole"><option value="manager">مدیر اجرایی</option><option value="cashier">صندوقدار</option><option value="warehouse">انباردار</option><option value="viewer">فقط‌خواندنی</option><option value="admin">مدیر سیستم</option></select></label><button class="primary" type="submit">ایجاد کاربر</button></form>
      <form id="passwordForm" class="panel form-grid"><h3 class="full-field">تغییر رمز عبور من</h3><label>رمز فعلی<input id="currentPassword" type="password" required></label><label>رمز جدید<input id="nextPassword" type="password" minlength="6" required></label><label>تکرار رمز جدید<input id="nextPasswordConfirm" type="password" minlength="6" required></label><button class="secondary" type="submit">تغییر رمز</button></form>
      <div id="usersError" class="form-error hidden"></div><div class="panel table-panel users-list-panel"><div class="table-wrap"><table><thead><tr><th>نام کاربری</th><th>نام</th><th>نقش</th><th>وضعیت</th><th>آخرین ورود</th><th>عملیات</th></tr></thead><tbody id="usersTable"></tbody></table></div></div>
      <div class="panel table-panel audit-log-panel"><div class="panel-heading"><h3>لاگ عملیات</h3></div><div class="table-wrap"><table><thead><tr><th>زمان</th><th>کاربر</th><th>عملیات</th><th>موجودیت</th><th>جزئیات</th></tr></thead><tbody id="auditTable"></tbody></table></div></div>
    </section>
    <section id="profitLossPage" class="page hidden">
      <div class="report-actions"><button id="plExportCsv" class="secondary" type="button">خروجی Excel</button><button id="plExportPdf" class="secondary" type="button">خروجی PDF</button></div>
      <div class="page-heading"><div><span class="eyebrow">گزارش مالی</span><h2>سود و زیان و بستن حساب روزانه</h2></div><button id="refreshProfitLoss" class="secondary">به‌روزرسانی</button></div>
      <div class="panel form-grid"><label>از تاریخ<input id="profitLossFrom" type="date"></label><label>تا تاریخ<input id="profitLossTo" type="date"></label><button id="applyProfitLoss" class="primary">اعمال</button></div>
      <div class="report-metrics"><div class="metric-card"><span>فروش خالص</span><strong id="plNetSales">${money(0)}</strong></div><div class="metric-card"><span>بهای تمام‌شده</span><strong id="plCost">${money(0)}</strong></div><div class="metric-card"><span>سود ناخالص</span><strong id="plGross">${money(0)}</strong></div><div class="metric-card"><span>سود خالص</span><strong id="plNet">${money(0)}</strong></div></div>
      <div class="panel form-grid"><label>تاریخ بستن روز<input id="closeDate" type="date"></label><label class="full-field">یادداشت<input id="closeNotes"></label><button id="closeDayButton" class="primary">بستن حساب روز</button></div>
      <div id="profitLossError" class="form-error hidden"></div><div class="panel table-panel"><div class="panel-heading"><h3>جزئیات روزانه</h3></div><div class="table-wrap"><table><thead><tr><th>تاریخ</th><th>فروش خالص</th><th>بهای تمام‌شده</th><th>سود ناخالص</th><th>درآمد متفرقه</th><th>هزینه</th><th>سود خالص</th></tr></thead><tbody id="profitLossTable"></tbody></table></div></div>
      <div class="panel table-panel" style="margin-top:16px"><div class="panel-heading"><h3>همه روزهای بسته‌شده</h3><small>این فهرست مستقل از بازه گزارش سود و زیان است.</small></div><div class="table-wrap"><table><thead><tr><th>تاریخ</th><th>موجودی آغازین</th><th>دریافت</th><th>پرداخت</th><th>موجودی پایانی</th><th>کاربر</th></tr></thead><tbody id="closuresTable"></tbody></table></div></div>
    </section>`);
  footer?.insertAdjacentHTML('beforebegin', `
    <section id="checksPage" class="page hidden">
      <div class="page-heading"><div><span class="eyebrow">تعهدات مالی</span><h2>مدیریت چک‌ها و سررسیدها</h2></div><button id="refreshChecks" class="secondary">به‌روزرسانی</button></div>
      <div class="panel form-grid"><label>وضعیت<select id="checkStatusFilter"><option value="">همه</option><option value="pending">در انتظار</option><option value="cleared">وصول‌شده</option><option value="bounced">برگشتی</option><option value="cancelled">لغوشده</option></select></label><label>جست‌وجو<input id="checkQuery" placeholder="شماره چک، فاکتور یا طرف‌حساب"></label><label>از تاریخ سررسید<input id="checkFrom" type="date"></label><label>تا تاریخ سررسید<input id="checkTo" type="date"></label><button id="applyChecks" class="primary">اعمال فیلتر</button></div>
      <div id="checksError" class="form-error hidden"></div><div class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>سررسید</th><th>شماره چک</th><th>فاکتور</th><th>طرف‌حساب</th><th>مبلغ</th><th>بانک</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody id="checksTable"></tbody></table></div></div>
    </section>`);
  document.body.insertAdjacentHTML('beforeend', `<div id="loginBackdrop" class="modal-backdrop"><div class="modal" style="max-width:380px"><div class="modal-header"><div><span class="eyebrow">ورود امن</span><h3>ورود به Acclectron</h3></div></div><form id="loginForm"><label>نام کاربری<input id="loginUsername" autocomplete="username" value="admin" required></label><label id="loginPasswordField">رمز عبور<input id="loginPassword" type="password" autocomplete="current-password"></label><div id="loginError" class="form-error hidden"></div><button id="loginSubmit" class="primary wide" type="button">ورود</button><small id="loginHint">ورود اولیه: admin / admin123</small></form></div></div>`);
}

document.querySelector('footer')?.insertAdjacentHTML('beforebegin', `
  <section id="installmentsPage" class="page hidden">
    <div class="page-heading"><div><span class="eyebrow">دریافت‌های دوره‌ای</span><h2>مدیریت اقساط و سررسیدها</h2></div><button id="refreshInstallments" class="secondary">به‌روزرسانی</button></div>
    <form id="installmentPlanForm" class="panel form-grid">
      <label>فاکتور دارای مانده<select id="installmentInvoiceSelect"><option value="">انتخاب فاکتور</option></select></label>
      <label>تعداد اقساط<input id="installmentCount" type="number" min="1" max="120" value="3"></label>
      <label>تاریخ اولین سررسید<input id="installmentFirstDue" type="date" required></label>
      <label class="full-field">یادداشت<input id="installmentNotes"></label>
      <button class="primary" type="submit">ایجاد برنامه اقساط</button>
    </form>
    <div id="installmentsError" class="form-error hidden"></div>
    <div class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>فاکتور</th><th>طرف‌حساب</th><th>جمع</th><th>وضعیت</th><th>اقساط</th></tr></thead><tbody id="installmentPlansTable"></tbody></table></div></div>
  </section>`);
let operationsInitialized = false;
async function loadReturnsPage() {
  initializeOperationsPages();
  const select = $('#returnSaleSelect');
  const sales = await window.api.sales.list({ status: 'active' });
  select.innerHTML = '<option value="">انتخاب فاکتور</option>' + sales.map((s) => `<option value="${s.id}">${esc(s.invoiceNumber)} · ${s.source === 'daily' ? 'فروش روزانه' : esc(s.partyName || 'بدون طرف‌حساب')} · ${money(s.total)}</option>`).join('');
  const renderSale = async () => {
    const saleId = Number(select.value);
    const body = $('#returnItemsTable');
    if (!saleId) { body.innerHTML = '<tr class="empty-row"><td colspan="4">ابتدا فاکتور را انتخاب کنید.</td></tr>'; return; }
    const invoice = await window.api.invoices.details('sale', saleId);
    body.innerHTML = invoice.items.map((item) => `<tr><td><strong>${esc(item.productName)}</strong><small>${esc(item.productCode || '')}</small><input type="hidden" class="return-sale-item" value="${item.id}"></td><td>${item.quantity}</td><td><input class="return-quantity" data-item-id="${item.id}" type="number" min="0" max="${item.quantity}" step="0.01" value="0"></td><td>${money(item.total)}</td></tr>`).join('');
  };
  select.onchange = () => renderSale().catch((e) => showToast(e.message, true));
  $('#refreshReturns').onclick = () => loadReturnsPage().catch((e) => showToast(e.message, true));
  $('#saveReturn').onclick = async () => {
    const error = $('#returnError'); error.classList.add('hidden');
    try {
      const items = [...document.querySelectorAll('.return-quantity')].map((input) => ({ saleItemId: Number(input.dataset.itemId), quantity: Number(input.value || 0) })).filter((item) => item.quantity > 0);
      if (!select.value || !items.length) throw new Error('فاکتور و حداقل یک قلم مرجوعی را انتخاب کنید.');
      const result = await window.api.returns.sale.create({ saleId: Number(select.value), items, refundAmount: parsePriceInput($('#returnRefund').value), method: $('#returnMethod').value, reason: $('#returnReason').value, date: new Date().toISOString().slice(0, 10) });
      showToast(`مرجوعی ${result.return_number} ثبت شد.`); $('#returnRefund').value = '0'; $('#returnReason').value = ''; await loadReturnsPage();
    } catch (e) { error.textContent = readableError(e, 'ثبت مرجوعی ناموفق بود.'); error.classList.remove('hidden'); }
  };
  const history = await window.api.returns.sale.list({});
  $('#returnsHistory').innerHTML = history.length ? history.map((r) => `<tr><td>${esc(r.returnNumber)}</td><td>${esc(r.saleInvoiceNumber)}</td><td>${isoToJalali(r.date)}</td><td>${money(r.total)}</td><td>${money(r.refundAmount)}</td><td>${r.status === 'cancelled' ? 'لغوشده' : 'تکمیل‌شده'}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="6">مرجوعی ثبت نشده است.</td></tr>';

  const purchaseSelect = $('#purchaseReturnSelect');
  const purchases = await window.api.purchases.list({ status: 'completed' });
  purchaseSelect.innerHTML = '<option value="">انتخاب فاکتور خرید</option>' + purchases.map((p) => `<option value="${p.id}">${esc(p.invoiceNumber)} · ${esc(p.partyName || 'بدون تأمین‌کننده')} · ${money(p.total)}</option>`).join('');
  const renderPurchase = async () => {
    const purchaseId = Number(purchaseSelect.value);
    const body = $('#purchaseReturnItemsTable');
    if (!purchaseId) { body.innerHTML = '<tr class="empty-row"><td colspan="4">ابتدا فاکتور خرید را انتخاب کنید.</td></tr>'; return; }
    const invoice = await window.api.invoices.details('purchase', purchaseId);
    body.innerHTML = invoice.items.map((item) => `<tr><td><strong>${esc(item.productName)}</strong><small>${esc(item.productCode || '')}</small></td><td>${item.quantity}</td><td><input class="purchase-return-quantity" data-item-id="${item.id}" type="number" min="0" max="${item.quantity}" step="0.01" value="0"></td><td>${money(item.total)}</td></tr>`).join('');
  };
  purchaseSelect.onchange = () => renderPurchase().catch((e) => showToast(e.message, true));
  $('#savePurchaseReturn').onclick = async () => {
    const error = $('#purchaseReturnError'); error.classList.add('hidden');
    try {
      const items = [...document.querySelectorAll('.purchase-return-quantity')].map((input) => ({ purchaseItemId: Number(input.dataset.itemId), quantity: Number(input.value || 0) })).filter((item) => item.quantity > 0);
      if (!purchaseSelect.value || !items.length) throw new Error('فاکتور خرید و حداقل یک قلم مرجوعی را انتخاب کنید.');
      const result = await window.api.returns.purchase.create({ purchaseId: Number(purchaseSelect.value), items, refundAmount: parsePriceInput($('#purchaseReturnRefund').value), method: $('#purchaseReturnMethod').value, reason: $('#purchaseReturnReason').value, date: new Date().toISOString().slice(0, 10) });
      showToast(`مرجوعی خرید ${result.return_number} ثبت شد.`); $('#purchaseReturnRefund').value = '0'; $('#purchaseReturnReason').value = ''; await loadReturnsPage();
    } catch (e) { error.textContent = readableError(e, 'ثبت مرجوعی خرید ناموفق بود.'); error.classList.remove('hidden'); }
  };
  const purchaseHistory = await window.api.returns.purchase.list({});
  $('#purchaseReturnsHistory').innerHTML = purchaseHistory.length ? purchaseHistory.map((r) => `<tr><td>${esc(r.returnNumber)}</td><td>${esc(r.purchaseInvoiceNumber)}</td><td>${isoToJalali(r.date)}</td><td>${money(r.total)}</td><td>${money(r.refundAmount)}</td><td>${r.status === 'cancelled' ? 'لغوشده' : 'تکمیل‌شده'}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="6">مرجوعی خرید ثبت نشده است.</td></tr>';
}

async function loadCashPage() {
  initializeOperationsPages();
  const summary = await window.api.cash.summary({});
  $('#cashIncome').textContent = money(summary.income); $('#cashExpense').textContent = money(summary.expense); $('#cashBalance').textContent = money(summary.balance);
  const rows = await window.api.cash.list({});
  $('#cashTable').innerHTML = rows.length ? rows.map((r) => `<tr><td>${isoToJalali(r.date)}</td><td>${r.type === 'income' ? 'دریافت' : 'هزینه'}</td><td>${esc(r.category)}</td><td>${esc(r.method)}</td><td>${money(r.amount)}</td><td>${esc(r.description || '—')}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="6">تراکنشی ثبت نشده است.</td></tr>';
  $('#refreshCash').onclick = () => loadCashPage().catch((e) => showToast(e.message, true));
  const form = $('#cashForm');
  if (!form.dataset.bound) {
    form.dataset.bound = '1';
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); const error = $('#cashError'); error.classList.add('hidden');
      try { await window.api.cash.create({ type: $('#cashType').value, category: $('#cashCategory').value, method: $('#cashMethod').value, amount: parsePriceInput($('#cashAmount').value), description: $('#cashDescription').value, date: new Date().toISOString().slice(0, 10) }); form.reset(); $('#cashCategory').value = 'general'; showToast('تراکنش صندوق ثبت شد.'); await loadCashPage(); }
      catch (e) { error.textContent = readableError(e, 'ثبت تراکنش ناموفق بود.'); error.classList.remove('hidden'); }
    });
  }
}

async function loadLedgerPage() {
  initializeOperationsPages();
  const select = $('#ledgerPartySelect');
  const parties = await window.api.customers.list({ query: '', type: '', includeInactive: false });
  const selected = select.value;
  select.innerHTML = '<option value="">انتخاب طرف‌حساب</option>' + parties.map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(p.code)} · مانده ${money(p.balance)}</option>`).join('');
  if (selected) select.value = selected;
  const render = async () => {
    const error = $('#ledgerError'); error.classList.add('hidden');
    const body = $('#ledgerTable');
    if (!select.value) {
      $('#ledgerOpening').textContent = money(0); $('#ledgerDebit').textContent = money(0); $('#ledgerCredit').textContent = money(0); $('#ledgerBalance').textContent = money(0);
      body.innerHTML = '<tr class="empty-row"><td colspan="6">طرف‌حسابی انتخاب نشده است.</td></tr>'; return;
    }
    try {
      const data = await window.api.customers.ledger(Number(select.value), {
        from: jalaliInputToIso($('#ledgerFrom').value || ''), to: jalaliInputToIso($('#ledgerTo').value || '')
      });
      $('#ledgerOpening').textContent = money(data.openingBalance); $('#ledgerDebit').textContent = money(data.debit); $('#ledgerCredit').textContent = money(data.credit); $('#ledgerBalance').textContent = money(data.closingBalance);
      const labels = { sale: 'فروش', purchase: 'خرید', payment: 'پرداخت', sale_return: 'مرجوعی فروش', purchase_return: 'مرجوعی خرید' };
      body.innerHTML = data.events.length ? data.events.map((e) => `<tr><td>${isoToJalali(e.date)}</td><td>${labels[e.kind] || esc(e.kind)}</td><td>${esc(e.description)}<small>${esc(e.reference || '')}</small></td><td>${e.debit ? money(e.debit) : '—'}</td><td>${e.credit ? money(e.credit) : '—'}</td><td class="${e.balance < 0 ? 'profit-amount' : e.balance > 0 ? 'debt-amount' : ''}">${money(e.balance)}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="6">گردشی برای این بازه وجود ندارد.</td></tr>';
    } catch (e) { error.textContent = readableError(e, 'دریافت گردش حساب ناموفق بود.'); error.classList.remove('hidden'); }
  };
  select.onchange = render; $('#ledgerFrom').onchange = render; $('#ledgerTo').onchange = render;
  $('#refreshLedger').onclick = () => loadLedgerPage().catch((e) => showToast(e.message, true));
  await render();
}

async function loadInventoryPage() {
  initializeOperationsPages();
  const products = await window.api.products.list({ query: '' });
  const select = $('#inventoryProductSelect');
  const searchInput = $('#inventoryProductSearch');
  const suggestions = $('#inventoryProductSuggestions');
  const selected = select.value;
  const findMatches = (query = '') => {
    const normalized = String(query).trim().toLocaleLowerCase();
    if (!normalized) return products.slice(0, 30);
    return products.filter((p) => [p.name, p.code, p.barcode].some((value) => String(value || '').toLocaleLowerCase().includes(normalized))).slice(0, 30);
  };
  const renderProductSuggestions = (query = '') => {
    const matches = findMatches(query);
    if (!matches.length) {
      suggestions.innerHTML = '<div class="inventory-product-suggestion-empty">محصولی پیدا نشد.</div>';
      suggestions.classList.remove('hidden');
      return;
    }
    suggestions.innerHTML = matches.map((p) => `<button type="button" class="inventory-product-suggestion" data-id="${p.id}"><span><strong>${esc(p.name)}</strong><small>${esc(p.code)}${p.barcode ? ` · ${esc(p.barcode)}` : ''} · موجودی ${p.stock}</small></span><b>${p.stock}</b></button>`).join('');
    suggestions.classList.remove('hidden');
  };
  const selectedProduct = products.find((p) => String(p.id) === String(selected));
  if (selectedProduct) searchInput.value = `${selectedProduct.name} · ${selectedProduct.code}`;
  searchInput.onfocus = () => renderProductSuggestions(select.value ? '' : searchInput.value);
  searchInput.onblur = () => setTimeout(() => suggestions.classList.add('hidden'), 150);
  searchInput.oninput = () => {
    select.value = '';
    renderProductSuggestions(searchInput.value);
  };
  searchInput.onkeydown = (event) => {
    const options = [...suggestions.querySelectorAll('.inventory-product-suggestion')];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!options.length) return;
      const active = options.findIndex((node) => node.classList.contains('active'));
      const next = event.key === 'ArrowDown' ? (active + 1) % options.length : (active - 1 + options.length) % options.length;
      options.forEach((node, index) => node.classList.toggle('active', index === next));
    } else if (event.key === 'Enter' && options.length) {
      event.preventDefault();
      (options.find((node) => node.classList.contains('active')) || options[0]).click();
    } else if (event.key === 'Escape') suggestions.classList.add('hidden');
  };
  suggestions.onclick = (event) => {
    const button = event.target.closest('.inventory-product-suggestion');
    if (!button) return;
    const product = products.find((p) => p.id === Number(button.dataset.id));
    if (!product) return;
    select.value = String(product.id);
    searchInput.value = `${product.name} · ${product.code}`;
    suggestions.classList.add('hidden');
  };
  $('#inventoryProductsTable').innerHTML = products.length ? products.map((p) => `<tr><td>${esc(p.code)}</td><td>${esc(p.name)}</td><td>${p.stock}</td><td>${p.minimumStock}</td><td>${Number(p.stock) <= Number(p.minimumStock) ? '<span class="status-badge warning">کم</span>' : '<span class="status-badge active">عادی</span>'}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="5">کالایی وجود ندارد.</td></tr>';
  const movements = await window.api.inventory.movements({});
  const typeLabels = { sale: 'فروش', purchase: 'خرید', sale_return: 'مرجوعی فروش', purchase_return: 'مرجوعی خرید', adjustment: 'اصلاح', sale_cancel: 'لغو فروش', purchase_cancel: 'لغو خرید' };
  $('#inventoryMovementsTable').innerHTML = movements.length ? movements.slice(0, 100).map((m) => `<tr><td>${isoToJalali(String(m.createdAt).slice(0, 10))}</td><td>${esc(m.productName)}</td><td>${typeLabels[m.type] || esc(m.type)}</td><td class="${Number(m.quantity) < 0 ? 'loss-amount' : 'profit-amount'}">${m.quantity}</td><td>${esc(m.description || '—')}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="5">گردش موجودی ثبت نشده است.</td></tr>';
  $('#refreshInventory').onclick = () => loadInventoryPage().catch((e) => showToast(e.message, true));
  const form = $('#inventoryAdjustForm');
  if (!form.dataset.bound) {
    form.dataset.bound = '1';
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); const error = $('#inventoryError'); error.classList.add('hidden');
      try {
        if (!select.value) throw new Error('یک کالا انتخاب کنید.');
        await window.api.inventory.adjust(Number(select.value), { stock: Number($('#inventoryCountedStock').value), reason: $('#inventoryAdjustmentReason').value });
        showToast('اصلاح موجودی ثبت شد.'); $('#inventoryAdjustmentReason').value = ''; await loadInventoryPage();
      } catch (e) { error.textContent = readableError(e, 'اصلاح موجودی ناموفق بود.'); error.classList.remove('hidden'); }
    });
  }
}

async function loadUsersPage() {
  initializeOperationsPages();
  const error = $('#usersError'); error.classList.add('hidden');
  try {
    const users = await window.api.users.list();
    const roleLabels = { admin: 'مدیر سیستم', manager: 'مدیر اجرایی', cashier: 'صندوقدار', warehouse: 'انباردار', viewer: 'فقط‌خواندنی' };
    $('#usersTable').innerHTML = users.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.displayName)}</td><td>${roleLabels[u.role] || u.role}</td><td>${u.isActive ? '<span class="status-badge active">فعال</span>' : '<span class="status-badge inactive">غیرفعال</span>'}</td><td>${esc(dateTimeToJalali(u.lastLoginAt))}</td><td><button class="table-action toggle-user" data-id="${u.id}" data-active="${u.isActive ? 1 : 0}">${u.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button></td></tr>`).join('');
    const logs = await window.api.audit.list({});
    $('#auditTable').innerHTML = logs.length ? logs.map((log) => `<tr><td>${esc(dateTimeToJalali(log.createdAt))}</td><td>${esc(log.userName)}</td><td>${esc(log.action)}</td><td>${esc(log.entityType || '—')} ${log.entityId || ''}</td><td>${esc(log.details || '—')}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="5">لاگی ثبت نشده است.</td></tr>';
  } catch (e) { error.textContent = readableError(e, 'دریافت کاربران یا لاگ ناموفق بود.'); error.classList.remove('hidden'); }
  $('#refreshUsers').onclick = () => loadUsersPage().catch((e) => showToast(e.message, true));
  const form = $('#userForm');
  if (!form.dataset.bound) {
    form.dataset.bound = '1';
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); error.classList.add('hidden');
      try {
        await window.api.users.create({ username: $('#newUsername').value, displayName: $('#newDisplayName').value, password: $('#newPassword').value, role: $('#newRole').value });
        form.reset(); showToast('کاربر ایجاد شد.'); await loadUsersPage();
      } catch (e) { error.textContent = readableError(e, 'ایجاد کاربر ناموفق بود.'); error.classList.remove('hidden'); }
    });
  }
  const passwordForm = $('#passwordForm');
  if (!passwordForm.dataset.bound) {
    passwordForm.dataset.bound = '1';
    passwordForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if ($('#nextPassword').value !== $('#nextPasswordConfirm').value) return showToast('تکرار رمز جدید یکسان نیست.', true);
      try {
        await window.api.auth.changePassword($('#currentPassword').value, $('#nextPassword').value);
        passwordForm.reset(); showToast('رمز عبور تغییر کرد.');
      } catch (e) { showToast(readableError(e, 'تغییر رمز عبور ناموفق بود.'), true); }
    });
  }
  $('#usersTable').onclick = async (event) => {
    const button = event.target.closest('.toggle-user'); if (!button) return;
    try { await window.api.users.setActive(Number(button.dataset.id), button.dataset.active !== '1'); await loadUsersPage(); } catch (e) { showToast(e.message, true); }
  };
}

async function loadChecksPage() {
  initializeOperationsPages();
  const error = $('#checksError'); error.classList.add('hidden');
  try {
    const rows = await window.api.checks.list({
      status: $('#checkStatusFilter').value,
      query: $('#checkQuery').value,
      from: $('#checkFrom').value,
      to: $('#checkTo').value
    });
    const labels = { pending: 'در انتظار', cleared: 'وصول‌شده', bounced: 'برگشتی', cancelled: 'لغوشده' };
    $('#checksTable').innerHTML = rows.length ? rows.map((r) => `<tr><td>${r.dueDate ? isoToJalali(r.dueDate) : '—'}</td><td>${esc(r.checkNumber || '—')}</td><td>${esc(r.invoiceNumber || '—')}</td><td>${esc(r.partyName || '—')}<small>${r.invoiceKind === 'sale' ? 'فروش' : 'خرید'}</small></td><td>${money(r.amount)}</td><td>${esc(r.bankName || '—')}</td><td><span class="status-badge ${r.checkStatus === 'pending' ? 'warning' : r.checkStatus === 'cleared' ? 'active' : 'inactive'}">${labels[r.checkStatus] || r.checkStatus}</span></td><td>${r.checkStatus !== 'cleared' && r.checkStatus !== 'cancelled' ? `<button class="table-action check-status-action" data-id="${r.id}" data-status="cleared">وصول</button>` : ''}${r.checkStatus !== 'bounced' && r.checkStatus !== 'cancelled' ? `<button class="table-action danger check-status-action" data-id="${r.id}" data-status="bounced">برگشتی</button>` : ''}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="8">چکی برای نمایش وجود ندارد.</td></tr>';
  } catch (e) { error.textContent = readableError(e, 'دریافت فهرست چک‌ها ناموفق بود.'); error.classList.remove('hidden'); }
  $('#refreshChecks').onclick = () => loadChecksPage().catch((e) => showToast(e.message, true));
  $('#applyChecks').onclick = () => loadChecksPage().catch((e) => showToast(e.message, true));
  $('#checksTable').onclick = async (event) => {
    const button = event.target.closest('.check-status-action'); if (!button) return;
    try { await window.api.checks.updateStatus(Number(button.dataset.id), button.dataset.status); await loadChecksPage(); showToast('وضعیت چک به‌روزرسانی شد.'); }
    catch (e) { showToast(readableError(e, 'تغییر وضعیت چک ناموفق بود.'), true); }
  };
}

function ensureInstallmentPaymentDialog() {
  let backdrop = $('#installmentPaymentBackdrop');
  if (backdrop) return backdrop;
  document.body.insertAdjacentHTML('beforeend', `<div id="installmentPaymentBackdrop" class="modal-backdrop hidden"><div class="modal" style="max-width:420px"><div class="modal-header"><div><span class="eyebrow">دریافت قسط</span><h3>ثبت پرداخت قسط</h3></div><button type="button" class="modal-close installment-payment-close">×</button></div><form id="installmentPaymentForm"><label>مبلغ پرداختی<input id="installmentPaymentAmount" class="money-input" inputmode="decimal" required></label><div id="installmentPaymentError" class="form-error hidden"></div><div class="modal-actions"><button type="button" class="secondary installment-payment-close">انصراف</button><button type="submit" class="primary">ثبت پرداخت</button></div></form></div></div>`);
  backdrop = $('#installmentPaymentBackdrop');
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop || event.target.closest('.installment-payment-close')) backdrop.classList.add('hidden');
  });
  $('#installmentPaymentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('#installmentPaymentError');
    error.classList.add('hidden');
    const installmentId = Number(backdrop.dataset.installmentId);
    try {
      const amount = parsePriceInput($('#installmentPaymentAmount').value);
      const remaining = Number(backdrop.dataset.remaining || 0);
      if (!installmentId || !amount) throw new Error('مبلغ پرداختی را وارد کنید.');
      if (amount > remaining) throw new Error(`مبلغ پرداختی نمی‌تواند بیشتر از ${money(remaining)} باشد.`);
      await window.api.installments.recordPayment(installmentId, { amount, method: 'cash', paidAt: new Date().toISOString() });
      backdrop.classList.add('hidden');
      showToast('پرداخت قسط ثبت شد.');
      await loadInstallmentsPage();
    } catch (e) {
      error.textContent = readableError(e, 'ثبت پرداخت قسط ناموفق بود.');
      error.classList.remove('hidden');
    }
  });
  return backdrop;
}

function openInstallmentPaymentDialog(button) {
  const backdrop = ensureInstallmentPaymentDialog();
  const remaining = Number(button.dataset.remaining || 0);
  backdrop.dataset.installmentId = String(button.dataset.id || '');
  backdrop.dataset.remaining = String(remaining);
  $('#installmentPaymentAmount').value = formatPriceInput(remaining);
  $('#installmentPaymentError').classList.add('hidden');
  backdrop.classList.remove('hidden');
  requestAnimationFrame(() => { $('#installmentPaymentAmount').focus(); $('#installmentPaymentAmount').select(); });
}

async function loadInstallmentsPage() {
  initializeOperationsPages();
  const error = $('#installmentsError'); error.classList.add('hidden');
  try {
    const [sales, purchases, plans] = await Promise.all([
      window.api.sales.list({ status: 'active' }),
      window.api.purchases.list({ status: 'completed' }),
      window.api.installments.listPlans({})
    ]);
    const invoices = [...sales.filter((i) => Number(i.remainingAmount) > 0).map((i) => ({ ...i, invoiceKind: 'sale', label: `فروش · ${i.invoiceNumber}` })),
      ...purchases.filter((i) => Number(i.remainingAmount) > 0).map((i) => ({ ...i, invoiceKind: 'purchase', label: `خرید · ${i.invoiceNumber}` }))];
    const select = $('#installmentInvoiceSelect');
    const previous = select.value;
    select.innerHTML = '<option value="">انتخاب فاکتور دارای مانده</option>' + invoices.map((i) => `<option value="${i.invoiceKind}:${i.id}">${esc(i.label)} · ${esc(i.partyName || 'بدون طرف‌حساب')} · ${money(i.remainingAmount)}</option>`).join('');
    if (previous) select.value = previous;
    const labels = { active: 'فعال', completed: 'تسویه‌شده', cancelled: 'لغوشده', pending: 'در انتظار', partial: 'پرداخت ناقص', paid: 'پرداخت‌شده', overdue: 'معوق' };
    $('#installmentPlansTable').innerHTML = plans.length ? plans.map((plan) => `<tr><td><strong>${esc(plan.invoiceNumber || '—')}</strong><small>${plan.invoiceKind === 'sale' ? 'فروش' : 'خرید'}</small></td><td>${esc(plan.partyName || 'بدون طرف‌حساب')}</td><td>${money(plan.totalAmount)}</td><td><span class="status-badge ${plan.status === 'completed' ? 'active' : 'warning'}">${labels[plan.status] || plan.status}</span></td><td><div class="installment-rows">${plan.installments.map((item) => `<div class="installment-row"><span>${item.installmentNumber}. ${isoToJalali(item.dueDate)}</span><b>${money(item.amount)}</b><small>${money(item.paidAmount)} · ${labels[item.status] || item.status}</small>${item.status !== 'paid' && item.status !== 'cancelled' ? `<button type="button" class="table-action installment-pay" data-id="${item.id}" data-remaining="${Number(item.amount) - Number(item.paidAmount || 0)}">ثبت پرداخت</button>` : ''}</div>`).join('')}</div></td></tr>`).join('') : '<tr class="empty-row"><td colspan="5">برنامه اقساطی ثبت نشده است.</td></tr>';
    $('#installmentPlanForm').onsubmit = async (event) => {
      event.preventDefault(); error.classList.add('hidden');
      try {
        const [kind, idText] = String(select.value).split(':');
        const invoice = invoices.find((item) => item.invoiceKind === kind && item.id === Number(idText));
        const count = Math.max(1, Math.min(120, Number($('#installmentCount').value || 1)));
        const firstDue = jalaliInputToIso($('#installmentFirstDue').value);
        if (!invoice || !firstDue) throw new Error('فاکتور و تاریخ اولین سررسید را به صورت معتبر وارد کنید.');
        const total = Number(invoice.remainingAmount);
        const base = Math.floor(total / count);
        const installments = Array.from({ length: count }, (_, index) => {
          const due = new Date(`${firstDue}T00:00:00Z`); due.setUTCMonth(due.getUTCMonth() + index);
          return { dueDate: due.toISOString().slice(0, 10), amount: base + (index < total % count ? 1 : 0) };
        });
        await window.api.installments.createPlan({ invoiceKind: kind, invoiceId: Number(idText), installments, notes: $('#installmentNotes').value });
        $('#installmentNotes').value = ''; showToast('برنامه اقساط ایجاد شد.'); await loadInstallmentsPage();
      } catch (e) { error.textContent = readableError(e, 'ایجاد برنامه اقساط ناموفق بود.'); error.classList.remove('hidden'); }
    };
    $('#refreshInstallments').onclick = () => loadInstallmentsPage().catch((e) => showToast(e.message, true));
    $('#installmentPlansTable').onclick = async (event) => {
      const button = event.target.closest('.installment-pay'); if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const remaining = Number(button.dataset.remaining || 0);
      if (!remaining) return;
      openInstallmentPaymentDialog(button);
    };
  } catch (e) { error.textContent = readableError(e, 'دریافت اطلاعات اقساط ناموفق بود.'); error.classList.remove('hidden'); }
}

async function loadProfitLossPage() {
  initializeOperationsPages();
  const today = new Date().toISOString().slice(0, 10);
  const todayJalali = isoToJalali(today);
  if (!$('#profitLossFrom').value) $('#profitLossFrom').value = todayJalali;
  if (!$('#profitLossTo').value) $('#profitLossTo').value = todayJalali;
  if (!$('#closeDate').value) $('#closeDate').value = todayJalali;
  bindJalaliDatePickers(true);
  const error = $('#profitLossError'); error.classList.add('hidden');
  try {
    const from = jalaliInputToIso($('#profitLossFrom').value);
    const to = jalaliInputToIso($('#profitLossTo').value);
    const report = await window.api.profitLoss.report({ from, to });
    $('#plNetSales').textContent = money(report.netSales); $('#plCost').textContent = money(report.costTotal); $('#plGross').textContent = money(report.grossProfit); $('#plNet').textContent = money(report.netProfit);
    $('#plNet').classList.toggle('negative', Number(report.netProfit) < 0);
    $('#profitLossTable').innerHTML = report.byDate.length ? report.byDate.map((r) => `<tr><td>${isoToJalali(r.date)}</td><td>${money(r.netSales)}</td><td>${money(r.costTotal)}</td><td>${money(r.grossProfit)}</td><td>${money(r.otherIncome)}</td><td>${money(r.expenses)}</td><td class="${r.netProfit < 0 ? 'negative' : ''}">${money(r.netProfit)}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="7">داده‌ای برای این بازه وجود ندارد.</td></tr>';
    // The report date range defaults to today-to-today and is only intended
    // for the P&L detail table. Closed days are a historical register, so
    // they must not inherit that range or older closures disappear.
    const closures = await window.api.dailyClose.list({});
    $('#closuresTable').innerHTML = closures.length ? closures.map((r) => `<tr><td>${isoToJalali(r.date)}</td><td>${money(r.openingBalance)}</td><td>${money(r.cashIncome)}</td><td>${money(r.cashExpense)}</td><td>${money(r.closingBalance)}</td><td>${esc(r.userName)}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="6">روزی بسته نشده است.</td></tr>';
  } catch (e) { error.textContent = readableError(e, 'گزارش سود و زیان ناموفق بود.'); error.classList.remove('hidden'); }
  $('#applyProfitLoss').onclick = () => loadProfitLossPage().catch((e) => showToast(e.message, true));
  $('#refreshProfitLoss').onclick = () => loadProfitLossPage().catch((e) => showToast(e.message, true));
  $('#closeDayButton').onclick = async () => {
    try {
      await window.api.dailyClose.create({ date: jalaliInputToIso($('#closeDate').value), notes: $('#closeNotes').value });
      $('#closeNotes').value = ''; showToast('حساب روز بسته شد.'); await loadProfitLossPage();
    } catch (e) { error.textContent = readableError(e, 'بستن حساب روزانه ناموفق بود.'); error.classList.remove('hidden'); }
  };
  $('#plExportCsv').onclick = async () => {
    try {
      const result = await window.api.reports.exportCsv('profit-loss', { from: $('#profitLossFrom').value, to: $('#profitLossTo').value });
      if (!result?.canceled) showToast(`فایل Excel ذخیره شد: ${result.filePath}`);
    } catch (e) { showToast(readableError(e, 'خروجی Excel ناموفق بود.'), true); }
  };
  $('#plExportPdf').onclick = async () => {
    document.body.classList.add('printing-report', 'printing-profit-loss');
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const result = await window.api.reports.exportPdf({ fileName: `سود-و-زیان-${new Date().toISOString().slice(0, 10)}` });
      if (!result?.canceled) showToast(`فایل PDF ذخیره شد: ${result.filePath}`);
    } catch (e) { showToast(readableError(e, 'خروجی PDF ناموفق بود.'), true); }
    finally { document.body.classList.remove('printing-report', 'printing-profit-loss'); }
  };
}

async function initializeAuth() {
  initializeOperationsPages();
  const backdrop = $('#loginBackdrop');
  try {
    const settings = await window.api.settings.get();
    const passwordless = settings.security?.passwordlessLogin === true;
    $('#loginPasswordField')?.classList.toggle('hidden', passwordless);
    $('#loginPassword')?.toggleAttribute('required', !passwordless);
    if (passwordless) $('#loginHint').textContent = 'ورود بدون رمز فعال است؛ نام کاربری را وارد کنید.';
  } catch {}
  try {
    const current = await window.api.auth.current();
    if (current) { backdrop.classList.add('hidden'); return; }
  } catch {}
}

function installLoginSubmitGuard() {
  if (document.body.dataset.loginSubmitGuard) return;
  document.body.dataset.loginSubmitGuard = '1';
  const submitLogin = async () => {
    const error = $('#loginError');
    const backdrop = $('#loginBackdrop');
    error?.classList.add('hidden');
    try {
      await window.api.auth.login($('#loginUsername')?.value || '', $('#loginPassword')?.value || '');
      backdrop?.classList.add('hidden');
      showToast('ورود موفق بود.');
    } catch (e) {
      if (error) {
        error.textContent = readableError(e, 'ورود ناموفق بود.');
        error.classList.remove('hidden');
      }
    }
  };
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('#loginSubmit')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      submitLogin();
    }
  }, true);
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!form || form.id !== 'loginForm') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    submitLogin();
  }, true);
}

function initializeSoftwareAboutPage() {
  const nav = document.querySelector('nav');
  const footer = document.querySelector('footer');
  if (!nav || !footer) return;

  if (!nav.querySelector('[data-page="about"]')) {
    nav.insertAdjacentHTML('beforeend', '<button class="nav-item" data-page="about"><span>ⓘ</span><span class="nav-label">معرفی نرم‌افزار</span></button>');
  }

  if (!$('#aboutPage')) {
    footer.insertAdjacentHTML('beforebegin', `
      <section id="aboutPage" class="page hidden about-page">
        <div class="about-hero panel">
          <span class="about-kicker">دربارهٔ Acclectron</span>
          <h2>حسابداری فروشگاهی، ساده و قابل‌اعتماد</h2>
          <p>اکلترون یک نرم‌افزار حسابداری دسکتاپ و آفلاین است که برای مدیریت یکپارچهٔ فروش، فاکتورها، کالاها، موجودی، طرف‌حساب‌ها و گزارش‌های مالی طراحی شده است.</p>
        </div>
        <div class="about-grid">
          <section class="panel about-card about-card-wide">
            <h3>قابلیت‌های اصلی</h3>
            <div class="about-feature-list">
              <span>ثبت فروش روزانه و فاکتور فروش</span>
              <span>مدیریت خرید، مرجوعی و اقساط</span>
              <span>کنترل موجودی و انبارگردانی</span>
              <span>گردش حساب مشتریان و تأمین‌کنندگان</span>
              <span>صندوق، هزینه‌ها و سود و زیان</span>
              <span>گزارش‌گیری، پشتیبان‌گیری و چاپ فاکتور</span>
            </div>
          </section>
          <section class="panel about-card">
            <h3>سازندگان نرم‌افزار</h3>
            <div class="about-creators">
              <div><b>افشین</b><small>مالک محصول و همکار توسعه</small></div>
              <div><b>Codex</b><small>همکار هوش مصنوعی در توسعهٔ نرم‌افزار</small></div>
            </div>
          </section>
          <section class="panel about-card about-stat-card">
            <h3>آمار توسعه</h3>
            <strong>۹٬۵۸۱</strong>
            <span>خط کد در فایل‌های اصلی، ماژول‌ها و آزمون‌های پروژه</span>
          </section>
        </div>
        <div class="about-note">داده‌های شما به‌صورت محلی نگهداری می‌شوند و برنامه برای استفادهٔ روزمرهٔ فروشگاه، بدون وابستگی به اینترنت، آماده است.</div>
      </section>`);
  }
}

const previousSetManagedPageForOperations = setManagedPage;
setManagedPage = function setManagedPageWithOperations(page) {
  initializeOperationsPages();
  initializeSidebarGroups();
  initializeSoftwareAboutPage();
  previousSetManagedPageForOperations(page);
  $('#returnsPage')?.classList.toggle('hidden', page !== 'returns');
  $('#cashPage')?.classList.toggle('hidden', page !== 'cash');
  $('#ledgerPage')?.classList.toggle('hidden', page !== 'ledger');
  $('#inventoryPage')?.classList.toggle('hidden', page !== 'inventory');
  $('#installmentsPage')?.classList.toggle('hidden', page !== 'installments');
  $('#aboutPage')?.classList.toggle('hidden', page !== 'about');
  if (page === 'about') {
    $('#placeholderPage')?.classList.add('hidden');
    document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.page === 'about'));
    $('#pageTitle').textContent = 'معرفی نرم‌افزار';
    $('#windowContext').textContent = 'معرفی نرم‌افزار';
  }
  if (page === 'returns') loadReturnsPage().catch((e) => showToast(e.message, true));
  if (page === 'cash') loadCashPage().catch((e) => showToast(e.message, true));
  if (page === 'ledger') loadLedgerPage().catch((e) => showToast(e.message, true));
  if (page === 'inventory') loadInventoryPage().catch((e) => showToast(e.message, true));
  if (page === 'users') loadUsersPage().catch((e) => showToast(e.message, true));
  if (page === 'profit-loss') loadProfitLossPage().catch((e) => showToast(e.message, true));
  if (page === 'checks') loadChecksPage().catch((e) => showToast(e.message, true));
  if (page === 'installments') loadInstallmentsPage().catch((e) => showToast(e.message, true));
};
initializeOperationsPages();
initializeSidebarGroups();
initializeSoftwareAboutPage();
bindJalaliDatePickers(true);
installLoginSubmitGuard();
initializeAuth();

// Add restore action to the existing backup settings tab.
const backupPanel = document.querySelector('[data-settings-panel="backup"] .modal-actions');
if (backupPanel && !$('#v2Restore')) {
  backupPanel.insertAdjacentHTML('afterbegin', '<button id="v2Restore" type="button" class="secondary">بازیابی پشتیبان</button>');
  $('#v2Restore').addEventListener('click', async () => {
    if (!confirm('بازیابی پشتیبان، داده‌های فعلی را جایگزین می‌کند. ادامه می‌دهید؟')) return;
    try { const result = await window.api.settings.restore(); if (!result.canceled) { showToast('پشتیبان بازیابی شد؛ برنامه را دوباره باز کنید.'); } } catch (e) { showToast(e.message, true); }
  });
}
if (backupPanel && !$('#v2OfficialStart')) {
  backupPanel.insertAdjacentHTML('afterbegin', '<button id="v2OfficialStart" type="button" class="danger-button">شروع رسمی بدون دادهٔ نمونه</button>');
  $('#v2OfficialStart').addEventListener('click', async () => {
    if (!confirm('تمام داده‌های فعلیِ برنامه حذف می‌شوند و یک نسخهٔ پشتیبان خودکار ساخته خواهد شد. تنظیمات فروشگاه حفظ می‌شوند. ادامه می‌دهید؟')) return;
    try {
      const result = await window.api.settings.officialStart();
      showToast(`شروع رسمی انجام شد. پشتیبان داده‌های قبلی: ${result.backupPath}`);
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      showToast(e.message, true);
    }
  });
}
