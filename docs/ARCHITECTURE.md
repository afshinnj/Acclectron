# Architecture map

This note documents the current process boundaries and renderer module order.

## Main process

- `main.js` creates the Electron window and wires app-level services.
- `preload.js` exposes the renderer's limited API.
- `src/main/ipc/authorization.js` defines trusted channels and authorization
  wrappers.
- `src/main/ipc/accounts.js`, `invoices.js`, `operations.js`, and `window.js`
  register IPC handlers by capability.
- `src/main/db/` owns persistence and domain queries. Schema changes belong in
  additive migrations in `src/main/db/core.js` and must be validated against
  temporary databases in tests.

## Renderer

`index.html` loads `src/renderer/bootstrap.mjs` as an ES module. Its imports are
ordered because later features extend shared functions and initialize markup
created by earlier features:

1. `src/renderer/shared/interaction-policy.mjs` installs global interaction
   rules before feature listeners.
2. `src/renderer/core.mjs` provides shared UI state, formatting, dashboard, and
   daily-sale primitives.
3. `src/renderer/features/management.mjs` provides product, category, party, and
   management-page behavior.
4. `src/renderer/features/settings-page.mjs` and `settings-print.mjs` build and
   operate store settings and print flows.
5. `src/renderer/features/invoices.mjs` and `assistant-reports.mjs` implement
   invoices, the assistant, and reporting.
6. `src/renderer/features/daily-sales.mjs` enhances the daily-sale workflow.
7. `src/renderer/features/operations.mjs` implements returns, cash, ledger,
   inventory, users, checks, installments, and profit/loss pages.
8. `src/renderer/features/auth.mjs` finishes routing and starts authentication.

Feature files execute as separate ES modules and import a shared `renderer`
runtime object from `src/renderer/shared/runtime.mjs`. Each feature registers
its public state and functions there through an explicit module import; the
runtime uses accessors where later features wrap existing functions. These
bindings are module scoped and are never installed on `window` or
`globalThis`. The ordered bootstrap remains necessary while features extend
shared behavior during initialization. New code should prefer direct named
exports and imports when its dependency does not need to participate in this
shared extension contract.

## Validation

Run `npm run check` and `npm test` after changing process boundaries or renderer
load order. Database tests use temporary files; do not point tests or manual
verification at the user's live database.
