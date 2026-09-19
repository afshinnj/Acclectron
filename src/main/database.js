const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { calculateSaleTotals } = require('./domain/sales');
const { buildSalesForecast } = require('./domain/forecast');
const { normalizePersianText } = require('./importer');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const crypto = require('node:crypto');
let database;
let currentUserId = null;
const webAuthnChallenges = new Map();
const webAuthnRpId = 'accletron.local';
const webAuthnOrigin = 'https://accletron.local';
const ROLE_PERMISSIONS = {
  admin: ['*'],
  manager: ['sales', 'purchases', 'returns', 'cash', 'inventory', 'reports', 'settings', 'users'],
  cashier: ['sales', 'returns', 'cash', 'reports'],
  warehouse: ['purchases', 'returns', 'inventory', 'reports'],
  viewer: ['reports']
};

function toPlainRow(row) {
  if (!row || typeof row !== 'object') return row;
  return Object.fromEntries(Object.entries(row));
}

function normalizeDatabaseRows(db) {
  // node:sqlite returns rows with a null prototype. Expose regular objects
  // consistently to callers (and to consumers using strict deep equality).
  const originalPrepare = db.prepare.bind(db);
  db.prepare = (...args) => {
    const statement = originalPrepare(...args);
    const originalGet = statement.get.bind(statement);
    const originalAll = statement.all.bind(statement);
    statement.get = (...params) => toPlainRow(originalGet(...params));
    statement.all = (...params) => originalAll(...params).map(toPlainRow);
    return statement;
  };
  return db;
}

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
  database = normalizeDatabaseRows(new DatabaseSync(path.join(dataDirectory, 'accletron.db')));
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
    CREATE TABLE IF NOT EXISTS sale_merge_sources (
      source_sale_id INTEGER PRIMARY KEY REFERENCES sales(id) ON DELETE RESTRICT,
      merged_sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (source_sale_id <> merged_sale_id)
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
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS quick_pin_credentials (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      pin_hash TEXT NOT NULL,
      pin_salt TEXT NOT NULL,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,
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
    CREATE TABLE IF NOT EXISTS installment_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_kind TEXT NOT NULL CHECK (invoice_kind IN ('sale', 'purchase')),
      invoice_id INTEGER NOT NULL,
      total_amount INTEGER NOT NULL CHECK (total_amount > 0),
      installment_count INTEGER NOT NULL CHECK (installment_count > 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(invoice_kind, invoice_id)
    );
    CREATE TABLE IF NOT EXISTS installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL REFERENCES installment_plans(id) ON DELETE CASCADE,
      installment_number INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount > 0),
      paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid', 'overdue', 'cancelled')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(plan_id, installment_number)
    );
    CREATE TABLE IF NOT EXISTS installment_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      installment_id INTEGER NOT NULL REFERENCES installments(id) ON DELETE CASCADE,
      invoice_payment_id INTEGER REFERENCES invoice_payments(id) ON DELETE SET NULL,
      amount INTEGER NOT NULL CHECK (amount > 0),
      paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      method TEXT NOT NULL DEFAULT 'cash',
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS sales_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_number TEXT NOT NULL UNIQUE,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
      date TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
      refund_amount INTEGER NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sales_return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
      sale_item_id INTEGER REFERENCES sale_items(id) ON DELETE SET NULL,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
      discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
      total INTEGER NOT NULL CHECK (total >= 0)
    );
    CREATE TABLE IF NOT EXISTS purchase_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_number TEXT NOT NULL UNIQUE,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
      date TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
      refund_amount INTEGER NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS purchase_return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
      purchase_item_id INTEGER REFERENCES purchase_items(id) ON DELETE SET NULL,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
      discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
      total INTEGER NOT NULL CHECK (total >= 0)
    );
    CREATE TABLE IF NOT EXISTS cash_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
      category TEXT NOT NULL DEFAULT 'general',
      amount INTEGER NOT NULL CHECK (amount > 0),
      method TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'card', 'bank', 'other')),
      date TEXT NOT NULL,
      description TEXT,
      reference_type TEXT,
      reference_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'manager', 'cashier', 'warehouse', 'viewer')),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS daily_closures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      opening_balance INTEGER NOT NULL DEFAULT 0,
      cash_income INTEGER NOT NULL DEFAULT 0,
      cash_expense INTEGER NOT NULL DEFAULT 0,
      net_sales INTEGER NOT NULL DEFAULT 0,
      profit_total INTEGER NOT NULL DEFAULT 0,
      closing_balance INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TRIGGER IF NOT EXISTS prevent_completed_purchase_delete
    BEFORE DELETE ON purchases
    WHEN OLD.status = 'completed'
    BEGIN
      SELECT RAISE(ABORT, 'completed purchases cannot be deleted');
    END;
    -- Completed purchases keep their commercial details immutable. Payment
    -- summaries are deliberately excluded because each settlement is recorded
    -- separately in invoice_payments and must update the running balance.
    DROP TRIGGER IF EXISTS prevent_completed_purchase_update;
    CREATE TRIGGER prevent_completed_purchase_update
    BEFORE UPDATE OF invoice_number, supplier_id, date, subtotal, discount, tax, total
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
  addColumnIfMissing(database, 'sales_returns', 'balance_adjustment', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'purchase_returns', 'balance_adjustment', 'INTEGER NOT NULL DEFAULT 0');

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
    CREATE INDEX IF NOT EXISTS idx_installments_due_date ON installments(due_date);
    CREATE INDEX IF NOT EXISTS idx_installment_plans_invoice ON installment_plans(invoice_kind, invoice_id);
    CREATE INDEX IF NOT EXISTS idx_sales_invoice_number ON sales(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
    CREATE INDEX IF NOT EXISTS idx_purchases_invoice_number ON purchases(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_product_id ON stock_movements(product_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_returns_sale_id ON sales_returns(sale_id);
    CREATE INDEX IF NOT EXISTS idx_sales_return_items_product_id ON sales_return_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase_id ON purchase_returns(purchase_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_return_items_product_id ON purchase_return_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_cash_transactions_date ON cash_transactions(date);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_daily_closures_date ON daily_closures(date);
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

  const userCount = database.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount === 0) {
    const { passwordHash, passwordSalt } = hashPassword('admin123');
    database.prepare(`
      INSERT INTO users (username, display_name, password_hash, password_salt, role)
      VALUES (?, ?, ?, ?, ?)
    `).run('admin', 'مدیر سیستم', passwordHash, passwordSalt, 'admin');
  }
  // One-time recovery migration for installations where the seeded admin
  // password was not usable. Existing custom passwords are not overwritten
  // after this marker has been written.
  const resetMarker = database.prepare('SELECT value FROM app_settings WHERE key = ?').get('adminPasswordResetV1');
  if (!resetMarker) {
    const admin = database.prepare('SELECT id FROM users WHERE username = ?').get('admin');
    if (admin) {
      const { passwordHash, passwordSalt } = hashPassword('admin123');
      database.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(passwordHash, passwordSalt, admin.id);
    }
    database.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run('adminPasswordResetV1', JSON.stringify(true));
  }
  return database;
}

function requireDatabase() {
  if (!database) getDatabase();
  return database;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const passwordHash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return { passwordHash, passwordSalt: salt };
}

function auditLog(action, entityType = null, entityId = null, details = null) {
  const db = requireDatabase();
  db.prepare(`
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(currentUserId || null, String(action), entityType, entityId ? Number(entityId) : null, details == null ? null : JSON.stringify(details));
}

function setCurrentUser(userId = null) {
  currentUserId = userId ? Number(userId) : null;
  return getCurrentUser();
}

function getCurrentUser() {
  if (!currentUserId) return null;
  const row = requireDatabase().prepare(`
    SELECT id, username, display_name AS displayName, role, is_active AS isActive, last_login_at AS lastLoginAt
    FROM users WHERE id = ?
  `).get(currentUserId);
  if (!row || !row.isActive) {
    currentUserId = null;
    return null;
  }
  return { ...row, isActive: Boolean(row.isActive) };
}

function validateQuickPin(pin) {
  const value = String(pin || '').trim();
  if (!/^\d{4,6}$/.test(value)) throw new Error('PIN باید ۴ تا ۶ رقم باشد.');
  return value;
}

function setQuickPin(pin, currentPassword = '') {
  const user = getCurrentUser();
  if (!user) throw new Error('برای تنظیم PIN ابتدا وارد حساب شوید.');
  const db = requireDatabase();
  const account = db.prepare('SELECT password_hash AS passwordHash, password_salt AS passwordSalt FROM users WHERE id = ?').get(user.id);
  if (getAppSettings().security?.passwordlessLogin !== true) {
    const { passwordHash } = hashPassword(currentPassword, account.passwordSalt);
    if (!crypto.timingSafeEqual(Buffer.from(passwordHash, 'hex'), Buffer.from(account.passwordHash, 'hex'))) throw new Error('رمز عبور فعلی نادرست است.');
  }
  const value = validateQuickPin(pin);
  const { passwordHash, passwordSalt } = hashPassword(value);
  db.prepare(`INSERT INTO quick_pin_credentials (user_id, pin_hash, pin_salt, failed_attempts, locked_until, updated_at)
    VALUES (?, ?, ?, 0, 0, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET pin_hash=excluded.pin_hash, pin_salt=excluded.pin_salt, failed_attempts=0, locked_until=0, updated_at=CURRENT_TIMESTAMP`)
    .run(user.id, passwordHash, passwordSalt);
  auditLog('auth.quick_pin.set', 'user', user.id);
  return { enabled: true };
}

function clearQuickPin(currentPassword = '') {
  const user = getCurrentUser();
  if (!user) throw new Error('نشست کاربر معتبر نیست.');
  const db = requireDatabase();
  const account = db.prepare('SELECT password_hash AS passwordHash, password_salt AS passwordSalt FROM users WHERE id = ?').get(user.id);
  if (getAppSettings().security?.passwordlessLogin !== true) {
    const { passwordHash } = hashPassword(currentPassword, account.passwordSalt);
    if (!crypto.timingSafeEqual(Buffer.from(passwordHash, 'hex'), Buffer.from(account.passwordHash, 'hex'))) throw new Error('رمز عبور فعلی نادرست است.');
  }
  db.prepare('DELETE FROM quick_pin_credentials WHERE user_id = ?').run(user.id);
  auditLog('auth.quick_pin.clear', 'user', user.id);
  return { enabled: false };
}

function getQuickPinStatus() {
  const user = getCurrentUser();
  if (!user) return { enabled: false };
  const row = requireDatabase().prepare('SELECT failed_attempts AS failedAttempts, locked_until AS lockedUntil FROM quick_pin_credentials WHERE user_id = ?').get(user.id);
  return { enabled: Boolean(row), lockedUntil: Number(row?.lockedUntil || 0), failedAttempts: Number(row?.failedAttempts || 0) };
}

function unlockWithQuickPin(pin) {
  const user = getCurrentUser();
  if (!user) throw new Error('نشست کاربر معتبر نیست.');
  const db = requireDatabase();
  const row = db.prepare('SELECT * FROM quick_pin_credentials WHERE user_id = ?').get(user.id);
  if (!row) throw new Error('برای این کاربر PIN تنظیم نشده است.');
  if (Number(row.locked_until || 0) > Date.now()) throw new Error('PIN موقتاً قفل شده است. چند دقیقه بعد دوباره تلاش کنید.');
  const value = String(pin || '').trim();
  const { passwordHash } = hashPassword(value, row.pin_salt);
  const valid = /^\d{4,6}$/.test(value) && crypto.timingSafeEqual(Buffer.from(passwordHash, 'hex'), Buffer.from(row.pin_hash, 'hex'));
  if (!valid) {
    const attempts = Number(row.failed_attempts || 0) + 1;
    db.prepare('UPDATE quick_pin_credentials SET failed_attempts = ?, locked_until = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
      .run(attempts, attempts >= 5 ? Date.now() + 5 * 60 * 1000 : 0, user.id);
    auditLog('auth.quick_pin.failed', 'user', user.id, { attempts });
    throw new Error(attempts >= 5 ? 'پنج تلاش ناموفق؛ PIN برای ۵ دقیقه قفل شد.' : 'PIN نادرست است.');
  }
  db.prepare('UPDATE quick_pin_credentials SET failed_attempts = 0, locked_until = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(user.id);
  auditLog('auth.quick_pin.unlock', 'user', user.id);
  return user;
}

function beginWindowsHelloRegistration() {
  const user = getCurrentUser();
  if (!user) throw new Error('برای ثبت Windows Hello ابتدا وارد حساب شوید.');
  const existing = requireDatabase().prepare('SELECT credential_id AS credentialId FROM webauthn_credentials WHERE user_id = ?').all(user.id);
  const options = generateRegistrationOptions({
    rpName: 'Acclectron', rpID: webAuthnRpId, userName: user.username,
    userDisplayName: user.displayName || user.username, userID: String(user.id),
    attestationType: 'none',
    excludeCredentials: existing.map((row) => ({ id: row.credentialId, type: 'public-key' })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }
  });
  webAuthnChallenges.set(`register:${user.id}`, { challenge: options.challenge, expiresAt: Date.now() + 120000 });
  return options;
}

function finishWindowsHelloRegistration(response) {
  const user = getCurrentUser();
  if (!user) throw new Error('نشست کاربر معتبر نیست.');
  const key = `register:${user.id}`;
  const pending = webAuthnChallenges.get(key);
  webAuthnChallenges.delete(key);
  if (!pending || pending.expiresAt < Date.now()) throw new Error('درخواست Windows Hello منقضی شده است.');
  const verification = verifyRegistrationResponse({ response, expectedChallenge: pending.challenge, expectedOrigin: webAuthnOrigin, expectedRPID: webAuthnRpId, requireUserVerification: true });
  if (!verification.verified || !verification.registrationInfo) throw new Error('ثبت Windows Hello تأیید نشد.');
  const info = verification.registrationInfo;
  requireDatabase().prepare(`INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)`)
    .run(user.id, Buffer.from(info.credential.id).toString('base64url'), Buffer.from(info.credential.publicKey).toString('base64'), Number(info.credential.counter || 0), JSON.stringify(info.credential.transports || []));
  auditLog('auth.webauthn.register', 'user', user.id);
  return { verified: true };
}

function beginWindowsHelloAuthentication(username = '') {
  const user = requireDatabase().prepare('SELECT id FROM users WHERE username = ? AND is_active = 1').get(String(username || '').trim());
  if (!user) throw new Error('کاربر فعال پیدا نشد.');
  const credentials = requireDatabase().prepare('SELECT credential_id AS credentialId FROM webauthn_credentials WHERE user_id = ?').all(user.id);
  if (!credentials.length) throw new Error('برای این کاربر Windows Hello ثبت نشده است.');
  const options = generateAuthenticationOptions({ rpID: webAuthnRpId, userVerification: 'required', allowCredentials: credentials.map((row) => ({ id: row.credentialId, type: 'public-key' })) });
  webAuthnChallenges.set(`authenticate:${user.id}`, { challenge: options.challenge, expiresAt: Date.now() + 120000 });
  return options;
}

function finishWindowsHelloAuthentication(username, response) {
  const db = requireDatabase();
  const user = db.prepare('SELECT id FROM users WHERE username = ? AND is_active = 1').get(String(username || '').trim());
  if (!user) throw new Error('اطلاعات Windows Hello معتبر نیست.');
  const key = `authenticate:${user.id}`;
  const pending = webAuthnChallenges.get(key);
  webAuthnChallenges.delete(key);
  if (!pending || pending.expiresAt < Date.now()) throw new Error('درخواست Windows Hello منقضی شده است.');
  const stored = db.prepare('SELECT * FROM webauthn_credentials WHERE user_id = ? AND credential_id = ?').get(user.id, String(response?.id || ''));
  if (!stored) throw new Error('credential Windows Hello پیدا نشد.');
  const verification = verifyAuthenticationResponse({ response, expectedChallenge: pending.challenge, expectedOrigin: webAuthnOrigin, expectedRPID: webAuthnRpId, requireUserVerification: true, credential: { id: stored.credential_id, publicKey: Buffer.from(stored.public_key, 'base64'), counter: Number(stored.counter || 0), transports: JSON.parse(stored.transports || '[]') } });
  if (!verification.verified) throw new Error('ورود با Windows Hello تأیید نشد.');
  db.prepare('UPDATE webauthn_credentials SET counter = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(Number(verification.authenticationInfo.newCounter || stored.counter), stored.id);
  currentUserId = Number(user.id);
  auditLog('auth.webauthn.login', 'user', user.id);
  return getCurrentUser();
}

function requirePermission(permission) {
  const user = getCurrentUser();
  if (!user) return true;
  const permissions = ROLE_PERMISSIONS[user.role] || [];
  if (permissions.includes('*') || permissions.includes(permission)) return true;
  throw new Error('کاربر جاری مجوز انجام این عملیات را ندارد.');
}

function createUser(payload = {}) {
  const db = requireDatabase();
  requirePermission('users');
  const username = String(payload.username || '').trim().toLowerCase();
  const displayName = String(payload.displayName || username).trim();
  const role = ['admin', 'manager', 'cashier', 'warehouse', 'viewer'].includes(String(payload.role)) ? String(payload.role) : 'viewer';
  const password = String(payload.password || '');
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('نام کاربری باید ۳ تا ۴۰ نویسهٔ لاتین معتبر داشته باشد.');
  if (password.length < 6) throw new Error('رمز عبور باید حداقل ۶ نویسه باشد.');
  if (!displayName) throw new Error('نام نمایشی الزامی است.');
  const { passwordHash, passwordSalt } = hashPassword(password);
  try {
    const result = db.prepare(`
      INSERT INTO users (username, display_name, password_hash, password_salt, role)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, displayName, passwordHash, passwordSalt, role);
    const user = listUsers().find((item) => item.id === Number(result.lastInsertRowid));
    auditLog('user.create', 'user', user.id, { username, role });
    return user;
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new Error('این نام کاربری قبلاً ثبت شده است.');
    throw error;
  }
}

function listUsers() {
  const rows = requireDatabase().prepare(`
    SELECT id, username, display_name AS displayName, role, is_active AS isActive,
      last_login_at AS lastLoginAt, created_at AS createdAt, updated_at AS updatedAt
    FROM users ORDER BY is_active DESC, username
  `).all();
  return rows.map((row) => ({ ...row, isActive: Boolean(row.isActive) }));
}

function setUserActive(id, active) {
  requirePermission('users');
  const result = requireDatabase().prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(active ? 1 : 0, Number(id));
  if (!result.changes) throw new Error('کاربر پیدا نشد.');
  auditLog(active ? 'user.activate' : 'user.deactivate', 'user', id);
  if (Number(id) === currentUserId && !active) currentUserId = null;
  return listUsers().find((user) => user.id === Number(id));
}

function loginUser(username, password) {
  const db = requireDatabase();
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(String(username || '').trim().toLowerCase());
  if (!user) throw new Error('نام کاربری یا رمز عبور نادرست است.');
  const passwordless = getAppSettings().security?.passwordlessLogin === true;
  if (!passwordless) {
    const { passwordHash } = hashPassword(password, user.password_salt);
    const a = Buffer.from(passwordHash, 'hex');
    const b = Buffer.from(user.password_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('نام کاربری یا رمز عبور نادرست است.');
  }
  currentUserId = Number(user.id);
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  auditLog('auth.login', 'user', user.id);
  return getCurrentUser();
}

function resetAdminPassword() {
  const db = requireDatabase();
  const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!admin) throw new Error('کاربر admin پیدا نشد.');
  const { passwordHash, passwordSalt } = hashPassword('admin123');
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(passwordHash, passwordSalt, admin.id);
  auditLog('auth.admin_password_reset', 'user', admin.id);
  return true;
}

function logoutUser() {
  if (currentUserId) auditLog('auth.logout', 'user', currentUserId);
  currentUserId = null;
  return true;
}

function listAuditLogs(payload = {}) {
  requirePermission('users');
  const db = requireDatabase();
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  return db.prepare(`
    SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
      a.details, a.created_at AS createdAt, a.user_id AS userId,
      COALESCE(u.display_name, u.username, 'سیستم') AS userName
    FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
    WHERE (? = '' OR substr(a.created_at, 1, 10) >= ?)
      AND (? = '' OR substr(a.created_at, 1, 10) <= ?)
    ORDER BY a.id DESC LIMIT 1000
  `).all(from, from, to, to);
}

function listChecks(payload = {}) {
  const db = requireDatabase();
  const status = ['pending', 'cleared', 'bounced', 'cancelled'].includes(String(payload.status)) ? String(payload.status) : '';
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  const query = String(payload.query || '').trim();
  return db.prepare(`
    SELECT ip.id, ip.method, ip.amount, ip.paid_at AS paidAt, ip.check_number AS checkNumber,
      ip.bank_name AS bankName, ip.due_date AS dueDate, ip.check_holder AS checkHolder,
      ip.check_status AS checkStatus, ip.notes,
      CASE WHEN ip.sale_id IS NOT NULL THEN 'sale' ELSE 'purchase' END AS invoiceKind,
      COALESCE(s.invoice_number, p.invoice_number) AS invoiceNumber,
      COALESCE(s.party_name, p.party_name, '') AS partyName,
      COALESCE(s.party_phone, p.party_phone, '') AS partyPhone
    FROM invoice_payments ip
    LEFT JOIN sales s ON s.id = ip.sale_id
    LEFT JOIN purchases p ON p.id = ip.purchase_id
    WHERE ip.method = 'check'
      AND (? = '' OR ip.check_status = ?)
      AND (? = '' OR ip.due_date >= ?)
      AND (? = '' OR ip.due_date <= ?)
      AND (? = '' OR ip.check_number LIKE ? OR COALESCE(s.invoice_number, p.invoice_number) LIKE ? OR COALESCE(s.party_name, p.party_name, '') LIKE ?)
    ORDER BY CASE WHEN ip.check_status = 'pending' THEN 0 ELSE 1 END, ip.due_date, ip.id DESC
    LIMIT 1000
  `).all(status, status, from, from, to, to, query, `%${query}%`, `%${query}%`, `%${query}%`);
}

function updateCheckStatus(id, status, notes = '') {
  requirePermission('cash');
  const valid = ['pending', 'cleared', 'bounced', 'cancelled'];
  if (!valid.includes(String(status))) throw new Error('وضعیت چک معتبر نیست.');
  const db = requireDatabase();
  const check = db.prepare("SELECT id, sale_id AS saleId, purchase_id AS purchaseId FROM invoice_payments WHERE id = ? AND method = 'check'").get(Number(id));
  if (!check) throw new Error('چک پیدا نشد.');
  const result = db.prepare('UPDATE invoice_payments SET check_status = ?, notes = COALESCE(?, notes) WHERE id = ?').run(String(status), String(notes || '').trim() || null, Number(id));
  if (!result.changes) throw new Error('وضعیت چک تغییر نکرد.');
  auditLog('check.status', check.saleId ? 'sale' : 'purchase', check.saleId || check.purchaseId, { paymentId: Number(id), status });
  return listChecks({ query: '' }).find((item) => item.id === Number(id));
}

function refreshInstallmentStatuses(db, planId = null, today = new Date().toISOString().slice(0, 10)) {
  const where = planId == null ? '' : 'WHERE i.plan_id = ?';
  const rows = db.prepare(`SELECT i.id, i.amount, i.paid_amount AS paidAmount, i.due_date AS dueDate, i.status FROM installments i ${where}`).all(...(planId == null ? [] : [Number(planId)]));
  const update = db.prepare('UPDATE installments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  for (const row of rows) {
    if (row.status === 'cancelled') continue;
    const paid = Number(row.paidAmount || 0);
    const amount = Number(row.amount || 0);
    const status = paid >= amount ? 'paid' : paid > 0 ? 'partial' : (row.dueDate < today ? 'overdue' : 'pending');
    if (status !== row.status) update.run(status, row.id);
  }
}

function createInstallmentPlan(payload = {}) {
  const db = requireDatabase();
  const invoiceKind = ['sale', 'purchase'].includes(String(payload.invoiceKind)) ? String(payload.invoiceKind) : 'sale';
  requirePermission(invoiceKind === 'sale' ? 'sales' : 'purchases');
  const invoiceId = Number(payload.invoiceId);
  const table = invoiceKind === 'sale' ? 'sales' : 'purchases';
  const invoice = db.prepare(`SELECT id, total, remaining_amount AS remainingAmount, status FROM ${table} WHERE id = ?`).get(invoiceId);
  if (!invoice) throw new Error('فاکتور برای تقسیط پیدا نشد.');
  if (invoice.status === 'cancelled') throw new Error('فاکتور لغوشده قابل تقسیط نیست.');
  if (Number(invoice.remainingAmount) <= 0) throw new Error('این فاکتور مانده قابل تقسیط ندارد.');
  if (db.prepare('SELECT id FROM installment_plans WHERE invoice_kind = ? AND invoice_id = ? AND status = ?').get(invoiceKind, invoiceId, 'active')) {
    throw new Error('برای این فاکتور برنامه اقساط فعال وجود دارد.');
  }
  const raw = Array.isArray(payload.installments) ? payload.installments : [];
  if (!raw.length || raw.length > 120) throw new Error('حداقل یک و حداکثر ۱۲۰ قسط وارد کنید.');
  const installments = raw.map((item, index) => ({
    number: index + 1,
    dueDate: String(item.dueDate || '').trim(),
    amount: Math.round(Number(item.amount || 0))
  }));
  if (installments.some((item) => !/^\d{4}-\d{2}-\d{2}$/.test(item.dueDate) || item.amount <= 0)) throw new Error('تاریخ یا مبلغ قسط نامعتبر است.');
  const totalAmount = installments.reduce((sum, item) => sum + item.amount, 0);
  if (totalAmount !== Number(invoice.remainingAmount)) throw new Error('جمع اقساط باید دقیقاً برابر مانده فاکتور باشد.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(`
      INSERT INTO installment_plans (invoice_kind, invoice_id, total_amount, installment_count, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(invoiceKind, invoiceId, totalAmount, installments.length, String(payload.notes || '').trim() || null);
    const planId = Number(result.lastInsertRowid);
    const insert = db.prepare('INSERT INTO installments (plan_id, installment_number, due_date, amount, notes) VALUES (?, ?, ?, ?, ?)');
    installments.forEach((item) => insert.run(planId, item.number, item.dueDate, item.amount, String(payload.notes || '').trim() || null));
    db.exec('COMMIT');
    auditLog('installment.plan.create', invoiceKind, invoiceId, { planId, count: installments.length, totalAmount });
    return listInstallmentPlans({ id: planId })[0];
  } catch (error) {
    db.exec('ROLLBACK');
    if (String(error.message).includes('UNIQUE')) throw new Error('برای این فاکتور برنامه اقساط فعال وجود دارد.');
    throw error;
  }
}

function listInstallmentPlans(payload = {}) {
  const db = requireDatabase();
  refreshInstallmentStatuses(db);
  const conditions = [];
  const params = [];
  if (payload.id) { conditions.push('ip.id = ?'); params.push(Number(payload.id)); }
  if (['sale', 'purchase'].includes(String(payload.invoiceKind))) { conditions.push('ip.invoice_kind = ?'); params.push(String(payload.invoiceKind)); }
  if (['active', 'completed', 'cancelled'].includes(String(payload.status))) { conditions.push('ip.status = ?'); params.push(String(payload.status)); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const plans = db.prepare(`
    SELECT ip.id, ip.invoice_kind AS invoiceKind, ip.invoice_id AS invoiceId,
      ip.total_amount AS totalAmount, ip.installment_count AS installmentCount,
      ip.status, ip.notes, ip.created_at AS createdAt,
      COALESCE(s.invoice_number, p.invoice_number) AS invoiceNumber,
      COALESCE(s.party_name, p.party_name, '') AS partyName,
      COALESCE(s.remaining_amount, p.remaining_amount, 0) AS invoiceRemaining
    FROM installment_plans ip
    LEFT JOIN sales s ON ip.invoice_kind = 'sale' AND s.id = ip.invoice_id
    LEFT JOIN purchases p ON ip.invoice_kind = 'purchase' AND p.id = ip.invoice_id
    ${where}
    ORDER BY ip.id DESC
  `).all(...params);
  const installments = db.prepare(`
    SELECT i.id, i.plan_id AS planId, i.installment_number AS installmentNumber,
      i.due_date AS dueDate, i.amount, i.paid_amount AS paidAmount, i.status, i.notes
    FROM installments i ORDER BY i.due_date, i.installment_number
  `).all();
  const updatePlan = db.prepare("UPDATE installment_plans SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'");
  const cancelOpenInstallments = db.prepare("UPDATE installments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE plan_id = ? AND status IN ('pending', 'partial')");
  return plans.map((plan) => {
    const rows = installments.filter((item) => item.planId === plan.id);
    // An invoice may have been settled outside the installment screen
    // (for example from invoice details). Do not leave stale "pay" buttons
    // visible for a plan whose invoice has no remaining balance.
    if (plan.status === 'active' && Number(plan.invoiceRemaining || 0) <= 0) {
      cancelOpenInstallments.run(plan.id);
      updatePlan.run(plan.id);
      rows.forEach((item) => {
        if (['pending', 'partial'].includes(item.status)) item.status = 'cancelled';
      });
      plan.status = 'completed';
    } else if (rows.length && rows.every((item) => item.status === 'paid')) {
      updatePlan.run(plan.id); plan.status = 'completed';
    }
    return { ...plan, installments: rows };
  });
}

function recordInstallmentPayment(id, payload = {}) {
  const db = requireDatabase();
  const installment = db.prepare(`
    SELECT i.*, ip.invoice_kind AS invoiceKind, ip.invoice_id AS invoiceId
    FROM installments i JOIN installment_plans ip ON ip.id = i.plan_id WHERE i.id = ?
  `).get(Number(id));
  if (!installment) throw new Error('قسط پیدا نشد.');
  requirePermission(installment.invoiceKind === 'sale' ? 'sales' : 'purchases');
  if (installment.status === 'cancelled' || installment.status === 'paid') throw new Error('این قسط قابل پرداخت نیست.');
  const amount = Math.round(Number(payload.amount || 0));
  if (!amount || amount > Number(installment.amount) - Number(installment.paid_amount || 0)) throw new Error('مبلغ پرداخت قسط نامعتبر است.');
  const method = ['cash', 'card', 'check'].includes(String(payload.method)) ? String(payload.method) : 'cash';
  const invoiceTable = installment.invoiceKind === 'sale' ? 'sales' : 'purchases';
  const invoice = db.prepare(`SELECT * FROM ${invoiceTable} WHERE id = ?`).get(installment.invoiceId);
  const invoiceRemaining = Number(invoice?.remaining_amount || 0);
  if (!invoice) throw new Error('فاکتور مرتبط با قسط پیدا نشد.');
  if (invoiceRemaining <= 0) {
    db.prepare("UPDATE installments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('pending', 'partial')")
      .run(installment.id);
    db.prepare("UPDATE installment_plans SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'")
      .run(installment.plan_id);
    throw new Error('فاکتور مرتبط قبلاً تسویه شده است و این قسط قابل پرداخت نیست.');
  }
  if (invoiceRemaining < amount) throw new Error(`مبلغ پرداختی از مانده فاکتور (${invoiceRemaining}) بیشتر است.`);
  const payment = normalizeInvoicePayments([{ ...payload, method, amount: amount / 100 }], Number(invoice.remaining_amount), 0).payments[0];
  db.exec('BEGIN IMMEDIATE');
  try {
    insertInvoicePayments(db, installment.invoiceKind === 'sale' ? 'sale_id' : 'purchase_id', installment.invoiceId, [payment]);
    const paymentId = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
    const nextPaid = Number(invoice.paid_amount || 0) + payment.amount;
    db.prepare(`UPDATE ${invoiceTable} SET paid_amount = ?, remaining_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(nextPaid, Math.max(0, Number(invoice.total) - nextPaid), installment.invoiceId);
    const installmentPaid = Number(installment.paid_amount || 0) + payment.amount;
    db.prepare('UPDATE installments SET paid_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(installmentPaid, installmentPaid >= Number(installment.amount) ? 'paid' : 'partial', installment.id);
    db.prepare('INSERT INTO installment_payments (installment_id, invoice_payment_id, amount, paid_at, method, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(installment.id, paymentId, payment.amount, payment.paidAt, payment.method, payment.notes);
    if (invoice.party_id) db.prepare('UPDATE parties SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(payment.amount, invoice.party_id);
    if (installment.invoiceKind === 'sale' && invoice.customer_id) db.prepare('UPDATE customers SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(payment.amount, invoice.customer_id);
    if (installment.invoiceKind === 'purchase' && invoice.supplier_id) db.prepare('UPDATE suppliers SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(payment.amount, invoice.supplier_id);
    db.exec('COMMIT');
    auditLog('installment.payment', installment.invoiceKind, installment.invoiceId, { installmentId: installment.id, amount: payment.amount });
    return listInstallmentPlans({ id: installment.plan_id })[0];
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function changeCurrentUserPassword(currentPassword, newPassword) {
  const user = getCurrentUser();
  if (!user) throw new Error('ابتدا وارد حساب کاربری شوید.');
  if (String(newPassword || '').length < 6) throw new Error('رمز عبور جدید باید حداقل ۶ نویسه باشد.');
  const db = requireDatabase();
  const existing = db.prepare('SELECT password_hash AS passwordHash, password_salt AS passwordSalt FROM users WHERE id = ?').get(user.id);
  const oldHash = hashPassword(currentPassword, existing.passwordSalt).passwordHash;
  if (oldHash !== existing.passwordHash) throw new Error('رمز عبور فعلی نادرست است.');
  const next = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(next.passwordHash, next.passwordSalt, user.id);
  auditLog('auth.password_change', 'user', user.id);
  return true;
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
      shortcuts: settings.shortcuts !== false,
      startup: settings.startup === true
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
    theme: ['dark', 'light', 'system'].includes(String(appearance.theme)) ? String(appearance.theme) : 'dark',
    calendar: ['gregorian', 'jalali'].includes(String(appearance.calendar)) ? String(appearance.calendar) : 'gregorian',
    fontScale: Math.max(80, Math.min(130, Number(appearance.fontScale || 100))),
    notifications: appearance.notifications !== false,
    shortcuts: appearance.shortcuts !== false,
    startup: appearance.startup === true
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
      CASE WHEN p.retail_price > 0 THEN p.retail_price ELSE p.sale_price END AS salePrice,
      p.purchase_price AS purchasePrice,
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
  const purchasePrice = Math.max(0, Math.round(Number(payload.purchasePrice) || 0));
  // Use manually entered selling prices when provided; otherwise derive them
  // from the purchase price so API/import callers keep the automatic behavior.
  const requestedWholesale = Number(payload.wholesalePrice);
  const requestedRetail = Number(payload.retailPrice);
  const wholesalePrice = requestedWholesale > 0
    ? Math.round(requestedWholesale)
    : (purchasePrice > 0 ? Math.ceil(purchasePrice * 1.2) : 0);
  const retailPrice = requestedRetail > 0
    ? Math.round(requestedRetail)
    : (purchasePrice > 0 ? Math.ceil(purchasePrice * 1.3) : 0);
  const prices = [purchasePrice, wholesalePrice, retailPrice];
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

function normalizeProductIdentity(value = '') {
  return normalizePersianText(String(value).normalize('NFKC'))
    .toLowerCase()
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ی')
    .replace(/[ةۀ]/g, 'ه')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[\p{P}\p{S}_]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeProductBarcode(value = '') {
  return String(value).normalize('NFKC')
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[\s\u200c\u200d\u200e\u200f\-_]+/g, '')
    .toUpperCase();
}

function assertProductIsUnique(db, product, excludeId = null) {
  const requestedName = normalizeProductIdentity(product.name);
  const requestedBarcode = product.barcode ? normalizeProductBarcode(product.barcode) : '';
  const rows = db.prepare(`
    SELECT p.id, p.code, p.name, p.barcode, p.is_active AS isActive,
      COALESCE(c.name, '') AS categoryName
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE (? IS NULL OR p.id <> ?)
  `).all(excludeId, excludeId);

  if (requestedBarcode) {
    const duplicateBarcode = rows.find((row) => row.barcode
      && normalizeProductBarcode(row.barcode) === requestedBarcode);
    if (duplicateBarcode) {
      throw new Error(`بارکد واردشده قبلاً برای کالای «${duplicateBarcode.name}» با کد ${duplicateBarcode.code} ثبت شده است.`);
    }
  }

  const duplicateName = rows.find((row) => normalizeProductIdentity(row.name) === requestedName);
  if (duplicateName) {
    const category = duplicateName.categoryName ? ` در دستهٔ «${duplicateName.categoryName}»` : '';
    const inactive = duplicateName.isActive ? '' : ' (غیرفعال)';
    throw new Error(`کالای «${duplicateName.name}» با کد ${duplicateName.code}${category} قبلاً ثبت شده است${inactive}.`);
  }
}

function checkProductDuplicate(payload = {}, excludeId = null) {
  const db = requireDatabase();
  const name = String(payload.name || '').trim();
  const barcode = String(payload.barcode || '').trim();
  const requestedName = normalizeProductIdentity(name);
  const requestedBarcode = barcode ? normalizeProductBarcode(barcode) : '';
  if (!requestedName && !requestedBarcode) return { duplicate: false };
  const normalizedExcludeId = Number(excludeId);
  const rows = db.prepare(`
    SELECT p.id, p.code, p.name, p.barcode, p.is_active AS isActive,
      COALESCE(c.name, '') AS categoryName
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE (? IS NULL OR p.id <> ?)
  `).all(Number.isInteger(normalizedExcludeId) && normalizedExcludeId > 0 ? normalizedExcludeId : null,
    Number.isInteger(normalizedExcludeId) && normalizedExcludeId > 0 ? normalizedExcludeId : null);
  const duplicateBarcode = requestedBarcode && rows.find((row) => row.barcode && normalizeProductBarcode(row.barcode) === requestedBarcode);
  if (duplicateBarcode) return { duplicate: true, field: 'barcode', name: duplicateBarcode.name, code: duplicateBarcode.code };
  const duplicateName = requestedName && rows.find((row) => normalizeProductIdentity(row.name) === requestedName);
  if (duplicateName) return { duplicate: true, field: 'name', name: duplicateName.name, code: duplicateName.code };
  return { duplicate: false };
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

function getNextProductCode(categoryId, excludeId = null) {
  const normalizedExcludeId = Number(excludeId);
  return generateProductCode(
    Number(categoryId),
    Number.isInteger(normalizedExcludeId) && normalizedExcludeId > 0 ? normalizedExcludeId : null
  );
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
    db.prepare('SELECT name FROM products').all()
      .map((product) => normalizeProductIdentity(product.name))
  );
  const categoryNames = [...new Set(rows.map((row) => row.category))];
  const missingCategories = categoryNames.filter((name) => !categoryByName.has(normalizePersianText(name)));
  const duplicateRows = rows.filter((row) => existingNames.has(normalizeProductIdentity(row.name)));
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
    const existingProducts = new Map(
      db.prepare('SELECT id, name FROM products').all()
        .map((product) => [
          normalizeProductIdentity(product.name),
          Number(product.id)
        ])
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
        const duplicateKey = normalizeProductIdentity(name);
        const stock = Number(row.stock);
        const currencyFactor = getCurrencyInputFactor();
        const purchasePrice = Math.round(Number(row.purchasePrice) * 100 / currencyFactor);
        const wholesalePrice = Math.round(Number(row.wholesalePrice) * 100 / currencyFactor);
        const retailPrice = Math.round(Number(row.retailPrice) * 100 / currencyFactor);
        if (existingProducts.has(duplicateKey)) {
          const existingId = existingProducts.get(duplicateKey);
          if (duplicateMode === 'update' && existingId) {
            db.prepare(`
              UPDATE products SET sale_price = ?, purchase_price = ?, wholesale_price = ?,
                retail_price = ?, stock = ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(retailPrice, purchasePrice, wholesalePrice, retailPrice, stock, existingId);
            result.updated = (result.updated || 0) + 1;
          } else {
            result.skipped += 1;
            result.duplicates.push({ row: row.sourceRow, name, category: categoryName });
          }
          continue;
        }
        const inserted = insertProduct.run(
          generateProductCode(category.id), name, retailPrice, purchasePrice,
          wholesalePrice, retailPrice, stock, category.id
        );
        existingProducts.set(duplicateKey, Number(inserted.lastInsertRowid));
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
  db.exec('BEGIN IMMEDIATE');
  try {
    assertProductIsUnique(db, product);
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
    db.exec('COMMIT');
    return getProduct(Number(result.lastInsertRowid));
  } catch (error) {
    db.exec('ROLLBACK');
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
  db.exec('BEGIN IMMEDIATE');
  try {
    assertProductIsUnique(db, product, productId);
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
    db.exec('COMMIT');
    return getProduct(productId);
  } catch (error) {
    db.exec('ROLLBACK');
    if (String(error.message).includes('UNIQUE')) throw new Error('کد یا بارکد کالا تکراری است.');
    throw error;
  }
}

function updateProductQuick(id, payload = {}) {
  const db = requireDatabase();
  const productId = Number(id);
  const current = db.prepare('SELECT id, purchase_price AS purchasePrice, wholesale_price AS wholesalePrice, retail_price AS retailPrice, sale_price AS salePrice, stock FROM products WHERE id = ?').get(productId);
  if (!current) throw new Error('کالا پیدا نشد.');
  const purchasePrice = payload.purchasePrice === undefined ? Number(current.purchasePrice || 0) : Math.max(0, Math.round(Number(payload.purchasePrice) || 0));
  const wholesalePrice = payload.wholesalePrice === undefined ? Number(current.wholesalePrice || 0) : Math.max(0, Math.round(Number(payload.wholesalePrice) || 0));
  const retailPrice = payload.retailPrice === undefined ? Number(current.retailPrice || current.salePrice || 0) : Math.max(0, Math.round(Number(payload.retailPrice) || 0));
  const stock = payload.stock === undefined ? Number(current.stock || 0) : Math.max(0, Number(payload.stock) || 0);
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
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayIso = yesterday.toISOString().slice(0, 10);
  const yesterdaySales = db.prepare(
    "SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE status = 'active' AND date = ?"
  ).get(yesterdayIso);
  const inventory = db.prepare('SELECT COALESCE(SUM(stock), 0) AS stock, COUNT(*) AS count FROM products WHERE is_active = 1').get();
  const inventoryValue = db.prepare(`
    SELECT COALESCE(SUM(stock * purchase_price), 0) AS purchaseValue,
      COALESCE(SUM(stock * CASE WHEN retail_price > 0 THEN retail_price ELSE sale_price END), 0) AS retailValue
    FROM products WHERE is_active = 1
  `).get();
  const lowStock = db.prepare(
    'SELECT COUNT(*) AS count FROM products WHERE is_active = 1 AND stock <= minimum_stock'
  ).get();
  const salesTrend = db.prepare(`
    SELECT s.date, COALESCE(SUM(s.total), 0) AS sales,
      COALESCE(SUM(s.total - s.tax - s.cost_total), 0) AS profit
    FROM sales s
    WHERE s.status = 'active' AND s.date >= date(?, '-13 day')
    GROUP BY s.date ORDER BY s.date
  `).all(today);
  const paymentBreakdown = db.prepare(`
    SELECT ip.method, COALESCE(SUM(ip.amount), 0) AS amount
    FROM invoice_payments ip
    LEFT JOIN sales s ON s.id = ip.sale_id
    LEFT JOIN purchases p ON p.id = ip.purchase_id
    WHERE (s.status = 'active' OR p.status = 'completed')
      AND COALESCE(substr(s.date, 1, 7), substr(p.date, 1, 7)) = ?
    GROUP BY ip.method ORDER BY amount DESC
  `).all(month);
  const topProducts = db.prepare(`
    SELECT p.name, COALESCE(SUM(si.quantity), 0) AS quantity,
      COALESCE(SUM(si.total), 0) AS netSales
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    JOIN products p ON p.id = si.product_id
    WHERE s.status = 'active' AND substr(s.date, 1, 7) = ?
    GROUP BY p.id, p.name ORDER BY quantity DESC, netSales DESC LIMIT 50
  `).all(month);
  const categorySales = db.prepare(`
    SELECT COALESCE(c.name, 'بدون دسته‌بندی') AS categoryName,
      COALESCE(SUM(si.total), 0) AS netSales,
      COALESCE(SUM(si.quantity), 0) AS quantity
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id AND s.status = 'active'
    JOIN products p ON p.id = si.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE substr(s.date, 1, 7) = ?
    GROUP BY c.id, c.name
    ORDER BY netSales DESC LIMIT 8
  `).all(month);
  const recentSales = db.prepare(`
    SELECT s.id, s.invoice_number AS invoiceNumber, s.date, s.source, s.total,
      s.paid_amount AS paidAmount, s.remaining_amount AS remainingAmount,
      COALESCE(s.party_name, '') AS partyName
    FROM sales s WHERE s.status = 'active'
    ORDER BY s.date DESC, s.id DESC LIMIT 50
  `).all();
  const topDebtors = db.prepare(`
    SELECT partyName, SUM(balance) AS balance FROM (
      SELECT COALESCE(NULLIF(TRIM(first_name || ' ' || COALESCE(last_name, '')), ''), code) AS partyName, balance
      FROM parties WHERE is_active = 1 AND balance > 0
      UNION ALL
      SELECT name AS partyName, balance FROM customers WHERE is_active = 1 AND balance > 0
      UNION ALL
      SELECT name AS partyName, balance FROM suppliers WHERE is_active = 1 AND balance > 0
    ) GROUP BY partyName ORDER BY balance DESC LIMIT 50
  `).all();
  const cashMonth = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
    FROM cash_transactions WHERE substr(date, 1, 7) = ?
  `).get(month);
  const monthProfit = db.prepare(`
    SELECT COALESCE(SUM(total - tax - cost_total), 0) AS profit
    FROM sales WHERE status = 'active' AND substr(date, 1, 7) = ?
  `).get(month);
  const receivables = db.prepare(`
    SELECT COALESCE(SUM(remaining_amount), 0) AS amount
    FROM sales WHERE status = 'active' AND remaining_amount > 0
  `).get();
  return {
    todaySales: Number(todaySales.total),
    todayCount: Number(todaySales.count),
    monthSales: Number(monthSales.total),
    yesterdaySales: Number(yesterdaySales.total),
    salesChangePct: Number(yesterdaySales.total) > 0
      ? Number(((Number(todaySales.total) - Number(yesterdaySales.total)) / Number(yesterdaySales.total) * 100).toFixed(1))
      : (Number(todaySales.total) > 0 ? 100 : 0),
    inventory: Number(inventory.stock),
    productCount: Number(inventory.count),
    inventoryValue: { purchase: Number(inventoryValue.purchaseValue), retail: Number(inventoryValue.retailValue) },
    lowStock: Number(lowStock.count),
    salesTrend: salesTrend.map((row) => ({ date: row.date, sales: Number(row.sales), profit: Number(row.profit) })),
    paymentBreakdown: paymentBreakdown.map((row) => ({ method: row.method, amount: Number(row.amount) })),
    topProducts: topProducts.map((row) => ({ name: row.name, quantity: Number(row.quantity), netSales: Number(row.netSales) })),
    categorySales: categorySales.map((row) => ({ categoryName: row.categoryName, quantity: Number(row.quantity), netSales: Number(row.netSales) })),
    recentSales: recentSales.map((row) => ({ ...row, total: Number(row.total), paidAmount: Number(row.paidAmount), remainingAmount: Number(row.remainingAmount) })),
    topDebtors: topDebtors.map((row) => ({ partyName: row.partyName, balance: Number(row.balance) })),
    cashMonth: { income: Number(cashMonth.income), expense: Number(cashMonth.expense) },
    monthProfit: Number(monthProfit.profit),
    receivables: Number(receivables.amount)
  };
}

function listNotifications(payload = {}) {
  const db = requireDatabase();
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.today || ''))
    ? String(payload.today)
    : new Date().toISOString().slice(0, 10);
  const daysAhead = Math.max(0, Math.min(30, Number(payload.daysAhead ?? 7)));
  const horizonDate = new Date(`${today}T00:00:00Z`);
  horizonDate.setUTCDate(horizonDate.getUTCDate() + daysAhead);
  const horizon = horizonDate.toISOString().slice(0, 10);
  const alerts = [];
  const add = (alert) => alerts.push({ id: `${alert.type}-${alert.entityType || 'system'}-${alert.entityId || alert.date || alerts.length}`, ...alert });

  db.prepare(`
    SELECT ip.id, ip.amount, ip.check_number AS checkNumber, ip.due_date AS dueDate,
      COALESCE(s.invoice_number, p.invoice_number) AS invoiceNumber,
      COALESCE(s.party_name, p.party_name, '') AS partyName
    FROM invoice_payments ip
    LEFT JOIN sales s ON s.id = ip.sale_id
    LEFT JOIN purchases p ON p.id = ip.purchase_id
    WHERE ip.method = 'check' AND ip.check_status = 'pending'
      AND ip.due_date IS NOT NULL AND ip.due_date <= ?
    ORDER BY ip.due_date, ip.id LIMIT 100
  `).all(horizon).forEach((row) => {
    const overdue = row.dueDate < today;
    add({
      type: overdue ? 'check-overdue' : 'check-due',
      severity: overdue ? 'danger' : 'warning',
      title: overdue ? 'چک سررسیدگذشته' : 'چک نزدیک سررسید',
      message: `${row.checkNumber || 'بدون شماره'} · ${row.partyName || row.invoiceNumber || 'بدون طرف‌حساب'} · سررسید ${row.dueDate}`,
      entityType: 'check',
      entityId: row.id,
      date: row.dueDate,
      actionPage: 'checks'
    });
  });

  refreshInstallmentStatuses(db, null, today);
  db.prepare(`
    SELECT i.id, i.due_date AS dueDate, i.amount, i.paid_amount AS paidAmount,
      ip.invoice_kind AS invoiceKind, ip.invoice_id AS invoiceId,
      COALESCE(s.invoice_number, p.invoice_number) AS invoiceNumber,
      COALESCE(s.party_name, p.party_name, '') AS partyName
    FROM installments i
    JOIN installment_plans ip ON ip.id = i.plan_id
    LEFT JOIN sales s ON ip.invoice_kind = 'sale' AND s.id = ip.invoice_id
    LEFT JOIN purchases p ON ip.invoice_kind = 'purchase' AND p.id = ip.invoice_id
    WHERE ip.status = 'active' AND i.status IN ('pending', 'partial', 'overdue')
      AND i.due_date <= ?
    ORDER BY i.due_date, i.id LIMIT 100
  `).all(horizon).forEach((row) => {
    const overdue = row.dueDate < today;
    const remaining = Number(row.amount) - Number(row.paidAmount || 0);
    add({
      type: overdue ? 'installment-overdue' : 'installment-due',
      severity: overdue ? 'danger' : 'warning',
      title: overdue ? 'قسط معوق' : 'قسط نزدیک سررسید',
      message: `${row.invoiceNumber || 'بدون شماره'} · ${row.partyName || 'بدون طرف‌حساب'} · مانده ${remaining} · سررسید ${row.dueDate}`,
      entityType: 'installment',
      entityId: row.id,
      date: row.dueDate,
      actionPage: 'installments'
    });
  });

  db.prepare(`
    SELECT id, invoice_number AS invoiceNumber, remaining_amount AS remainingAmount,
      date, party_name AS partyName, 'sale' AS invoiceKind
    FROM sales WHERE status = 'active' AND remaining_amount > 0
    UNION ALL
    SELECT id, invoice_number AS invoiceNumber, remaining_amount AS remainingAmount,
      date, party_name AS partyName, 'purchase' AS invoiceKind
    FROM purchases WHERE status = 'completed' AND remaining_amount > 0
    ORDER BY date DESC, id DESC LIMIT 100
  `).all().forEach((row) => add({
    type: 'unpaid-invoice',
    severity: 'info',
    title: row.invoiceKind === 'sale' ? 'فاکتور فروش تسویه‌نشده' : 'فاکتور خرید تسویه‌نشده',
    message: `${row.invoiceNumber || 'بدون شماره'} · ${row.partyName || 'بدون طرف‌حساب'} · مانده ${row.remainingAmount}`,
    entityType: row.invoiceKind,
    entityId: row.id,
    date: row.date,
    actionPage: row.invoiceKind === 'sale' ? 'sales-invoices' : 'purchase-invoices'
  }));

  db.prepare(`
    SELECT id, name, stock, minimum_stock AS minimumStock
    FROM products
    WHERE is_active = 1 AND stock <= minimum_stock
    ORDER BY stock ASC, name LIMIT 100
  `).all().forEach((row) => add({
    type: 'low-stock',
    severity: Number(row.stock) < 0 ? 'danger' : 'warning',
    title: Number(row.stock) < 0 ? 'موجودی منفی' : 'موجودی کمتر از حداقل',
    message: `${row.name} · موجودی ${row.stock} از حداقل ${row.minimumStock}`,
    entityType: 'product',
    entityId: row.id,
    actionPage: 'inventory'
  }));

  const severityRank = { danger: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => (severityRank[a.severity] - severityRank[b.severity]) || String(a.date || '').localeCompare(String(b.date || '')));
  return {
    alerts,
    counts: {
      total: alerts.length,
      danger: alerts.filter((item) => item.severity === 'danger').length,
      warning: alerts.filter((item) => item.severity === 'warning').length,
      info: alerts.filter((item) => item.severity === 'info').length
    },
    generatedAt: new Date().toISOString()
  };
}

function getSalesReport(payload = {}) {
  const db = requireDatabase();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.from || '')) ? String(payload.from) : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.to || '')) ? String(payload.to) : '';
  const source = ['daily', 'invoice'].includes(String(payload.source || '')) ? String(payload.source) : '';
  const period = ['day', 'week', 'month', 'year'].includes(String(payload.period || '')) ? String(payload.period) : 'day';
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
  const periodExpression = {
    day: 's.date',
    week: "date(s.date, '-' || ((CAST(strftime('%w', s.date) AS INTEGER) + 1) % 7) || ' days')",
    month: "substr(s.date, 1, 7)",
    year: "substr(s.date, 1, 4)"
  }[period];
  const byPeriod = db.prepare(`
    SELECT ${periodExpression} AS period,
      COUNT(*) AS invoiceCount,
      COALESCE(SUM(s.item_count), 0) AS itemCount,
      COALESCE(SUM(s.total), 0) AS total,
      COALESCE(SUM(CASE WHEN s.total > s.tax THEN s.total - s.tax ELSE 0 END), 0) AS netSales,
      COALESCE(SUM(s.cost_total), 0) AS costTotal,
      COALESCE(SUM(CASE WHEN s.total > s.tax THEN s.total - s.tax ELSE 0 END - s.cost_total), 0) AS profitTotal,
      COALESCE(SUM(s.paid_amount), 0) AS paidAmount,
      COALESCE(SUM(s.remaining_amount), 0) AS remainingAmount,
      COALESCE(SUM(CASE WHEN s.source = 'daily' THEN 1 ELSE 0 END), 0) AS dailyCount,
      COALESCE(SUM(CASE WHEN s.source = 'invoice' THEN 1 ELSE 0 END), 0) AS formalCount
    FROM sales s WHERE ${where}
    GROUP BY ${periodExpression} ORDER BY period
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
    ORDER BY quantity DESC, netSales DESC LIMIT 20
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
    filters: { from, to, source, period },
    summary: castRows([summary])[0],
    byDate: castRows(byDate),
    byPeriod: castRows(byPeriod),
    period,
    bySource: castRows(bySource),
    byProduct: castRows(byProduct),
    byCustomer: castRows(byCustomer)
  };
}
function getSalesForecast(payload = {}) {
  const period = String(payload.period || '') === 'year' ? 'year' : 'month';
  const report = getSalesReport({ period, source: payload.source });
  return buildSalesForecast(report.byPeriod, { period, horizon: payload.horizon });
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
  requirePermission('sales');
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
    auditLog('sale.create', 'sale', saleId, { invoiceNumber, total: totals.total });
    return { id: saleId, invoiceNumber, costTotal, profitTotal, itemCount, ...totals };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function createPurchase(payload = {}) {
  const db = requireDatabase();
  requirePermission('purchases');
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
    auditLog('purchase.create', 'purchase', purchaseId, { invoiceNumber, total });
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
  const requestedStatus = String(payload.status || '');
  const showMerged = kind === 'sale' && requestedStatus === 'merged';
  const status = ['active', 'completed', 'cancelled'].includes(requestedStatus) ? requestedStatus : '';
  const mergeColumns = kind === 'sale'
    ? `,
      (SELECT merged_sale_id FROM sale_merge_sources WHERE source_sale_id = i.id) AS mergedIntoSaleId,
      (SELECT target.invoice_number FROM sale_merge_sources sms JOIN sales target ON target.id = sms.merged_sale_id WHERE sms.source_sale_id = i.id) AS mergedIntoInvoiceNumber`
    : ', NULL AS mergedIntoSaleId, NULL AS mergedIntoInvoiceNumber';
  const mergeFilter = kind === 'sale'
    ? (showMerged
      ? 'AND EXISTS (SELECT 1 FROM sale_merge_sources sms WHERE sms.source_sale_id = i.id)'
      : 'AND NOT EXISTS (SELECT 1 FROM sale_merge_sources sms WHERE sms.source_sale_id = i.id)')
    : '';
  const rows = db.prepare(`
    SELECT i.id, i.invoice_number AS invoiceNumber, i.date, i.subtotal, i.discount, i.tax,
      i.total, i.paid_amount AS paidAmount, i.remaining_amount AS remainingAmount,
      i.status, ${sourceExpression} AS source, i.created_at AS createdAt,
      COALESCE(i.party_name, trim(p.first_name || ' ' || COALESCE(p.last_name, '')), c.name, s.name, '') AS partyName,
      COALESCE(i.party_phone, p.phone, p.mobile, c.phone, s.phone, '') AS partyPhone,
      COALESCE(i.party_address, p.address, s.address, '') AS partyAddress,
      (SELECT COUNT(*) FROM ${kind === 'sale' ? 'sale_items' : 'purchase_items'} ii WHERE ii.${kind === 'sale' ? 'sale' : 'purchase'}_id = i.id) AS itemCount
      ${mergeColumns}
    FROM ${table} i
    LEFT JOIN parties p ON p.id = i.party_id
    LEFT JOIN customers c ON c.id = i.${partyColumn}
    LEFT JOIN suppliers s ON s.id = i.${partyColumn}
    WHERE (? = '' OR i.invoice_number LIKE ? OR COALESCE(i.party_name, '') LIKE ? OR COALESCE(p.first_name || ' ' || p.last_name, '') LIKE ? OR COALESCE(c.name, '') LIKE ? OR COALESCE(s.name, '') LIKE ? OR COALESCE(c.phone, '') LIKE ? OR COALESCE(s.phone, '') LIKE ?)
      AND (? = '' OR i.date >= ?) AND (? = '' OR i.date <= ?)
      ${mergeFilter}
      AND (? = '' OR i.status = ?)
    ORDER BY i.date DESC, i.id DESC
    LIMIT 500
  `).all(query, term, term, term, term, term, term, term, from, from, to, to, status, status);
  return rows.map((row) => ({ ...row, itemCount: Number(row.itemCount || 0) }));
}

function listSales(payload = {}) { return invoiceListQuery('sale', payload); }
function listPurchases(payload = {}) { return invoiceListQuery('purchase', payload); }

function mergeDailySales(payload = {}) {
  const db = requireDatabase();
  requirePermission('sales');
  const sourceIds = [...new Set((Array.isArray(payload.saleIds) ? payload.saleIds : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0))];
  if (!sourceIds.length) throw new Error('حداقل یک فاکتور فروش روزانه را انتخاب کنید.');
  const date = String(payload.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('تاریخ فاکتور ادغامی معتبر نیست.');
  const partyId = Number(payload.partyId);
  if (!Number.isInteger(partyId) || partyId <= 0) throw new Error('انتخاب مشتری برای فاکتور ادغامی الزامی است.');

  db.exec('BEGIN IMMEDIATE');
  try {
    const placeholders = sourceIds.map(() => '?').join(', ');
    const sources = db.prepare(`
      SELECT id, invoice_number AS invoiceNumber, date, subtotal, discount, tax, total,
        paid_amount AS paidAmount, remaining_amount AS remainingAmount,
        cost_total AS costTotal, profit_total AS profitTotal, item_count AS itemCount,
        source, status
      FROM sales WHERE id IN (${placeholders}) ORDER BY id
    `).all(...sourceIds);
    if (sources.length !== sourceIds.length) throw new Error('یکی از فاکتورهای انتخاب‌شده پیدا نشد.');
    if (sources.some((sale) => sale.source !== 'daily' || sale.status !== 'active' || sale.date !== date)) {
      throw new Error('فقط فاکتورهای فعالِ فروش روزانه با یک تاریخ مشترک قابل ادغام هستند.');
    }
    const party = db.prepare(`
      SELECT id, trim(first_name || ' ' || COALESCE(last_name, '')) AS name,
        phone, mobile, address, party_type AS partyType
      FROM parties WHERE id = ? AND is_active = 1
    `).get(partyId);
    if (!party || !['customer', 'both'].includes(party.partyType)) throw new Error('مشتری انتخاب‌شده معتبر نیست.');
    const returnCount = db.prepare(`
      SELECT COUNT(*) AS count FROM sales_returns
      WHERE sale_id IN (${placeholders}) AND status = 'completed'
    `).get(...sourceIds).count;
    if (returnCount) throw new Error('فاکتور دارای مرجوعی قابل ادغام نیست.');
    const installmentCount = db.prepare(`
      SELECT COUNT(*) AS count FROM installment_plans
      WHERE invoice_kind = 'sale' AND invoice_id IN (${placeholders}) AND status <> 'cancelled'
    `).get(...sourceIds).count;
    if (installmentCount) throw new Error('فاکتور دارای برنامه اقساط قابل ادغام نیست.');

    const payments = db.prepare(`
      SELECT id, sale_id AS saleId, amount FROM invoice_payments
      WHERE sale_id IN (${placeholders}) ORDER BY id
    `).all(...sourceIds);
    const paymentTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const declaredPaid = sources.reduce((sum, sale) => sum + Number(sale.paidAmount || 0), 0);
    if (paymentTotal !== declaredPaid) throw new Error('جمع پرداخت‌های یکی از فاکتورها با اطلاعات ثبت‌شده همخوانی ندارد.');

    const totals = sources.reduce((result, sale) => ({
      subtotal: result.subtotal + Number(sale.subtotal || 0),
      discount: result.discount + Number(sale.discount || 0),
      tax: result.tax + Number(sale.tax || 0),
      total: result.total + Number(sale.total || 0),
      paidAmount: result.paidAmount + Number(sale.paidAmount || 0),
      remainingAmount: result.remainingAmount + Number(sale.remainingAmount || 0),
      costTotal: result.costTotal + Number(sale.costTotal || 0),
      profitTotal: result.profitTotal + Number(sale.profitTotal || 0),
      itemCount: result.itemCount + Number(sale.itemCount || 0)
    }), { subtotal: 0, discount: 0, tax: 0, total: 0, paidAmount: 0, remainingAmount: 0, costTotal: 0, profitTotal: 0, itemCount: 0 });
    if (totals.total !== totals.paidAmount + totals.remainingAmount) throw new Error('مانده فاکتورهای انتخاب‌شده معتبر نیست.');
    const invoiceNumber = nextInvoiceNumber(db, 'sale', date);
    const sourceNumbers = sources.map((sale) => sale.invoiceNumber).join('، ');
    const target = db.prepare(`
      INSERT INTO sales
        (invoice_number, party_id, party_name, party_phone, party_address, date, subtotal, discount, tax, total, paid_amount, remaining_amount, cost_total, profit_total, item_count, source, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'invoice', 'active', ?)
    `).run(
      invoiceNumber, party.id, party.name, party.phone || party.mobile || null, party.address || null,
      date, totals.subtotal, totals.discount, totals.tax, totals.total, totals.paidAmount,
      totals.remainingAmount, totals.costTotal, totals.profitTotal, totals.itemCount,
      `ادغام فروش‌های روزانه: ${sourceNumbers}`
    );
    const mergedSaleId = Number(target.lastInsertRowid);
    db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount, total, purchase_price, profit, price_type)
      SELECT ?, product_id, quantity, unit_price, discount, total, purchase_price, profit, price_type
      FROM sale_items WHERE sale_id IN (${placeholders}) ORDER BY id
    `).run(mergedSaleId, ...sourceIds);
    db.prepare(`UPDATE invoice_payments SET sale_id = ? WHERE sale_id IN (${placeholders})`).run(mergedSaleId, ...sourceIds);
    db.prepare(`
      INSERT INTO sale_merge_sources (source_sale_id, merged_sale_id)
      VALUES ${sourceIds.map(() => '(?, ?)').join(', ')}
    `).run(...sourceIds.flatMap((sourceId) => [sourceId, mergedSaleId]));
    db.prepare(`
      UPDATE sales
      SET status = 'cancelled', paid_amount = 0, remaining_amount = 0,
        notes = trim(COALESCE(notes, '') || CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE '\n' END || ?),
        updated_at = CURRENT_TIMESTAMP
      WHERE id IN (${placeholders})
    `).run(`ادغام‌شده در فاکتور ${invoiceNumber}`, ...sourceIds);
    if (totals.remainingAmount > 0) {
      db.prepare('UPDATE parties SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(totals.remainingAmount, party.id);
    }
    db.exec('COMMIT');
    auditLog('sale.merge_daily', 'sale', mergedSaleId, { invoiceNumber, sourceSaleIds: sourceIds, sourceInvoiceNumbers: sources.map((sale) => sale.invoiceNumber) });
    return { id: mergedSaleId, invoiceNumber, date, sourceSaleIds: sourceIds, ...totals };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getPurchasePriceHistory(productId, payload = {}) {
  const db = requireDatabase();
  const id = Number(productId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('کالای موردنظر معتبر نیست.');

  const limit = Math.min(50, Math.max(1, Math.floor(Number(payload.limit) || 15)));
  const partyId = Number(payload.partyId || 0);
  const baseQuery = `
    WITH returned_items AS (
      SELECT pri.purchase_item_id AS purchase_item_id, SUM(pri.quantity) AS returned_quantity
      FROM purchase_return_items pri
      JOIN purchase_returns pr ON pr.id = pri.return_id
      WHERE pr.status = 'completed'
      GROUP BY pri.purchase_item_id
    )
    SELECT
      pi.id AS purchaseItemId,
      pu.id AS purchaseId,
      pu.invoice_number AS invoiceNumber,
      pu.date,
      pu.party_id AS partyId,
      COALESCE(
        NULLIF(trim(pu.party_name), ''),
        NULLIF(trim(COALESCE(pt.first_name, '') || ' ' || COALESCE(pt.last_name, '')), ''),
        NULLIF(trim(s.name), ''),
        'بدون تأمین‌کننده'
      ) AS supplierName,
      pi.quantity,
      pi.unit_price AS unitPrice,
      pi.discount AS discount,
      pi.total AS lineTotal,
      CAST(ROUND(CAST(pi.total AS REAL) / pi.quantity) AS INTEGER) AS effectiveUnitPrice,
      COALESCE(ri.returned_quantity, 0) AS returnedQuantity,
      CASE WHEN ? > 0 AND pu.party_id = ? THEN 1 ELSE 0 END AS isSelectedSupplier
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchase_id
    LEFT JOIN parties pt ON pt.id = pu.party_id
    LEFT JOIN suppliers s ON s.id = pu.supplier_id
    LEFT JOIN returned_items ri ON ri.purchase_item_id = pi.id
    WHERE pi.product_id = ? AND pu.status = 'completed'
  `;
  const items = db.prepare(`${baseQuery} ORDER BY pu.date DESC, pi.id DESC LIMIT ?`)
    .all(partyId, partyId, id, limit);
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS count,
      MIN(pi.unit_price) AS minUnitPrice,
      MAX(pi.unit_price) AS maxUnitPrice,
      CAST(ROUND(SUM(pi.total) * 1.0 / NULLIF(SUM(pi.quantity), 0)) AS INTEGER) AS averageEffectiveUnitPrice,
      SUM(CASE WHEN ? > 0 AND pu.party_id = ? THEN 1 ELSE 0 END) AS selectedSupplierCount
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchase_id
    WHERE pi.product_id = ? AND pu.status = 'completed'
  `).get(partyId, partyId, id);

  return {
    items,
    summary: {
      count: Number(summary.count || 0),
      minUnitPrice: Number(summary.minUnitPrice || 0),
      maxUnitPrice: Number(summary.maxUnitPrice || 0),
      averageEffectiveUnitPrice: Number(summary.averageEffectiveUnitPrice || 0),
      selectedSupplierCount: Number(summary.selectedSupplierCount || 0)
    }
  };
}

function updateSale(id, payload = {}) {
  const db = requireDatabase();
  requirePermission('sales');
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
    auditLog('sale.update', 'sale', saleId);
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
  requirePermission(kind === 'sale' ? 'sales' : 'purchases');
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
    auditLog('invoice.settle', kind, invoiceId, { amount: payment.amount });
    return getInvoiceDetails(kind, invoiceId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function cancelInvoice(kind, id) {
  const db = requireDatabase();
  requirePermission(kind === 'sale' ? 'sales' : 'purchases');
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
    auditLog('invoice.cancel', kind, invoiceId);
    return getInvoiceDetails(kind, invoiceId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function nextReturnNumber(db, date) {
  const year = String(gregorianToJalaliYear(date));
  const rows = db.prepare('SELECT return_number AS number FROM sales_returns WHERE return_number LIKE ?').all(`R-${year}-%`);
  const sequence = rows.reduce((max, row) => {
    const match = String(row.number).match(/-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  return `R-${year}-${String(sequence).padStart(6, '0')}`;
}

function createSaleReturn(payload = {}) {
  const db = requireDatabase();
  requirePermission('returns');
  const saleId = Number(payload.saleId);
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  if (!sale) throw new Error('فاکتور فروش پیدا نشد.');
  if (sale.status === 'cancelled') throw new Error('فاکتور لغوشده قابل مرجوعی نیست.');
  const requested = Array.isArray(payload.items) ? payload.items : [];
  if (!requested.length) throw new Error('حداقل یک قلم برای مرجوعی انتخاب کنید.');
  const saleItems = db.prepare(`
    SELECT si.*, p.name AS productName
    FROM sale_items si JOIN products p ON p.id = si.product_id
    WHERE si.sale_id = ?
  `).all(saleId);
  const returned = db.prepare(`
    SELECT sri.sale_item_id AS saleItemId, SUM(sri.quantity) AS quantity
    FROM sales_return_items sri JOIN sales_returns sr ON sr.id = sri.return_id
    WHERE sr.sale_id = ? AND sr.status = 'completed'
    GROUP BY sri.sale_item_id
  `).all(saleId);
  const returnedMap = new Map(returned.map((row) => [Number(row.saleItemId), Number(row.quantity || 0)]));
  const items = requested.map((raw) => {
    const saleItem = saleItems.find((item) => Number(item.id) === Number(raw.saleItemId)
      || Number(item.product_id) === Number(raw.productId));
    if (!saleItem) throw new Error('قلم فاکتور برای مرجوعی پیدا نشد.');
    const quantity = Number(raw.quantity);
    const available = Number(saleItem.quantity) - (returnedMap.get(Number(saleItem.id)) || 0);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > available + 1e-9) {
      throw new Error(`تعداد مرجوعی «${saleItem.productName}» بیشتر از مقدار قابل مرجوعی است.`);
    }
    const lineDiscount = saleItem.quantity > 0
      ? Math.min(Number(saleItem.discount || 0), Math.round(Number(saleItem.discount || 0) * quantity / Number(saleItem.quantity)))
      : 0;
    return {
      saleItemId: Number(saleItem.id),
      productId: Number(saleItem.product_id),
      productName: saleItem.productName,
      quantity,
      unitPrice: Number(saleItem.unit_price || 0),
      discount: lineDiscount,
      total: Math.max(0, Math.round(quantity * Number(saleItem.unit_price || 0)) - lineDiscount)
    };
  });
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const refundAmount = Math.min(total, Math.max(0, Math.round(Number(payload.refundAmount || 0))));
  const date = normalizeInvoiceDate(payload.date);
  const returnNumber = String(payload.returnNumber || '').trim() || nextReturnNumber(db, date);
  db.exec('BEGIN IMMEDIATE');
  try {
    const balanceReduction = Math.min(total, Number(sale.remaining_amount || 0));
    const result = db.prepare(`
      INSERT INTO sales_returns (return_number, sale_id, date, total, refund_amount, reason, status, balance_adjustment)
      VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)
    `).run(returnNumber, saleId, date, total, refundAmount, String(payload.reason || '').trim(), balanceReduction);
    const returnId = Number(result.lastInsertRowid);
    const insertItem = db.prepare(`
      INSERT INTO sales_return_items (return_id, sale_item_id, product_id, quantity, unit_price, discount, total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const updateStock = db.prepare('UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const movement = db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity, reference_type, reference_id, description)
      VALUES (?, 'sale_return', ?, 'sale_return', ?, ?)
    `);
    for (const item of items) {
      insertItem.run(returnId, item.saleItemId, item.productId, item.quantity, item.unitPrice, item.discount, item.total);
      updateStock.run(item.quantity, item.productId);
      movement.run(item.productId, item.quantity, returnId, `مرجوعی ${returnNumber}`);
    }
    // A return reduces the outstanding receivable associated with the sale.
    // Keep legacy customer records and the newer party ledger in sync.
    if (balanceReduction > 0) {
      if (sale.party_id) {
        db.prepare('UPDATE parties SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(balanceReduction, sale.party_id);
      }
      if (sale.customer_id) {
        db.prepare('UPDATE customers SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(balanceReduction, sale.customer_id);
      }
    }
    if (refundAmount > 0) {
      db.prepare(`
        INSERT INTO cash_transactions (type, category, amount, method, date, description, reference_type, reference_id)
        VALUES ('expense', 'sales_return', ?, ?, ?, ?, 'sales_return', ?)
      `).run(refundAmount, String(payload.method || 'cash').match(/^(cash|card|bank|other)$/)?.[1] || 'cash', date, `استرداد مرجوعی ${returnNumber}`, returnId);
    }
    db.exec('COMMIT');
    auditLog('sale_return.create', 'sales_return', returnId, { returnNumber, total, refundAmount });
    return getSaleReturnDetails(returnId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getSaleReturnDetails(id) {
  const db = requireDatabase();
  const returnId = Number(id);
  const row = db.prepare(`
    SELECT sr.*, s.invoice_number AS saleInvoiceNumber,
      COALESCE(s.party_name, '') AS partyName
    FROM sales_returns sr JOIN sales s ON s.id = sr.sale_id
    WHERE sr.id = ?
  `).get(returnId);
  if (!row) throw new Error('مرجوعی پیدا نشد.');
  const items = db.prepare(`
    SELECT sri.*, p.name AS productName, p.code AS productCode
    FROM sales_return_items sri JOIN products p ON p.id = sri.product_id
    WHERE sri.return_id = ? ORDER BY sri.id
  `).all(returnId);
  return { ...row, items };
}

function listSalesReturns(payload = {}) {
  const db = requireDatabase();
  const query = String(payload.query || '').trim();
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  return db.prepare(`
    SELECT sr.id, sr.return_number AS returnNumber, sr.sale_id AS saleId,
      sr.date, sr.total, sr.refund_amount AS refundAmount, sr.reason, sr.status,
      s.invoice_number AS saleInvoiceNumber, COALESCE(s.party_name, '') AS partyName
    FROM sales_returns sr JOIN sales s ON s.id = sr.sale_id
    WHERE (? = '' OR sr.return_number LIKE ? OR s.invoice_number LIKE ? OR COALESCE(s.party_name, '') LIKE ?)
      AND (? = '' OR sr.date >= ?) AND (? = '' OR sr.date <= ?)
    ORDER BY sr.date DESC, sr.id DESC LIMIT 500
  `).all(query, `%${query}%`, `%${query}%`, `%${query}%`, from, from, to, to);
}

function cancelSaleReturn(id) {
  const db = requireDatabase();
  requirePermission('returns');
  const returnId = Number(id);
  const record = db.prepare('SELECT * FROM sales_returns WHERE id = ?').get(returnId);
  if (!record) throw new Error('مرجوعی پیدا نشد.');
  if (record.status === 'cancelled') throw new Error('این مرجوعی قبلاً لغو شده است.');
  const items = db.prepare('SELECT product_id AS productId, quantity FROM sales_return_items WHERE return_id = ?').all(returnId);
  db.exec('BEGIN IMMEDIATE');
  try {
    const updateStock = db.prepare('UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const movement = db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity, reference_type, reference_id, description)
      VALUES (?, 'sale_return_cancel', ?, 'sales_return', ?, ?)
    `);
    for (const item of items) {
      const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.productId);
      if (!product || Number(product.stock) < Number(item.quantity)) throw new Error('موجودی فعلی برای لغو مرجوعی کافی نیست.');
      updateStock.run(item.quantity, item.productId);
      movement.run(item.productId, -Number(item.quantity), returnId, `لغو مرجوعی ${record.return_number}`);
    }
    const sale = db.prepare('SELECT party_id, customer_id FROM sales WHERE id = ?').get(record.sale_id);
    const balanceIncrease = Number(record.balance_adjustment || 0);
    if (balanceIncrease > 0) {
      if (sale?.party_id) {
        db.prepare('UPDATE parties SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(balanceIncrease, sale.party_id);
      }
      if (sale?.customer_id) {
        db.prepare('UPDATE customers SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(balanceIncrease, sale.customer_id);
      }
    }
    db.prepare("UPDATE sales_returns SET status = 'cancelled' WHERE id = ?").run(returnId);
    db.prepare("DELETE FROM cash_transactions WHERE reference_type = 'sales_return' AND reference_id = ?").run(returnId);
    db.exec('COMMIT');
    auditLog('sale_return.cancel', 'sales_return', returnId);
    return getSaleReturnDetails(returnId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function nextPurchaseReturnNumber(db, date) {
  const year = String(gregorianToJalaliYear(date));
  const rows = db.prepare('SELECT return_number AS number FROM purchase_returns WHERE return_number LIKE ?').all(`PR-${year}-%`);
  const sequence = rows.reduce((max, row) => {
    const match = String(row.number).match(/-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  return `PR-${year}-${String(sequence).padStart(6, '0')}`;
}

function createPurchaseReturn(payload = {}) {
  const db = requireDatabase();
  requirePermission('returns');
  const purchaseId = Number(payload.purchaseId);
  const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId);
  if (!purchase) throw new Error('فاکتور خرید پیدا نشد.');
  if (purchase.status === 'cancelled') throw new Error('فاکتور لغوشده قابل مرجوعی نیست.');
  const requested = Array.isArray(payload.items) ? payload.items : [];
  if (!requested.length) throw new Error('حداقل یک قلم برای مرجوعی خرید انتخاب کنید.');
  const purchaseItems = db.prepare(`
    SELECT pi.*, p.name AS productName
    FROM purchase_items pi JOIN products p ON p.id = pi.product_id
    WHERE pi.purchase_id = ?
  `).all(purchaseId);
  const returned = db.prepare(`
    SELECT pri.purchase_item_id AS purchaseItemId, SUM(pri.quantity) AS quantity
    FROM purchase_return_items pri JOIN purchase_returns pr ON pr.id = pri.return_id
    WHERE pr.purchase_id = ? AND pr.status = 'completed'
    GROUP BY pri.purchase_item_id
  `).all(purchaseId);
  const returnedMap = new Map(returned.map((row) => [Number(row.purchaseItemId), Number(row.quantity || 0)]));
  const items = requested.map((raw) => {
    const purchaseItem = purchaseItems.find((item) => Number(item.id) === Number(raw.purchaseItemId)
      || Number(item.product_id) === Number(raw.productId));
    if (!purchaseItem) throw new Error('قلم فاکتور خرید برای مرجوعی پیدا نشد.');
    const quantity = Number(raw.quantity);
    const available = Number(purchaseItem.quantity) - (returnedMap.get(Number(purchaseItem.id)) || 0);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > available + 1e-9) {
      throw new Error(`تعداد مرجوعی «${purchaseItem.productName}» بیشتر از مقدار قابل مرجوعی است.`);
    }
    const lineDiscount = purchaseItem.quantity > 0
      ? Math.min(Number(purchaseItem.discount || 0), Math.round(Number(purchaseItem.discount || 0) * quantity / Number(purchaseItem.quantity)))
      : 0;
    return {
      purchaseItemId: Number(purchaseItem.id),
      productId: Number(purchaseItem.product_id),
      productName: purchaseItem.productName,
      quantity,
      unitPrice: Number(purchaseItem.unit_price || 0),
      discount: lineDiscount,
      total: Math.max(0, Math.round(quantity * Number(purchaseItem.unit_price || 0)) - lineDiscount)
    };
  });
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const refundAmount = Math.min(total, Math.max(0, Math.round(Number(payload.refundAmount || 0))));
  const date = normalizeInvoiceDate(payload.date);
  const returnNumber = String(payload.returnNumber || '').trim() || nextPurchaseReturnNumber(db, date);
  db.exec('BEGIN IMMEDIATE');
  try {
    const balanceReduction = Math.min(total, Number(purchase.remaining_amount || 0));
    const result = db.prepare(`
      INSERT INTO purchase_returns (return_number, purchase_id, date, total, refund_amount, reason, status, balance_adjustment)
      VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)
    `).run(returnNumber, purchaseId, date, total, refundAmount, String(payload.reason || '').trim(), balanceReduction);
    const returnId = Number(result.lastInsertRowid);
    const insertItem = db.prepare(`
      INSERT INTO purchase_return_items (return_id, purchase_item_id, product_id, quantity, unit_price, discount, total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const updateStock = db.prepare('UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const movement = db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity, reference_type, reference_id, description)
      VALUES (?, 'purchase_return', ?, 'purchase_return', ?, ?)
    `);
    for (const item of items) {
      const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.productId);
      if (!product || Number(product.stock) < item.quantity) throw new Error(`موجودی «${item.productName}» برای مرجوعی خرید کافی نیست.`);
      insertItem.run(returnId, item.purchaseItemId, item.productId, item.quantity, item.unitPrice, item.discount, item.total);
      updateStock.run(item.quantity, item.productId);
      movement.run(item.productId, -item.quantity, returnId, `مرجوعی خرید ${returnNumber}`);
    }
    if (refundAmount > 0) {
      db.prepare(`
        INSERT INTO cash_transactions (type, category, amount, method, date, description, reference_type, reference_id)
        VALUES ('income', 'purchase_return', ?, ?, ?, ?, 'purchase_return', ?)
      `).run(refundAmount, String(payload.method || 'cash').match(/^(cash|card|bank|other)$/)?.[1] || 'cash', date, `دریافت بابت مرجوعی خرید ${returnNumber}`, returnId);
    }
    if (purchase.supplier_id && balanceReduction > 0) {
      db.prepare('UPDATE suppliers SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(balanceReduction, purchase.supplier_id);
    }
    if (purchase.party_id && balanceReduction > 0) {
      db.prepare('UPDATE parties SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(balanceReduction, purchase.party_id);
    }
    db.exec('COMMIT');
    auditLog('purchase_return.create', 'purchase_return', returnId, { returnNumber, total, refundAmount });
    return getPurchaseReturnDetails(returnId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getPurchaseReturnDetails(id) {
  const db = requireDatabase();
  const returnId = Number(id);
  const row = db.prepare(`
    SELECT pr.*, p.invoice_number AS purchaseInvoiceNumber, COALESCE(p.party_name, '') AS partyName
    FROM purchase_returns pr JOIN purchases p ON p.id = pr.purchase_id
    WHERE pr.id = ?
  `).get(returnId);
  if (!row) throw new Error('مرجوعی خرید پیدا نشد.');
  const items = db.prepare(`
    SELECT pri.*, p.name AS productName, p.code AS productCode
    FROM purchase_return_items pri JOIN products p ON p.id = pri.product_id
    WHERE pri.return_id = ? ORDER BY pri.id
  `).all(returnId);
  return { ...row, items };
}

function listPurchaseReturns(payload = {}) {
  const db = requireDatabase();
  const query = String(payload.query || '').trim();
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  return db.prepare(`
    SELECT pr.id, pr.return_number AS returnNumber, pr.purchase_id AS purchaseId,
      pr.date, pr.total, pr.refund_amount AS refundAmount, pr.reason, pr.status,
      p.invoice_number AS purchaseInvoiceNumber, COALESCE(p.party_name, '') AS partyName
    FROM purchase_returns pr JOIN purchases p ON p.id = pr.purchase_id
    WHERE (? = '' OR pr.return_number LIKE ? OR p.invoice_number LIKE ? OR COALESCE(p.party_name, '') LIKE ?)
      AND (? = '' OR pr.date >= ?) AND (? = '' OR pr.date <= ?)
    ORDER BY pr.date DESC, pr.id DESC LIMIT 500
  `).all(query, `%${query}%`, `%${query}%`, `%${query}%`, from, from, to, to);
}

function cancelPurchaseReturn(id) {
  const db = requireDatabase();
  requirePermission('returns');
  const returnId = Number(id);
  const record = db.prepare('SELECT * FROM purchase_returns WHERE id = ?').get(returnId);
  if (!record) throw new Error('مرجوعی خرید پیدا نشد.');
  if (record.status === 'cancelled') throw new Error('این مرجوعی خرید قبلاً لغو شده است.');
  const items = db.prepare('SELECT product_id AS productId, quantity FROM purchase_return_items WHERE return_id = ?').all(returnId);
  db.exec('BEGIN IMMEDIATE');
  try {
    const updateStock = db.prepare('UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const movement = db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity, reference_type, reference_id, description)
      VALUES (?, 'purchase_return_cancel', ?, 'purchase_return', ?, ?)
    `);
    for (const item of items) {
      updateStock.run(item.quantity, item.productId);
      movement.run(item.productId, Number(item.quantity), returnId, `لغو مرجوعی خرید ${record.return_number}`);
    }
    const purchase = db.prepare('SELECT supplier_id, party_id FROM purchases WHERE id = ?').get(record.purchase_id);
    const balanceIncrease = Number(record.balance_adjustment || 0);
    if (purchase?.supplier_id && balanceIncrease > 0) db.prepare('UPDATE suppliers SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(balanceIncrease, purchase.supplier_id);
    if (purchase?.party_id && balanceIncrease > 0) db.prepare('UPDATE parties SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(balanceIncrease, purchase.party_id);
    db.prepare("UPDATE purchase_returns SET status = 'cancelled' WHERE id = ?").run(returnId);
    db.prepare("DELETE FROM cash_transactions WHERE reference_type = 'purchase_return' AND reference_id = ?").run(returnId);
    db.exec('COMMIT');
    auditLog('purchase_return.cancel', 'purchase_return', returnId);
    return getPurchaseReturnDetails(returnId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function createCashTransaction(payload = {}) {
  const db = requireDatabase();
  requirePermission('cash');
  const type = ['income', 'expense'].includes(String(payload.type)) ? String(payload.type) : '';
  const method = ['cash', 'card', 'bank', 'other'].includes(String(payload.method)) ? String(payload.method) : 'cash';
  const amount = Math.round(Number(payload.amount || 0));
  if (!type) throw new Error('نوع تراکنش صندوق معتبر نیست.');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('مبلغ تراکنش باید بیشتر از صفر باشد.');
  const date = normalizeInvoiceDate(payload.date);
  const result = db.prepare(`
    INSERT INTO cash_transactions (type, category, amount, method, date, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(type, String(payload.category || 'general').trim() || 'general', amount, method, date, String(payload.description || '').trim());
  const transaction = getCashTransaction(Number(result.lastInsertRowid));
  auditLog('cash.create', 'cash_transaction', transaction.id, { type, amount, category: transaction.category });
  return transaction;
}

function getCashTransaction(id) {
  const db = requireDatabase();
  const row = db.prepare('SELECT id, type, category, amount, method, date, description, reference_type AS referenceType, reference_id AS referenceId, created_at AS createdAt FROM cash_transactions WHERE id = ?').get(Number(id));
  if (!row) throw new Error('تراکنش صندوق پیدا نشد.');
  return row;
}

function listCashTransactions(payload = {}) {
  const db = requireDatabase();
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  const type = ['income', 'expense'].includes(String(payload.type)) ? String(payload.type) : '';
  return db.prepare(`
    SELECT id, type, category, amount, method, date, description,
      reference_type AS referenceType, reference_id AS referenceId, created_at AS createdAt
    FROM cash_transactions
    WHERE (? = '' OR date >= ?) AND (? = '' OR date <= ?) AND (? = '' OR type = ?)
    ORDER BY date DESC, id DESC LIMIT 500
  `).all(from, from, to, to, type, type);
}

function getCashSummary(payload = {}) {
  const db = requireDatabase();
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  const manual = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
    FROM cash_transactions WHERE (? = '' OR date >= ?) AND (? = '' OR date <= ?)
  `).get(from, from, to, to);
  const payments = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN ip.method IN ('cash','card','bank') AND s.status = 'active' THEN ip.amount ELSE 0 END), 0) AS salesIncome,
      COALESCE(SUM(CASE WHEN ip.method IN ('cash','card','bank') AND p.status = 'completed' THEN ip.amount ELSE 0 END), 0) AS purchaseExpense
    FROM invoice_payments ip
    LEFT JOIN sales s ON s.id = ip.sale_id
    LEFT JOIN purchases p ON p.id = ip.purchase_id
    WHERE (? = '' OR COALESCE(s.date, p.date, substr(ip.paid_at, 1, 10)) >= ?)
      AND (? = '' OR COALESCE(s.date, p.date, substr(ip.paid_at, 1, 10)) <= ?)
  `).get(from, from, to, to);
  const income = Number(manual.income || 0) + Number(payments.salesIncome || 0);
  const expense = Number(manual.expense || 0) + Number(payments.purchaseExpense || 0);
  return { income, expense, balance: income - expense, manualIncome: Number(manual.income || 0), manualExpense: Number(manual.expense || 0), salesIncome: Number(payments.salesIncome || 0), purchaseExpense: Number(payments.purchaseExpense || 0) };
}

function getProfitLossReport(payload = {}) {
  const db = requireDatabase();
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  const range = (column = 'date') => `(? = '' OR ${column} >= ?) AND (? = '' OR ${column} <= ?)`;
  const sales = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN total > tax THEN total - tax ELSE 0 END), 0) AS netSales,
      COALESCE(SUM(cost_total), 0) AS costTotal, COUNT(*) AS invoiceCount
    FROM sales WHERE status = 'active' AND ${range('date')}
  `).get(from, from, to, to);
  const saleReturns = db.prepare(`
    SELECT COALESCE(SUM(sr.total), 0) AS total,
      COALESCE(SUM(sri.quantity * si.purchase_price), 0) AS costTotal
    FROM sales_returns sr
    JOIN sales_return_items sri ON sri.return_id = sr.id
    LEFT JOIN sale_items si ON si.id = sri.sale_item_id
    WHERE sr.status = 'completed' AND ${range('sr.date')}
  `).get(from, from, to, to);
  const manual = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expenses,
      COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS otherIncome
    FROM cash_transactions
    WHERE reference_type IS NULL AND ${range('date')}
  `).get(from, from, to, to);
  const netSales = Number(sales.netSales || 0) - Number(saleReturns.total || 0);
  const costTotal = Number(sales.costTotal || 0) - Number(saleReturns.costTotal || 0);
  const grossProfit = netSales - costTotal;
  const expenses = Number(manual.expenses || 0);
  const otherIncome = Number(manual.otherIncome || 0);
  const netProfit = grossProfit + otherIncome - expenses;
  const byDate = db.prepare(`
    WITH dates AS (
      SELECT date FROM sales WHERE status = 'active' AND ${range('date')}
      UNION SELECT date FROM cash_transactions WHERE reference_type IS NULL AND ${range('date')}
      UNION SELECT date FROM sales_returns WHERE status = 'completed' AND ${range('date')}
    )
    SELECT dates.date,
      COALESCE((SELECT SUM(CASE WHEN total > tax THEN total-tax ELSE 0 END) FROM sales WHERE status='active' AND sales.date=dates.date), 0)
        - COALESCE((SELECT SUM(total) FROM sales_returns WHERE status='completed' AND sales_returns.date=dates.date), 0) AS netSales,
      COALESCE((SELECT SUM(cost_total) FROM sales WHERE status='active' AND sales.date=dates.date), 0)
        - COALESCE((SELECT SUM(sri.quantity*si.purchase_price) FROM sales_return_items sri JOIN sales_returns sr ON sr.id=sri.return_id LEFT JOIN sale_items si ON si.id=sri.sale_item_id WHERE sr.status='completed' AND sr.date=dates.date), 0) AS costTotal,
      COALESCE((SELECT SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) FROM cash_transactions WHERE reference_type IS NULL AND cash_transactions.date=dates.date), 0) AS expenses,
      COALESCE((SELECT SUM(CASE WHEN type='income' THEN amount ELSE 0 END) FROM cash_transactions WHERE reference_type IS NULL AND cash_transactions.date=dates.date), 0) AS otherIncome
    FROM dates ORDER BY dates.date
  `).all(
    from, from, to, to,
    from, from, to, to,
    from, from, to, to
  );
  return {
    filters: { from, to },
    salesNet: Number(sales.netSales || 0),
    salesReturns: Number(saleReturns.total || 0),
    netSales,
    costTotal,
    returnsCost: Number(saleReturns.costTotal || 0),
    grossProfit,
    expenses,
    otherIncome,
    netProfit,
    invoiceCount: Number(sales.invoiceCount || 0),
    byDate: byDate.map((row) => ({
      ...row,
      netSales: Number(row.netSales || 0),
      costTotal: Number(row.costTotal || 0),
      expenses: Number(row.expenses || 0),
      otherIncome: Number(row.otherIncome || 0),
      grossProfit: Number(row.netSales || 0) - Number(row.costTotal || 0),
      netProfit: Number(row.netSales || 0) - Number(row.costTotal || 0) + Number(row.otherIncome || 0) - Number(row.expenses || 0)
    }))
  };
}

function closeDailyAccount(payload = {}) {
  const db = requireDatabase();
  requirePermission('cash');
  const date = normalizeInvoiceDate(payload.date);
  const existing = db.prepare('SELECT id FROM daily_closures WHERE date = ?').get(date);
  if (existing) throw new Error('این روز قبلاً بسته شده است.');
  const cash = getCashSummary({ from: date, to: date });
  const profit = getProfitLossReport({ from: date, to: date });
  const previous = db.prepare('SELECT closing_balance AS closingBalance FROM daily_closures WHERE date < ? ORDER BY date DESC LIMIT 1').get(date);
  const openingBalance = Number(previous?.closingBalance || 0);
  const closingBalance = openingBalance + Number(cash.income || 0) - Number(cash.expense || 0);
  const result = db.prepare(`
    INSERT INTO daily_closures (date, user_id, opening_balance, cash_income, cash_expense, net_sales, profit_total, closing_balance, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(date, currentUserId || null, openingBalance, cash.income, cash.expense, profit.netSales, profit.netProfit, closingBalance, String(payload.notes || '').trim());
  auditLog('daily.close', 'daily_closure', Number(result.lastInsertRowid), { date, closingBalance });
  return getDailyClosure(Number(result.lastInsertRowid));
}

function getDailyClosure(id) {
  const row = requireDatabase().prepare(`
    SELECT dc.id, dc.date, dc.user_id AS userId, dc.opening_balance AS openingBalance,
      dc.cash_income AS cashIncome, dc.cash_expense AS cashExpense,
      dc.net_sales AS netSales, dc.profit_total AS profitTotal,
      dc.closing_balance AS closingBalance, dc.notes, dc.created_at AS createdAt,
      COALESCE(u.display_name, u.username, 'سیستم') AS userName
    FROM daily_closures dc LEFT JOIN users u ON u.id = dc.user_id WHERE dc.id = ?
  `).get(Number(id));
  if (!row) throw new Error('بستن حساب روزانه پیدا نشد.');
  return row;
}

function listDailyClosures(payload = {}) {
  const db = requireDatabase();
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  return db.prepare(`
    SELECT dc.id, dc.date, dc.user_id AS userId, dc.opening_balance AS openingBalance,
      dc.cash_income AS cashIncome, dc.cash_expense AS cashExpense,
      dc.net_sales AS netSales, dc.profit_total AS profitTotal,
      dc.closing_balance AS closingBalance, dc.notes, dc.created_at AS createdAt,
      COALESCE(u.display_name, u.username, 'سیستم') AS userName
    FROM daily_closures dc LEFT JOIN users u ON u.id = dc.user_id
    WHERE (? = '' OR dc.date >= ?) AND (? = '' OR dc.date <= ?)
    ORDER BY dc.date DESC LIMIT 500
  `).all(from, from, to, to);
}

function getPartyLedger(partyId, payload = {}) {
  const db = requireDatabase();
  const id = Number(partyId);
  const party = db.prepare(`
    SELECT id, code, trim(first_name || ' ' || COALESCE(last_name, '')) AS name,
      party_type AS partyType, balance, phone, mobile, address
    FROM parties WHERE id = ?
  `).get(id);
  if (!party) throw new Error('طرف‌حساب پیدا نشد.');
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  const events = [];
  const add = (date, kind, reference, referenceId, description, debit, credit) => {
    events.push({ date, kind, reference, referenceId, description, debit: Number(debit || 0), credit: Number(credit || 0) });
  };
  const sales = db.prepare(`SELECT id, invoice_number AS invoiceNumber, date, total, source FROM sales WHERE party_id = ? AND status = 'active' ORDER BY date, id`).all(id);
  for (const row of sales) {
    add(row.date, 'sale', row.invoiceNumber, row.id, row.source === 'daily' ? 'فروش روزانه' : 'فاکتور فروش', row.total, 0);
    const payments = db.prepare('SELECT id, amount, paid_at AS paidAt, method FROM invoice_payments WHERE sale_id = ? ORDER BY id').all(row.id);
    // Keep invoice and its payments together in period ledgers, even when a
    // payment was entered after the invoice date.
    for (const payment of payments) add(row.date, 'payment', row.invoiceNumber, payment.id, `دریافت فروش (${payment.method})`, 0, payment.amount);
  }
  const saleReturns = db.prepare(`
    SELECT sr.id, sr.return_number AS returnNumber, sr.date, sr.total
    FROM sales_returns sr JOIN sales s ON s.id = sr.sale_id
    WHERE s.party_id = ? AND sr.status = 'completed' ORDER BY sr.date, sr.id
  `).all(id);
  for (const row of saleReturns) add(row.date, 'sale_return', row.returnNumber, row.id, 'مرجوعی فروش', 0, row.total);
  const purchases = db.prepare(`SELECT id, invoice_number AS invoiceNumber, date, total FROM purchases WHERE party_id = ? AND status = 'completed' ORDER BY date, id`).all(id);
  for (const row of purchases) {
    add(row.date, 'purchase', row.invoiceNumber, row.id, 'فاکتور خرید', 0, row.total);
    const payments = db.prepare('SELECT id, amount, paid_at AS paidAt, method FROM invoice_payments WHERE purchase_id = ? ORDER BY id').all(row.id);
    for (const payment of payments) add(row.date, 'payment', row.invoiceNumber, payment.id, `پرداخت خرید (${payment.method})`, payment.amount, 0);
  }
  const purchaseReturns = db.prepare(`
    SELECT pr.id, pr.return_number AS returnNumber, pr.date, pr.total
    FROM purchase_returns pr JOIN purchases p ON p.id = pr.purchase_id
    WHERE p.party_id = ? AND pr.status = 'completed' ORDER BY pr.date, pr.id
  `).all(id);
  for (const row of purchaseReturns) add(row.date, 'purchase_return', row.returnNumber, row.id, 'مرجوعی خرید', row.total, 0);
  events.sort((a, b) => a.date.localeCompare(b.date) || a.referenceId - b.referenceId);
  const openingBalance = from
    ? events.filter((event) => event.date < from).reduce((sum, event) => sum + event.debit - event.credit, 0)
    : 0;
  const rangedEvents = events.filter((event) => (!from || event.date >= from) && (!to || event.date <= to));
  let running = openingBalance;
  for (const event of rangedEvents) {
    running += event.debit - event.credit;
    event.balance = running;
  }
  const debit = rangedEvents.reduce((sum, event) => sum + event.debit, 0);
  const credit = rangedEvents.reduce((sum, event) => sum + event.credit, 0);
  return { party, filters: { from, to }, openingBalance, debit, credit, closingBalance: openingBalance + debit - credit, events: rangedEvents };
}

function adjustProductStock(productId, payload = {}) {
  const db = requireDatabase();
  requirePermission('inventory');
  const id = Number(productId);
  const product = db.prepare('SELECT id, name, stock FROM products WHERE id = ?').get(id);
  if (!product) throw new Error('کالا پیدا نشد.');
  const mode = String(payload.mode || 'counted');
  const value = Number(payload.stock ?? payload.quantity);
  if (!Number.isFinite(value) || value < 0) throw new Error('موجودی اصلاحی باید عددی معتبر و غیرمنفی باشد.');
  const current = Number(product.stock || 0);
  const next = mode === 'delta' ? current + value : value;
  const delta = next - current;
  if (next < 0) throw new Error('موجودی نهایی نمی‌تواند منفی باشد.');
  if (Math.abs(delta) < 1e-9) return getProduct(id);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(next, id);
    db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity, reference_type, reference_id, description)
      VALUES (?, 'adjustment', ?, 'manual', ?, ?)
    `).run(id, delta, null, String(payload.reason || 'اصلاح موجودی').trim() || 'اصلاح موجودی');
    db.exec('COMMIT');
    auditLog('inventory.adjust', 'product', id, { previousStock: current, nextStock: next, delta, reason: payload.reason || '' });
    return getProduct(id);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function listStockMovements(payload = {}) {
  const db = requireDatabase();
  const productId = Number(payload.productId || 0);
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  return db.prepare(`
    SELECT sm.id, sm.product_id AS productId, p.name AS productName, p.code AS productCode,
      sm.type, sm.quantity, sm.reference_type AS referenceType, sm.reference_id AS referenceId,
      sm.description, sm.created_at AS createdAt
    FROM stock_movements sm JOIN products p ON p.id = sm.product_id
    WHERE (? = 0 OR sm.product_id = ?)
      AND (? = '' OR substr(sm.created_at, 1, 10) >= ?)
      AND (? = '' OR substr(sm.created_at, 1, 10) <= ?)
    ORDER BY sm.id DESC LIMIT 1000
  `).all(productId, productId, from, from, to, to);
}

function closeDatabase() {
  if (database) {
    database.close();
    database = undefined;
  }
  currentUserId = null;
}

module.exports = {
  closeDatabase,
  getAppSettings,
  saveAppSettings,
  createCategory,
  createPurchase,
  listSales,
  listPurchases,
  getPurchasePriceHistory,
  getNextInvoiceNumber,
  getNextProductCode,
  checkProductDuplicate,
  getInvoiceDetails,
  updateSale,
  settleInvoice,
  cancelInvoice,
  createProduct,
  createSale,
  mergeDailySales,
  getSalesReport,
  getSalesForecast,
  getDashboardSummary,
  listNotifications,
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
  updateProductQuick,
  createSaleReturn,
  getSaleReturnDetails,
  listSalesReturns,
  cancelSaleReturn,
  createPurchaseReturn,
  getPurchaseReturnDetails,
  listPurchaseReturns,
  cancelPurchaseReturn,
  createCashTransaction,
  getCashTransaction,
  listCashTransactions,
  getCashSummary,
  getProfitLossReport,
  closeDailyAccount,
  getDailyClosure,
  listDailyClosures,
  getPartyLedger,
  hashPassword,
  auditLog,
  setCurrentUser,
  getCurrentUser,
  beginWindowsHelloRegistration,
  finishWindowsHelloRegistration,
  beginWindowsHelloAuthentication,
  finishWindowsHelloAuthentication,
  setQuickPin,
  clearQuickPin,
  getQuickPinStatus,
  unlockWithQuickPin,
  createUser,
  listUsers,
  setUserActive,
  loginUser,
  resetAdminPassword,
  logoutUser,
  listAuditLogs,
  listChecks,
  updateCheckStatus,
  createInstallmentPlan,
  listInstallmentPlans,
  recordInstallmentPayment,
  changeCurrentUserPassword,
  adjustProductStock,
  listStockMovements
  ,previewProductImport
  ,importProducts
  ,getCurrencyInputFactor
};
