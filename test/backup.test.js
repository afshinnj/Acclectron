'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { validateBackupFile, restoreDatabaseFile } = require('../src/main/db/backup');

function makeDb(file, label) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE products(id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE categories(id INTEGER PRIMARY KEY); CREATE TABLE units(id INTEGER PRIMARY KEY); CREATE TABLE sales(id INTEGER PRIMARY KEY); CREATE TABLE sale_items(id INTEGER PRIMARY KEY); CREATE TABLE purchases(id INTEGER PRIMARY KEY); CREATE TABLE purchase_items(id INTEGER PRIMARY KEY); CREATE TABLE invoice_payments(id INTEGER PRIMARY KEY); CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE audit_logs(id INTEGER PRIMARY KEY); CREATE TABLE app_settings(key TEXT PRIMARY KEY); CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); CREATE TABLE marker(value TEXT); INSERT INTO schema_migrations VALUES(1);`);
  db.prepare('INSERT INTO marker VALUES (?)').run(label);
  return db;
}

function withDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accletron-backup-test-'));
  try { return callback(directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('validates SQLite integrity, required tables and supported schema versions', () => withDirectory((directory) => {
  const file = path.join(directory, 'valid.db');
  const db = makeDb(file, 'valid');
  db.close();
  assert.equal(validateBackupFile(file).version, 1);

  const invalid = path.join(directory, 'invalid.db');
  fs.writeFileSync(invalid, Buffer.alloc(2048, 1));
  assert.throws(() => validateBackupFile(invalid), /بررسی سلامت/);
  assert.throws(() => validateBackupFile(directory), /پشتیبان خالی یا نامعتبر/);

  const future = path.join(directory, 'future.db');
  const futureDb = makeDb(future, 'future');
  futureDb.exec('DELETE FROM schema_migrations; INSERT INTO schema_migrations VALUES(3);');
  futureDb.close();
  assert.throws(() => validateBackupFile(future), /نسخه/);

  const legacy = path.join(directory, 'legacy.db');
  const legacyDb = new DatabaseSync(legacy);
  legacyDb.exec('CREATE TABLE products(id INTEGER PRIMARY KEY); CREATE TABLE sales(id INTEGER PRIMARY KEY);');
  legacyDb.close();
  assert.equal(validateBackupFile(legacy).version, 0);
}));

test('restores a validated backup and snapshots the current database first', () => withDirectory((directory) => {
  const target = path.join(directory, 'accletron.db');
  const source = path.join(directory, 'incoming.db');
  const safety = path.join(directory, 'safety.db');
  let live = makeDb(target, 'before');
  const sourceDb = makeDb(source, 'after');
  sourceDb.close();

  const result = restoreDatabaseFile(source, target, {
    closeDatabase: () => { live.close(); live = null; },
    reopenDatabase: () => { live = new DatabaseSync(target); },
    createSafetyBackup: () => {
      live.prepare('VACUUM INTO ?').run(safety);
      return safety;
    }
  });

  assert.equal(live.prepare('SELECT value FROM marker').get().value, 'after');
  assert.equal(result.safetyPath, safety);
  const safetyDb = new DatabaseSync(safety, { readOnly: true });
  assert.equal(safetyDb.prepare('SELECT value FROM marker').get().value, 'before');
  safetyDb.close();
  live.close();
}));

test('rejects invalid input without closing or modifying the live database', () => withDirectory((directory) => {
  const target = path.join(directory, 'accletron.db');
  const source = path.join(directory, 'broken.db');
  const live = makeDb(target, 'still-here');
  fs.writeFileSync(source, 'broken');
  let safetyCalled = false;
  assert.throws(() => restoreDatabaseFile(source, target, {
    closeDatabase: () => { throw new Error('must not close'); },
    reopenDatabase: () => {},
    createSafetyBackup: () => { safetyCalled = true; return ''; }
  }));
  assert.equal(safetyCalled, false);
  assert.equal(live.prepare('SELECT value FROM marker').get().value, 'still-here');
  live.close();
}));

test('recovers the previous database if the restored database cannot reopen', () => withDirectory((directory) => {
  const target = path.join(directory, 'accletron.db');
  const source = path.join(directory, 'incoming.db');
  const safety = path.join(directory, 'safety.db');
  let live = makeDb(target, 'before');
  makeDb(source, 'after').close();
  let openAttempts = 0;
  assert.throws(() => restoreDatabaseFile(source, target, {
    closeDatabase: () => { if (live) live.close(); live = null; },
    reopenDatabase: () => {
      openAttempts += 1;
      if (openAttempts === 1) throw new Error('simulated open failure');
      live = new DatabaseSync(target);
    },
    createSafetyBackup: () => { live.prepare('VACUUM INTO ?').run(safety); return safety; }
  }), /simulated open failure/);
  assert.equal(live.prepare('SELECT value FROM marker').get().value, 'before');
  assert.equal(validateBackupFile(safety).version, 1);
  live.close();
}));
