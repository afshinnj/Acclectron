const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
// Some Windows GPU drivers terminate Electron immediately with
// "GPU state invalid..." before the login window is usable.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseXlsxFile, normalizeProductRows } = require('./src/main/importer');
const {
  closeDatabase,
  createPurchase,
  createParty,
  createCategory,
  createProduct,
  createSale,
  mergeDailySales,
  getDashboardSummary,
  listNotifications,
  getSalesReport,
  getDatabase,
  listCategories,
  listProducts,
  listParties,
  listUnits,
  createUnit,
  updateUnit,
  setUnitActive,
  searchCustomers,
  searchProducts,
  setCategoryActive,
  setProductActive,
  setPartyActive,
  updateParty,
  updateCategory,
  updateProduct,
  updateProductQuick,
  previewProductImport,
  importProducts,
  getCurrencyInputFactor,
  getAppSettings,
  saveAppSettings,
  getNextInvoiceNumber,
  getNextProductCode,
  checkProductDuplicate,
  listSales,
  listPurchases,
  getPurchasePriceHistory,
  getInvoiceDetails,
  updateSale,
  settleInvoice,
  cancelInvoice,
  setSalePinned,
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
  adjustProductStock,
  listStockMovements,
  createUser,
  listUsers,
  setUserActive,
  loginUser,
  logoutUser,
  getCurrentUser,
  listAuditLogs,
  setCurrentUser,
  requirePermission,
  listChecks,
  updateCheckStatus,
  createInstallmentPlan,
  listInstallmentPlans,
  recordInstallmentPayment,
  changeCurrentUserPassword,
  userUsesDefaultPassword,
  getSalesForecast,
  beginWindowsHelloRegistration,
  finishWindowsHelloRegistration,
  beginWindowsHelloAuthentication,
  finishWindowsHelloAuthentication,
  setQuickPin,
  clearQuickPin,
  getQuickPinStatus,
  unlockWithQuickPin
} = require('./src/main/database');
const { aiStatus, rankProductsBySimilarity } = require('./src/main/ai/semantic');
const { planCommand, applyProductUpdates, undoLastAssistantApply } = require('./src/main/ai/assistant');

