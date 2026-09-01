const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appInfo', {
  name: 'Acclectron',
  version: '1.0.0'
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
  },
  dashboard: {
    summary: () => ipcRenderer.invoke('dashboard:summary')
  },
  reports: {
    sales: (payload) => ipcRenderer.invoke('reports:sales', payload)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (payload) => ipcRenderer.invoke('settings:save', payload),
    printers: () => ipcRenderer.invoke('settings:printers'),
    chooseLogo: () => ipcRenderer.invoke('settings:choose-logo'),
    chooseBackupPath: () => ipcRenderer.invoke('settings:choose-backup-path'),
    backupNow: (destination) => ipcRenderer.invoke('settings:backup-now', destination)
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
    list: (payload) => ipcRenderer.invoke('purchases:list', payload)
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
