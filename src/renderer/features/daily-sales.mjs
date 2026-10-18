import { renderer, registerRendererBindings } from '../shared/runtime.mjs';
import { localDateIso } from '../shared/date-utils.mjs';

/* Daily-sales refinements: keep identical product/price rows together,
   accept keyboard prices with grouping separators, and persist Jalali dates. */
function saveDailySaleDraft() {
  try {
    if (!renderer.saleState.cart.length) {
      localStorage.removeItem(renderer.dailySaleDraftStorageKey);
      return;
    }
    const date = renderer.$('#saleDate')?.value || '';
    const cart = renderer.saleState.cart.map((item) => ({
      productId: Number(item.productId),
      name: String(item.name || ''),
      unitPrice: Math.max(0, Math.round(Number(item.unitPrice) || 0)),
      quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
      priceType: item.priceType === 'wholesale' ? 'wholesale' : 'retail'
    })).filter((item) => Number.isInteger(item.productId) && item.productId > 0 && item.name);
    if (!cart.length) {
      localStorage.removeItem(renderer.dailySaleDraftStorageKey);
      return;
    }
    localStorage.setItem(renderer.dailySaleDraftStorageKey, JSON.stringify({ date, cart }));
  } catch {
    // A draft is a convenience feature; a blocked browser storage must not
    // interrupt selling.
  }
}

function restoreDailySaleDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(renderer.dailySaleDraftStorageKey) || 'null');
    if (!saved || !Array.isArray(saved.cart)) return;
    const cart = saved.cart.map((item) => ({
      productId: Number(item.productId),
      name: String(item.name || ''),
      unitPrice: Math.max(0, Math.round(Number(item.unitPrice) || 0)),
      quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
      priceType: item.priceType === 'wholesale' ? 'wholesale' : 'retail'
    })).filter((item) => Number.isInteger(item.productId) && item.productId > 0 && item.name);
    if (!cart.length) {
      localStorage.removeItem(renderer.dailySaleDraftStorageKey);
      return;
    }
    renderer.saleState.cart = cart;
    if (saved.date && renderer.$('#saleDate')) renderer.$('#saleDate').value = saved.date;
    renderer.renderSaleCart();
  } catch {
    localStorage.removeItem(renderer.dailySaleDraftStorageKey);
  }
}

renderer.renderSaleCart = function renderDailySaleCart() {
  const body = renderer.$('#modernSaleItems');
  if (!body) return;
  body.innerHTML = renderer.saleState.cart.length
    ? renderer.saleState.cart.map((item, index) => `<tr><td><strong>${renderer.esc(item.name)}</strong><small>${item.priceType === 'wholesale' ? 'عمده' : 'فروش'}</small></td><td><input class="cart-price" data-index="${index}" type="text" inputmode="decimal" value="${renderer.formatPriceInput(item.unitPrice)}"></td><td><div class="cart-quantity-control"><button class="cart-quantity-step" data-index="${index}" data-delta="-1" type="button">−</button><input class="cart-quantity" data-index="${index}" type="number" min="1" step="1" value="${item.quantity}"><button class="cart-quantity-step" data-index="${index}" data-delta="1" type="button">+</button></div></td><td><button class="delete-line" data-index="${index}">×</button></td></tr>`).join('')
    : '<tr class="empty-row"><td colspan="4">برای شروع یکی از قیمت‌های محصول را انتخاب کنید.</td></tr>';
  const itemCount = renderer.saleState.cart.reduce((sum, item) => sum + item.quantity, 0);
  const formattedItemCount = new Intl.NumberFormat('fa-IR').format(itemCount);
  renderer.$('#cartCount').textContent = `${formattedItemCount} قلم`;
  renderer.$('#cartItemCount').textContent = formattedItemCount;
  renderer.$('#modernSaleTotal').textContent = renderer.money(renderer.saleState.cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));
  const badge = renderer.$('#saleCartBadge');
  if (badge) { const count = renderer.saleState.cart.reduce((sum, item) => sum + item.quantity, 0); badge.textContent = new Intl.NumberFormat('fa-IR').format(count); badge.classList.toggle('hidden', count === 0); }
  saveDailySaleDraft();
};

renderer.addSaleProduct = function addDailySaleProduct(id, unitPrice, priceType) {
  const product = renderer.saleState.products.find((p) => p.id === id);
  if (!product) return;
  const normalizedPrice = Math.max(0, Math.round(Number(unitPrice) || 0));
  const existing = renderer.saleState.cart.find((item) => item.productId === id && item.unitPrice === normalizedPrice);
  if (existing) existing.quantity += 1;
  else renderer.saleState.cart.push({ productId: id, name: product.name, unitPrice: normalizedPrice, quantity: 1, priceType });
  renderer.renderSaleCart();
  renderer.showToast('محصول به سبد فروش اضافه شد.');
};

