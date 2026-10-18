import { publishRendererBindings } from '../shared/bridge.mjs';

function initializeAssistantPage() {
  if ($('#assistantPage')) return;
  $('#placeholderPage')?.insertAdjacentHTML('beforebegin', `
    <section id="assistantPage" class="page hidden">
      <div class="page-heading"><div><span class="eyebrow">پردازش درخواست متنی · کاملاً محلی و آفلاین</span><h2>دستیار هوشمند</h2></div></div>
      <div class="panel assistant-box">
        <div id="assistantConversation" class="assistant-conversation" aria-live="polite"></div>
        <label class="assistant-label">سؤال یا درخواست خود را به فارسی بنویسید
          <textarea id="assistantInput" rows="2" placeholder="مثال: تعداد محصولات چنده؟ / فروش امروز چقدر بود؟ / لیست پروانه های لباسشویی را لیست کن و 20 درصد به مبلغ خرید اضافه کن"></textarea>
        </label>
        <div class="assistant-chips">
          <button type="button" class="assistant-chip" data-text="تعداد محصولات چنده؟">تعداد محصولات</button>
          <button type="button" class="assistant-chip" data-text="فروش امروز چقدر بود؟">فروش امروز</button>
          <button type="button" class="assistant-chip" data-text="کالاهای کم موجودی کدوم‌ن؟">کمبود موجودی</button>
          <button type="button" class="assistant-chip" data-text="چه کارایی می‌تونی بکنی؟">چه کارایی بلدی؟</button>
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
  const state = { plan: null, lastAnswerKind: null };
  const appendBubble = (role, text) => {
    const box = $('#assistantConversation');
    if (!box) return;
    box.classList.remove('hidden');
    box.insertAdjacentHTML('beforeend', `<div class="assistant-bubble ${role}">${esc(text)}</div>`);
    box.scrollTop = box.scrollHeight;
  };
  const toUser = (cents) => Math.round((Number(cents) || 0) / 100 * currencyFactor());
  const toCents = (raw) => Math.max(0, Math.round(parsePriceInput(raw) * 100 / currencyFactor()));
  const fieldInput = (id, field) => document.querySelector(`.assistant-new-price[data-id="${id}"][data-field="${field}"]`);
  const columnLabels = { code: 'کد', name: 'نام کالا', category: 'دسته', stock: 'موجودی', unit: 'واحد', barcode: 'بارکد', purchasePrice: 'قیمت خرید', wholesalePrice: 'قیمت عمده', retailPrice: 'قیمت فروش', margin: 'سود ٪' };
  const priceColumns = ['purchasePrice', 'wholesalePrice', 'retailPrice'];
  const matchModeLabels = { keyword: 'تطبیق کلمه‌ای', partial: 'تطبیق بخشی کلمات', semantic: 'جست‌وجوی معنایی لوکال', continued: 'ادامهٔ انتخاب قبلی' };
  const render = () => {
    const plan = state.plan;
    const adjust = plan?.action?.type === 'adjust';
    const isAnswer = plan?.action?.type === 'answer';
    const columns = plan?.columns?.length ? plan.columns : ['code', 'name', 'stock', 'purchasePrice', 'wholesalePrice', 'retailPrice'];
    const targetField = adjust ? { purchase: 'purchasePrice', wholesale: 'wholesalePrice', retail: 'retailPrice' }[plan.action.field] : null;
    $('#assistantApply').disabled = !adjust;
    $('#assistantExport').disabled = !plan?.products?.length;
    $('#assistantExportPdf').disabled = !plan?.products?.length;
    const fieldLabels = { purchase: 'قیمت خرید', wholesale: 'قیمت عمده', retail: 'قیمت فروش' };
    $('#assistantSummary').textContent = isAnswer
      ? ''
      : plan
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
      : isAnswer ? ''
      : `<tr class="empty-row"><td colspan="${columns.length + 1}">ابتدا یک درخواست تحلیل کنید یا کالایی مطابق درخواست پیدا نشد.</td></tr>`;
  };
  const run = async () => {
    const errorBox = $('#assistantError');
    errorBox.classList.add('hidden');
    const question = ($('#assistantInput').value || '').trim();
    if (!question) { showToast('سؤال یا درخواست خود را در کادر بنویسید.', true); return; }
    appendBubble('user', question);
    try {
      // Follow-ups ("و دیروز؟") re-ask the previous question, so the last
      // answered kind travels with the request; a non-answer resets it.
      state.plan = await window.api.ai.plan(question, (state.plan?.products || []).map((product) => product.id), { lastKind: state.lastAnswerKind });
      state.lastAnswerKind = state.plan?.answer?.kind || null;
      render();
      if (state.plan?.answer?.text) appendBubble('assistant', state.plan.answer.text);
    } catch (error) {
      state.plan = null;
      render();
      errorBox.textContent = error?.message || 'تحلیل درخواست انجام نشد.';
      errorBox.classList.remove('hidden');
    }
  };
  $('#assistantRun').addEventListener('click', run);
  $('#assistantInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); run(); }
  });
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
  // The product grid is seeded once at boot, but its first load runs before
  // login and is rejected by the IPC guard; stock and prices also change with
  // every sale/purchase/return, so re-read the catalogue on every entry.
  if (page === 'sales') loadSaleProducts().catch(() => {});
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
  const labels = points.map((p, i) => (i % Math.max(1, Math.ceil(points.length / 6)) === 0 ? `<text x="${x(i)}" y="${height - 8}" text-anchor="middle">${esc(p.chartLabel || reportPeriodLabel(p.date))}</text>` : '')).join('');
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
    $('#reportAdjustments').innerHTML = `<span>جمع قبل از تخفیف: ${money(s.subtotal)}</span><span>تخفیف: ${money(s.discount)}</span>${Number(s.returnsCount || 0) ? `<span>مرجوعی‌ها: ${money(s.returnsTotal)} (${new Intl.NumberFormat('fa-IR').format(Number(s.returnsCount || 0))} رسید، از فروش کسر شد)</span>` : ''}<span>مالیات: ${money(s.tax)} (در سود لحاظ نشده)</span>`;
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
    // The reports page reuses the same weighted-linear forecast the dashboard
    // shows, instead of a flat average, so the two never disagree. The single
    // line continues from actual months into the forecasted ones.
    const forecastChart = $('#reportForecastChart');
    if (forecastChart) {
      try {
        const forecastData = await window.api.reports.forecast({ period: 'month', horizon: 3 });
        if (!forecastData.history?.length) {
          forecastChart.innerHTML = '<div class="empty-state compact">برای پیش‌بینی هنوز سابقهٔ فروش وجود ندارد.</div>';
          $('#reportForecastNote').textContent = forecastData.note || 'دادهٔ کافی برای پیش‌بینی وجود ندارد.';
        } else {
          const historyRows = (forecastData.history || []).map((row) => ({ date: row.period, chartLabel: dashboardPeriodChartLabel(row.period, 'month'), netSales: row.netSales }));
          const predictionRows = (forecastData.predictions || []).map((row) => ({ date: row.period, chartLabel: dashboardPeriodChartLabel(row.period, 'month'), netSales: row.netSales }));
          reportSvgLine(forecastChart, [...historyRows, ...predictionRows], [{ key: 'netSales', label: 'فروش واقعی / پیش‌بینی‌شده', color: '#fbbf24' }]);
          $('#reportForecastNote').textContent = `${forecastData.note} · اطمینان: ${forecastData.confidence}`;
        }
      } catch {
        forecastChart.innerHTML = '<div class="empty-state compact">داده کافی برای پیش‌بینی وجود ندارد.</div>';
        $('#reportForecastNote').textContent = 'داده کافی برای پیش‌بینی وجود ندارد';
      }
    }
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
if (sessionReady) loadNotifications().catch(() => {});
setInterval(() => { if (sessionReady) loadNotifications().catch(() => {}); }, 5 * 60 * 1000);

publishRendererBindings(window, {
  constants: { assistantNavTarget, toPersianDigits },
  functions: {
    initializeAssistantPage: { get: () => initializeAssistantPage, set: (value) => { initializeAssistantPage = value; } },
    setPageRouter: { get: () => setPageRouter, set: (value) => { setPageRouter = value; } },
    initializeReportsPage: { get: () => initializeReportsPage, set: (value) => { initializeReportsPage = value; } },
    reportIsoToJalali: { get: () => reportIsoToJalali, set: (value) => { reportIsoToJalali = value; } },
    reportDateValue: { get: () => reportDateValue, set: (value) => { reportDateValue = value; } },
    reportPeriodLabel: { get: () => reportPeriodLabel, set: (value) => { reportPeriodLabel = value; } },
    reportSvgLine: { get: () => reportSvgLine, set: (value) => { reportSvgLine = value; } },
    reportSvgBars: { get: () => reportSvgBars, set: (value) => { reportSvgBars = value; } },
    reportFillDates: { get: () => reportFillDates, set: (value) => { reportFillDates = value; } },
    loadSalesReport: { get: () => loadSalesReport, set: (value) => { loadSalesReport = value; } }
  }
});
