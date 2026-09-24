// core.js — connection, migrations, shared state (current user), audit log and permission gate.
// Split mechanically from database.js; function bodies are unchanged.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { normalizePersianText } = require('../importer');

let database;

let currentUserId = null;

const ROLE_PERMISSIONS = {
  admin: ['*'],
  manager: ['sales', 'purchases', 'returns', 'cash', 'inventory', 'products', 'parties', 'reports', 'settings', 'users'],
  cashier: ['sales', 'returns', 'cash', 'products', 'parties', 'reports'],
  warehouse: ['purchases', 'returns', 'inventory', 'products', 'parties', 'reports'],
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
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
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
  addColumnIfMissing(database, 'sales', 'pinned', 'INTEGER NOT NULL DEFAULT 0');
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

// Runs multi-row writes as one atomic unit so a mid-loop failure can never
// leave half of a batch applied (used by the AI assistant bulk operations).
function runInTransaction(work) {
  const db = requireDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
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

function requirePermission(permission) {
  const user = getCurrentUser();
  if (!user) throw new Error('ابتدا وارد حساب کاربری شوید.');
  const permissions = ROLE_PERMISSIONS[user.role] || [];
  if (permissions.includes('*') || permissions.includes(permission)) return true;
  throw new Error('کاربر جاری مجوز انجام این عملیات را ندارد.');
}

// Unifies Persian/Arabic letter and digit variants so product search ignores
// them: ۰-۹ and ٠-٩ map to 0-9, ي/ك map to ی/ک and ZWNJ becomes a space.
function normalizeSearchText(value) {
  return normalizePersianText(String(value ?? ''))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[\u0660-\u0669]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .toLowerCase()
    .trim();
}

function closeDatabase() {
  if (database) {
    database.close();
    database = undefined;
  }
  currentUserId = null;
}

module.exports = { addColumnIfMissing, auditLog, closeDatabase, getCurrentUser, getDatabase, hashPassword, normalizeDatabaseRows, normalizeSearchText, requireDatabase, requirePermission, runInTransaction, setCurrentUser, tableColumns, toPlainRow };
