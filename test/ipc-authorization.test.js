'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSecureHandle } = require('../src/main/ipc/authorization');
const { registerAccountHandlers } = require('../src/main/ipc/accounts');
const { registerInvoiceHandlers } = require('../src/main/ipc/invoices');
const { registerOperationsHandlers } = require('../src/main/ipc/operations');

function createIpcHarness({ trusted = true, currentUser = null, permissions = [] } = {}) {
  const handlers = new Map();
  const requestedPermissions = [];
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const window = { webContents: {} };
  const secureHandle = createSecureHandle({
    ipcMain,
    isTrustedAppSender: (event, webContents) => trusted && event?.sender === webContents && webContents === window.webContents,
    getMainWindow: () => window,
    appDirectory: '/app',
    getCurrentUser: () => currentUser,
    requirePermission: (permission) => {
      requestedPermissions.push(permission);
      if (!permissions.includes(permission)) throw new Error('permission denied');
    }
  });
  return { handlers, requestedPermissions, secureHandle, window };
}

test('public login handler is restricted to trusted app senders without requiring a session', async () => {
  const harness = createIpcHarness();
  harness.secureHandle('auth:login', (_event, username) => username);
  const invoke = harness.handlers.get('auth:login');
  const event = { sender: harness.window.webContents };

  assert.equal(await invoke(event, 'admin'), 'admin');
  assert.throws(() => invoke({ sender: {} }, 'admin'), /درخواست از پنجرهٔ مجاز/);
});

test('non-public channels require an authenticated user', () => {
  const harness = createIpcHarness();
  harness.secureHandle('sales:list', () => 'sales');

  assert.throws(() => harness.handlers.get('sales:list')({ sender: harness.window.webContents }), /ابتدا وارد حساب/);
});

test('permission-scoped channels enforce their configured permission', () => {
  const harness = createIpcHarness({ currentUser: { id: 1 } });
  harness.secureHandle('products:create', () => 'created');
  const invoke = harness.handlers.get('products:create');
  const event = { sender: harness.window.webContents };

  assert.throws(() => invoke(event), /permission denied/);
  assert.deepEqual(harness.requestedPermissions, ['products']);
});

test('account, invoice and operations registrars expose distinct secured channels', () => {
  const channels = [];
  const secureHandle = (channel) => channels.push(channel);
  registerAccountHandlers(secureHandle);
  registerInvoiceHandlers(secureHandle);
  registerOperationsHandlers(secureHandle);

  assert.equal(channels.length, 52);
  assert.equal(new Set(channels).size, channels.length);
  assert.ok(channels.includes('auth:quick-pin:unlock'));
  assert.ok(channels.includes('returns:sale:create'));
  assert.ok(channels.includes('daily-close:create'));
});
