// users.js — user accounts, authentication and audit trail queries.
// Split mechanically from database.js; function bodies are unchanged.

const crypto = require('node:crypto');
const { auditLog, getCurrentUser, hashPassword, requireDatabase, requirePermission, setCurrentUser } = require('./core');
const { getAppSettings } = require('./settings');

function createUser(payload = {}) {
  const db = requireDatabase();
  requirePermission('users');
  const username = String(payload.username || '').trim().toLowerCase();
  const displayName = String(payload.displayName || username).trim();
  const role = ['admin', 'manager', 'cashier', 'warehouse', 'viewer'].includes(String(payload.role)) ? String(payload.role) : 'viewer';
  const password = String(payload.password || '');
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('نام کاربری باید ۳ تا ۴۰ نویسهٔ لاتین معتبر داشته باشد.');
  if (password.length < 6) throw new Error('رمز عبور باید حداقل ۶ نویسه باشد.');
  if (!displayName) throw new Error('نام نمایشی الزامی است.');
  const { passwordHash, passwordSalt } = hashPassword(password);
  try {
    const result = db.prepare(`
      INSERT INTO users (username, display_name, password_hash, password_salt, role)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, displayName, passwordHash, passwordSalt, role);
    const user = listUsers().find((item) => item.id === Number(result.lastInsertRowid));
    auditLog('user.create', 'user', user.id, { username, role });
    return user;
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new Error('این نام کاربری قبلاً ثبت شده است.');
    throw error;
  }
}

function listUsers() {
  const rows = requireDatabase().prepare(`
    SELECT id, username, display_name AS displayName, role, is_active AS isActive,
      last_login_at AS lastLoginAt, created_at AS createdAt, updated_at AS updatedAt
    FROM users ORDER BY is_active DESC, username
  `).all();
  return rows.map((row) => ({ ...row, isActive: Boolean(row.isActive) }));
}

function setUserActive(id, active) {
  requirePermission('users');
  const result = requireDatabase().prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(active ? 1 : 0, Number(id));
  if (!result.changes) throw new Error('کاربر پیدا نشد.');
  auditLog(active ? 'user.activate' : 'user.deactivate', 'user', id);
  if (!active && getCurrentUser()?.id === Number(id)) setCurrentUser(null);
  return listUsers().find((user) => user.id === Number(id));
}

function loginUser(username, password) {
  const db = requireDatabase();
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(String(username || '').trim().toLowerCase());
  if (!user) throw new Error('نام کاربری یا رمز عبور نادرست است.');
  const passwordless = getAppSettings().security?.passwordlessLogin === true;
  if (!passwordless) {
    const { passwordHash } = hashPassword(password, user.password_salt);
    const a = Buffer.from(passwordHash, 'hex');
    const b = Buffer.from(user.password_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('نام کاربری یا رمز عبور نادرست است.');
  }
  setCurrentUser(Number(user.id));
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  auditLog('auth.login', 'user', user.id);
  return { ...getCurrentUser(), passwordIsDefault: !passwordless && userUsesDefaultPassword(user.id) };
}

function resetAdminPassword() {
  const db = requireDatabase();
  const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!admin) throw new Error('کاربر admin پیدا نشد.');
  const { passwordHash, passwordSalt } = hashPassword('admin123');
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(passwordHash, passwordSalt, admin.id);
  auditLog('auth.admin_password_reset', 'user', admin.id);
  return true;
}

// Only the seeded admin account ships with a known default password; other
// users set theirs at creation time. Used to nudge admins into changing it.
function userUsesDefaultPassword(userId) {
  const row = requireDatabase().prepare('SELECT username, password_hash AS passwordHash, password_salt AS passwordSalt FROM users WHERE id = ? AND is_active = 1').get(Number(userId));
  if (!row || row.username !== 'admin') return false;
  const { passwordHash } = hashPassword('admin123', row.passwordSalt);
  const computed = Buffer.from(passwordHash, 'hex');
  const stored = Buffer.from(row.passwordHash, 'hex');
  return computed.length === stored.length && crypto.timingSafeEqual(computed, stored);
}

function logoutUser() {
  const activeUser = getCurrentUser();
  if (activeUser) auditLog('auth.logout', 'user', activeUser.id);
  setCurrentUser(null);
  return true;
}

function listAuditLogs(payload = {}) {
  requirePermission('users');
  const db = requireDatabase();
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim();
  return db.prepare(`
    SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
      a.details, a.created_at AS createdAt, a.user_id AS userId,
      COALESCE(u.display_name, u.username, 'سیستم') AS userName
    FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
    WHERE (? = '' OR substr(a.created_at, 1, 10) >= ?)
      AND (? = '' OR substr(a.created_at, 1, 10) <= ?)
    ORDER BY a.id DESC LIMIT 1000
  `).all(from, from, to, to);
}

function changeCurrentUserPassword(currentPassword, newPassword) {
  const user = getCurrentUser();
  if (!user) throw new Error('ابتدا وارد حساب کاربری شوید.');
  if (String(newPassword || '').length < 6) throw new Error('رمز عبور جدید باید حداقل ۶ نویسه باشد.');
  const db = requireDatabase();
  const existing = db.prepare('SELECT password_hash AS passwordHash, password_salt AS passwordSalt FROM users WHERE id = ?').get(user.id);
  const oldHash = hashPassword(currentPassword, existing.passwordSalt).passwordHash;
  const computed = Buffer.from(oldHash, 'hex');
  const stored = Buffer.from(existing.passwordHash, 'hex');
  if (computed.length !== stored.length || !crypto.timingSafeEqual(computed, stored)) throw new Error('رمز عبور فعلی نادرست است.');
  const next = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(next.passwordHash, next.passwordSalt, user.id);
  auditLog('auth.password_change', 'user', user.id);
  return true;
}

module.exports = { changeCurrentUserPassword, createUser, listAuditLogs, listUsers, loginUser, logoutUser, resetAdminPassword, setUserActive, userUsesDefaultPassword };
