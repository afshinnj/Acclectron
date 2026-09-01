const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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
  getDashboardSummary,
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
  getAppSettings,
  saveAppSettings,
  getNextInvoiceNumber,
  listSales,
  listPurchases,
  getInvoiceDetails,
  updateSale,
  settleInvoice,
  cancelInvoice
} = require('./src/main/database');

let mainWindow;
const pendingImports = new Map();
const appIconPath = path.join(__dirname, 'assets', 'icon.png');

function registerIpcHandlers() {
  ipcMain.handle('settings:get', () => getAppSettings());
  ipcMain.handle('settings:save', (_event, payload) => saveAppSettings(payload));
  ipcMain.handle('settings:printers', async () => {
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
  ipcMain.handle('print:invoice', async (_event, payload = {}) => {
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
  ipcMain.handle('pdf:invoice', async (_event, payload = {}) => {
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
  ipcMain.handle('settings:choose-logo', async () => {
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
  ipcMain.handle('products:search', (_event, query = '') => searchProducts(query));
  ipcMain.handle('products:list', (_event, payload = {}) => listProducts(payload.query, payload.categoryId));
  ipcMain.handle('products:create', (_event, payload) => createProduct(payload));
  ipcMain.handle('products:update', (_event, id, payload) => updateProduct(id, payload));
  ipcMain.handle('products:quick-update', (_event, id, payload) => updateProductQuick(id, payload));
  ipcMain.handle('products:set-active', (_event, id, active) => setProductActive(id, active));
  ipcMain.handle('products:import-preview', async () => {
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
  ipcMain.handle('products:import-confirm', (_event, token, duplicateMode = 'skip') => {
    const pending = pendingImports.get(String(token));
    if (!pending) throw new Error('پیش‌نمایش ورود منقضی شده است؛ لطفاً فایل را دوباره انتخاب کنید.');
    pendingImports.delete(String(token));
    const result = importProducts(pending.rows, ['skip', 'update'].includes(duplicateMode) ? duplicateMode : 'skip');
    result.errors = [...pending.errors, ...result.errors];
    return result;
  });
  ipcMain.handle('products:template', async () => {
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
  ipcMain.handle('products:export', async () => {
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
        row.code, row.name, row.categoryName, row.barcode, Math.round(Number(row.purchasePrice || 0) / 100),
        Math.round(Number(row.wholesalePrice || 0) / 100), Math.round(Number(row.salePrice || 0) / 100),
        row.stock, row.minimumStock, row.unitName || row.unitSymbol, row.isActive ? 'فعال' : 'غیرفعال'
      ])
    ];
    fs.writeFileSync(selection.filePath, '\uFEFF' + csvRows.map((row) => row.map(escapeCsv).join(',')).join('\r\n') + '\r\n', 'utf8');
    return { canceled: false, filePath: selection.filePath, count: rows.length };
  });
  ipcMain.handle('categories:list', (_event, includeInactive = true) => listCategories(includeInactive));
  ipcMain.handle('categories:create', (_event, payload) => createCategory(payload));
  ipcMain.handle('categories:update', (_event, id, payload) => updateCategory(id, payload));
  ipcMain.handle('categories:set-active', (_event, id, active) => setCategoryActive(id, active));
  ipcMain.handle('units:list', () => listUnits());
  ipcMain.handle('units:create', (_event, payload) => createUnit(payload));
  ipcMain.handle('units:update', (_event, id, payload) => updateUnit(id, payload));
  ipcMain.handle('units:set-active', (_event, id, active) => setUnitActive(id, active));
  ipcMain.handle('settings:choose-backup-path', async () => {
    const selection = await dialog.showOpenDialog(mainWindow, { title: 'انتخاب پوشه پشتیبان', properties: ['openDirectory', 'createDirectory'] });
    return selection.canceled || !selection.filePaths[0] ? { canceled: true } : { canceled: false, path: selection.filePaths[0] };
  });
  ipcMain.handle('settings:backup-now', async (_event, destination) => {
    const targetDir = String(destination || '').trim() || app.getPath('documents');
    fs.mkdirSync(targetDir, { recursive: true });
    const source = path.join(app.getPath('userData'), 'accletron.db');
    const file = path.join(targetDir, `accletron-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    fs.copyFileSync(source, file);
    return { path: file };
  });
  ipcMain.handle('customers:search', (_event, query = '') => searchCustomers(query));
  ipcMain.handle('parties:list', (_event, payload = {}) => listParties(payload.query, payload.type, payload.includeInactive !== false));
  ipcMain.handle('parties:create', (_event, payload) => createParty(payload));
  ipcMain.handle('parties:update', (_event, id, payload) => updateParty(id, payload));
  ipcMain.handle('parties:set-active', (_event, id, active) => setPartyActive(id, active));
  ipcMain.handle('dashboard:summary', () => getDashboardSummary());
  ipcMain.handle('reports:sales', (_event, payload = {}) => getSalesReport(payload));
  ipcMain.handle('sales:create', (_event, payload) => createSale(payload));
  ipcMain.handle('purchases:create', (_event, payload) => createPurchase(payload));
  ipcMain.handle('sales:list', (_event, payload) => listSales(payload));
  ipcMain.handle('purchases:list', (_event, payload) => listPurchases(payload));
  ipcMain.handle('invoices:next-number', (_event, kind, date) => getNextInvoiceNumber(kind, date));
  ipcMain.handle('invoices:details', (_event, kind, id) => getInvoiceDetails(kind, id));
  ipcMain.handle('invoices:update', (_event, kind, id, payload) => {
    if (kind !== 'sale') throw new Error('ویرایش این نوع فاکتور هنوز پشتیبانی نمی‌شود.');
    return updateSale(id, payload);
  });
  ipcMain.handle('invoices:settle', (_event, kind, id, payload) => settleInvoice(kind, id, payload));
  ipcMain.handle('invoices:cancel', (_event, kind, id) => cancelInvoice(kind, id));
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.handle('window:is-maximized', () => Boolean(mainWindow?.isMaximized()));
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#111827',
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
};

app.whenReady().then(() => {
  getDatabase(app.getPath('userData'));
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', closeDatabase);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
