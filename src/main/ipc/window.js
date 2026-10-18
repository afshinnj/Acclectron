'use strict';

function registerWindowHandlers({ ipcMain, secureHandle, isTrustedAppSender, getMainWindow, appDirectory, markWindowCloseApproved, platform }) {
  const isTrustedWindowEvent = (event) => isTrustedAppSender(event, getMainWindow()?.webContents, appDirectory);

  ipcMain.on('window:minimize', (event) => {
    if (!isTrustedWindowEvent(event)) return;
    getMainWindow()?.minimize();
  });
  ipcMain.on('window:toggle-maximize', (event) => {
    if (!isTrustedWindowEvent(event)) return;
    const window = getMainWindow();
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.on('window:close', (event) => {
    if (!isTrustedWindowEvent(event)) return;
    getMainWindow()?.webContents.send('window:close-requested');
  });
  ipcMain.on('window:close-confirmed', (event) => {
    if (!isTrustedWindowEvent(event)) return;
    markWindowCloseApproved();
    const window = getMainWindow();
    if (window && !window.isDestroyed()) {
      window.hide();
      window.setSkipTaskbar(true);
    }
  });
  secureHandle('window:is-maximized', () => Boolean(getMainWindow()?.isMaximized()));
  secureHandle('window:set-overlay', (_event, payload = {}) => {
    const window = getMainWindow();
    if (platform !== 'win32' || typeof window?.setTitleBarOverlay !== 'function') return false;
    try {
      const height = Math.max(32, Math.min(64, Math.round(Number(payload.height) || 48)));
      window.setTitleBarOverlay({
        color: String(payload.color || '#111a2b'),
        symbolColor: String(payload.symbolColor || '#dbe4f0'),
        height
      });
      return true;
    } catch {
      return false;
    }
  });
}

module.exports = { registerWindowHandlers };