// Keep the main process alive on unexpected errors and leave a trace on disk
// (userData/logs, newest 10 files) so failures can be diagnosed afterwards.
function appendProcessLog(scope, error) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `main-${new Date().toISOString().slice(0, 10)}.log`);
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${scope}: ${error?.stack || error?.message || String(error)}\n`, 'utf8');
  } catch {
    // Logging must never itself crash the app.
  }
}

function pruneOldLogs(keep = 10) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    const files = fs.readdirSync(dir)
      .filter((name) => /^main-\d{4}-\d{2}-\d{2}\.log$/.test(name))
      .sort()
      .reverse();
    for (const name of files.slice(keep)) fs.rmSync(path.join(dir, name), { force: true });
  } catch {}
}

process.on('uncaughtException', (error) => appendProcessLog('uncaughtException', error));
process.on('unhandledRejection', (reason) => appendProcessLog('unhandledRejection', reason));

let mainWindow;
let tray;
let isQuitting = false;
let isWindowCloseApproved = false;
let autoBackupTimer;
const pendingImports = new Map();
const appIconPath = path.join(__dirname, 'assets', 'icon.png');

// The renderer must never navigate away from the packaged app files: remote or
// foreign local content would still reach the privileged preload bridge.
const isAllowedAppUrl = (url) => {
  try {
    const target = new URL(url);
    if (target.protocol !== 'file:') return false;
    const targetPath = path.normalize(decodeURIComponent(target.pathname).replace(/^\/([A-Za-z]:)/, '$1'));
    const relative = path.relative(__dirname, targetPath);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  } catch {
    return false;
  }
};

function hardenWebContents(webContents) {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppUrl(url)) event.preventDefault();
  });
}

function registerIpcHandlers() {
  // Security boundary of the whole IPC surface: every channel requires a
  // logged-in user unless it is explicitly public, and the channels listed in
  // IPC_PERMISSIONS additionally require an explicit role permission. The
  // renderer is sandboxed behind contextIsolation, so this boundary is the
  // single trust line for every privileged operation.
  const PUBLIC_IPC_CHANNELS = new Set([
    'auth:login',
    'auth:current',
    'auth:logout',
    // Windows Hello authentication replaces the password prompt on the login
    // screen, so its options/verify pair must stay reachable before login.
    'auth:webauthn:authentication-options',
    'auth:webauthn:authentication-verify',
    // The Quick PIN status/unlock pair guards an already-established session
    // and must remain callable from the lock screen.
    'auth:quick-pin:status',
    'auth:quick-pin:unlock',
    // Boot configuration (appearance, passwordless-login flag) is read while
    // the login screen is still up; it exposes no business records.
    'settings:get',
    'window:is-maximized',
    'window:set-overlay'
  ]);
  const IPC_PERMISSIONS = {
    'products:create': 'products',
    'products:update': 'products',
    'products:quick-update': 'products',
    'products:set-active': 'products',
    'products:import-preview': 'products',
    'products:import-confirm': 'products',
    'products:template': 'products',
    'products:export': 'products',
    'categories:create': 'products',
    'categories:update': 'products',
    'categories:set-active': 'products',
    'units:create': 'settings',
    'units:update': 'settings',
    'units:set-active': 'settings',
    'parties:create': 'parties',
    'parties:update': 'parties',
    'parties:set-active': 'parties',
    'reports:sales': 'reports',
    'reports:forecast': 'reports',
    'reports:export-csv': 'reports',
    'reports:export-pdf': 'reports',
    'profit-loss:report': 'reports',
    'ai:assistant-apply': 'products',
    'ai:assistant-undo': 'products',
    'ai:assistant-export': 'reports',
    'ai:assistant-export-pdf': 'reports',
    'settings:save': 'settings',
    'settings:choose-logo': 'settings',
    'settings:choose-backup-path': 'settings',
    'settings:backup-now': 'settings',
    'settings:official-start': 'settings',
    'settings:restore': 'settings',
    'users:create': 'users',
    'users:list': 'users',
    'users:set-active': 'users'
  };
  const secureHandle = (channel, handler) => ipcMain.handle(channel, (event, ...args) => {
    if (PUBLIC_IPC_CHANNELS.has(channel)) return handler(event, ...args);
    const permission = IPC_PERMISSIONS[channel];
    if (permission) requirePermission(permission);
    else if (!getCurrentUser()) throw new Error('ابتدا وارد حساب کاربری شوید.');
    return handler(event, ...args);
  });
  secureHandle('settings:get', () => getAppSettings());
  secureHandle('settings:save', (_event, payload) => {
    const settings = saveAppSettings(payload);
    applyStartupSetting(settings.appearance?.startup);
    return settings;
  });
  secureHandle('settings:printers', async () => {
    if (!mainWindow?.webContents?.getPrintersAsync) return [];
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map((printer) => ({
      name: printer.name,
      displayName: printer.displayName || printer.name,
      description: printer.description || '',
      status: printer.status || 0,
      isDefault: Boolean(printer.isDefault)
    }));
  });
  const printPaperSizes = {
    A4: { width: 210000, height: 297000 },
    A5: { width: 148000, height: 210000 },
    '80mm': { width: 80000, height: 200000 },
    '58mm': { width: 58000, height: 200000 }
  };
  const validPaper = (value) => ['A4', 'A5', '80mm', '58mm'].includes(String(value)) ? String(value) : 'A4';
  const validOrientation = (value) => ['portrait', 'landscape'].includes(String(value)) ? String(value) : 'portrait';
  const validMargin = (value) => ['narrow', 'normal', 'wide'].includes(String(value)) ? String(value) : 'normal';
  const resolvePrintLayout = (payload = {}) => {
    const settings = getAppSettings();
    const print = { ...(settings.print || {}), ...(payload.print || {}) };
    const paperSize = validPaper(print.paperSize);
    const orientation = validOrientation(print.orientation);
    const size = { ...(printPaperSizes[paperSize] || printPaperSizes.A4) };
    if (paperSize === '80mm' || paperSize === '58mm') {
      const requestedHeight = Number(payload.contentHeightMicrons);
      if (Number.isFinite(requestedHeight)) size.height = Math.max(40000, Math.min(1000000, Math.ceil(requestedHeight)));
    }
    return { print, paperSize, orientation, margin: validMargin(print.margin), size };
  };
  const getPrintOptions = (payload = {}) => {
    const layout = resolvePrintLayout(payload);
    const isThermal = layout.paperSize === '80mm' || layout.paperSize === '58mm';
    const size = layout.orientation === 'landscape' && !isThermal
      ? { width: layout.size.height, height: layout.size.width }
      : layout.size;
    const pageSize = ['A4', 'A5'].includes(layout.paperSize)
      ? layout.paperSize
      : size;
    return {
      layout,
      options: {
        silent: Boolean(layout.print.printerName) && !Boolean(layout.print.showPrintDialog),
        printBackground: true,
        color: layout.print.color !== false,
        copies: Math.max(1, Math.min(10, Number(layout.print.copies || 1))),
        margins: { marginType: 'none' },
        landscape: layout.orientation === 'landscape' && !isThermal,
        scaleFactor: 100,
        pageSize
      }
    };
  };
  secureHandle('print:invoice', async (_event, payload = {}) => {
    if (!mainWindow?.webContents) throw new Error('پنجره چاپ آماده نیست.');
    const { options, layout } = getPrintOptions(payload);
    if (layout.print.printerName) options.deviceName = String(layout.print.printerName);
    return new Promise((resolve, reject) => {
      mainWindow.webContents.print(options, (success, reason) => {
        if (success) resolve({ success: true });
        else reject(new Error(reason || 'چاپ فاکتور انجام نشد.'));
      });
    });
  });
  secureHandle('pdf:invoice', async (_event, payload = {}) => {
    if (!mainWindow?.webContents) throw new Error('پنجره خروجی PDF آماده نیست.');
    const { layout } = getPrintOptions(payload);
    const isThermal = layout.paperSize === '80mm' || layout.paperSize === '58mm';
    const widthInches = layout.size.width / 25400;
    const heightInches = layout.size.height / 25400;
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: 'ذخیره PDF فاکتور',
      defaultPath: String(payload.fileName || `فاکتور-${new Date().toISOString().slice(0, 10)}.pdf`).replace(/\.pdf$/i, '') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (selection.canceled || !selection.filePath) return { canceled: true };
    const pdfOptions = {
      printBackground: true,
      displayHeaderFooter: false,
      preferCSSPageSize: true,
      margins: { marginType: 'none' },
      landscape: layout.orientation === 'landscape' && !isThermal,
      pageSize: ['A4', 'A5'].includes(layout.paperSize)
        ? layout.paperSize
        : { width: layout.orientation === 'landscape' && !isThermal ? heightInches : widthInches, height: layout.orientation === 'landscape' && !isThermal ? widthInches : heightInches }
    };
    const data = await mainWindow.webContents.printToPDF(pdfOptions);
    fs.writeFileSync(selection.filePath, data);
    return { canceled: false, filePath: selection.filePath };
  });
  secureHandle('settings:choose-logo', async () => {
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'انتخاب لوگوی فروشگاه',
      properties: ['openFile'],
      filters: [{ name: 'تصویر', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
    const source = selection.filePaths[0];
    const extension = path.extname(source).toLowerCase() || '.png';
    const destination = path.join(app.getPath('userData'), `store-logo${extension}`);
    fs.copyFileSync(source, destination);
    return { canceled: false, path: destination };
  });
  secureHandle('products:search', (_event, query = '') => searchProducts(query));
  const aiModelRoots = [
    process.env.ACCLETRON_AI_MODELS || null,
    path.join(__dirname, 'assets', 'models'),
    process.resourcesPath ? path.join(process.resourcesPath, 'ai-models') : null,
    path.join(app.getPath('userData'), 'models')
  ].filter(Boolean);
  secureHandle('ai:status', () => aiStatus(aiModelRoots));
  secureHandle('ai:semantic-search', async (_event, payload = {}) => {
    const query = String(payload.query || '').trim();
    const status = aiStatus(aiModelRoots);
    if (!query) return { available: status.available, results: [] };
    if (!status.available) return { available: false, results: [] };
    const limit = Math.max(1, Math.min(100, Number(payload.limit || 50)));
    try {
      const results = await rankProductsBySimilarity(query, listProducts('', ''), aiModelRoots);
      return { available: true, results: results.slice(0, limit) };
    } catch (error) {
      return { available: false, results: [], reason: String(error?.message || error) };
    }
  });
  secureHandle('ai:assistant-plan', async (_event, payload = {}) => planCommand(
    String(payload.text || ''),
    aiModelRoots,
    Array.isArray(payload.previousIds) ? payload.previousIds : []
  ));
  secureHandle('ai:assistant-apply', (_event, payload = {}) => applyProductUpdates(payload.updates || []));
  secureHandle('ai:assistant-undo', () => undoLastAssistantApply());
  secureHandle('ai:assistant-export', async (_event, payload = {}) => {
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: 'خروجی CSV دستیار هوشمند',
      defaultPath: String(payload.fileName || `دستیار-هوشمند-${new Date().toISOString().slice(0, 10)}.csv`).replace(/\.csv$/i, '') + '.csv',
      filters: [{ name: 'Excel CSV', extensions: ['csv'] }]
    });
    if (selection.canceled || !selection.filePath) return { canceled: true };
    const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    fs.writeFileSync(selection.filePath, '\uFEFF' + rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n') + '\r\n', 'utf8');
    return { canceled: false, filePath: selection.filePath };
  });
  const escapeAssistantHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  secureHandle('ai:assistant-export-pdf', async (_event, payload = {}) => {
    const rows = Array.isArray(payload.rows) ? payload.rows.filter(Array.isArray) : [];
    if (rows.length < 2) throw new Error('داده‌ای برای خروجی PDF وجود ندارد.');
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: 'خروجی PDF دستیار هوشمند',
      defaultPath: String(payload.fileName || `دستیار-هوشمند-${new Date().toISOString().slice(0, 10)}`).replace(/\.pdf$/i, '') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (selection.canceled || !selection.filePath) return { canceled: true };
    const [header, ...bodyRows] = rows;
    const html = `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><style>body{font-family:Tahoma,'Segoe UI',sans-serif;font-size:10px;padding:14px}h3{font-size:13px;margin:0 0 10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:5px 6px;text-align:right}th{background:#eef2f6}</style></head><body><h3>Acclectron — دستیار هوشمند</h3><table><thead><tr>${header.map((cell) => `<th>${escapeAssistantHtml(cell)}</th>`).join('')}</tr></thead><tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${escapeAssistantHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
    const pdfWindow = new BrowserWindow({ show: false });
    try {
      await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const data = await pdfWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4', landscape: true, margins: { marginType: 'none' } });
      fs.writeFileSync(selection.filePath, data);
    } finally {
      pdfWindow.destroy();
    }
    return { canceled: false, filePath: selection.filePath };
  });
  secureHandle('products:list', (_event, payload = {}) => listProducts(payload.query, payload.categoryId));
  secureHandle('products:next-code', (_event, categoryId, excludeId = null) => getNextProductCode(categoryId, excludeId));
  secureHandle('products:check-duplicate', (_event, payload = {}, excludeId = null) => checkProductDuplicate(payload, excludeId));
  secureHandle('products:create', (_event, payload) => createProduct(payload));
  secureHandle('products:update', (_event, id, payload) => updateProduct(id, payload));
  secureHandle('products:quick-update', (_event, id, payload) => updateProductQuick(id, payload));
  secureHandle('products:set-active', (_event, id, active) => setProductActive(id, active));
  secureHandle('products:import-preview', async () => {
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'انتخاب فایل محصولات',
      properties: ['openFile'],
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
    const workbook = await parseXlsxFile(selection.filePaths[0]);
    const normalized = normalizeProductRows(workbook.rows);
    const preview = previewProductImport(normalized.rows);
    const token = crypto.randomUUID();
    pendingImports.set(token, { rows: normalized.rows, errors: normalized.errors });
    return { canceled: false, token, sheetName: workbook.sheetName, ...preview, parseErrors: normalized.errors };
  });
  secureHandle('products:import-confirm', (_event, token, duplicateMode = 'skip') => {
    const pending = pendingImports.get(String(token));
    if (!pending) throw new Error('پیش‌نمایش ورود منقضی شده است؛ لطفاً فایل را دوباره انتخاب کنید.');
    pendingImports.delete(String(token));
    const result = importProducts(pending.rows, ['skip', 'update'].includes(duplicateMode) ? duplicateMode : 'skip');
    result.errors = [...pending.errors, ...result.errors];
    return result;
  });
  secureHandle('products:template', async () => {
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: 'ذخیره فایل نمونه محصولات',
      defaultPath: 'نمونه-ورود-محصولات.csv',
      filters: [{ name: 'CSV Excel', extensions: ['csv'] }]
    });
    if (selection.canceled || !selection.filePath) return { canceled: true };
    const csv = '\uFEFFگروه اصلی,نام کالا,تعداد بدهکار,قيمت خريد,قيمت فروش عمده,قيمت فروش\nلباسشویی,نمونه محصول,0,0,0,0\n';
    fs.writeFileSync(selection.filePath, csv, 'utf8');
    return { canceled: false, filePath: selection.filePath };
  });
  secureHandle('products:export', async () => {
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: 'خروجی محصولات',
      defaultPath: 'محصولات.csv',
      filters: [{ name: 'CSV Excel', extensions: ['csv'] }]
    });
    if (selection.canceled || !selection.filePath) return { canceled: true };
    const rows = listProducts('', '');
    const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csvRows = [
      ['کد کالا', 'نام کالا', 'دسته‌بندی', 'بارکد', 'قیمت خرید', 'قیمت عمده', 'قیمت فروش', 'موجودی', 'حداقل موجودی', 'واحد', 'وضعیت'],
      ...rows.map((row) => [
        row.code, row.name, row.categoryName, row.barcode, Math.round(Number(row.purchasePrice || 0) / 100 * getCurrencyInputFactor()),
        Math.round(Number(row.wholesalePrice || 0) / 100 * getCurrencyInputFactor()), Math.round(Number(row.salePrice || 0) / 100 * getCurrencyInputFactor()),
        row.stock, row.minimumStock, row.unitName || row.unitSymbol, row.isActive ? 'فعال' : 'غیرفعال'
      ])
    ];
    fs.writeFileSync(selection.filePath, '\uFEFF' + csvRows.map((row) => row.map(escapeCsv).join(',')).join('\r\n') + '\r\n', 'utf8');
    return { canceled: false, filePath: selection.filePath, count: rows.length };
  });
  secureHandle('categories:list', (_event, includeInactive = true) => listCategories(includeInactive));
  secureHandle('categories:create', (_event, payload) => createCategory(payload));
  secureHandle('categories:update', (_event, id, payload) => updateCategory(id, payload));
  secureHandle('categories:set-active', (_event, id, active) => setCategoryActive(id, active));
  secureHandle('units:list', () => listUnits());
  secureHandle('units:create', (_event, payload) => createUnit(payload));
  secureHandle('units:update', (_event, id, payload) => updateUnit(id, payload));
  secureHandle('units:set-active', (_event, id, active) => setUnitActive(id, active));
  secureHandle('settings:choose-backup-path', async () => {
    const selection = await dialog.showOpenDialog(mainWindow, { title: 'انتخاب پوشه پشتیبان', properties: ['openDirectory', 'createDirectory'] });
    return selection.canceled || !selection.filePaths[0] ? { canceled: true } : { canceled: false, path: selection.filePaths[0] };
  });
  secureHandle('settings:backup-now', async (_event, destination) => {
    // A renderer-supplied path is honored only when it matches the configured
    // backup folder or Documents; anything else falls back to the configured
    // folder so a compromised renderer cannot place database copies elsewhere.
    const configured = String(getAppSettings().backup?.path || '').trim() || app.getPath('documents');
    const requested = String(destination || '').trim();
    const target = requested && [configured, app.getPath('documents')]
      .some((dir) => path.resolve(dir).toLowerCase() === path.resolve(requested).toLowerCase())
      ? requested
      : configured;
    return backupDatabase(target);
  });
  secureHandle('settings:official-start', () => startOfficialUse());
  secureHandle('settings:restore', async () => {
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'بازیابی پشتیبان Acclectron',
      properties: ['openFile'],
      filters: [{ name: 'SQLite backup', extensions: ['db', 'sqlite', 'sqlite3'] }]
    });
    if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
    const source = selection.filePaths[0];
    const target = path.join(app.getPath('userData'), 'accletron.db');
    if (path.resolve(source).toLowerCase() === path.resolve(target).toLowerCase()) throw new Error('فایل پشتیبان با دیتابیس فعلی یکسان است.');
    closeDatabase();
    // Stale journal sidecars of the previous database must not survive a restore.
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const sidecar = `${target}${suffix}`;
      if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
    }
    fs.copyFileSync(source, target);
    getDatabase(app.getPath('userData'));
    return { canceled: false, path: source };
  });
  secureHandle('customers:search', (_event, query = '') => searchCustomers(query));
  secureHandle('parties:list', (_event, payload = {}) => listParties(payload.query, payload.type, payload.includeInactive !== false));
  secureHandle('parties:create', (_event, payload) => createParty(payload));
  secureHandle('parties:update', (_event, id, payload) => updateParty(id, payload));
  secureHandle('parties:set-active', (_event, id, active) => setPartyActive(id, active));
  secureHandle('dashboard:summary', (_event, payload = {}) => getDashboardSummary(payload));
  secureHandle('notifications:list', (_event, payload = {}) => {
    const result = listNotifications(payload);
    const settings = getAppSettings();
    const backup = settings.backup || {};
    if (backup.auto) {
      const targetDir = backup.path || app.getPath('documents');
      let latest = null;
      try {
        latest = fs.readdirSync(targetDir)
          .filter((name) => /^accletron-backup-.*\.db$/i.test(name))
          .map((name) => path.join(targetDir, name))
          .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime)[0] || null;
      } catch {}
      const interval = backup.frequency === 'weekly' ? 7 * 86400000 : 86400000;
      if (!latest) {
        result.alerts.push({ id: 'backup-missing', type: 'backup-missing', severity: 'danger', title: 'پشتیبان‌گیری انجام نشده', message: 'برای پایگاه‌داده هنوز فایل پشتیبان پیدا نشد.', actionPage: 'settings' });
      } else if (Date.now() - latest.mtime > interval * 1.5) {
        result.alerts.push({ id: 'backup-stale', type: 'backup-stale', severity: 'warning', title: 'پشتیبان‌گیری قدیمی است', message: `آخرین پشتیبان در ${new Date(latest.mtime).toLocaleString('fa-IR')} ایجاد شده است.`, actionPage: 'settings' });
      }
    }
    const currentUser = getCurrentUser();
    if (currentUser && userUsesDefaultPassword(currentUser.id)) {
      result.alerts.push({ id: 'default-password', type: 'default-password', severity: 'danger', title: 'رمز عبور پیش‌فرض', message: 'کاربر admin هنوز از رمز عبور پیش‌فرض (admin123) استفاده می‌کند؛ لطفاً از صفحه کاربران آن را تغییر دهید.', actionPage: 'users' });
    }
    result.counts = {
      total: result.alerts.length,
      danger: result.alerts.filter((item) => item.severity === 'danger').length,
      warning: result.alerts.filter((item) => item.severity === 'warning').length,
      info: result.alerts.filter((item) => item.severity === 'info').length
    };
    return result;
  });
  secureHandle('reports:sales', (_event, payload = {}) => getSalesReport(payload));
  secureHandle('reports:forecast', (_event, payload = {}) => getSalesForecast(payload));
  secureHandle('reports:export-csv', async (_event, kind, payload = {}) => {
    const report = String(kind) === 'profit-loss' ? getProfitLossReport(payload) : getSalesReport(payload);
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: 'خروجی Excel گزارش',
      defaultPath: `${String(kind) === 'profit-loss' ? 'سود-و-زیان' : 'گزارش-فروش'}-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'Excel CSV', extensions: ['csv'] }]
    });
    if (selection.canceled || !selection.filePath) return { canceled: true };
    const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = String(kind) === 'profit-loss'
      ? [['تاریخ', 'فروش خالص', 'بهای تمام‌شده', 'سود ناخالص', 'درآمد متفرقه', 'هزینه', 'سود خالص'], ...(report.byDate || []).map((r) => [r.date, r.netSales, r.costTotal, r.grossProfit, r.otherIncome, r.expenses, r.netProfit])]
      : [['تاریخ', 'فروش خالص', 'هزینه', 'سود', 'تعداد فاکتور'], ...(report.byDate || []).map((r) => [r.date, r.netSales, r.costTotal, r.profitTotal, r.invoiceCount])];
    fs.writeFileSync(selection.filePath, '\uFEFF' + rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n') + '\r\n', 'utf8');
    return { canceled: false, filePath: selection.filePath, count: rows.length - 1 };
  });
  secureHandle('reports:export-pdf', async (_event, payload = {}) => {
    if (!mainWindow?.webContents) throw new Error('پنجره گزارش آماده نیست.');
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: 'خروجی PDF گزارش',
      defaultPath: String(payload.fileName || `گزارش-${new Date().toISOString().slice(0, 10)}.pdf`).replace(/\.pdf$/i, '') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (selection.canceled || !selection.filePath) return { canceled: true };
    const data = await mainWindow.webContents.printToPDF({
      printBackground: true,
      displayHeaderFooter: false,
      preferCSSPageSize: true,
      margins: { marginType: 'none' },
      pageSize: 'A4',
      landscape: true
    });
    fs.writeFileSync(selection.filePath, data);
    return { canceled: false, filePath: selection.filePath };
  });
  secureHandle('sales:create', (_event, payload) => createSale(payload));
  secureHandle('sales:merge-daily', (_event, payload) => mergeDailySales(payload));
  secureHandle('purchases:create', (_event, payload) => createPurchase(payload));
  secureHandle('sales:list', (_event, payload) => listSales(payload));
  secureHandle('purchases:list', (_event, payload) => listPurchases(payload));
  secureHandle('purchases:price-history', (_event, productId, payload) => getPurchasePriceHistory(productId, payload));
  secureHandle('invoices:next-number', (_event, kind, date) => getNextInvoiceNumber(kind, date));
  secureHandle('invoices:details', (_event, kind, id) => getInvoiceDetails(kind, id));
  secureHandle('invoices:update', (_event, kind, id, payload) => {
    if (kind !== 'sale') throw new Error('ویرایش این نوع فاکتور هنوز پشتیبانی نمی‌شود.');
    return updateSale(id, payload);
  });
  secureHandle('invoices:settle', (_event, kind, id, payload) => settleInvoice(kind, id, payload));
  secureHandle('invoices:cancel', (_event, kind, id) => cancelInvoice(kind, id));
  secureHandle('invoices:set-pinned', (_event, kind, id, pinned) => {
    if (kind !== 'sale') throw new Error('سنجاق کردن فقط برای فاکتورهای فروش فعال است.');
    return setSalePinned(id, pinned);
  });
  secureHandle('returns:sale:create', (_event, payload) => createSaleReturn(payload));
  secureHandle('returns:sale:details', (_event, id) => getSaleReturnDetails(id));
  secureHandle('returns:sale:list', (_event, payload) => listSalesReturns(payload));
  secureHandle('returns:sale:cancel', (_event, id) => cancelSaleReturn(id));
  secureHandle('returns:purchase:create', (_event, payload) => createPurchaseReturn(payload));
  secureHandle('returns:purchase:details', (_event, id) => getPurchaseReturnDetails(id));
  secureHandle('returns:purchase:list', (_event, payload) => listPurchaseReturns(payload));
  secureHandle('returns:purchase:cancel', (_event, id) => cancelPurchaseReturn(id));
  secureHandle('cash:create', (_event, payload) => createCashTransaction(payload));
  secureHandle('cash:details', (_event, id) => getCashTransaction(id));
  secureHandle('cash:list', (_event, payload) => listCashTransactions(payload));
  secureHandle('cash:summary', (_event, payload) => getCashSummary(payload));
  secureHandle('parties:ledger', (_event, id, payload) => getPartyLedger(id, payload));
  secureHandle('inventory:adjust', (_event, id, payload) => adjustProductStock(id, payload));
  secureHandle('inventory:movements', (_event, payload) => listStockMovements(payload));
  secureHandle('auth:login', (_event, username, password) => loginUser(username, password));
  secureHandle('auth:logout', () => logoutUser());
  secureHandle('auth:current', () => getCurrentUser());
  secureHandle('users:create', (_event, payload) => createUser(payload));
  secureHandle('users:list', () => listUsers());
  secureHandle('users:set-active', (_event, id, active) => setUserActive(id, active));
  secureHandle('audit:list', (_event, payload) => listAuditLogs(payload));
  secureHandle('checks:list', (_event, payload) => listChecks(payload));
  secureHandle('checks:update-status', (_event, id, status, notes) => updateCheckStatus(id, status, notes));
  secureHandle('installments:create-plan', (_event, payload) => createInstallmentPlan(payload));
  secureHandle('installments:list-plans', (_event, payload) => listInstallmentPlans(payload));
  secureHandle('installments:record-payment', (_event, id, payload) => recordInstallmentPayment(id, payload));
  secureHandle('auth:change-password', (_event, currentPassword, newPassword) => changeCurrentUserPassword(currentPassword, newPassword));
  secureHandle('auth:webauthn:registration-options', () => beginWindowsHelloRegistration());
  secureHandle('auth:webauthn:registration-verify', (_event, response) => finishWindowsHelloRegistration(response));
  secureHandle('auth:webauthn:authentication-options', (_event, username) => beginWindowsHelloAuthentication(username));
  secureHandle('auth:webauthn:authentication-verify', (_event, username, response) => finishWindowsHelloAuthentication(username, response));
  secureHandle('auth:quick-pin:set', (_event, pin, currentPassword) => setQuickPin(pin, currentPassword));
  secureHandle('auth:quick-pin:clear', (_event, currentPassword) => clearQuickPin(currentPassword));
  secureHandle('auth:quick-pin:status', () => getQuickPinStatus());
  secureHandle('auth:quick-pin:unlock', (_event, pin) => unlockWithQuickPin(pin));
  secureHandle('profit-loss:report', (_event, payload) => getProfitLossReport(payload));
  secureHandle('daily-close:create', (_event, payload) => closeDailyAccount(payload));
  secureHandle('daily-close:details', (_event, id) => getDailyClosure(id));
  secureHandle('daily-close:list', (_event, payload) => listDailyClosures(payload));
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.webContents.send('window:close-requested'));
  ipcMain.on('window:close-confirmed', () => {
    isWindowCloseApproved = true;
    // Confirmed close minimises to the system tray rather than terminating;
    // "خروج کامل" in the tray context menu is the only true exit path.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
      mainWindow.setSkipTaskbar(true);
    }
  });
  secureHandle('window:is-maximized', () => Boolean(mainWindow?.isMaximized()));
  secureHandle('window:set-overlay', (_event, payload = {}) => {
    if (process.platform !== 'win32' || typeof mainWindow?.setTitleBarOverlay !== 'function') return false;
    try {
      mainWindow.setTitleBarOverlay({
        color: String(payload.color || '#111b2b'),
        symbolColor: String(payload.symbolColor || '#dbe7f5'),
        height: 42
      });
      return true;
    } catch {
      return false;
    }
  });
}

function backupDatabase(destination) {
  const targetDir = String(destination || '').trim() || app.getPath('documents');
  fs.mkdirSync(targetDir, { recursive: true });
  const file = path.join(targetDir, `accletron-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  // VACUUM INTO snapshots a consistent copy of the live database; a plain file
  // copy could catch a half-written WAL page and produce a corrupt backup.
  getDatabase(app.getPath('userData')).prepare('VACUUM INTO ?').run(file);
  pruneOldBackups(targetDir);
  return { path: file };
}

function pruneOldBackups(targetDir, keep = 14) {
  try {
    const files = fs.readdirSync(targetDir)
      .filter((name) => /^accletron-backup-.*\.db$/i.test(name))
      .map((name) => path.join(targetDir, name))
      .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const entry of files.slice(keep)) fs.rmSync(entry.file, { force: true });
  } catch {
    // Cleanup must never fail the backup itself.
  }
}

