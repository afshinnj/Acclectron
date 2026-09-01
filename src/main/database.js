const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { calculateSaleTotals } = require('./domain/sales');
const { normalizePersianText } = require('./importer');

let database;

function tableColumns(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));
}

function addColumnIfMissing(db, tableName, columnName, definition) {
  if (!tableColumns(db, tableName).has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function getDatabase(userDataPath) {
  if (database) return database;
  const dataDirectory = userDataPath || path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDirectory, { recursive: true });
  database = new DatabaseSync(path.join(dataDirectory, 'accletron.db'));
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      barcode TEXT UNIQUE,
      sale_price INTEGER NOT NULL DEFAULT 0,
      stock REAL NOT NULL DEFAULT 0,
      minimum_stock REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      balance INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT NOT NULL UNIQUE,
      customer_id INTEGER REFERENCES customers(id),
      party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL,
      party_name TEXT,
      party_phone TEXT,
      party_address TEXT,
      date TEXT NOT NULL,
      subtotal INTEGER NOT NULL,
      discount INTEGER NOT NULL DEFAULT 0,
      tax INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL,
      paid_amount INTEGER NOT NULL DEFAULT 0,
      remaining_amount INTEGER NOT NULL DEFAULT 0,
      cost_total INTEGER NOT NULL DEFAULT 0,
      profit_total INTEGER NOT NULL DEFAULT 0,
      item_count INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'invoice',
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL,
      unit_price INTEGER NOT NULL,
      discount INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL,
      purchase_price INTEGER NOT NULL DEFAULT 0,
      profit INTEGER NOT NULL DEFAULT 0,
      price_type TEXT NOT NULL DEFAULT 'retail'
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      reference_type TEXT,
      reference_id INTEGER,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Foundation tables are additive so an existing database is never destroyed.
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      symbol TEXT,
      decimals INTEGER NOT NULL DEFAULT 0,
      allow_fraction INTEGER NOT NULL DEFAULT 0 CHECK (allow_fraction IN (0, 1)),
      base_unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
      conversion_factor REAL NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      phone TEXT,
      mobile TEXT,
      address TEXT,
      description TEXT,
      balance INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS parties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      first_name TEXT NOT NULL CHECK (length(trim(first_name)) > 0),
      last_name TEXT,
      phone TEXT,
      mobile TEXT,
      address TEXT,
      party_type TEXT NOT NULL CHECK (party_type IN ('customer', 'supplier', 'both')),
      description TEXT,
      balance INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT NOT NULL UNIQUE,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL,
      party_name TEXT,
      party_phone TEXT,
      party_address TEXT,
      date TEXT NOT NULL,
      subtotal INTEGER NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
      discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
      tax INTEGER NOT NULL DEFAULT 0 CHECK (tax >= 0),
      total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
      paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
      remaining_amount INTEGER NOT NULL DEFAULT 0 CHECK (remaining_amount >= 0),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed', 'cancelled')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
      discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
      total INTEGER NOT NULL CHECK (total >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS invoice_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
      purchase_id INTEGER REFERENCES purchases(id) ON DELETE CASCADE,
      method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'check', 'credit')),
      amount INTEGER NOT NULL CHECK (amount > 0),
      paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      check_number TEXT,
      bank_name TEXT,
      due_date TEXT,
      check_holder TEXT,
      check_status TEXT CHECK (check_status IN ('pending', 'cleared', 'bounced', 'cancelled')),
      notes TEXT,
      CHECK ((sale_id IS NOT NULL AND purchase_id IS NULL) OR (sale_id IS NULL AND purchase_id IS NOT NULL)),
      CHECK ((method = 'check' AND check_number IS NOT NULL) OR method <> 'check')
    );
    CREATE TRIGGER IF NOT EXISTS prevent_completed_purchase_delete
    BEFORE DELETE ON purchases
    WHEN OLD.status = 'completed'
    BEGIN
      SELECT RAISE(ABORT, 'completed purchases cannot be deleted');
    END;
    CREATE TRIGGER IF NOT EXISTS prevent_completed_purchase_update
    BEFORE UPDATE OF invoice_number, supplier_id, date, subtotal, discount, tax, total, paid_amount, remaining_amount
    ON purchases
    WHEN OLD.status = 'completed'
    BEGIN
      SELECT RAISE(ABORT, 'completed purchases are immutable');
    END;
    CREATE TRIGGER IF NOT EXISTS prevent_completed_purchase_item_update
    BEFORE UPDATE OF quantity, unit_price, discount, total ON purchase_items
    WHEN EXISTS (SELECT 1 FROM purchases WHERE id = OLD.purchase_id AND status = 'completed')
    BEGIN
      SELECT RAISE(ABORT, 'completed purchase items are immutable');
    END;
  `);

  addColumnIfMissing(database, 'products', 'category_id', 'INTEGER REFERENCES categories(id) ON DELETE SET NULL');
  addColumnIfMissing(database, 'categories', 'code', 'TEXT');
  addColumnIfMissing(database, 'products', 'purchase_price', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'products', 'wholesale_price', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'products', 'retail_price', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'products', 'unit_id', 'INTEGER REFERENCES units(id) ON DELETE SET NULL');
  addColumnIfMissing(database, 'products', 'description', 'TEXT');
  addColumnIfMissing(database, 'units', 'decimals', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'units', 'allow_fraction', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'units', 'base_unit_id', 'INTEGER REFERENCES units(id) ON DELETE SET NULL');
  addColumnIfMissing(database, 'units', 'conversion_factor', 'REAL NOT NULL DEFAULT 1');
  // SQLite cannot add a non-constant default to a populated table; backfill
  // timestamp columns after adding them as plain TEXT columns.
  addColumnIfMissing(database, 'products', 'updated_at', 'TEXT');
  addColumnIfMissing(database, 'customers', 'updated_at', 'TEXT');
  addColumnIfMissing(database, 'sales', 'updated_at', 'TEXT');
  addColumnIfMissing(database, 'sales', 'cost_total', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'sales', 'profit_total', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'sales', 'item_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'sales', "source", "TEXT NOT NULL DEFAULT 'invoice'");
  addColumnIfMissing(database, 'sales', 'party_id', 'INTEGER REFERENCES parties(id) ON DELETE SET NULL');
  addColumnIfMissing(database, 'sales', 'party_name', 'TEXT');
  addColumnIfMissing(database, 'sales', 'party_phone', 'TEXT');
  addColumnIfMissing(database, 'sales', 'party_address', 'TEXT');
  addColumnIfMissing(database, 'purchases', 'party_id', 'INTEGER REFERENCES parties(id) ON DELETE SET NULL');
  addColumnIfMissing(database, 'purchases', 'party_name', 'TEXT');
  addColumnIfMissing(database, 'purchases', 'party_phone', 'TEXT');
  addColumnIfMissing(database, 'purchases', 'party_address', 'TEXT');
  addColumnIfMissing(database, 'sale_items', 'created_at', 'TEXT');
  addColumnIfMissing(database, 'sale_items', 'updated_at', 'TEXT');
  addColumnIfMissing(database, 'sale_items', 'purchase_price', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'sale_items', 'profit', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'sale_items', 'price_type', "TEXT NOT NULL DEFAULT 'retail'");
  addColumnIfMissing(database, 'stock_movements', 'description', 'TEXT');

  database.exec(`
    UPDATE categories SET code = CAST(id AS TEXT) WHERE code IS NULL OR trim(code) = '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_code ON categories(code);
    UPDATE products SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP);
    UPDATE customers SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP);
    INSERT INTO parties (code, first_name, phone, party_type, balance, is_active, created_at, updated_at)
    SELECT c.code, c.name, c.phone, 'customer', c.balance, c.is_active,
      COALESCE(c.created_at, CURRENT_TIMESTAMP), COALESCE(c.updated_at, c.created_at, CURRENT_TIMESTAMP)
    FROM customers c
    WHERE NOT EXISTS (SELECT 1 FROM parties p WHERE p.code = c.code);
    INSERT INTO parties (code, first_name, phone, mobile, address, party_type, balance, is_active, created_at, updated_at)
    SELECT s.code, s.name, s.phone, s.mobile, s.address, 'supplier', s.balance, s.is_active,
      COALESCE(s.created_at, CURRENT_TIMESTAMP), COALESCE(s.updated_at, s.created_at, CURRENT_TIMESTAMP)
    FROM suppliers s
    WHERE NOT EXISTS (SELECT 1 FROM parties p WHERE p.code = s.code);
    UPDATE sales SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP);
    UPDATE sale_items SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP);
    UPDATE sale_items SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP);
    UPDATE products SET retail_price = sale_price
    WHERE retail_price = 0 AND sale_price <> 0;
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date);
    CREATE INDEX IF NOT EXISTS idx_purchases_supplier_id ON purchases(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON purchase_items(purchase_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_items_product_id ON purchase_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_payments_sale_id ON invoice_payments(sale_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_payments_purchase_id ON invoice_payments(purchase_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_payments_due_date ON invoice_payments(due_date);
    CREATE INDEX IF NOT EXISTS idx_sales_invoice_number ON sales(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
    CREATE INDEX IF NOT EXISTS idx_purchases_invoice_number ON purchases(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_product_id ON stock_movements(product_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at);
    CREATE INDEX IF NOT EXISTS idx_parties_name ON parties(first_name, last_name);
    CREATE INDEX IF NOT EXISTS idx_parties_phone ON parties(phone);
    CREATE INDEX IF NOT EXISTS idx_parties_type ON parties(party_type);
  `);
  const unitCount = database.prepare('SELECT COUNT(*) AS count FROM units').get().count;
  if (unitCount === 0) {
    const insertUnit = database.prepare('INSERT INTO units (name, symbol, decimals, allow_fraction) VALUES (?, ?, ?, ?)');
    insertUnit.run('عدد', 'عدد', 0, 0);
    insertUnit.run('متر', 'م', 2, 1);
    insertUnit.run('سانتی‌متر', 'cm', 2, 1);
    insertUnit.run('کیلوگرم', 'کیلو', 3, 1);
    insertUnit.run('گرم', 'گرم', 0, 0);
    insertUnit.run('لیتر', 'لیتر', 2, 1);
    insertUnit.run('بسته', 'بسته', 0, 0);
    insertUnit.run('کارتن', 'کارتن', 0, 0);
  }
  database.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(1);

  const count = database.prepare('SELECT COUNT(*) AS count FROM products').get().count;
  if (count === 0) {
    const insert = database.prepare(
      'INSERT INTO products (code, name, barcode, sale_price, stock, minimum_stock) VALUES (?, ?, ?, ?, ?, ?)'
    );
    insert.run('P-1001', 'دفتر یادداشت', '6260000000011', 8500000, 24, 5);
    insert.run('P-1002', 'خودکار آبی', '6260000000028', 3500000, 8, 10);
    insert.run('P-1003', 'پوشه اداری', '6260000000035', 12000000, 16, 4);
  }
  const customerCount = database.prepare('SELECT COUNT(*) AS count FROM customers').get().count;
  if (customerCount === 0) {
    database.prepare('INSERT INTO customers (code, name, phone) VALUES (?, ?, ?)').run(
      'C-0001',
      'مشتری عمومی',
      ''
    );
  }
  return database;
}

function requireDatabase() {
  if (!database) getDatabase();
  return database;
}

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
      name: String(settings.currencyName || 'تومان'),
      symbol: String(settings.currencySymbol || 'تومان'),
      position: String(settings.currencyPosition || 'suffix'),
      decimals: Math.max(0, Math.min(4, Number(settings.currencyDecimals ?? 0))),
      separator: settings.currencySeparator !== false,
      rounding: String(settings.currencyRounding || 'none'),
      inputUnit: String(settings.currencyInputUnit || 'toman')
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
      calendar: String(settings.calendar || 'gregorian'),
      fontScale: Number(settings.fontScale || 100),
      notifications: settings.notifications !== false,
      shortcuts: settings.shortcuts !== false
    }
    ,backup: {
      auto: settings.backupAuto === true,
      frequency: String(settings.backupFrequency || 'daily'),
      path: String(settings.backupPath || '')
    }
  };
}

function saveAppSettings(payload = {}) {
  const db = requireDatabase();
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
    currencyName: String(currency.name || 'تومان').trim(),
    currencySymbol: String(currency.symbol || 'تومان').trim(),
    currencyPosition: ['prefix', 'suffix'].includes(String(currency.position)) ? String(currency.position) : 'suffix',
    currencyDecimals: Math.max(0, Math.min(4, Number(currency.decimals || 0))),
    currencySeparator: currency.separator !== false,
    currencyRounding: ['none', '100', '1000'].includes(String(currency.rounding)) ? String(currency.rounding) : 'none',
    currencyInputUnit: String(currency.inputUnit || 'toman')
  });
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
    theme: ['dark', 'light', 'system'].includes(String(appearance.theme)) ? String(appearance.theme) : 'dark',
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

function searchProducts(query = '') {
  const db = requireDatabase();
  const normalizeSearch = (value) => normalizePersianText(String(value ?? ''))
    .replace(/[يى]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[\u06F0-\u06F9]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .toLowerCase()
    .trim();
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const rows = db.prepare(`
    SELECT p.id, p.code, p.name, p.barcode,
      CASE WHEN p.retail_price > 0 THEN p.retail_price ELSE p.sale_price END AS salePrice,
      p.purchase_price AS purchasePrice, p.wholesale_price AS wholesalePrice,
      p.stock, p.minimum_stock AS minimumStock, p.category_id AS categoryId, p.unit_id AS unitId,
      COALESCE(SUM(CASE WHEN s.status = 'active' THEN si.quantity ELSE 0 END), 0) AS soldQuantity
    FROM products p
    LEFT JOIN sale_items si ON si.product_id = p.id
    LEFT JOIN sales s ON s.id = si.sale_id
    WHERE p.is_active = 1
    GROUP BY p.id
  `).all();
  return rows
    .map((row) => {
      const searchable = normalizeSearch([row.name, row.code, row.barcode].filter(Boolean).join(' '));
      const matches = tokens.every((token) => searchable.includes(token));
      const exact = tokens.length && normalizeSearch(row.name) === tokens.join(' ') ? 3 : 0;
      const starts = tokens.length && normalizeSearch(row.name).startsWith(tokens[0]) ? 1 : 0;
      return { ...row, soldQuantity: Number(row.soldQuantity || 0), _matches: matches, _score: exact + starts };
    })
    .filter((row) => row._matches)
    .sort((a, b) => b._score - a._score || b.soldQuantity - a.soldQuantity || String(a.name).localeCompare(String(b.name), 'fa'))
    .map(({ _matches, _score, ...row }) => row);
}

function listProducts(query = '', categoryId = '') {
  const db = requireDatabase();
  const term = `%${String(query).trim()}%`;
  const category = categoryId ? Number(categoryId) : null;
  return db.prepare(`
    SELECT p.id, p.code, p.name, p.barcode,
      p.sale_price AS salePrice, p.purchase_price AS purchasePrice,
      p.wholesale_price AS wholesalePrice, p.stock,
      p.minimum_stock AS minimumStock, p.category_id AS categoryId,
      p.unit_id AS unitId, p.description, p.is_active AS isActive,
      c.name AS categoryName, u.name AS unitName, u.symbol AS unitSymbol,
      p.created_at AS createdAt, p.updated_at AS updatedAt
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN units u ON u.id = p.unit_id
    WHERE (? = 1 OR p.is_active = 1)
      AND (p.name LIKE ? OR p.code LIKE ? OR COALESCE(p.barcode, '') LIKE ?)
      AND (? IS NULL OR p.category_id = ?)
    ORDER BY p.is_active DESC, p.name COLLATE NOCASE
  `).all(1, term, term, term, category, category);
}

function listCategories(includeInactive = false) {
  const db = requireDatabase();
  return db.prepare(`
    SELECT c.id, c.code, c.name, c.description, c.is_active AS isActive,
      c.created_at AS createdAt, c.updated_at AS updatedAt,
      COUNT(CASE WHEN p.is_active = 1 THEN 1 END) AS productCount
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id
    WHERE (? = 1 OR c.is_active = 1)
    GROUP BY c.id
    ORDER BY c.is_active DESC, c.name COLLATE NOCASE
  `).all(includeInactive ? 1 : 0);
}

function listUnits() {
  const db = requireDatabase();
  return db.prepare(`
    SELECT id, name, symbol, decimals, allow_fraction AS allowFraction,
      base_unit_id AS baseUnitId, conversion_factor AS conversionFactor, is_active AS isActive
    FROM units
    WHERE is_active = 1
    ORDER BY name COLLATE NOCASE
  `).all();
}

function createUnit(payload = {}) {
  const db = requireDatabase();
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('نام واحد الزامی است.');
  const decimals = Math.max(0, Math.min(6, Number(payload.decimals || 0)));
  const factor = Number(payload.conversionFactor || 1);
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('ضریب تبدیل باید بزرگ‌تر از صفر باشد.');
  const result = db.prepare(`INSERT INTO units (name, symbol, decimals, allow_fraction, base_unit_id, conversion_factor, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(
    name, String(payload.symbol || '').trim(), decimals, payload.allowFraction ? 1 : 0,
    payload.baseUnitId ? Number(payload.baseUnitId) : null, factor
  );
  return listUnits().find((unit) => unit.id === Number(result.lastInsertRowid));
}

function updateUnit(id, payload = {}) {
  const db = requireDatabase();
  const unitId = Number(id);
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('نام واحد الزامی است.');
  const decimals = Math.max(0, Math.min(6, Number(payload.decimals || 0)));
  const factor = Number(payload.conversionFactor || 1);
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('ضریب تبدیل باید بزرگ‌تر از صفر باشد.');
  const result = db.prepare(`UPDATE units SET name = ?, symbol = ?, decimals = ?, allow_fraction = ?,
    base_unit_id = ?, conversion_factor = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    name, String(payload.symbol || '').trim(), decimals, payload.allowFraction ? 1 : 0,
    payload.baseUnitId ? Number(payload.baseUnitId) : null, factor, unitId
  );
  if (!result.changes) throw new Error('واحد پیدا نشد.');
  return listUnits().find((unit) => unit.id === unitId);
}

function setUnitActive(id, active = false) {
  const db = requireDatabase();
  const result = db.prepare('UPDATE units SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(active ? 1 : 0, Number(id));
  if (!result.changes) throw new Error('واحد پیدا نشد.');
  return listUnits().find((unit) => unit.id === Number(id));
}

function normalizeProductPayload(payload = {}) {
  const name = String(payload.name || '').trim();
  const barcode = String(payload.barcode || '').trim() || null;
  if (!name) throw new Error('نام کالا الزامی است.');
  const categoryId = payload.categoryId ? Number(payload.categoryId) : null;
  if (!categoryId) throw new Error('انتخاب دسته‌بندی برای کالا الزامی است.');
  if (!Number.isInteger(categoryId) || categoryId <= 0) throw new Error('دسته‌بندی انتخاب‌شده معتبر نیست.');
  const stock = Number(payload.stock ?? 0);
  const minimumStock = Number(payload.minimumStock ?? 0);
  const prices = ['purchasePrice', 'wholesalePrice', 'retailPrice'].map((key) => Math.round(Number(payload[key]) || 0));
  if (![stock, minimumStock].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error('موجودی و حداقل موجودی باید عدد معتبر باشند.');
  }
  if (prices.some((value) => value < 0)) throw new Error('قیمت‌ها نمی‌توانند منفی باشند.');
  return {
    name, barcode,
    categoryId,
    unitId: payload.unitId ? Number(payload.unitId) : null,
    purchasePrice: prices[0],
    wholesalePrice: prices[1],
    retailPrice: prices[2],
    stock,
    minimumStock,
    description: String(payload.description || '').trim()
  };
}

function getCategoryCode(categoryId) {
  if (!categoryId) return '0';
  const category = requireDatabase().prepare('SELECT code, is_active AS isActive FROM categories WHERE id = ?').get(categoryId);
  if (!category || !category.isActive) throw new Error('دسته‌بندی انتخاب‌شده فعال نیست.');
  const code = String(category.code || '').trim();
  if (!/^\d+$/.test(code)) throw new Error('کد دسته‌بندی باید عددی باشد.');
  return code;
}

function generateProductCode(categoryId, excludeId = null) {
  const db = requireDatabase();
  const prefix = getCategoryCode(categoryId);
  const rows = db.prepare('SELECT code FROM products WHERE code LIKE ?' + (excludeId ? ' AND id <> ?' : '')).all(...(excludeId ? [`${prefix}%`, excludeId] : [`${prefix}%`]));
  let sequence = 1;
  for (const row of rows) {
    const suffix = String(row.code).slice(prefix.length);
    const parsed = Number(suffix);
    if (suffix && /^\d+$/.test(suffix) && Number.isInteger(parsed)) sequence = Math.max(sequence, parsed + 1);
  }
  return `${prefix}${String(sequence).padStart(3, '0')}`;
}

function generateCategoryCode() {
  const db = requireDatabase();
  const rows = db.prepare('SELECT code FROM categories').all();
  let sequence = 1;
  for (const row of rows) {
    const code = String(row.code || '').trim();
    if (/^\d+$/.test(code)) sequence = Math.max(sequence, Number(code) + 1);
  }
  return String(sequence);
}

function previewProductImport(rows = []) {
  const db = requireDatabase();
  const categories = db.prepare('SELECT id, name, code FROM categories WHERE is_active = 1').all();
  const categoryByName = new Map(categories.map((category) => [normalizePersianText(category.name), category]));
  const existingNames = new Set(
    db.prepare('SELECT name, category_id AS categoryId FROM products').all()
      .map((product) => `${normalizePersianText(product.name)}|${product.categoryId || ''}`)
  );
  const categoryNames = [...new Set(rows.map((row) => row.category))];
  const missingCategories = categoryNames.filter((name) => !categoryByName.has(normalizePersianText(name)));
  const duplicateRows = rows.filter((row) => {
    const category = categoryByName.get(normalizePersianText(row.category));
    return existingNames.has(`${normalizePersianText(row.name)}|${category?.id || ''}`);
  });
  const priceWarnings = rows.filter((row) =>
    row.purchasePrice === 0 || row.wholesalePrice === 0 || row.retailPrice === 0 ||
    (row.purchasePrice > 0 && row.wholesalePrice > 0 && row.retailPrice > 0 &&
      (row.purchasePrice > row.wholesalePrice || row.wholesalePrice > row.retailPrice))
  );
  return {
    total: rows.length,
    categoryCount: categoryNames.length,
    missingCategories,
    duplicateCount: duplicateRows.length,
    priceWarningCount: priceWarnings.length,
    sample: rows.slice(0, 8)
  };
}

function importProducts(rows = [], duplicateMode = 'skip') {
  const db = requireDatabase();
  if (!Array.isArray(rows) || !rows.length) throw new Error('محصولی برای ورود وجود ندارد.');
  const result = { imported: 0, skipped: 0, categoriesCreated: 0, duplicates: [], errors: [] };
  db.exec('BEGIN IMMEDIATE');
  try {
    const categoryRows = db.prepare('SELECT id, name, code FROM categories WHERE is_active = 1').all();
    const categoryByName = new Map(categoryRows.map((category) => [normalizePersianText(category.name), category]));
    const existingNames = new Set(
      db.prepare('SELECT name, category_id AS categoryId FROM products').all()
        .map((product) => `${normalizePersianText(product.name)}|${product.categoryId || ''}`)
    );
    const insertCategory = db.prepare(
      'INSERT INTO categories (code, name, description, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
    );
    const insertProduct = db.prepare(`
      INSERT INTO products
        (code, name, barcode, sale_price, purchase_price, wholesale_price, retail_price,
         stock, minimum_stock, category_id, unit_id, description, updated_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 0, ?, NULL, '', CURRENT_TIMESTAMP)
    `);

    for (const row of rows) {
      try {
        const categoryName = normalizePersianText(row.category);
        const name = normalizePersianText(row.name);
        if (!categoryName || !name) throw new Error('دسته‌بندی یا نام کالا خالی است.');
        let category = categoryByName.get(categoryName);
        if (!category) {
          const categoryResult = insertCategory.run(generateCategoryCode(), categoryName, '');
          category = { id: Number(categoryResult.lastInsertRowid), name: categoryName };
          categoryByName.set(categoryName, category);
          result.categoriesCreated += 1;
        }
        const duplicateKey = `${name}|${category.id}`;
        const stock = Number(row.stock);
        const purchasePrice = Math.round(Number(row.purchasePrice) * 100);
        const wholesalePrice = Math.round(Number(row.wholesalePrice) * 100);
        const retailPrice = Math.round(Number(row.retailPrice) * 100);
        if (existingNames.has(duplicateKey)) {
          const existing = db.prepare('SELECT id FROM products WHERE name = ? AND category_id = ? LIMIT 1')
            .get(name, category.id);
          if (duplicateMode === 'update' && existing) {
            db.prepare(`
              UPDATE products SET sale_price = ?, purchase_price = ?, wholesale_price = ?,
                retail_price = ?, stock = ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(retailPrice, purchasePrice, wholesalePrice, retailPrice, stock, existing.id);
            result.updated = (result.updated || 0) + 1;
          } else {
            result.skipped += 1;
            result.duplicates.push({ row: row.sourceRow, name, category: categoryName });
          }
          continue;
        }
        insertProduct.run(
          generateProductCode(category.id), name, retailPrice, purchasePrice,
          wholesalePrice, retailPrice, stock, category.id
        );
        existingNames.add(duplicateKey);
        result.imported += 1;
      } catch (error) {
        result.errors.push({ row: row.sourceRow, message: error.message });
      }
    }
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function createProduct(payload = {}) {
  const db = requireDatabase();
  const product = normalizeProductPayload(payload);
  try {
    const result = db.prepare(`
      INSERT INTO products
        (code, name, barcode, sale_price, purchase_price, wholesale_price, retail_price,
         stock, minimum_stock, category_id, unit_id, description, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      generateProductCode(product.categoryId), product.name, product.barcode, product.retailPrice,
      product.purchasePrice, product.wholesalePrice, product.retailPrice,
      product.stock, product.minimumStock, product.categoryId, product.unitId, product.description
    );
    return getProduct(Number(result.lastInsertRowid));
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new Error('کد یا بارکد کالا تکراری است.');
    throw error;
  }
}

function getProduct(id) {
  return listProducts('', '').find((product) => product.id === Number(id)) || null;
}

function updateProduct(id, payload = {}) {
  const db = requireDatabase();
  const product = normalizeProductPayload(payload);
  const productId = Number(id);
  const current = db.prepare('SELECT id, category_id AS categoryId, code FROM products WHERE id = ?').get(productId);
  if (!current) throw new Error('کالا پیدا نشد.');
  const nextCode = Number(current.categoryId) === Number(product.categoryId)
    ? current.code
    : generateProductCode(product.categoryId, productId);
  try {
    db.prepare(`
      UPDATE products SET
        code = ?, name = ?, barcode = ?, sale_price = ?, purchase_price = ?,
        wholesale_price = ?, retail_price = ?, stock = ?, minimum_stock = ?,
        category_id = ?, unit_id = ?, description = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nextCode, product.name, product.barcode, product.retailPrice,
      product.purchasePrice, product.wholesalePrice, product.retailPrice,
      product.stock, product.minimumStock, product.categoryId, product.unitId,
      product.description, productId
    );
    return getProduct(productId);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new Error('کد یا بارکد کالا تکراری است.');
    throw error;
  }
}

function updateProductQuick(id, payload = {}) {
  const db = requireDatabase();
  const productId = Number(id);
  const current = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!current) throw new Error('کالا پیدا نشد.');
  const purchasePrice = Math.max(0, Math.round(Number(payload.purchasePrice) || 0));
  const wholesalePrice = Math.max(0, Math.round(Number(payload.wholesalePrice) || 0));
  const retailPrice = Math.max(0, Math.round(Number(payload.retailPrice) || 0));
  const stock = Math.max(0, Number(payload.stock) || 0);
  db.prepare(`
    UPDATE products SET purchase_price = ?, wholesale_price = ?, retail_price = ?,
      sale_price = ?, stock = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(purchasePrice, wholesalePrice, retailPrice, retailPrice, stock, productId);
  return getProduct(productId);
}

function setProductActive(id, isActive = false) {
  const db = requireDatabase();
  const productId = Number(id);
  const result = db.prepare('UPDATE products SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(isActive ? 1 : 0, productId);
  if (!result.changes) throw new Error('کالا پیدا نشد.');
  return getProduct(productId);
}

function createCategory(payload = {}) {
  const db = requireDatabase();
  const name = String(payload.name || '').trim();
  const code = String(payload.code || '').trim();
  if (!name) throw new Error('نام دسته‌بندی الزامی است.');
  if (!/^\d{1,4}$/.test(code)) throw new Error('کد دسته‌بندی باید یک عدد ۱ تا ۴ رقمی باشد.');
  try {
    const result = db.prepare('INSERT INTO categories (code, name, description, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
      .run(code, name, String(payload.description || '').trim());
    return listCategories(true).find((category) => category.id === Number(result.lastInsertRowid));
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new Error('این دسته‌بندی قبلاً ثبت شده است.');
    throw error;
  }
}

function updateCategory(id, payload = {}) {
  const db = requireDatabase();
  const categoryId = Number(id);
  const name = String(payload.name || '').trim();
  const code = String(payload.code || '').trim();
  if (!name) throw new Error('نام دسته‌بندی الزامی است.');
  if (!/^\d{1,4}$/.test(code)) throw new Error('کد دسته‌بندی باید یک عدد ۱ تا ۴ رقمی باشد.');
  const current = db.prepare('SELECT code FROM categories WHERE id = ?').get(categoryId);
  if (!current) throw new Error('دسته‌بندی پیدا نشد.');
  if (String(current.code) !== code && db.prepare('SELECT 1 FROM products WHERE category_id = ? LIMIT 1').get(categoryId)) {
    throw new Error('کد دسته‌بندی دارای کالا است و برای حفظ کد کالاها قابل تغییر نیست.');
  }
  const result = db.prepare('UPDATE categories SET code = ?, name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(code, name, String(payload.description || '').trim(), categoryId);
  if (!result.changes) throw new Error('دسته‌بندی پیدا نشد.');
  return listCategories(true).find((category) => category.id === categoryId);
}

function setCategoryActive(id, isActive = false) {
  const db = requireDatabase();
  const categoryId = Number(id);
  const result = db.prepare('UPDATE categories SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(isActive ? 1 : 0, categoryId);
  if (!result.changes) throw new Error('دسته‌بندی پیدا نشد.');
  return listCategories(true).find((category) => category.id === categoryId);
}

function listParties(query = '', type = '', includeInactive = true) {
  const db = requireDatabase();
  const term = `%${String(query).trim()}%`;
  const partyType = ['customer', 'supplier', 'both'].includes(String(type)) ? String(type) : '';
  return db.prepare(`
    SELECT id, code, first_name AS firstName, last_name AS lastName,
      trim(first_name || ' ' || COALESCE(last_name, '')) AS name,
      phone, mobile, address, party_type AS partyType, description,
      balance, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
    FROM parties
    WHERE (? = 1 OR is_active = 1)
      AND (? = '' OR party_type = ?)
      AND (
        first_name LIKE ? OR COALESCE(last_name, '') LIKE ? OR
        trim(first_name || ' ' || COALESCE(last_name, '')) LIKE ? OR
        code LIKE ? OR COALESCE(phone, '') LIKE ? OR COALESCE(mobile, '') LIKE ?
      )
    ORDER BY is_active DESC, first_name COLLATE NOCASE, last_name COLLATE NOCASE
  `).all(includeInactive ? 1 : 0, partyType, partyType, term, term, term, term, term, term);
}

function normalizePartyPayload(payload = {}) {
  const firstName = String(payload.firstName || '').trim();
  const lastName = String(payload.lastName || '').trim();
  const partyType = String(payload.partyType || '').trim();
  if (!firstName) throw new Error('نام طرف حساب الزامی است.');
  if (!['customer', 'supplier', 'both'].includes(partyType)) throw new Error('نوع طرف حساب معتبر نیست.');
  return {
    firstName,
    lastName,
    phone: String(payload.phone || '').trim(),
    mobile: String(payload.mobile || '').trim(),
    address: String(payload.address || '').trim(),
    partyType,
    description: String(payload.description || '').trim()
  };
}

function generatePartyCode(excludeId = null) {
  const db = requireDatabase();
  const rows = db.prepare(
    'SELECT code FROM parties WHERE code LIKE ?' + (excludeId ? ' AND id <> ?' : '')
  ).all(...(excludeId ? ['PT-%', excludeId] : ['PT-%']));
  let sequence = 1;
  for (const row of rows) {
    const match = /^PT-(\d+)$/.exec(String(row.code));
    if (match) sequence = Math.max(sequence, Number(match[1]) + 1);
  }
  return `PT-${String(sequence).padStart(4, '0')}`;
}

function createParty(payload = {}) {
  const db = requireDatabase();
  const party = normalizePartyPayload(payload);
  const result = db.prepare(`
    INSERT INTO parties
      (code, first_name, last_name, phone, mobile, address, party_type, description, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    generatePartyCode(), party.firstName, party.lastName, party.phone, party.mobile,
    party.address, party.partyType, party.description
  );
  return listParties('', '', true).find((item) => item.id === Number(result.lastInsertRowid));
}

function updateParty(id, payload = {}) {
  const db = requireDatabase();
  const partyId = Number(id);
  const party = normalizePartyPayload(payload);
  const result = db.prepare(`
    UPDATE parties SET first_name = ?, last_name = ?, phone = ?, mobile = ?,
      address = ?, party_type = ?, description = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    party.firstName, party.lastName, party.phone, party.mobile,
    party.address, party.partyType, party.description, partyId
  );
  if (!result.changes) throw new Error('طرف حساب پیدا نشد.');
  return listParties('', '', true).find((item) => item.id === partyId);
}

function setPartyActive(id, isActive = false) {
  const db = requireDatabase();
  const partyId = Number(id);
  const result = db.prepare('UPDATE parties SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(isActive ? 1 : 0, partyId);
  if (!result.changes) throw new Error('طرف حساب پیدا نشد.');
  return listParties('', '', true).find((item) => item.id === partyId);
}

function searchCustomers(query = '') {
  const db = requireDatabase();
  const term = `%${String(query).trim()}%`;
  return db.prepare(`
    SELECT id, code, name, phone, balance
    FROM customers
    WHERE is_active = 1 AND (name LIKE ? OR code LIKE ? OR phone LIKE ?)
    ORDER BY name LIMIT 30
  `).all(term, term, term);
}

function getDashboardSummary() {
  const db = requireDatabase();
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const todaySales = db.prepare(
    "SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS count FROM sales WHERE status = 'active' AND date = ?"
  ).get(today);
  const monthSales = db.prepare(
    "SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE status = 'active' AND substr(date, 1, 7) = ?"
  ).get(month);
  const inventory = db.prepare('SELECT COALESCE(SUM(stock), 0) AS stock, COUNT(*) AS count FROM products WHERE is_active = 1').get();
  const lowStock = db.prepare(
    'SELECT COUNT(*) AS count FROM products WHERE is_active = 1 AND stock <= minimum_stock'
  ).get();
  return {
    todaySales: Number(todaySales.total),
    todayCount: Number(todaySales.count),
    monthSales: Number(monthSales.total),
    inventory: Number(inventory.stock),
    productCount: Number(inventory.count),
    lowStock: Number(lowStock.count)
  };
}

function getSalesReport(payload = {}) {
  const db = requireDatabase();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.from || '')) ? String(payload.from) : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.to || '')) ? String(payload.to) : '';
  const source = ['daily', 'invoice'].includes(String(payload.source || '')) ? String(payload.source) : '';
  const conditions = ["s.status = 'active'"];
  const params = [];
  if (from) { conditions.push('s.date >= ?'); params.push(from); }
  if (to) { conditions.push('s.date <= ?'); params.push(to); }
  if (source) { conditions.push('s.source = ?'); params.push(source); }
  const where = conditions.join(' AND ');
  const summary = db.prepare(`
    SELECT COUNT(*) AS invoiceCount,
      COALESCE(SUM(CASE WHEN s.source = 'daily' THEN 1 ELSE 0 END), 0) AS dailyCount,
      COALESCE(SUM(CASE WHEN s.source = 'invoice' THEN 1 ELSE 0 END), 0) AS formalCount,
      COALESCE(SUM(s.item_count), 0) AS itemCount,
      COALESCE(SUM(s.subtotal), 0) AS subtotal,
      COALESCE(SUM(s.discount), 0) AS discount,
      COALESCE(SUM(s.tax), 0) AS tax,
      COALESCE(SUM(s.total), 0) AS total,
      COALESCE(SUM(CASE WHEN s.total > s.tax THEN s.total - s.tax ELSE 0 END), 0) AS netSales,
      COALESCE(SUM(s.paid_amount), 0) AS paidAmount,
      COALESCE(SUM(s.remaining_amount), 0) AS remainingAmount,
      COALESCE(SUM(s.cost_total), 0) AS costTotal,
      COALESCE(SUM(CASE WHEN s.total > s.tax THEN s.total - s.tax ELSE 0 END - s.cost_total), 0) AS profitTotal
    FROM sales s WHERE ${where}
  `).get(...params);
  const byDate = db.prepare(`
    SELECT s.date,
      COUNT(*) AS invoiceCount,
      COALESCE(SUM(s.item_count), 0) AS itemCount,
      COALESCE(SUM(s.total), 0) AS total,
      COALESCE(SUM(CASE WHEN s.total > s.tax THEN s.total - s.tax ELSE 0 END), 0) AS netSales,
      COALESCE(SUM(s.cost_total), 0) AS costTotal,
      COALESCE(SUM(CASE WHEN s.total > s.tax THEN s.total - s.tax ELSE 0 END - s.cost_total), 0) AS profitTotal,
      COALESCE(SUM(CASE WHEN s.source = 'daily' THEN 1 ELSE 0 END), 0) AS dailyCount,
      COALESCE(SUM(CASE WHEN s.source = 'invoice' THEN 1 ELSE 0 END), 0) AS formalCount
    FROM sales s WHERE ${where}
    GROUP BY s.date ORDER BY s.date
  `).all(...params);
  const bySource = db.prepare(`
    SELECT s.source,
      COUNT(*) AS invoiceCount, COALESCE(SUM(s.total), 0) AS total,
      COALESCE(SUM(CASE WHEN s.total > s.tax THEN s.total - s.tax ELSE 0 END), 0) AS netSales,
      COALESCE(SUM(s.cost_total), 0) AS costTotal,
      COALESCE(SUM(CASE WHEN s.total > s.tax THEN s.total - s.tax ELSE 0 END - s.cost_total), 0) AS profitTotal
    FROM sales s WHERE ${where}
    GROUP BY s.source ORDER BY s.source
  `).all(...params);
  const byProduct = db.prepare(`
    WITH item_totals AS (
      SELECT sale_id, SUM(total) AS itemSubtotal
      FROM sale_items GROUP BY sale_id
    )
    SELECT p.id AS productId, p.name, p.code,
      COALESCE(c.name, '') AS categoryName,
      COALESCE(SUM(si.quantity), 0) AS quantity,
      COALESCE(SUM(si.total), 0) AS netSales,
      COALESCE(SUM(si.purchase_price * si.quantity), 0) AS costTotal,
      COALESCE(SUM(
        si.total - (si.purchase_price * si.quantity) -
        CASE WHEN it.itemSubtotal > 0
          THEN MIN(MAX(s.discount, 0), it.itemSubtotal) * si.total / it.itemSubtotal
          ELSE 0 END
      ), 0) AS profitTotal
    FROM sales s
    JOIN sale_items si ON si.sale_id = s.id
    JOIN products p ON p.id = si.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN item_totals it ON it.sale_id = s.id
    WHERE ${where}
    GROUP BY p.id, p.name, p.code, c.name
    ORDER BY netSales DESC LIMIT 20
  `).all(...params);
  const byCustomer = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(s.party_name), ''), 'مشتری متفرقه') AS customerName,
      COUNT(*) AS invoiceCount, COALESCE(SUM(s.total), 0) AS total,
      COALESCE(SUM(CASE WHEN s.total > s.tax THEN s.total - s.tax ELSE 0 END - s.cost_total), 0) AS profitTotal
    FROM sales s WHERE ${where}
    GROUP BY customerName ORDER BY total DESC LIMIT 10
  `).all(...params);
  const castRows = (rows) => rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, typeof value === 'number' ? Number(value) : value])
  ));
  return {
    filters: { from, to, source },
    summary: castRows([summary])[0],
    byDate: castRows(byDate),
    bySource: castRows(bySource),
    byProduct: castRows(byProduct),
    byCustomer: castRows(byCustomer)
  };
}

