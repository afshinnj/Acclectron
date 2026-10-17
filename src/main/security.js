'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');

function isTrustedAppUrl(url, appDirectory) {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'file:') return false;
    const actual = path.resolve(fileURLToPath(parsed));
    const expected = path.resolve(appDirectory, 'index.html');
    return process.platform === 'win32'
      ? actual.toLowerCase() === expected.toLowerCase()
      : actual === expected;
  } catch {
    return false;
  }
}

function isTrustedAppSender(event, webContents, appDirectory) {
  return Boolean(event?.sender && event.sender === webContents
    && isTrustedAppUrl(event.senderFrame?.url, appDirectory));
}

module.exports = { isTrustedAppUrl, isTrustedAppSender };
