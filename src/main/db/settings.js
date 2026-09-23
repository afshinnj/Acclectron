// settings.js — application settings persistence and currency conversion factor.
// Split mechanically from database.js; function bodies are unchanged.

const path = require('node:path');
const { requireDatabase, requirePermission } = require('./core');

function getAppSettings() {
  const db = requireDatabase();
  const settings = {};
  for (const row of db.prepare('SELECT key, value FROM app_settings').all()) {
    try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
  }
  return {
    store: {
      name: String(settings.storeName || ''),
      slogan: String(settings.storeSlogan || ''),
      phone: String(settings.storePhone || ''),
      address: String(settings.storeAddress || ''),
      postalCode: String(settings.storePostalCode || ''),
      website: String(settings.storeWebsite || ''),
      instagram: String(settings.storeInstagram || ''),
      rubika: String(settings.storeRubika || ''),
      footer: String(settings.invoiceFooter || ''),
      logoPath: String(settings.storeLogoPath || '')
    },
    print: {
      printerName: String(settings.printerName || ''),
      paperSize: String(settings.paperSize || 'A4'),
      color: settings.color !== false,
      autoPrintSale: settings.autoPrintSale === true,
      autoPrintPurchase: settings.autoPrintPurchase === true
      ,copies: Math.max(1, Number(settings.printCopies || 1))
      ,showLogo: settings.showLogo !== false
      ,showStoreInfo: settings.showStoreInfo !== false
      ,showDiscount: settings.showDiscount !== false
      ,showTax: settings.showTax !== false
      ,showUnit: settings.showUnit !== false
      ,previewBeforePrint: settings.previewBeforePrint === true
      ,showPrintDialog: settings.showPrintDialog === true
      ,margin: String(settings.printMargin || 'normal')
      ,orientation: ['portrait', 'landscape'].includes(String(settings.printOrientation)) ? String(settings.printOrientation) : 'portrait'
    }
    ,currency: {
      code: String(settings.currencyCode || 'IRR'),
      name: String(settings.currencyName || 'ریال'),
      symbol: String(settings.currencySymbol || 'ریال'),
      position: String(settings.currencyPosition || 'suffix'),
      decimals: Math.max(0, Math.min(4, Number(settings.currencyDecimals ?? 0))),
      separator: settings.currencySeparator !== false,
      rounding: String(settings.currencyRounding || 'none'),
      inputUnit: String(settings.currencyInputUnit || 'rial')
    }
    ,product: {
      defaultUnitId: settings.defaultUnitId ? Number(settings.defaultUnitId) : null,
      defaultMinimumStock: Number(settings.defaultMinimumStock || 0),
      requireBarcode: settings.requireBarcode === true,
      allowNegativeStock: settings.allowNegativeStock === true,
      warnLowStock: settings.warnLowStock !== false,
      allowFractional: settings.allowFractional !== false,
      codePrefix: String(settings.productCodePrefix || 'P-')
    }
    ,sales: {
      defaultPriceType: String(settings.defaultPriceType || 'retail'),
      defaultTax: Number(settings.defaultTax || 0),
      preventOversell: settings.preventOversell !== false,
      invoicePrefix: String(settings.invoicePrefix || 'S-'),
      paymentMethod: String(settings.paymentMethod || 'cash'),
      autoDate: settings.autoDate !== false
    }
    ,financial: {
      taxEnabled: settings.taxEnabled === true,
      taxRate: Number(settings.taxRate || 0),
      taxAfterDiscount: settings.taxAfterDiscount !== false,
      maxDiscount: Number(settings.maxDiscount || 0),
      rounding: String(settings.financialRounding || 'none')
    }
    ,appearance: {
      theme: String(settings.theme || 'dark'),
      calendar: 'jalali',
      fontScale: Number(settings.fontScale || 100),
      notifications: settings.notifications !== false,
      shortcuts: settings.shortcuts !== false
    }
    ,backup: {
      auto: settings.backupAuto === true,
      frequency: String(settings.backupFrequency || 'daily'),
      path: String(settings.backupPath || '')
    },
    security: {
      passwordlessLogin: settings.passwordlessLogin === true
    }
  };
}

// Monetary values are persisted as hundredths of a toman. Product imports
// arrive in the unit selected by the user, so convert them back to the
// canonical storage unit before writing.
function getCurrencyInputFactor() {
  const inputUnit = String(getAppSettings().currency?.inputUnit || 'rial').toLowerCase();
  return inputUnit === 'rial' ? 10 : 1;
}

