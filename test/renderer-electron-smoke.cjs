// Run with: npm run test:renderer. Uses an isolated fixture database/profile.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sourceRoot = path.resolve(__dirname, '..');
const appArgument = process.argv.find(arg => arg.startsWith('--app-dir='));
const root = appArgument ? path.resolve(sourceRoot, appArgument.slice(10)) : sourceRoot;
if (appArgument) {
  const files = ['index.html', 'main.js', 'preload.js', 'styles.css'];
  const collect = (relative) => {
    for (const entry of fs.readdirSync(path.join(sourceRoot, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) collect(child);
      else files.push(child);
    }
  };
  collect('src');
  for (const file of files) assert.deepEqual(fs.readFileSync(path.join(root, file)), fs.readFileSync(path.join(sourceRoot, file)), 'packaged source matches: ' + file);
  assert.equal(require(path.join(root, 'package.json')).version, require(path.join(sourceRoot, 'package.json')).version);
  console.log('PASS packaged source parity: ' + files.length + ' files');
}
console.log('Electron runtime: ' + process.versions.electron);
const database = require(path.join(root, 'src/main/database'));
const { getPrintOptions, getPdfOptions } = require(path.join(root, 'src/main/print-layout'));
const { createSecureHandle } = require(path.join(root, 'src/main/ipc/authorization'));
const { isTrustedAppSender } = require(path.join(root, 'src/main/security'));
const { registerAccountHandlers } = require(path.join(root, 'src/main/ipc/accounts'));
const { registerInvoiceHandlers } = require(path.join(root, 'src/main/ipc/invoices'));
const { registerOperationsHandlers } = require(path.join(root, 'src/main/ipc/operations'));

const tempRoot = path.join(sourceRoot, '.tmp-ui-smoke');
fs.mkdirSync(tempRoot, { recursive: true });
const fixture = fs.mkdtempSync(path.join(tempRoot, 'renderer-'));
app.setPath('userData', path.join(fixture, 'profile'));
app.disableHardwareAcceleration();
let window;
const watchdog = setTimeout(() => { console.error("Renderer test timed out"); finish(1); }, 90000);
const errors = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function finish(code) {
  clearTimeout(watchdog);
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
    const sale = database.createSale({ items: [{ productId: product.id, quantity: 2, unitPrice: 200 }], paidAmount: 400 });

    window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const secureHandle = createSecureHandle({ ipcMain, isTrustedAppSender, getMainWindow: () => window, appDirectory: root, getCurrentUser: database.getCurrentUser, requirePermission: database.requirePermission });
    registerAccountHandlers(secureHandle);
    registerInvoiceHandlers(secureHandle);
    registerOperationsHandlers(secureHandle);
    const pdfs = [];
    secureHandle('pdf:invoice', async (_event, payload) => {
      const options = getPrintOptions(database.getAppSettings(), payload).options;
      assert.equal(options.landscape, payload.print.orientation === 'landscape' && !payload.print.paperSize.endsWith('mm'));
      const pdf = await window.webContents.printToPDF(getPdfOptions(database.getAppSettings(), payload));
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      assert.ok(pdf.length > 1000, 'PDF contains rendered invoice');
      const filePath = path.join(fixture, payload.print.paperSize + '-' + payload.print.orientation + '.pdf');
      fs.writeFileSync(filePath, pdf);
      const mediaBox = /\/MediaBox\s*\[([\d. ]+)\]/.exec(pdf.toString('latin1'));
      assert.ok(mediaBox, 'PDF defines page dimensions');
      const [, , width, height] = mediaBox[1].trim().split(/\s+/).map(Number);
      const dimensions = { A4: [210, 297], A5: [148, 210], '80mm': [80, payload.contentHeightMicrons / 1000], '58mm': [58, payload.contentHeightMicrons / 1000] };
      const expected = [...dimensions[payload.print.paperSize]];
      if (options.landscape) expected.reverse();
      assert.ok(Math.abs(width * 25.4 / 72 - expected[0]) < 1, 'PDF width matches selected paper');
      assert.ok(Math.abs(height * 25.4 / 72 - expected[1]) < 1, 'PDF height matches selected paper');
      pdfs.push(filePath);
      return { canceled: false, filePath };
    });
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
    window.webContents.on('console-message', (event, details, message) => {
      const info = details && typeof details === 'object' ? details : event;
      const level = info.level ?? details;
      if (level === 'error' || level === 3) errors.push(info.message ?? message);
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
    await evaluate(`import('./src/renderer/shared/runtime.mjs').then(({renderer}) => renderer.openInvoicePrintPreview('sale', ${sale.id}))`);
    assert.match(await evaluate("document.querySelector('.invoice-print-preview-content').textContent"), /Smoke product/);
    for (const paper of ['A4', 'A5', '80mm', '58mm']) {
      for (const orientation of ['portrait', 'landscape']) {
        await evaluate(`(() => { const p=document.querySelector('.invoice-preview-paper');p.value='${paper}';p.dispatchEvent(new Event('change'));const o=document.querySelector('.invoice-preview-orientation');o.value='${orientation}';o.dispatchEvent(new Event('change')); })()`);
        const completed = pdfs.length;
        await evaluate("document.querySelector('.invoice-preview-pdf').click()");
        for (let attempt = 0; attempt < 100 && pdfs.length === completed; attempt++) await wait(100);
        assert.equal(pdfs.length, completed + 1, 'PDF button completes through secured IPC');
        await wait(100);
        assert.equal(await evaluate("document.body.classList.contains('printing-invoice')"), false);
        console.log(`PASS invoice PDF: ${paper} ${orientation}`);
      }
    }
    await evaluate("document.querySelector('.invoice-preview-close').click()");
    assert.deepEqual(errors, [], 'renderer must not report runtime errors');
    console.log('PASS dashboard data, product data, and all menu routes');
    finish(0);
  } catch (error) {
    console.error(error.stack || error);
    if (errors.length) console.error('Renderer errors:', errors);
    finish(1);
  }
});
