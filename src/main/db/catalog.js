// catalog.js — products, categories, units, product import and stock adjustments.
// Split mechanically from database.js; function bodies are unchanged.

const { normalizePersianText } = require('../importer');
const { auditLog, normalizeSearchText, requireDatabase, requirePermission } = require('./core');
const { getCurrencyInputFactor } = require('./settings');

function searchProducts(query = '') {
  const db = requireDatabase();
  const normalizeSearch = normalizeSearchText;
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
  const category = categoryId ? Number(categoryId) : null;
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  const rows = db.prepare(`
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
      AND (? IS NULL OR p.category_id = ?)
    ORDER BY p.is_active DESC, p.name COLLATE NOCASE
  `).all(1, category, category);
  if (!tokens.length) return rows;
  return rows.filter((row) => {
    const haystack = normalizeSearchText([row.name, row.code, row.barcode, row.categoryName].filter(Boolean).join(' '));
    return tokens.every((token) => haystack.includes(token));
  });
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

module.exports = { adjustProductStock, assertProductIsUnique, checkProductDuplicate, createCategory, createProduct, createUnit, generateCategoryCode, generateProductCode, getCategoryCode, getNextProductCode, getProduct, importProducts, listCategories, listProducts, listStockMovements, listUnits, normalizeProductBarcode, normalizeProductIdentity, normalizeProductPayload, previewProductImport, searchProducts, setCategoryActive, setProductActive, setUnitActive, updateCategory, updateProduct, updateProductQuick, updateUnit };
