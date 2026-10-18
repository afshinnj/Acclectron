import { publishRendererBindings } from '../shared/bridge.mjs';

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
  // This original settings screen is superseded at parse time by
  // initializeSettingsPageV2 (03-settings-print.js), which rebuilds #settingsPage
  // and owns the post-login reload via refreshSettingsData. Its guarded reads
  // (units, printers) are rejected before login, so skip the boot copy.
  if (sessionReady) loadSettings().catch(() => {});
}

const originalManagedPageForSettings = setManagedPage;
setManagedPage = function setManagedPageWithSettings(page) {
  initializeSettingsPage();
  // Resolved at call time: 04-invoices-assistant-reports.js loads later and
  // provides the full page router (all managed pages), which supersedes the
  // partial router defined earlier in this file.
  (typeof setPageRouter === 'function' ? setPageRouter : originalManagedPageForSettings)(page);
  if (page === 'settings') {
    $('#settingsPage')?.classList.remove('hidden');
    $('#placeholderPage')?.classList.add('hidden');
  } else {
    $('#settingsPage')?.classList.add('hidden');
  }
};
initializeSettingsPage();

publishRendererBindings(window, {
  constants: { originalManagedPageForSettings },
  functions: {
    initializeSettingsPage: { get: () => initializeSettingsPage, set: (value) => { initializeSettingsPage = value; } }
  }
});
