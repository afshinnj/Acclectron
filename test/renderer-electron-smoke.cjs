// Run with: npm run test:renderer. Uses an isolated fixture database/profile.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const database = require('../src/main/database');
const { createSecureHandle } = require('../src/main/ipc/authorization');
const { isTrustedAppSender } = require('../src/main/security');
const { registerAccountHandlers } = require('../src/main/ipc/accounts');
const { registerInvoiceHandlers } = require('../src/main/ipc/invoices');
const { registerOperationsHandlers } = require('../src/main/ipc/operations');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(root, '.tmp-ui-smoke');
fs.mkdirSync(tempRoot, { recursive: true });
const fixture = fs.mkdtempSync(path.join(tempRoot, 'renderer-'));
app.setPath('userData', path.join(fixture, 'profile'));
app.disableHardwareAcceleration();
let window;
const errors = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function finish(code) {
  window?.destroy();
  database.closeDatabase();
  // Chromium keeps the profile files open until process exit. Retain this
  // isolated fixture under .tmp-ui-smoke instead of deleting a live profile.
  app.exit(code);
}

app.whenReady().then(async () => {
  try {
    const db = database.getDatabase(path.join(fixture, 'database'));
    database.setCurrentUser(db.prepare("SELECT id FROM users WHERE username='admin'").get().id);
    const category = database.createCategory({ name: 'Smoke category', code: '91' });
    const product = database.createProduct({ name: 'Smoke product', categoryId: category.id, purchasePrice: 100, retailPrice: 200, stock: 10 });
    database.createSale({ items: [{ productId: product.id, quantity: 2, unitPrice: 200 }], paidAmount: 400 });

    window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const secureHandle = createSecureHandle({ ipcMain, isTrustedAppSender, getMainWindow: () => window, appDirectory: root, getCurrentUser: database.getCurrentUser, requirePermission: database.requirePermission });
    registerAccountHandlers(secureHandle);
    registerInvoiceHandlers(secureHandle);
    registerOperationsHandlers(secureHandle);
    const handlers = {
      'settings:get': () => database.getAppSettings(),
      'settings:printers': () => [],
      'window:is-maximized': () => false,
      'window:set-overlay': () => false,
      'ai:status': () => ({ available: false }),
      'products:list': (_event, payload = {}) => database.listProducts(payload.query, payload.categoryId),
      'products:search': (_event, query = '') => database.searchProducts(query),
      'products:next-code': (_event, categoryId, excludeId) => database.getNextProductCode(categoryId, excludeId),
      'categories:list': (_event, includeInactive) => database.listCategories(includeInactive),
      'units:list': () => database.listUnits(),
      'parties:list': (_event, payload = {}) => database.listParties(payload.query, payload.type, payload.includeInactive !== false),
      'customers:search': (_event, query = '') => database.searchCustomers(query),
      'dashboard:summary': (_event, payload) => database.getDashboardSummary(payload),
      'notifications:list': (_event, payload) => database.listNotifications(payload),
      'reports:sales': (_event, payload) => database.getSalesReport(payload),
      'reports:forecast': (_event, payload) => database.getSalesForecast(payload)
    };
    for (const [channel, handler] of Object.entries(handlers)) secureHandle(channel, handler);
    window.webContents.on('console-message', (_event, details, message) => {
      const level = typeof details === 'object' ? details.level : details;
      if (level === 'error' || level === 3) errors.push(typeof details === 'object' ? details.message : message);
    });
    await window.loadFile(path.join(root, 'index.html'));
    const evaluate = (code) => window.webContents.executeJavaScript(code);
    for (let i = 0; i < 50; i++) {
      if (await evaluate("document.querySelector('#loginBackdrop')?.classList.contains('hidden') && document.querySelector('#dashboardRecentSales')?.textContent.includes('S-')")) break;
      await wait(100);
    }
    assert.equal(await evaluate("document.querySelector('#loginBackdrop')?.classList.contains('hidden')"), true);
    assert.match(await evaluate("document.querySelector('#dashboardRecentSales').textContent"), /S-/);
    assert.equal(await evaluate("document.querySelector('#dashboardSalesChart').querySelector('.skeleton') === null"), true);

    const pages = { sales: 'salesPage', products: 'productsPage', categories: 'categoriesPage', customers: 'partiesPage', ledger: 'ledgerPage', inventory: 'inventoryPage', returns: 'returnsPage', checks: 'checksPage', installments: 'installmentsPage', cash: 'cashPage', 'profit-loss': 'profitLossPage', users: 'usersPage', reports: 'reportsPage', settings: 'settingsPage', dashboard: 'dashboardPage' };
    for (const [page, id] of Object.entries(pages)) {
      await evaluate(`document.querySelector('nav [data-page="${page}"]').click()`);
      await wait(150);
      const visible = await evaluate("Array.from(document.querySelectorAll('main section.page')).filter(node => !node.classList.contains('hidden')).map(node => node.id)");
      assert.deepEqual(visible, [id], `menu ${page} shows exactly its requested page`);
      if (page === 'products') {
        assert.match(await evaluate("document.querySelector('#productsTable').textContent"), /Smoke product/);
        assert.equal(await evaluate("document.querySelector('#productsTable .edit-product').dataset.id"), String(product.id));
        await evaluate("document.querySelector('#productsTable .edit-product').click()");
        await wait(150);
        assert.equal(await evaluate("document.querySelector('#managementModalBackdrop').classList.contains('hidden')"), false);
        assert.equal(await evaluate("document.querySelector('#productId').value"), String(product.id));
        await evaluate("document.querySelector('#productModal [data-close-management]').click()");
      }
      console.log(`PASS menu: ${page}`);
    }
    assert.deepEqual(errors, [], 'renderer must not report runtime errors');
    console.log('PASS dashboard data, product data, and all menu routes');
    finish(0);
  } catch (error) {
    console.error(error.stack || error);
    if (errors.length) console.error('Renderer errors:', errors);
    finish(1);
  }
});
