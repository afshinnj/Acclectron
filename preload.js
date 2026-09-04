const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appInfo', {
  name: 'Acclectron',
  version: '1.0.2'
});

contextBridge.exposeInMainWorld('api', {
  products: {
    search: (query) => ipcRenderer.invoke('products:search', query),
    list: (payload) => ipcRenderer.invoke('products:list', payload),
    create: (payload) => ipcRenderer.invoke('products:create', payload),
    update: (id, payload) => ipcRenderer.invoke('products:update', id, payload),
    quickUpdate: (id, payload) => ipcRenderer.invoke('products:quick-update', id, payload),
    setActive: (id, active) => ipcRenderer.invoke('products:set-active', id, active),
    importPreview: () => ipcRenderer.invoke('products:import-preview'),
    importConfirm: (token, duplicateMode) => ipcRenderer.invoke('products:import-confirm', token, duplicateMode),
    template: () => ipcRenderer.invoke('products:template'),
    export: () => ipcRenderer.invoke('products:export')
  },
  categories: {
    list: (includeInactive) => ipcRenderer.invoke('categories:list', includeInactive),
    create: (payload) => ipcRenderer.invoke('categories:create', payload),
    update: (id, payload) => ipcRenderer.invoke('categories:update', id, payload),
    setActive: (id, active) => ipcRenderer.invoke('categories:set-active', id, active)
  },
  units: {
    list: () => ipcRenderer.invoke('units:list'),
    create: (payload) => ipcRenderer.invoke('units:create', payload),
    update: (id, payload) => ipcRenderer.invoke('units:update', id, payload),
    setActive: (id, active) => ipcRenderer.invoke('units:set-active', id, active)
  },
  customers: {
    search: (query) => ipcRenderer.invoke('customers:search', query),
    list: (payload) => ipcRenderer.invoke('parties:list', payload),
    create: (payload) => ipcRenderer.invoke('parties:create', payload),
    update: (id, payload) => ipcRenderer.invoke('parties:update', id, payload),
    setActive: (id, active) => ipcRenderer.invoke('parties:set-active', id, active)
    ,ledger: (id, payload) => ipcRenderer.invoke('parties:ledger', id, payload)
  },
  auth: {
    login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
    logout: () => ipcRenderer.invoke('auth:logout'),
    current: () => ipcRenderer.invoke('auth:current'),
    changePassword: (currentPassword, newPassword) => ipcRenderer.invoke('auth:change-password', currentPassword, newPassword)
  },
  users: {
    create: (payload) => ipcRenderer.invoke('users:create', payload),
    list: () => ipcRenderer.invoke('users:list'),
    setActive: (id, active) => ipcRenderer.invoke('users:set-active', id, active)
  },
  audit: {
    list: (payload) => ipcRenderer.invoke('audit:list', payload)
  },
  checks: {
    list: (payload) => ipcRenderer.invoke('checks:list', payload),
    updateStatus: (id, status, notes) => ipcRenderer.invoke('checks:update-status', id, status, notes)
  },
  installments: {
    createPlan: (payload) => ipcRenderer.invoke('installments:create-plan', payload),
    listPlans: (payload) => ipcRenderer.invoke('installments:list-plans', payload),
    recordPayment: (id, payload) => ipcRenderer.invoke('installments:record-payment', id, payload)
  },
  dashboard: {
    summary: () => ipcRenderer.invoke('dashboard:summary')
  },
  notifications: {
    list: (payload) => ipcRenderer.invoke('notifications:list', payload)
  },
  reports: {
    sales: (payload) => ipcRenderer.invoke('reports:sales', payload),
    exportCsv: (kind, payload) => ipcRenderer.invoke('reports:export-csv', kind, payload),
    exportPdf: (payload) => ipcRenderer.invoke('reports:export-pdf', payload)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (payload) => ipcRenderer.invoke('settings:save', payload),
    printers: () => ipcRenderer.invoke('settings:printers'),
    chooseLogo: () => ipcRenderer.invoke('settings:choose-logo'),
    chooseBackupPath: () => ipcRenderer.invoke('settings:choose-backup-path'),
    backupNow: (destination) => ipcRenderer.invoke('settings:backup-now', destination),
    restore: () => ipcRenderer.invoke('settings:restore')
  },
  print: {
    invoice: (payload) => ipcRenderer.invoke('print:invoice', payload),
    invoicePdf: (payload) => ipcRenderer.invoke('pdf:invoice', payload)
  },
  sales: {
    create: (payload) => ipcRenderer.invoke('sales:create', payload),
    list: (payload) => ipcRenderer.invoke('sales:list', payload)
  },
  purchases: {
    create: (payload) => ipcRenderer.invoke('purchases:create', payload),
    list: (payload) => ipcRenderer.invoke('purchases:list', payload),
    priceHistory: (productId, payload) => ipcRenderer.invoke('purchases:price-history', productId, payload)
  },
  returns: {
    sale: {
      create: (payload) => ipcRenderer.invoke('returns:sale:create', payload),
      details: (id) => ipcRenderer.invoke('returns:sale:details', id),
      list: (payload) => ipcRenderer.invoke('returns:sale:list', payload),
      cancel: (id) => ipcRenderer.invoke('returns:sale:cancel', id)
    },
    purchase: {
      create: (payload) => ipcRenderer.invoke('returns:purchase:create', payload),
      details: (id) => ipcRenderer.invoke('returns:purchase:details', id),
      list: (payload) => ipcRenderer.invoke('returns:purchase:list', payload),
      cancel: (id) => ipcRenderer.invoke('returns:purchase:cancel', id)
    }
  },
  cash: {
    create: (payload) => ipcRenderer.invoke('cash:create', payload),
    details: (id) => ipcRenderer.invoke('cash:details', id),
    list: (payload) => ipcRenderer.invoke('cash:list', payload),
    summary: (payload) => ipcRenderer.invoke('cash:summary', payload)
  },
  inventory: {
    adjust: (id, payload) => ipcRenderer.invoke('inventory:adjust', id, payload),
    movements: (payload) => ipcRenderer.invoke('inventory:movements', payload)
  },
  profitLoss: {
    report: (payload) => ipcRenderer.invoke('profit-loss:report', payload)
  },
  dailyClose: {
    create: (payload) => ipcRenderer.invoke('daily-close:create', payload),
    details: (id) => ipcRenderer.invoke('daily-close:details', id),
    list: (payload) => ipcRenderer.invoke('daily-close:list', payload)
  },
  invoices: {
    nextNumber: (kind, date) => ipcRenderer.invoke('invoices:next-number', kind, date),
    details: (kind, id) => ipcRenderer.invoke('invoices:details', kind, id),
    update: (kind, id, payload) => ipcRenderer.invoke('invoices:update', kind, id, payload),
    settle: (kind, id, payload) => ipcRenderer.invoke('invoices:settle', kind, id, payload),
    cancel: (kind, id) => ipcRenderer.invoke('invoices:cancel', kind, id)
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized')
  }
});