function normalizeInvoicePayments(payments, total, fallbackPaidAmount = 0) {
  const source = Array.isArray(payments) && payments.length
    ? payments
    : (Number(fallbackPaidAmount) > 0 ? [{ method: 'cash', amount: fallbackPaidAmount }] : []);
  const normalized = source.map((payment) => {
    const method = ['cash', 'card', 'check'].includes(String(payment.method)) ? String(payment.method) : 'cash';
    const amount = Math.max(0, Math.round(Number(payment.amount || payment.amountToman || 0) * 100));
    if (!amount) throw new Error('مبلغ پرداخت باید بیشتر از صفر باشد.');
    if (method === 'check' && !String(payment.checkNumber || '').trim()) {
      throw new Error('شماره چک برای پرداخت چکی الزامی است.');
    }
    return {
      method,
      amount,
      paidAt: String(payment.paidAt || new Date().toISOString()),
      checkNumber: String(payment.checkNumber || '').trim() || null,
      bankName: String(payment.bankName || '').trim() || null,
      dueDate: String(payment.dueDate || '').trim() || null,
      checkHolder: String(payment.checkHolder || '').trim() || null,
      checkStatus: method === 'check' ? (['pending', 'cleared', 'bounced', 'cancelled'].includes(String(payment.checkStatus)) ? String(payment.checkStatus) : 'pending') : null,
      notes: String(payment.notes || '').trim() || null
    };
  });
  const paidAmount = normalized.reduce((sum, payment) => sum + payment.amount, 0);
  if (paidAmount > total) throw new Error('مجموع پرداخت‌ها نمی‌تواند بیشتر از مبلغ فاکتور باشد.');
  return { payments: normalized, paidAmount, remainingAmount: total - paidAmount };
}

