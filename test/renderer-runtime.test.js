const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const rendererRoot = path.join(projectRoot, 'src/renderer');

test('renderer runtime keeps shared mutable state and wrapped functions live without globals', async () => {
  const { renderer, registerRendererBindings } = await import('../src/renderer/shared/runtime.mjs');
  let sessionReady = false;
  let setPage = (page) => `old:${page}`;

  registerRendererBindings(renderer, {
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

  assert.equal(renderer.appName, 'Acclectron');
  assert.equal(renderer.sessionReady, false);
  renderer.sessionReady = true;
  assert.equal(sessionReady, true);
  assert.equal(renderer.setPage('dashboard'), 'old:dashboard');
  renderer.setPage = (page) => `wrapped:${page}`;
  assert.equal(setPage('sales'), 'wrapped:sales');
  assert.equal(Object.hasOwn(globalThis, 'sessionReady'), false);
});

test('renderer features import the shared runtime and register bindings outside window', () => {
  const featureFiles = [
    'core.mjs',
    'features/management.mjs',
    'features/settings-page.mjs',
    'features/settings-print.mjs',
    'features/invoices.mjs',
    'features/assistant-reports.mjs',
    'features/daily-sales.mjs',
    'features/operations.mjs',
    'features/auth.mjs'
  ];

  for (const file of featureFiles) {
    const source = fs.readFileSync(path.join(rendererRoot, file), 'utf8');
    assert.match(source, /import \{ renderer, registerRendererBindings \} from ['"].*shared\/runtime\.mjs['"]/);
    assert.match(source, /registerRendererBindings\(renderer,/);
    assert.doesNotMatch(source, /publishRendererBindings|bridge\.mjs/);
  }

  assert.equal(fs.existsSync(path.join(rendererRoot, 'shared/bridge.mjs')), false);
});

test('renderer bootstrap imports existing feature modules in dependency order', () => {
  const bootstrapPath = path.join(rendererRoot, 'bootstrap.mjs');
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

test('settings data refresh is declared and registered for the shared renderer API', () => {
  const settingsPath = path.join(rendererRoot, 'features/settings-print.mjs');
  const source = fs.readFileSync(settingsPath, 'utf8');

  assert.match(source, /let refreshSettingsData\s*=/);
  assert.match(source, /refreshSettingsData:\s*\{\s*get:/);
});
