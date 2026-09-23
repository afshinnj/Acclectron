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
      <form id="inventoryAdjustForm" class="panel form-grid"><label>کالا<div class="inventory-product-picker"><input id="inventoryProductSearch" placeholder="جست‌وجوی نام، کد یا بارکد" autocomplete="off"><input id="inventoryProductSelect" type="hidden"><div id="inventoryProductSuggestions" class="inventory-product-suggestions hidden"></div></div></label><label>موجودی شمارش‌شده<input id="inventoryCountedStock" type="number" min="0" step="1" required></label><label class="full-field">علت اصلاح<input id="inventoryAdjustmentReason" placeholder="مثلاً کسری، خرابی یا انبارگردانی دوره‌ای"></label><button class="primary" type="submit">ثبت اصلاح موجودی</button></form>
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