function insertInvoicePayments(db, invoiceColumn, invoiceId, payments) {
  if (!payments.length) return;
  const statement = db.prepare(`
    INSERT INTO invoice_payments
      (${invoiceColumn}, method, amount, paid_at, check_number, bank_name, due_date, check_holder, check_status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const payment of payments) {
    statement.run(
      invoiceId, payment.method, payment.amount, payment.paidAt, payment.checkNumber,
      payment.bankName, payment.dueDate, payment.checkHolder, payment.checkStatus, payment.notes
    );
  }
}

function normalizeInvoiceDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : new Date().toISOString().slice(0, 10);
}

function nextInvoiceNumber(db, kind, date) {
  const prefix = kind === 'sale' ? (getAppSettings().sales.invoicePrefix || 'S-') : 'P-';
  const year = String(gregorianToJalaliYear(date));
  const pattern = `${prefix}${year}-%`;
  const table = kind === 'sale' ? 'sales' : 'purchases';
  const rows = db.prepare(`SELECT invoice_number AS invoiceNumber FROM ${table} WHERE invoice_number LIKE ?`).all(pattern);
  const sequence = rows.reduce((max, row) => {
    const match = String(row.invoiceNumber).match(/-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  return `${prefix}${year}-${String(sequence).padStart(6, '0')}`;
}

function gregorianToJalaliYear(isoDate) {
  const [gy, gm, gd] = String(isoDate || '').split('-').map(Number);
  if (!gy || !gm || !gd) return new Date().getUTCFullYear() - 621;
  const monthDays = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jalaliYear = gy > 1600 ? 979 : 0;
  const gregorianBaseYear = gy > 1600 ? gy - 1600 : gy - 621;
  const leapYear = gm > 2 ? gregorianBaseYear + 1 : gregorianBaseYear;
  let days = (365 * gregorianBaseYear) + Math.floor((leapYear + 3) / 4) - Math.floor((leapYear + 99) / 100)
    + Math.floor((leapYear + 399) / 400) - 80 + gd + monthDays[gm - 1];
  jalaliYear += 33 * Math.floor(days / 12053);
  days %= 12053;
  jalaliYear += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) jalaliYear += Math.floor((days - 1) / 365);
  return jalaliYear;
}

function getNextInvoiceNumber(kind, date) {
  const db = requireDatabase();
  return nextInvoiceNumber(db, kind, normalizeInvoiceDate(date));
}

function getPartySnapshot(db, partyId, fallback = {}) {
  const party = partyId ? db.prepare(`
    SELECT id, trim(first_name || ' ' || COALESCE(last_name, '')) AS name,
      code, phone, mobile, address FROM parties WHERE id = ?
  `).get(Number(partyId)) : null;
  return {
    partyId: party?.id || null,
    partyName: String(party?.name || fallback.name || '').trim() || null,
    partyPhone: String(party?.phone || party?.mobile || fallback.phone || '').trim() || null,
    partyAddress: String(party?.address || fallback.address || '').trim() || null
  };
}

function priceSaleItems(pricedItems, discount, subtotal) {
  const effectiveDiscount = Math.min(Math.max(0, Number(discount) || 0), Math.max(0, Number(subtotal) || 0));
  let allocatedDiscount = 0;
  return pricedItems.map((item, index) => {
    const allocation = index === pricedItems.length - 1
      ? effectiveDiscount - allocatedDiscount
      : (subtotal > 0 ? Math.round(effectiveDiscount * item.total / subtotal) : 0);
    allocatedDiscount += allocation;
    return {
      ...item,
      profit: Math.round(item.total - allocation - (item.purchasePrice * item.quantity))
    };
  });
}

function rejectSalesBelowPurchasePrice(pricedItems) {
  const lossMakingItem = pricedItems.find((item) => item.profit < 0);
  if (!lossMakingItem) return;
  throw new Error(`قیمت فروش «${lossMakingItem.name}» نمی‌تواند کمتر از قیمت خرید باشد.`);
}

function getAvailableSaleProducts(db, items) {
  const requestedQuantities = new Map();
  for (const item of items) {
    const productId = Number(item.productId);
    requestedQuantities.set(productId, (requestedQuantities.get(productId) || 0) + Number(item.quantity || 0));
  }

  const findProduct = db.prepare(
    'SELECT id, name, stock, purchase_price AS purchasePrice FROM products WHERE id = ? AND is_active = 1'
  );
  const products = new Map();
  for (const [productId, requestedQuantity] of requestedQuantities) {
    const product = findProduct.get(productId);
    if (!product) throw new Error('کالای انتخاب‌شده پیدا نشد.');
    if (Number(product.stock) < requestedQuantity) {
      throw new Error(`موجودی «${product.name}» کافی نیست.`);
    }
    products.set(productId, product);
  }
  return products;
}

function createSale(payload = {}) {
  const db = requireDatabase();
  const baseTotals = calculateSaleTotals(payload.items, payload.discount, payload.tax, 0);
  const paymentTotals = normalizeInvoicePayments(payload.payments, baseTotals.total, payload.paidAmount);
  const totals = { ...baseTotals, ...paymentTotals };
  const customerId = payload.customerId ? Number(payload.customerId) : null;
  const party = getPartySnapshot(db, payload.partyId, { name: payload.partyName, phone: payload.partyPhone, address: payload.partyAddress });
  const partyId = party.partyId;
  const date = normalizeInvoiceDate(payload.date);
  const invoiceNumber = String(payload.invoiceNumber || '').trim()
    || nextInvoiceNumber(db, 'sale', date);

  db.exec('BEGIN IMMEDIATE');
  try {
    const products = getAvailableSaleProducts(db, totals.items);
    let pricedItems = totals.items.map((item) => {
      const product = products.get(item.productId);
      const purchasePrice = Number(product.purchasePrice || 0);
      return { ...item, name: product.name, purchasePrice };
    });
    pricedItems = priceSaleItems(pricedItems, totals.discount, totals.subtotal);
    rejectSalesBelowPurchasePrice(pricedItems);
    const costTotal = pricedItems.reduce((sum, item) => sum + Math.round(item.purchasePrice * item.quantity), 0);
    const profitTotal = pricedItems.reduce((sum, item) => sum + item.profit, 0);
    const itemCount = pricedItems.reduce((sum, item) => sum + item.quantity, 0);

    const sale = db.prepare(`
      INSERT INTO sales (invoice_number, customer_id, party_id, party_name, party_phone, party_address, date, subtotal, discount, tax, total, paid_amount, remaining_amount, cost_total, profit_total, item_count, source, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invoiceNumber,
      customerId,
      partyId,
      party.partyName,
      party.partyPhone,
      party.partyAddress,
      date,
      totals.subtotal,
      totals.discount,
      totals.tax,
      totals.total,
      totals.paidAmount,
      totals.remainingAmount,
      costTotal,
      profitTotal,
      itemCount,
      payload.source === 'daily' ? 'daily' : 'invoice',
      String(payload.notes || '')
    );
    const saleId = Number(sale.lastInsertRowid);
    const insertItem = db.prepare(
      'INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount, total, purchase_price, profit, price_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const updateStock = db.prepare('UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const movement = db.prepare(
      "INSERT INTO stock_movements (product_id, type, quantity, reference_type, reference_id) VALUES (?, 'sale', ?, 'sale', ?)"
    );
    for (const item of pricedItems) {
      insertItem.run(saleId, item.productId, item.quantity, item.unitPrice, item.discount, item.total, item.purchasePrice, item.profit, item.priceType || 'retail');
      updateStock.run(item.quantity, item.productId);
      movement.run(item.productId, -item.quantity, saleId);
    }
    insertInvoicePayments(db, 'sale_id', saleId, paymentTotals.payments);
    if (customerId && totals.remainingAmount > 0) {
      db.prepare('UPDATE customers SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(totals.remainingAmount, customerId);
    }
    if (partyId && totals.remainingAmount > 0) {
      db.prepare('UPDATE parties SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(totals.remainingAmount, partyId);
    }
    db.exec('COMMIT');
    return { id: saleId, invoiceNumber, costTotal, profitTotal, itemCount, ...totals };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function createPurchase(payload = {}) {
  const db = requireDatabase();
  const items = (payload.items || []).map((item) => {
    // Purchase quantities are whole inventory units in the invoice editor.
    // Normalize API payloads too so stock moves by whole units.
    const quantity = Math.max(1, Math.round(Number(item.quantity)));
    const unitPrice = Math.round(Number(item.unitPrice) || 0);
    const itemDiscount = Math.round(Number(item.discount) || 0);
    if (!Number.isFinite(quantity) || quantity <= 0 || unitPrice < 0 || itemDiscount < 0) {
      throw new Error('اقلام خرید نامعتبر است.');
    }
    return {
      productId: Number(item.productId),
      quantity,
      unitPrice,
      discount: itemDiscount,
      total: Math.max(0, Math.round(quantity * unitPrice) - itemDiscount)
    };
  });
  if (!items.length) throw new Error('خرید باید حداقل یک کالا داشته باشد.');

  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const discount = Math.max(0, Math.round(Number(payload.discount) || 0));
  const tax = Math.max(0, Math.round(Number(payload.tax) || 0));
  const total = Math.max(0, subtotal - discount + tax);
  const paymentTotals = normalizeInvoicePayments(payload.payments, total, Number(payload.paidAmount || 0) / 100);
  const paidAmount = paymentTotals.paidAmount;
  const date = normalizeInvoiceDate(payload.date);
  const invoiceNumber = String(payload.invoiceNumber || '').trim() || nextInvoiceNumber(db, 'purchase', date);
  const party = getPartySnapshot(db, payload.partyId, { name: payload.partyName, phone: payload.partyPhone, address: payload.partyAddress });
  const partyId = party.partyId;

  db.exec('BEGIN IMMEDIATE');
  try {
    const purchase = db.prepare(`
      INSERT INTO purchases
        (invoice_number, supplier_id, party_id, party_name, party_phone, party_address, date, subtotal, discount, tax, total, paid_amount, remaining_amount, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
    `).run(
      invoiceNumber,
      payload.supplierId ? Number(payload.supplierId) : null,
      partyId,
      party.partyName,
      party.partyPhone,
      party.partyAddress,
      date,
      subtotal,
      discount,
      tax,
      total,
      paidAmount,
      total - paidAmount,
      String(payload.notes || '')
    );
    const purchaseId = Number(purchase.lastInsertRowid);
    const insertItem = db.prepare(
      'INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_price, discount, total) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const updateProduct = db.prepare(
      'UPDATE products SET stock = stock + ?, purchase_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    );
    const movement = db.prepare(
      "INSERT INTO stock_movements (product_id, type, quantity, reference_type, reference_id, description) VALUES (?, 'purchase', ?, 'purchase', ?, ?)"
    );
    for (const item of items) {
      const product = db.prepare('SELECT id FROM products WHERE id = ? AND is_active = 1').get(item.productId);
      if (!product) throw new Error('کالای خرید پیدا نشد.');
      insertItem.run(purchaseId, item.productId, item.quantity, item.unitPrice, item.discount, item.total);
      updateProduct.run(item.quantity, item.unitPrice, item.productId);
      movement.run(item.productId, item.quantity, purchaseId, `Purchase ${invoiceNumber}`);
    }
    insertInvoicePayments(db, 'purchase_id', purchaseId, paymentTotals.payments);
    if (payload.supplierId && total - paidAmount > 0) {
      db.prepare('UPDATE suppliers SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(total - paidAmount, Number(payload.supplierId));
    }
    if (partyId && paymentTotals.remainingAmount > 0) {
      db.prepare('UPDATE parties SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(paymentTotals.remainingAmount, partyId);
    }
    db.exec('COMMIT');
    return { id: purchaseId, invoiceNumber, subtotal, discount, tax, total, paidAmount, remainingAmount: paymentTotals.remainingAmount, payments: paymentTotals.payments };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function invoiceListQuery(kind, payload = {}) {
  const db = requireDatabase();
  const table = kind === 'sale' ? 'sales' : 'purchases';
  const sourceExpression = kind === 'sale' ? 'i.source' : 'NULL';
  const partyColumn = kind === 'sale' ? 'customer_id' : 'supplier_id';
  const query = String(payload.query || '').trim();
  const term = `%${query}%`;
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  const status = ['active', 'completed', 'cancelled'].includes(String(payload.status)) ? String(payload.status) : '';
  const rows = db.prepare(`
    SELECT i.id, i.invoice_number AS invoiceNumber, i.date, i.subtotal, i.discount, i.tax,
      i.total, i.paid_amount AS paidAmount, i.remaining_amount AS remainingAmount,
      i.status, ${sourceExpression} AS source, i.created_at AS createdAt,
      COALESCE(i.party_name, trim(p.first_name || ' ' || COALESCE(p.last_name, '')), c.name, s.name, '') AS partyName,
      COALESCE(i.party_phone, p.phone, p.mobile, c.phone, s.phone, '') AS partyPhone,
      COALESCE(i.party_address, p.address, s.address, '') AS partyAddress,
      (SELECT COUNT(*) FROM ${kind === 'sale' ? 'sale_items' : 'purchase_items'} ii WHERE ii.${kind === 'sale' ? 'sale' : 'purchase'}_id = i.id) AS itemCount
    FROM ${table} i
    LEFT JOIN parties p ON p.id = i.party_id
    LEFT JOIN customers c ON c.id = i.${partyColumn}
    LEFT JOIN suppliers s ON s.id = i.${partyColumn}
    WHERE (? = '' OR i.invoice_number LIKE ? OR COALESCE(i.party_name, '') LIKE ? OR COALESCE(p.first_name || ' ' || p.last_name, '') LIKE ? OR COALESCE(c.name, '') LIKE ? OR COALESCE(s.name, '') LIKE ? OR COALESCE(c.phone, '') LIKE ? OR COALESCE(s.phone, '') LIKE ?)
      AND (? = '' OR i.date >= ?) AND (? = '' OR i.date <= ?)
      AND (? = '' OR i.status = ?)
    ORDER BY i.date DESC, i.id DESC
    LIMIT 500
  `).all(query, term, term, term, term, term, term, term, from, from, to, to, status, status);
  return rows.map((row) => ({ ...row, itemCount: Number(row.itemCount || 0) }));
}

function listSales(payload = {}) { return invoiceListQuery('sale', payload); }
function listPurchases(payload = {}) { return invoiceListQuery('purchase', payload); }

function updateSale(id, payload = {}) {
  const db = requireDatabase();
  const saleId = Number(id);
  const existing = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  if (!existing) throw new Error('فاکتور پیدا نشد.');
  if (existing.status === 'cancelled') throw new Error('فاکتور لغوشده قابل ویرایش نیست.');
  const baseTotals = calculateSaleTotals(payload.items, payload.discount, payload.tax, 0);
  const paymentTotals = normalizeInvoicePayments(payload.payments, baseTotals.total, payload.paidAmount);
  const totals = { ...baseTotals, ...paymentTotals };
  const party = getPartySnapshot(db, payload.partyId, { name: payload.partyName, phone: payload.partyPhone, address: payload.partyAddress });
  const date = normalizeInvoiceDate(payload.date);
  db.exec('BEGIN IMMEDIATE');
  try {
    const oldItems = db.prepare('SELECT product_id AS productId, quantity FROM sale_items WHERE sale_id = ?').all(saleId);
    const adjustStock = db.prepare('UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    for (const item of oldItems) adjustStock.run(Number(item.quantity), item.productId);
    if (existing.party_id && Number(existing.remaining_amount || 0) > 0) {
      db.prepare('UPDATE parties SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(existing.remaining_amount, existing.party_id);
    }
    const products = getAvailableSaleProducts(db, totals.items);
    let pricedItems = totals.items.map((item) => {
      const product = products.get(item.productId);
      const purchasePrice = Number(product.purchasePrice || 0);
      return { ...item, name: product.name, purchasePrice };
    });
    pricedItems = priceSaleItems(pricedItems, totals.discount, totals.subtotal);
    rejectSalesBelowPurchasePrice(pricedItems);
    const costTotal = pricedItems.reduce((sum, item) => sum + Math.round(item.purchasePrice * item.quantity), 0);
    const profitTotal = pricedItems.reduce((sum, item) => sum + item.profit, 0);
    const itemCount = pricedItems.reduce((sum, item) => sum + item.quantity, 0);
    db.prepare(`UPDATE sales SET party_id = ?, party_name = ?, party_phone = ?, party_address = ?, date = ?, subtotal = ?, discount = ?, tax = ?, total = ?, paid_amount = ?, remaining_amount = ?, cost_total = ?, profit_total = ?, item_count = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(party.partyId, party.partyName, party.partyPhone, party.partyAddress, date, totals.subtotal, totals.discount, totals.tax, totals.total, totals.paidAmount, totals.remainingAmount, costTotal, profitTotal, itemCount, String(payload.notes || ''), saleId);
    db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId);
    db.prepare('DELETE FROM invoice_payments WHERE sale_id = ?').run(saleId);
    db.prepare("DELETE FROM stock_movements WHERE type = 'sale' AND reference_type = 'sale' AND reference_id = ?").run(saleId);
    const insertItem = db.prepare('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount, total, purchase_price, profit, price_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const movement = db.prepare(
      "INSERT INTO stock_movements (product_id, type, quantity, reference_type, reference_id) VALUES (?, 'sale', ?, 'sale', ?)"
    );
    for (const item of pricedItems) {
      insertItem.run(saleId, item.productId, item.quantity, item.unitPrice, item.discount, item.total, item.purchasePrice, item.profit, item.priceType || 'retail');
      adjustStock.run(-item.quantity, item.productId);
      movement.run(item.productId, -item.quantity, saleId);
    }
    insertInvoicePayments(db, 'sale_id', saleId, paymentTotals.payments);
    if (party.partyId && totals.remainingAmount > 0) {
      db.prepare('UPDATE parties SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(totals.remainingAmount, party.partyId);
    }
    db.exec('COMMIT');
    return getInvoiceDetails('sale', saleId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getInvoiceDetails(kind, id) {
  const db = requireDatabase();
  const invoiceId = Number(id);
  const table = kind === 'sale' ? 'sales' : 'purchases';
  const itemTable = kind === 'sale' ? 'sale_items' : 'purchase_items';
  const partyTable = kind === 'sale' ? 'customers' : 'suppliers';
  const partyColumn = kind === 'sale' ? 'customer_id' : 'supplier_id';
  const partyAddressExpression = kind === 'sale' ? "COALESCE(i.party_address, p.address, '')" : "COALESCE(i.party_address, p.address, x.address, '')";
  const invoice = db.prepare(`
    SELECT i.*, COALESCE(i.party_name, trim(p.first_name || ' ' || COALESCE(p.last_name, '')), x.name, '') AS partyName,
      COALESCE(i.party_phone, p.phone, p.mobile, x.phone, '') AS partyPhone,
      ${partyAddressExpression} AS partyAddress
    FROM ${table} i
    LEFT JOIN parties p ON p.id = i.party_id
    LEFT JOIN ${partyTable} x ON x.id = i.${partyColumn}
    WHERE i.id = ?
  `).get(invoiceId);
  if (!invoice) throw new Error('فاکتور پیدا نشد.');
  const items = db.prepare(`
    SELECT ii.*, p.name AS productName, p.code AS productCode, u.name AS unitName, u.symbol AS unitSymbol
    FROM ${itemTable} ii JOIN products p ON p.id = ii.product_id
    LEFT JOIN units u ON u.id = p.unit_id
    WHERE ii.${kind === 'sale' ? 'sale' : 'purchase'}_id = ? ORDER BY ii.id
  `).all(invoiceId);
  const payments = db.prepare('SELECT * FROM invoice_payments WHERE ' + (kind === 'sale' ? 'sale_id' : 'purchase_id') + ' = ? ORDER BY id').all(invoiceId);
  return { ...invoice, items, payments };
}

function settleInvoice(kind, id, payload = {}) {
  const db = requireDatabase();
  const invoiceId = Number(id);
  const table = kind === 'sale' ? 'sales' : 'purchases';
  const invoice = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(invoiceId);
  if (!invoice) throw new Error('فاکتور پیدا نشد.');
  if (invoice.status === 'cancelled') throw new Error('فاکتور لغوشده قابل تسویه نیست.');
  const paymentTotals = normalizeInvoicePayments([payload], Number(invoice.remaining_amount || 0), 0);
  if (!paymentTotals.payments.length) throw new Error('مبلغ پرداخت را وارد کنید.');
  const payment = paymentTotals.payments[0];
  db.exec('BEGIN IMMEDIATE');
  try {
    insertInvoicePayments(db, kind === 'sale' ? 'sale_id' : 'purchase_id', invoiceId, [payment]);
    const nextPaid = Number(invoice.paid_amount || 0) + payment.amount;
    const nextRemaining = Math.max(0, Number(invoice.total || 0) - nextPaid);
    db.prepare(`UPDATE ${table} SET paid_amount = ?, remaining_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(nextPaid, nextRemaining, invoiceId);
    if (payment.amount > 0) {
      if (invoice.party_id) {
      db.prepare('UPDATE parties SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(payment.amount, invoice.party_id);
      }
      if (kind === 'sale' && invoice.customer_id) db.prepare('UPDATE customers SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(payment.amount, invoice.customer_id);
      if (kind === 'purchase' && invoice.supplier_id) db.prepare('UPDATE suppliers SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(payment.amount, invoice.supplier_id);
    }
    db.exec('COMMIT');
    return getInvoiceDetails(kind, invoiceId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function cancelInvoice(kind, id) {
  const db = requireDatabase();
  const invoiceId = Number(id);
  const table = kind === 'sale' ? 'sales' : 'purchases';
  const itemTable = kind === 'sale' ? 'sale_items' : 'purchase_items';
  const invoice = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(invoiceId);
  if (!invoice) throw new Error('فاکتور پیدا نشد.');
  if (invoice.status === 'cancelled') throw new Error('این فاکتور قبلاً لغو شده است.');
  const items = db.prepare(`SELECT product_id AS productId, quantity FROM ${itemTable} WHERE ${kind === 'sale' ? 'sale' : 'purchase'}_id = ?`).all(invoiceId);
  db.exec('BEGIN IMMEDIATE');
  try {
    const stockSign = kind === 'sale' ? 1 : -1;
    const updateStock = db.prepare('UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const movement = db.prepare("INSERT INTO stock_movements (product_id, type, quantity, reference_type, reference_id, description) VALUES (?, ?, ?, ?, ?, ?)");
    for (const item of items) {
      if (kind === 'purchase' && Number(db.prepare('SELECT stock FROM products WHERE id = ?').get(item.productId)?.stock || 0) < Number(item.quantity)) {
        throw new Error('موجودی فعلی برای لغو این فاکتور خرید کافی نیست.');
      }
      updateStock.run(stockSign * Number(item.quantity), item.productId);
      movement.run(item.productId, kind === 'sale' ? 'sale_cancel' : 'purchase_cancel', stockSign * Number(item.quantity), kind, invoiceId, `لغو فاکتور ${invoice.invoice_number}`);
    }
    if (Number(invoice.remaining_amount || 0) > 0) {
      if (invoice.party_id) {
        db.prepare('UPDATE parties SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(invoice.remaining_amount, invoice.party_id);
      }
      if (kind === 'sale' && invoice.customer_id) db.prepare('UPDATE customers SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(invoice.remaining_amount, invoice.customer_id);
      if (kind === 'purchase' && invoice.supplier_id) db.prepare('UPDATE suppliers SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(invoice.remaining_amount, invoice.supplier_id);
    }
    db.prepare(`UPDATE ${table} SET status = 'cancelled', remaining_amount = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(invoiceId);
    db.exec('COMMIT');
    return getInvoiceDetails(kind, invoiceId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function closeDatabase() {
  if (database) {
    database.close();
    database = undefined;
  }
}

module.exports = {
  closeDatabase,
  getAppSettings,
  saveAppSettings,
  createCategory,
  createPurchase,
  listSales,
  listPurchases,
  getNextInvoiceNumber,
  getInvoiceDetails,
  updateSale,
  settleInvoice,
  cancelInvoice,
  createProduct,
  createSale,
  getSalesReport,
  getDashboardSummary,
  getDatabase,
  listCategories,
  listParties,
  listProducts,
  listUnits,
  createUnit,
  updateUnit,
  setUnitActive,
  searchCustomers,
  searchProducts,
  createParty,
  updateParty,
  setPartyActive,
  setCategoryActive,
  setProductActive,
  updateCategory,
  updateProduct,
  updateProductQuick
  ,previewProductImport
  ,importProducts
};
