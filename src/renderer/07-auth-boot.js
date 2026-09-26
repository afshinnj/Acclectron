let quickPinIdleTimer;
let quickPinLocked = false;
let quickPinMonitorStarted = false;

function ensureQuickPinLockUI() {
  if ($('#quickPinBackdrop')) return;
  document.body.insertAdjacentHTML('beforeend', '<div id="quickPinBackdrop" class="modal-backdrop hidden"><div class="modal" style="max-width:380px"><div class="modal-header"><div><span class="eyebrow">قفل سریع</span><h3>برنامه قفل شد</h3></div></div><form id="quickPinForm"><p>برای ادامه PIN سریع خود را وارد کنید.</p><label>PIN سریع<input id="quickPinInput" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" autocomplete="off" required></label><div id="quickPinError" class="form-error hidden"></div><button class="primary wide" type="submit">بازکردن قفل</button><button id="quickPinFullLogin" class="secondary wide" type="button">ورود با رمز عبور</button></form></div></div>');
  $('#quickPinForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await window.api.auth.quickPin.unlock($('#quickPinInput').value); quickPinLocked = false; $('#quickPinInput').value = ''; $('#quickPinBackdrop').classList.add('hidden'); resetQuickPinIdleTimer(); }
    catch (error) { const box = $('#quickPinError'); box.textContent = readableError(error, 'بازکردن قفل ناموفق بود.'); box.classList.remove('hidden'); }
  });
  $('#quickPinFullLogin').addEventListener('click', () => { quickPinLocked = true; clearTimeout(quickPinIdleTimer); $('#quickPinBackdrop').classList.add('hidden'); $('#loginBackdrop').classList.remove('hidden'); $('#loginPassword')?.focus(); });
}

function resetQuickPinIdleTimer() {
  clearTimeout(quickPinIdleTimer);
  if (quickPinLocked) return;
  quickPinIdleTimer = setTimeout(async () => {
    try { const status = await window.api.auth.quickPin.status(); if (status.enabled) { quickPinLocked = true; ensureQuickPinLockUI(); $('#quickPinBackdrop').classList.remove('hidden'); $('#quickPinInput').focus(); } } catch {}
  }, 15 * 60 * 1000);
}

function startQuickPinIdleMonitor() {
  ensureQuickPinLockUI();
  if (!quickPinMonitorStarted) {
    quickPinMonitorStarted = true;
    ['mousemove', 'mousedown', 'keydown', 'touchstart'].forEach((type) => document.addEventListener(type, resetQuickPinIdleTimer, { passive: true }));
  }
  quickPinLocked = false;
  resetQuickPinIdleTimer();
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
    if (current) { backdrop.classList.add('hidden'); startQuickPinIdleMonitor(); return; }
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
      const session = await window.api.auth.login($('#loginUsername')?.value || '', $('#loginPassword')?.value || '');
      backdrop?.classList.add('hidden');
      showToast('ورود موفق بود.');
      warnDefaultPassword(session);
      refreshAfterLogin();
      startQuickPinIdleMonitor();
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

// Boot the managed pages now that every chunk has loaded. This call and the
// initial setManagedPage('dashboard') used to live at the bottom of
// 02-management.js, but the renderer split into separate <script> tags means
// 04-invoices-assistant-reports.js (which supplies the full
// initializeSalesMarkupFinal that builds the keyboard-invoice pages) had not
// loaded yet at that point. Running them here reproduces the original
// monolith's hoisting order, where all declarations existed before boot.
initializeManagementMarkup();
setManagedPage('dashboard');

// Add restore action to the existing backup settings tab.
const backupPanel = document.querySelector('[data-settings-panel="backup"] .modal-actions');
if (backupPanel && !$('#v2Restore')) {
  backupPanel.insertAdjacentHTML('afterbegin', '<button id="v2Restore" type="button" class="secondary">بازیابی پشتیبان</button>');
  $('#v2Restore').addEventListener('click', async () => {
    if (!await showConfirmDialog({ title: 'بازیابی پشتیبان', message: 'بازیابی پشتیبان، داده‌های فعلی را جایگزین می‌کند. ادامه می‌دهید؟', confirmText: 'بازیابی پشتیبان', destructive: true })) return;
    try { const result = await window.api.settings.restore(); if (!result.canceled) { showToast('پشتیبان بازیابی شد؛ برنامه را دوباره باز کنید.'); } } catch (e) { showToast(e.message, true); }
  });
}
if (backupPanel && !$('#v2OfficialStart')) {
  backupPanel.insertAdjacentHTML('afterbegin', '<button id="v2OfficialStart" type="button" class="danger-button">شروع رسمی بدون دادهٔ نمونه</button>');
  $('#v2OfficialStart').addEventListener('click', async () => {
    if (!await showConfirmDialog({ title: 'شروع رسمی بدون دادهٔ نمونه', message: 'تمام داده‌های فعلیِ برنامه حذف می‌شوند و یک نسخهٔ پشتیبان خودکار ساخته خواهد شد. تنظیمات فروشگاه حفظ می‌شوند. ادامه می‌دهید؟', confirmText: 'ادامه و حذف داده‌ها', destructive: true })) return;
    try {
      const result = await window.api.settings.officialStart();
      showToast(`شروع رسمی انجام شد. پشتیبان داده‌های قبلی: ${result.backupPath}`);
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      showToast(e.message, true);
    }
  });
}