function saveAppSettings(payload = {}) {
  const db = requireDatabase();
  requirePermission('settings');
  const store = payload.store || {};
  const print = payload.print || {};
  const values = {
    storeName: String(store.name || '').trim(),
    storeSlogan: String(store.slogan || '').trim(),
    storePhone: String(store.phone || '').trim(),
    storeAddress: String(store.address || '').trim(),
    storePostalCode: String(store.postalCode || '').trim(),
    storeWebsite: String(store.website || '').trim(),
    storeInstagram: String(store.instagram || '').trim(),
    storeRubika: String(store.rubika || '').trim(),
    invoiceFooter: String(store.footer || '').trim(),
    storeLogoPath: String(store.logoPath || '').trim(),
    printerName: String(print.printerName || '').trim(),
    paperSize: ['A4', 'A5', '80mm', '58mm'].includes(String(print.paperSize)) ? String(print.paperSize) : 'A4',
    color: print.color !== false,
    autoPrintSale: print.autoPrintSale === true,
    autoPrintPurchase: print.autoPrintPurchase === true
    ,printCopies: Math.max(1, Math.min(10, Number(print.copies || 1)))
    ,showLogo: print.showLogo !== false
    ,showStoreInfo: print.showStoreInfo !== false
    ,showDiscount: print.showDiscount !== false
    ,showTax: print.showTax !== false
    ,showUnit: print.showUnit !== false
    ,previewBeforePrint: print.previewBeforePrint === true
    ,showPrintDialog: print.showPrintDialog === true
    ,printMargin: ['narrow', 'normal', 'wide'].includes(String(print.margin)) ? String(print.margin) : 'normal'
    ,printOrientation: ['portrait', 'landscape'].includes(String(print.orientation)) ? String(print.orientation) : 'portrait'
  };
  const currency = payload.currency || {};
  Object.assign(values, {
    currencyCode: String(currency.code || 'IRR').trim(),
    currencyName: String(currency.name || 'ریال').trim(),
    currencySymbol: String(currency.symbol || 'ریال').trim(),
    currencyPosition: ['prefix', 'suffix'].includes(String(currency.position)) ? String(currency.position) : 'suffix',
    currencyDecimals: Math.max(0, Math.min(4, Number(currency.decimals || 0))),
    currencySeparator: currency.separator !== false,
    currencyRounding: ['none', '100', '1000'].includes(String(currency.rounding)) ? String(currency.rounding) : 'none',
    currencyInputUnit: ['rial', 'toman'].includes(String(currency.inputUnit || '').toLowerCase())
      ? String(currency.inputUnit).toLowerCase()
      : 'rial'
  });
  // Keep legacy settings consistent: IRR with a ریال label must be rendered
  // and entered in ریال even if an older record still says تومان.
  if (values.currencyCode.toUpperCase() === 'IRR'
      && (`${values.currencyName} ${values.currencySymbol}`).includes('ریال')) {
    values.currencyInputUnit = 'rial';
  }
  const product = payload.product || {};
  Object.assign(values, {
    defaultUnitId: product.defaultUnitId ? Number(product.defaultUnitId) : null,
    defaultMinimumStock: Math.max(0, Number(product.defaultMinimumStock || 0)),
    requireBarcode: product.requireBarcode === true,
    allowNegativeStock: product.allowNegativeStock === true,
    warnLowStock: product.warnLowStock !== false,
    allowFractional: product.allowFractional !== false,
    productCodePrefix: String(product.codePrefix || 'P-').trim()
  });
  const sales = payload.sales || {};
  Object.assign(values, {
    defaultPriceType: ['retail', 'wholesale'].includes(String(sales.defaultPriceType)) ? String(sales.defaultPriceType) : 'retail',
    defaultTax: Math.max(0, Number(sales.defaultTax || 0)),
    preventOversell: sales.preventOversell !== false,
    invoicePrefix: String(sales.invoicePrefix || 'S-').trim(),
    paymentMethod: String(sales.paymentMethod || 'cash'),
    autoDate: sales.autoDate !== false
  });
  const financial = payload.financial || {};
  Object.assign(values, {
    taxEnabled: financial.taxEnabled === true,
    taxRate: Math.max(0, Number(financial.taxRate || 0)),
    taxAfterDiscount: financial.taxAfterDiscount !== false,
    maxDiscount: Math.max(0, Number(financial.maxDiscount || 0)),
    financialRounding: ['none', '100', '1000'].includes(String(financial.rounding)) ? String(financial.rounding) : 'none'
  });
  const appearance = payload.appearance || {};
  Object.assign(values, {
    theme: ['dark', 'light', 'system', 'hacker'].includes(String(appearance.theme)) ? String(appearance.theme) : 'dark',
    calendar: ['gregorian', 'jalali'].includes(String(appearance.calendar)) ? String(appearance.calendar) : 'gregorian',
    fontScale: Math.max(80, Math.min(130, Number(appearance.fontScale || 100))),
    notifications: appearance.notifications !== false,
    shortcuts: appearance.shortcuts !== false
  });
  const backup = payload.backup || {};
  Object.assign(values, {
    backupAuto: backup.auto === true,
    backupFrequency: ['daily', 'weekly'].includes(String(backup.frequency)) ? String(backup.frequency) : 'daily',
    backupPath: String(backup.path || '').trim()
  });
  const security = payload.security || {};
  Object.assign(values, {
    passwordlessLogin: security.passwordlessLogin === true
  });
  const statement = db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [key, value] of Object.entries(values)) statement.run(key, JSON.stringify(value));
    db.exec('COMMIT');
    return getAppSettings();
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { getAppSettings, getCurrencyInputFactor, saveAppSettings };
