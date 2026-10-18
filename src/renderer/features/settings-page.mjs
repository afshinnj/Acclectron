import { renderer, registerRendererBindings } from '../shared/runtime.mjs';

function initializeSettingsPage() {
  if (renderer.$('#settingsPage')) return;
  const placeholder = renderer.$('#placeholderPage');
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
    const select = renderer.$('#settingsPrinter');
    if (!select) return;
    try {
      const printers = await window.api.settings.printers();
      select.innerHTML = '<option value="">پرینتر پیش‌فرض سیستم</option>' +
        printers.map((printer) => `<option value="${renderer.esc(printer.name)}">${renderer.esc(printer.displayName)}${printer.isDefault ? ' (پیش‌فرض)' : ''}</option>`).join('');
      select.value = selected || '';
    } catch (error) {
      select.innerHTML = '<option value="">دریافت فهرست پرینترها ناموفق بود</option>';
    }
  }

  async function loadSettings() {
    const settings = await window.api.settings.get();
    const store = settings.store || {};
    const print = settings.print || {};
    renderer.$('#settingsStoreName').value = store.name || '';
    renderer.$('#settingsStoreSlogan').value = store.slogan || '';
    renderer.$('#settingsStorePhone').value = store.phone || '';
    renderer.$('#settingsStorePostalCode').value = store.postalCode || '';
    renderer.$('#settingsStoreAddress').value = store.address || '';
    renderer.$('#settingsStoreWebsite').value = store.website || '';
    renderer.$('#settingsStoreInstagram').value = store.instagram || '';
    renderer.$('#settingsStoreRubika').value = store.rubika || '';
    renderer.$('#settingsInvoiceFooter').value = store.footer || '';
    renderer.$('#settingsLogoPathValue').value = store.logoPath || '';
    renderer.$('#settingsLogoPath').textContent = store.logoPath ? store.logoPath : 'لوگویی انتخاب نشده است.';
    renderer.$('#settingsPaper').value = print.paperSize || 'A4';
    renderer.$('#settingsColor').checked = print.color !== false;
    renderer.$('#settingsAutoPrintSale').checked = print.autoPrintSale === true;
    renderer.$('#settingsAutoPrintPurchase').checked = print.autoPrintPurchase === true;
    await loadPrinters(print.printerName || '');
  }

  renderer.$('#reloadPrinters').addEventListener('click', () => loadPrinters(renderer.$('#settingsPrinter').value));
  renderer.$('#chooseStoreLogo').addEventListener('click', async () => {
    const result = await window.api.settings.chooseLogo();
    if (!result.canceled) {
      renderer.$('#settingsLogoPathValue').value = result.path;
      renderer.$('#settingsLogoPath').textContent = result.path;
    }
  });
  renderer.$('#storeSettingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = renderer.$('#storeSettingsError');
    error.classList.add('hidden');
    try {
      const current = await window.api.settings.get();
      await window.api.settings.save({
        ...current,
        store: {
          name: renderer.$('#settingsStoreName').value,
          slogan: renderer.$('#settingsStoreSlogan').value,
          phone: renderer.$('#settingsStorePhone').value,
          postalCode: renderer.$('#settingsStorePostalCode').value,
          address: renderer.$('#settingsStoreAddress').value,
          website: renderer.$('#settingsStoreWebsite').value,
          instagram: renderer.$('#settingsStoreInstagram').value,
          rubika: renderer.$('#settingsStoreRubika').value,
          footer: renderer.$('#settingsInvoiceFooter').value,
          logoPath: renderer.$('#settingsLogoPathValue').value
        }
      });
      renderer.showToast('مشخصات فروشگاه ذخیره شد.');
    } catch (err) { error.textContent = err.message; error.classList.remove('hidden'); }
  });
  renderer.$('#printSettingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = renderer.$('#printSettingsError');
    error.classList.add('hidden');
    try {
      const current = await window.api.settings.get();
      await window.api.settings.save({
        ...current,
        print: {
          printerName: renderer.$('#settingsPrinter').value,
          paperSize: renderer.$('#settingsPaper').value,
          color: renderer.$('#settingsColor').checked,
          autoPrintSale: renderer.$('#settingsAutoPrintSale').checked,
          autoPrintPurchase: renderer.$('#settingsAutoPrintPurchase').checked
        }
      });
      renderer.showToast('تنظیمات چاپ ذخیره شد.');
    } catch (err) { error.textContent = err.message; error.classList.remove('hidden'); }
  });
  // This original settings screen is superseded at parse time by
  // initializeSettingsPageV2 (03-settings-print.js), which rebuilds #settingsPage
  // and owns the post-login reload via refreshSettingsData. Its guarded reads
  // (units, printers) are rejected before login, so skip the boot copy.
  if (renderer.sessionReady) loadSettings().catch(() => {});
}

const originalManagedPageForSettings = renderer.setManagedPage;
renderer.setManagedPage = function setManagedPageWithSettings(page) {
  initializeSettingsPage();
  // Resolved at call time: 04-invoices-assistant-reports.js loads later and
  // provides the full page router (all managed pages), which supersedes the
  // partial router defined earlier in this file.
  (typeof renderer.setPageRouter === 'function' ? setPageRouter : originalManagedPageForSettings)(page);
  if (page === 'settings') {
    renderer.$('#settingsPage')?.classList.remove('hidden');
    renderer.$('#placeholderPage')?.classList.add('hidden');
  } else {
    renderer.$('#settingsPage')?.classList.add('hidden');
  }
};
initializeSettingsPage();

registerRendererBindings(renderer, {
  constants: { originalManagedPageForSettings },
  functions: {
    initializeSettingsPage: { get: () => initializeSettingsPage, set: (value) => { initializeSettingsPage = value; } }
  }
});
