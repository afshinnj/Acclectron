'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { CURRENT_DB_SCHEMA_VERSION } = require('./core');

const REQUIRED_TABLES = ['products', 'sales'];

function validateBackupFile(filePath, currentSchemaVersion = CURRENT_DB_SCHEMA_VERSION) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size < 512) throw new Error('فایل پشتیبان خالی یا نامعتبر است.');
  let db;
  try {
    db = new DatabaseSync(filePath, { readOnly: true });
    const integrity = db.prepare('PRAGMA integrity_check').get();
    if (integrity?.integrity_check !== 'ok') throw new Error('ساختار داخلی فایل SQLite سالم نیست.');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
    if (missing.length) throw new Error(`فایل انتخاب‌شده پشتیبان Acclectron نیست؛ جدول‌های لازم موجود نیستند: ${missing.join(', ')}`);
    const hasMigrationTable = tables.has('schema_migrations');
    const version = hasMigrationTable
      ? Number(db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version)
      : 0;
    if (version > currentSchemaVersion) throw new Error('نسخهٔ ساختار دیتابیس با این نسخهٔ برنامه سازگار نیست.');
    return { version, size: stat.size };
  } catch (error) {
    if (error instanceof Error && /پشتیبان|SQLite|ساختار|نسخهٔ/.test(error.message)) throw error;
    throw new Error('خواندن یا بررسی سلامت فایل پشتیبان ناموفق بود.', { cause: error });
  } finally {
    db?.close();
  }
}

function restoreDatabaseFile(source, target, { closeDatabase, reopenDatabase, createSafetyBackup }) {
  const sourcePath = path.resolve(source);
  const targetPath = path.resolve(target);
  if (sourcePath.toLowerCase() === targetPath.toLowerCase()) throw new Error('فایل پشتیبان با دیتابیس فعلی یکسان است.');
  validateBackupFile(sourcePath);
  const safetyPath = createSafetyBackup();
  validateBackupFile(safetyPath);
  const stagedPath = `${targetPath}.restore-${process.pid}-${Date.now()}.tmp`;
  const displacedPath = `${targetPath}.before-restore-${process.pid}-${Date.now()}`;
  let closed = false;
  let displaced = false;
  let replacementInstalled = false;
  try {
    fs.copyFileSync(sourcePath, stagedPath, fs.constants.COPYFILE_EXCL);
    validateBackupFile(stagedPath);
    closeDatabase();
    closed = true;
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const sidecar = `${targetPath}${suffix}`;
      if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
    }
    if (fs.existsSync(targetPath)) {
      fs.renameSync(targetPath, displacedPath);
      displaced = true;
    }
    fs.renameSync(stagedPath, targetPath);
    replacementInstalled = true;
    reopenDatabase();
    if (displaced) {
      try { fs.rmSync(displacedPath, { force: true }); } catch {}
    }
    return { path: sourcePath, safetyPath };
  } catch (error) {
    if (closed) {
      try { closeDatabase(); } catch {}
      try {
        for (const suffix of ['-wal', '-shm', '-journal']) {
          const sidecar = `${targetPath}${suffix}`;
          if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
        }
        if (replacementInstalled && fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
        if (displaced && fs.existsSync(displacedPath)) fs.renameSync(displacedPath, targetPath);
        else if (replacementInstalled && fs.existsSync(safetyPath)) fs.copyFileSync(safetyPath, targetPath);
        reopenDatabase();
      } catch (recoveryError) {
        throw new Error(`بازیابی فایل پشتیبان ناموفق بود. نسخهٔ ایمن فعلی در ${safetyPath} نگهداری شده است.`, { cause: recoveryError });
      }
    }
    throw error;
  } finally {
    if (fs.existsSync(stagedPath)) fs.rmSync(stagedPath, { force: true });
  }
}

module.exports = { validateBackupFile, restoreDatabaseFile };
