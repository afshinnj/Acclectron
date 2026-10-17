function toCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 100);
}

function validatedCents(value, label, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} نامعتبر است.`);
  const cents = Math.round(number * 100);
  if (!Number.isSafeInteger(cents)) throw new Error(`${label} خارج از محدودهٔ مجاز است.`);
  return cents;
}

function calculateSaleTotals(items, discount = 0, tax = 0, paidAmount = 0) {
  const normalizedItems = (items ?? []).map((item) => {
    const quantity = Number(item.quantity);
    const unitPrice = validatedCents(item.unitPrice, 'قیمت واحد');
    const itemDiscount = validatedCents(item.discount, 'تخفیف ردیف', true);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('تعداد کالا باید بزرگ‌تر از صفر باشد.');
    }
    const gross = Math.round(quantity * unitPrice);
    if (!Number.isSafeInteger(gross)) throw new Error('مبلغ ردیف خارج از محدودهٔ مجاز است.');
    if (itemDiscount > gross) throw new Error('تخفیف هر ردیف نمی‌تواند از مبلغ همان ردیف بیشتر باشد.');
    const total = gross - itemDiscount;
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
  if (!Number.isSafeInteger(subtotal)) throw new Error('جمع اقلام خارج از محدودهٔ مجاز است.');
  const discountCents = validatedCents(discount, 'تخفیف فاکتور', true);
  const taxCents = validatedCents(tax, 'مالیات', true);
  if (discountCents > subtotal) throw new Error('تخفیف فاکتور نمی‌تواند از جمع اقلام بیشتر باشد.');
  const total = subtotal - discountCents + taxCents;
  if (!Number.isSafeInteger(total)) throw new Error('مبلغ نهایی خارج از محدودهٔ مجاز است.');
  const paidCents = Math.min(total, validatedCents(paidAmount, 'مبلغ پرداخت', true));

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
