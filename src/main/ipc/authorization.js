'use strict';

const PUBLIC_IPC_CHANNELS = new Set([
  'auth:login',
  'auth:current',
  'auth:logout',
  'auth:webauthn:authentication-options',
  'auth:webauthn:authentication-verify',
  'auth:quick-pin:status',
  'auth:quick-pin:unlock',
  'settings:get',
  'window:is-maximized',
  'window:set-overlay'
]);

const IPC_PERMISSIONS = Object.freeze({
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
});

function createSecureHandle({ ipcMain, isTrustedAppSender, getMainWindow, appDirectory, getCurrentUser, requirePermission }) {
  if (!ipcMain?.handle || typeof isTrustedAppSender !== 'function' || typeof getMainWindow !== 'function') {
    throw new TypeError('IPC authorization requires ipcMain, a trust check, and a main-window getter.');
  }

  return (channel, handler) => ipcMain.handle(channel, (event, ...args) => {
    const mainWindow = getMainWindow();
    if (!isTrustedAppSender(event, mainWindow?.webContents, appDirectory)) {
      throw new Error('درخواست از پنجرهٔ مجاز برنامه دریافت نشد.');
    }
    if (PUBLIC_IPC_CHANNELS.has(channel)) return handler(event, ...args);
    const permission = IPC_PERMISSIONS[channel];
    if (permission) requirePermission(permission);
    else if (!getCurrentUser()) throw new Error('ابتدا وارد حساب کاربری شوید.');
    return handler(event, ...args);
  });
}

module.exports = { createSecureHandle, IPC_PERMISSIONS, PUBLIC_IPC_CHANNELS };