renderer.bindSalesEvents = function bindDailySalesEvents() {
  let saleSearchTimer;
  renderer.$('#saleProductFilter')?.addEventListener('input', () => {
    clearTimeout(saleSearchTimer);
    saleSearchTimer = setTimeout(() => renderer.loadSaleProducts(renderer.$('#saleProductFilter').value), 120);
  });
  renderer.$('#saleProductCards')?.addEventListener('click', (event) => {
    const button = event.target.closest('.add-daily-product');
    if (!button || button.disabled) return;
    const product = renderer.saleState.products.find((p) => p.id === Number(button.dataset.id));
    if (!product) return;
    const type = button.dataset.priceType;
    renderer.addSaleProduct(product.id, type === 'wholesale' ? product.wholesalePrice : product.salePrice, type);
  });
  renderer.$('#modernSaleItems')?.addEventListener('input', (event) => {
    const item = renderer.saleState.cart[Number(event.target.dataset.index)];
    if (!item) return;
    if (event.target.classList.contains('cart-price')) {
      item.unitPrice = renderer.parsePriceInput(event.target.value);
      if (String(event.target.value).trim()) {
        event.target.value = renderer.formatPriceInput(item.unitPrice);
        event.target.setSelectionRange(event.target.value.length, event.target.value.length);
      }
    }
    if (event.target.classList.contains('cart-quantity')) item.quantity = Math.max(1, Math.round(Number(event.target.value || 1)));
    renderer.$('#modernSaleTotal').textContent = renderer.money(renderer.saleState.cart.reduce((sum, row) => sum + row.unitPrice * row.quantity, 0));
    saveDailySaleDraft();
  });
  renderer.$('#modernSaleItems')?.addEventListener('blur', (event) => {
    if (event.target.classList.contains('cart-price')) {
      const item = renderer.saleState.cart[Number(event.target.dataset.index)];
      if (item) event.target.value = renderer.formatPriceInput(item.unitPrice);
    }
  }, true);
  renderer.$('#modernSaleItems')?.addEventListener('click', (event) => {
    const quantityButton = event.target.closest('.cart-quantity-step');
    if (quantityButton) {
      const item = renderer.saleState.cart[Number(quantityButton.dataset.index)];
      if (item) item.quantity = Math.max(1, item.quantity + Number(quantityButton.dataset.delta));
      renderer.renderSaleCart();
      return;
    }
    const button = event.target.closest('.delete-line');
    if (button) { renderer.saleState.cart.splice(Number(button.dataset.index), 1); renderer.renderSaleCart(); }
  });
  renderer.$('#clearSaleCart')?.addEventListener('click', () => {
    if (!renderer.saleState.cart.length) return renderer.showToast('سبد فروش خالی است.', true);
    renderer.saleState.cart = []; renderer.renderSaleCart(); renderer.showToast('سبد فروش پاک شد.');
  });
  const saveDailySale = async (print = false) => {
    const error = renderer.$('#modernSaleError'); error.classList.add('hidden');
    try {
      if (!renderer.saleState.cart.length) throw new Error('حداقل یک محصول به سبد اضافه کنید.');
      const date = renderer.jalaliInputToIso(renderer.$('#saleDate').value);
      if (!date) throw new Error('تاریخ فروش را به صورت شمسی و معتبر وارد کنید.');
      const total = renderer.saleState.cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
      const result = await window.api.sales.create({
        items: renderer.saleState.cart.map((item) => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice / 100, discount: 0, priceType: item.priceType })),
        source: 'daily',
        paidAmount: total / 100,
        date
      });
      renderer.saleState.cart = []; renderer.renderSaleCart(); await renderer.loadSaleProducts(); await window.api.dashboard.summary().then(renderer.renderMetrics);
      if (!renderer.$('#reportsPage')?.classList.contains('hidden')) renderer.loadSalesReport();
      renderer.showToast(`فروش ${result.invoiceNumber} با موفقیت ثبت شد. سود: ${renderer.money(result.profitTotal)}`);
      if (print) await renderer.openInvoicePrintPreview('sale', result.id);
    } catch (err) { error.textContent = renderer.readableError(err, 'ثبت فروش انجام نشد.'); error.classList.remove('hidden'); }
  };
  renderer.$('#modernSaveSale')?.addEventListener('click', () => saveDailySale(false));
  renderer.$('#modernSaveSalePrint')?.addEventListener('click', () => saveDailySale(true));
  renderer.$('#saleDate')?.addEventListener('change', saveDailySaleDraft);
  renderer.$('#saleDate')?.addEventListener('input', saveDailySaleDraft);
  renderer.$('#saleProductFilter')?.addEventListener('keydown', (event) => {
    if (event.key === 'F2') { event.preventDefault(); event.target.select(); }
    if (event.key === 'F9') { event.preventDefault(); saveDailySale(false); }
    if (event.key === 'Enter' && renderer.saleState.products[0]) {
      event.preventDefault();
      const product = renderer.saleState.products[0];
      renderer.addSaleProduct(product.id, product.salePrice, 'retail');
      event.target.value = '';
      renderer.loadSaleProducts('');
    }
  });
  renderer.$('#saleProductFilter')?.focus();
};

