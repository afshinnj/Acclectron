'use strict';

const database = require('../database');

function registerInvoiceHandlers(secureHandle) {
  secureHandle('sales:create', (_event, payload) => database.createSale(payload));
  secureHandle('sales:merge-daily', (_event, payload) => database.mergeDailySales(payload));
  secureHandle('purchases:create', (_event, payload) => database.createPurchase(payload));
  secureHandle('sales:list', (_event, payload) => database.listSales(payload));
  secureHandle('purchases:list', (_event, payload) => database.listPurchases(payload));
  secureHandle('purchases:price-history', (_event, productId, payload) => database.getPurchasePriceHistory(productId, payload));
  secureHandle('invoices:next-number', (_event, kind, date) => database.getNextInvoiceNumber(kind, date));
  secureHandle('invoices:details', (_event, kind, id) => database.getInvoiceDetails(kind, id));
  secureHandle('invoices:update', (_event, kind, id, payload) => {
    if (kind !== 'sale') throw new Error('ویرایش این نوع فاکتور هنوز پشتیبانی نمی‌شود.');
    return database.updateSale(id, payload);
  });
  secureHandle('invoices:settle', (_event, kind, id, payload) => database.settleInvoice(kind, id, payload));
  secureHandle('invoices:cancel', (_event, kind, id) => database.cancelInvoice(kind, id));
  secureHandle('invoices:set-pinned', (_event, kind, id, pinned) => {
    if (kind !== 'sale') throw new Error('سنجاق کردن فقط برای فاکتورهای فروش فعال است.');
    return database.setSalePinned(id, pinned);
  });

  secureHandle('returns:sale:create', (_event, payload) => database.createSaleReturn(payload));
  secureHandle('returns:sale:details', (_event, id) => database.getSaleReturnDetails(id));
  secureHandle('returns:sale:list', (_event, payload) => database.listSalesReturns(payload));
  secureHandle('returns:sale:cancel', (_event, id) => database.cancelSaleReturn(id));
  secureHandle('returns:purchase:create', (_event, payload) => database.createPurchaseReturn(payload));
  secureHandle('returns:purchase:details', (_event, id) => database.getPurchaseReturnDetails(id));
  secureHandle('returns:purchase:list', (_event, payload) => database.listPurchaseReturns(payload));
  secureHandle('returns:purchase:cancel', (_event, id) => database.cancelPurchaseReturn(id));

}

module.exports = { registerInvoiceHandlers };
