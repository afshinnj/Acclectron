const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

test('renderer bridge keeps mutable state and wrapped functions live', async () => {
  const { publishRendererBindings } = await import('../src/renderer/shared/bridge.mjs');
  const target = {};
  let sessionReady = false;
  let setPage = (page) => `old:${page}`;

  publishRendererBindings(target, {
    constants: { appName: 'Acclectron' },
    mutable: {
      sessionReady: {
        get: () => sessionReady,
        set: (value) => { sessionReady = value; }
      }
    },
    functions: {
      setPage: {
        get: () => setPage,
        set: (value) => { setPage = value; }
      }
    }
  });

  assert.equal(target.appName, 'Acclectron');
  assert.equal(target.sessionReady, false);
  target.sessionReady = true;
  assert.equal(sessionReady, true);
  assert.equal(target.setPage('dashboard'), 'old:dashboard');

  target.setPage = (page) => `wrapped:${page}`;
  assert.equal(setPage('sales'), 'wrapped:sales');
});

test('ES modules can resolve and assign compatibility bindings through the global environment', async () => {
  const bindingName = '__accletronRendererBridgeProbe';
  let value = 'before';
  Object.defineProperty(globalThis, bindingName, {
    configurable: true,
    get: () => value,
    set: (next) => { value = next; }
  });

  try {
    const source = encodeURIComponent(`${bindingName} = 'after'`);
    await import(`data:text/javascript,${source}`);
    assert.equal(value, 'after');
  } finally {
    delete globalThis[bindingName];
  }
});

test('renderer bootstrap imports existing feature modules in dependency order', () => {
  const bootstrapPath = path.join(projectRoot, 'src/renderer/bootstrap.mjs');
  const imports = [...fs.readFileSync(bootstrapPath, 'utf8').matchAll(/^import ['"](.+)['"];$/gm)]
    .map((match) => match[1]);

  assert.deepEqual(imports, [
    './shared/interaction-policy.mjs',
    './core.mjs',
    './features/management.mjs',
    './features/settings-page.mjs',
    './features/settings-print.mjs',
    './features/invoices.mjs',
    './features/assistant-reports.mjs',
    './features/daily-sales.mjs',
    './features/operations.mjs',
    './features/auth.mjs'
  ]);

  for (const imported of imports) {
    assert.equal(fs.existsSync(path.resolve(path.dirname(bootstrapPath), imported)), true, `${imported} exists`);
  }
});

test('settings data refresh is declared and shared with the post-login refresh flow', () => {
  const settingsPath = path.join(projectRoot, 'src/renderer/features/settings-print.mjs');
  const source = fs.readFileSync(settingsPath, 'utf8');

  assert.match(source, /let refreshSettingsData\s*=/);
  assert.match(source, /refreshSettingsData:\s*\{\s*get:/);
});
