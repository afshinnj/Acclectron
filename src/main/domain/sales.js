function toCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 100);
}

function calculateSaleTotals(items, discount = 0, tax = 0, paidAmount = 0) {
  const normalizedItems = (items ?? []).map((item) => {
    const quantity = Number(item.quantity);
    const unitPrice = toCents(item.unitPrice);
    const itemDiscount = toCents(item.discount);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('تعداد کالا باید بزرگ‌تر از صفر باشد.');
    }
    const gross = Math.round(quantity * unitPrice);
    const total = Math.max(0, gross - itemDiscount);
    return {
      productId: Number(item.productId),
      quantity,
      unitPrice,
      discount: itemDiscount,
      priceType: item.priceType === 'wholesale' ? 'wholesale' : 'retail',
      total
    };
  });

  if (normalizedItems.length === 0) {
    throw new Error('فاکتور باید حداقل یک کالا داشته باشد.');
  }

  const subtotal = normalizedItems.reduce((sum, item) => sum + item.total, 0);
  const discountCents = toCents(discount);
  const taxCents = toCents(tax);
  const total = Math.max(0, subtotal - discountCents + taxCents);
  const paidCents = Math.min(total, toCents(paidAmount));

  return {
    items: normalizedItems,
    subtotal,
    discount: discountCents,
    tax: taxCents,
    total,
    paidAmount: paidCents,
    remainingAmount: total - paidCents
  };
}

module.exports = { calculateSaleTotals, toCents };
