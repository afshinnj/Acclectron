// Shared interaction rules that must run before feature-specific renderer code.
// Modal backdrops never dismiss dialogs; each modal owns an explicit close or
// cancel control. The product details drawer has its own close control.
document.addEventListener('click', (event) => {
  if (event.target?.classList?.contains('modal-backdrop')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

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