const dailySalesNodes = ['saleProductFilter', 'saleProductCards', 'modernSaleItems', 'clearSaleCart', 'modernSaveSale', 'modernSaveSalePrint']
  .map((id) => document.getElementById(id)).filter(Boolean);
dailySalesNodes.forEach((node) => node.replaceWith(node.cloneNode(true)));
const dailySaleDate = renderer.$('#saleDate');
if (dailySaleDate) {
  dailySaleDate.type = 'text';
  dailySaleDate.inputMode = 'numeric';
  if (!renderer.saleState.cart.length) dailySaleDate.value = renderer.isoToJalali(localDateIso());
}
renderer.bindSalesEvents();
renderer.bindJalaliDatePickers();

function initializeSaleCartModal() {
  const actions = document.querySelector('.topbar-actions');
  const cart = document.querySelector('#salesPage .modern-cart');
  if (!actions || !cart || renderer.$('#saleCartButton')) return;
  actions.insertAdjacentHTML('afterbegin', '<button id="saleCartButton" class="icon-button sale-cart-button" title="سبد خرید" aria-label="سبد خرید">🛒<span id="saleCartBadge" class="notification-badge hidden">۰</span></button>');
  document.body.insertAdjacentHTML('beforeend', '<div id="saleCartModal" class="modal-backdrop hidden"><div class="sale-cart-modal-shell"><div class="sale-cart-modal-head"><div><span class="eyebrow">فروش روزانه</span><h3>سبد خرید</h3></div><button type="button" class="modal-close" id="closeSaleCart">×</button></div><div id="saleCartModalBody"></div></div></div>');
  renderer.$('#saleCartModalBody').appendChild(cart);
  renderer.$('#saleCartButton').addEventListener('click', () => { renderer.$('#saleCartModal').classList.remove('hidden'); renderer.renderSaleCart(); });
  renderer.$('#closeSaleCart').addEventListener('click', () => renderer.$('#saleCartModal').classList.add('hidden'));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'F8' && !renderer.authOverlayVisible() && !event.target.matches('input,textarea,select')) { event.preventDefault(); renderer.$('#saleCartButton')?.click(); }
  });
  renderer.renderSaleCart();
}
// initializeSaleCartModal() is invoked by initializeManagementMarkup() once the
// daily-sales markup exists; calling it here at chunk-parse time is too early
// (#salesPage still holds the original static markup, so .modern-cart is null).
renderer.renderSaleCart();

// Confirmation is intentionally limited to actions that discard current work
// or make a record unavailable, while routine edits remain uninterrupted.
document.addEventListener('click', async (event) => {
  const toggle = event.target.closest('.toggle-product,.toggle-category,.toggle-party');
  if (toggle?.dataset.active === '1') {
    const label = toggle.classList.contains('toggle-product')
      ? 'کالا'
      : toggle.classList.contains('toggle-category')
        ? 'دسته‌بندی'
        : 'طرف‌حساب';
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!await renderer.showConfirmDialog({ title: `غیرفعال‌سازی ${label}`, message: `${label} غیرفعال شود؟ تا زمان فعال‌سازی دوباره، در عملیات جدید قابل انتخاب نخواهد بود.`, confirmText: 'غیرفعال‌سازی', destructive: true })) return;
    const id = Number(toggle.dataset.id);
    try {
      if (toggle.classList.contains('toggle-product')) {
        await window.api.products.setActive(id, false);
        renderer.showToast('کالا غیرفعال شد.');
        await renderer.loadManagedProducts();
      } else if (toggle.classList.contains('toggle-category')) {
        await window.api.categories.setActive(id, false);
        renderer.showToast('دسته‌بندی غیرفعال شد.');
        await renderer.loadManagedCategories();
      } else {
        await window.api.customers.setActive(id, false);
        renderer.showToast('طرف‌حساب غیرفعال شد.');
        await renderer.loadManagedParties();
      }
    } catch (error) { renderer.showToast(error.message, true); }
    return;
  }

  if (event.target.closest('#clearSaleCart') && renderer.saleState.cart.length) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (await renderer.showConfirmDialog({ title: 'پاک کردن سبد فروش', message: 'سبد فروش پاک شود؟ این مورد ثبت نشده و قابل بازگردانی نیست.', confirmText: 'پاک کردن سبد', destructive: true })) {
      renderer.saleState.cart = [];
      renderer.renderSaleCart();
      renderer.showToast('سبد فروش پاک شد.');
    }
  }
}, true);

registerRendererBindings(renderer, {
  constants: { dailySalesNodes, dailySaleDate },
  functions: {
    saveDailySaleDraft: { get: () => saveDailySaleDraft, set: (value) => { saveDailySaleDraft = value; } },
    restoreDailySaleDraft: { get: () => restoreDailySaleDraft, set: (value) => { restoreDailySaleDraft = value; } },
    initializeSaleCartModal: { get: () => initializeSaleCartModal, set: (value) => { initializeSaleCartModal = value; } }
  }
});
