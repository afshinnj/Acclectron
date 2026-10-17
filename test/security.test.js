'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isTrustedAppUrl, isTrustedAppSender } = require('../src/main/security');

const appDirectory = path.resolve(__dirname, '..');
const indexUrl = pathToFileURL(path.join(appDirectory, 'index.html')).href;

test('only the packaged app entry page is a trusted app URL', () => {
  assert.equal(isTrustedAppUrl(indexUrl, appDirectory), true);
  assert.equal(isTrustedAppUrl('https://example.com/index.html', appDirectory), false);
  assert.equal(isTrustedAppUrl(pathToFileURL(path.join(appDirectory, 'preload.js')).href, appDirectory), false);
  assert.equal(isTrustedAppUrl('file:///outside/index.html', appDirectory), false);
  assert.equal(isTrustedAppUrl('not a url', appDirectory), false);
});

test('IPC accepts only the main window and its trusted frame', () => {
  const mainWindow = {};
  const event = { sender: mainWindow, senderFrame: { url: indexUrl } };
  assert.equal(isTrustedAppSender(event, mainWindow, appDirectory), true);
  assert.equal(isTrustedAppSender({ ...event, sender: {} }, mainWindow, appDirectory), false);
  assert.equal(isTrustedAppSender({ sender: mainWindow, senderFrame: { url: 'https://example.com' } }, mainWindow, appDirectory), false);
  assert.equal(isTrustedAppSender({ sender: mainWindow }, mainWindow, appDirectory), false);
});