function startOfficialUse() {
  const userDataPath = app.getPath('userData');
  const source = path.join(userDataPath, 'accletron.db');
  const settings = getAppSettings();
  const backup = backupDatabase(settings.backup?.path);

  closeDatabase();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const file = `${source}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
  getDatabase(userDataPath);
  saveAppSettings(settings);

  return { backupPath: backup.path };
}

function runAutoBackupIfDue() {
  try {
    const settings = getAppSettings();
    if (!settings.backup?.auto) return;
    const targetDir = settings.backup.path || app.getPath('documents');
    fs.mkdirSync(targetDir, { recursive: true });
    const frequencyMs = settings.backup.frequency === 'weekly' ? 7 * 86400000 : 86400000;
    const files = fs.readdirSync(targetDir)
      .filter((name) => /^accletron-backup-.*\.db$/i.test(name))
      .map((name) => path.join(targetDir, name))
      .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files[0] && Date.now() - files[0].mtime < frequencyMs) return;
    backupDatabase(targetDir);
  } catch {
    // Automatic backup must never prevent the application from starting.
  }
}

const createWindow = () => {
  isWindowCloseApproved = false;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#111b2b',
      symbolColor: '#dbe7f5',
      height: 42
    },
    backgroundColor: '#111827',
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  hardenWebContents(mainWindow.webContents);
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    appendProcessLog('render-process-gone', new Error(`${details.reason} (exitCode=${details.exitCode})`));
    // Bring the UI back instead of leaving a dead window; unsaved in-form
    // state is lost either way.
    if (details.reason !== 'clean-exit' && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
  });
  mainWindow.loadFile('index.html');
  mainWindow.on('close', (event) => {
    if (isQuitting || isWindowCloseApproved) return;
    // A crashed renderer can never confirm the close flow; without this the
    // window would deadlock and only Task Manager could end the process.
    if (mainWindow.webContents.isCrashed()) {
      isWindowCloseApproved = true;
      return;
    }
    event.preventDefault();
    mainWindow.webContents.send('window:close-requested');
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
};

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setSkipTaskbar(false);
  mainWindow.show();
  mainWindow.focus();
}

function createSystemTray() {
  if (tray) return;
  const source = nativeImage.createFromPath(appIconPath);
  tray = new Tray(source.isEmpty() ? nativeImage.createEmpty() : source.resize({ width: 16, height: 16 }));
  tray.setToolTip('Acclectron');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'نمایش Acclectron', click: showMainWindow },
    { type: 'separator' },
    { label: 'خروج کامل', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', showMainWindow);
}

function applyStartupSetting(enabled) {
  if (process.platform !== 'win32' || typeof app.setLoginItemSettings !== 'function') return;
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    path: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()]
  });
}

// A second instance would write to the same SQLite file concurrently; hand
// focus back to the running window instead of opening a second one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    showMainWindow();
  });
}

app.whenReady().then(() => {
  getDatabase(app.getPath('userData'));
  registerIpcHandlers();
  applyStartupSetting(getAppSettings().appearance?.startup);
  createWindow();
  createSystemTray();
  runAutoBackupIfDue();
  autoBackupTimer = setInterval(runAutoBackupIfDue, 60 * 1000);
  pruneOldLogs();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  isWindowCloseApproved = true;
  if (autoBackupTimer) clearInterval(autoBackupTimer);
  tray?.destroy();
  tray = null;
  closeDatabase();
});
app.on('window-all-closed', () => {
  // Hiding to the tray leaves no visible window; only a requested full exit
  // should terminate the application.
  if (isQuitting && process.platform !== 'darwin') app.quit();
});
