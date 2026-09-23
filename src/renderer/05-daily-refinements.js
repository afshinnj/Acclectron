/* Daily-sales refinements: keep identical product/price rows together,
   accept keyboard prices with grouping separators, and persist Jalali dates. */
function saveDailySaleDraft() {
  try {
    if (!saleState.cart.length) {
      localStorage.removeItem(dailySaleDraftStorageKey);
      return;
    }
    const date = $('#saleDate')?.value || '';
    const cart = saleState.cart.map((item) => ({
      productId: Number(item.productId),
      name: String(item.name || ''),
      unitPrice: Math.max(0, Math.round(Number(item.unitPrice) || 0)),
      quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
      priceType: item.priceType === 'wholesale' ? 'wholesale' : 'retail'
    })).filter((item) => Number.isInteger(item.productId) && item.productId > 0 && item.name);
    if (!cart.length) {
      localStorage.removeItem(dailySaleDraftStorageKey);
      return;
    }
    localStorage.setItem(dailySaleDraftStorageKey, JSON.stringify({ date, cart }));
  } catch {
    // A draft is a convenience feature; a blocked browser storage must not
    // interrupt selling.
  }
}

function restoreDailySaleDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(dailySaleDraftStorageKey) || 'null');
    if (!saved || !Array.isArray(saved.cart)) return;
    const cart = saved.cart.map((item) => ({
      productId: Number(item.productId),
      name: String(item.name || ''),
      unitPrice: Math.max(0, Math.round(Number(item.unitPrice) || 0)),
      quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
      priceType: item.priceType === 'wholesale' ? 'wholesale' : 'retail'
    })).filter((item) => Number.isInteger(item.productId) && item.productId > 0 && item.name);
    if (!cart.length) {
      localStorage.removeItem(dailySaleDraftStorageKey);
      return;
    }
    saleState.cart = cart;
    if (saved.date && $('#saleDate')) $('#saleDate').value = saved.date;
    renderSaleCart();
  } catch {
    localStorage.removeItem(dailySaleDraftStorageKey);
  }
}

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
  saveDailySaleDraft();
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
    saveDailySaleDraft();
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
  $('#saleDate')?.addEventListener('change', saveDailySaleDraft);
  $('#saleDate')?.addEventListener('input', saveDailySaleDraft);
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
  if (!saleState.cart.length) dailySaleDate.value = isoToJalali(new Date().toISOString().slice(0, 10));
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
    if (!await showConfirmDialog({ title: `غیرفعال‌سازی ${label}`, message: `${label} غیرفعال شود؟ تا زمان فعال‌سازی دوباره، در عملیات جدید قابل انتخاب نخواهد بود.`, confirmText: 'غیرفعال‌سازی', destructive: true })) return;
    const id = Number(toggle.dataset.id);
    try {
      if (toggle.classList.contains('toggle-product')) {
        await window.api.products.setActive(id, false);
        showToast('کالا غیرفعال شد.');
        await loadManagedProducts();
      } else if (toggle.classList.contains('toggle-category')) {
        await window.api.categories.setActive(id, false);
        showToast('دسته‌بندی غیرفعال شد.');
        await loadManagedCategories();
      } else {
        await window.api.customers.setActive(id, false);
        showToast('طرف‌حساب غیرفعال شد.');
        await loadManagedParties();
      }
    } catch (error) { showToast(error.message, true); }
    return;
  }

  if (event.target.closest('#clearSaleCart') && saleState.cart.length) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (await showConfirmDialog({ title: 'پاک کردن سبد فروش', message: 'سبد فروش پاک شود؟ این مورد ثبت نشده و قابل بازگردانی نیست.', confirmText: 'پاک کردن سبد', destructive: true })) {
      saleState.cart = [];
      renderSaleCart();
      showToast('سبد فروش پاک شد.');
    }
  }
}, true);

