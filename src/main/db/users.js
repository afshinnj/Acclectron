// users.js — user accounts, authentication and audit trail queries.
// Split mechanically from database.js; function bodies are unchanged.

const crypto = require('node:crypto');
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const { auditLog, getCurrentUser, hashPassword, requireDatabase, requirePermission, setCurrentUser } = require('./core');
const { getAppSettings } = require('./settings');

// In-memory WebAuthn challenges expire after two minutes.
const webAuthnChallenges = new Map();
const webAuthnRpId = 'accletron.local';
const webAuthnOrigin = 'https://accletron.local';

function beginWindowsHelloRegistration() {
  const user = getCurrentUser();
  if (!user) throw new Error('برای ثبت Windows Hello ابتدا وارد حساب شوید.');
  const existing = requireDatabase().prepare('SELECT credential_id AS credentialId FROM webauthn_credentials WHERE user_id = ?').all(user.id);
  const options = generateRegistrationOptions({
    rpName: 'Acclectron', rpID: webAuthnRpId, userName: user.username,
    userDisplayName: user.displayName || user.username, userID: String(user.id),
    attestationType: 'none',
    excludeCredentials: existing.map((row) => ({ id: row.credentialId, type: 'public-key' })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }
  });
  webAuthnChallenges.set(`register:${user.id}`, { challenge: options.challenge, expiresAt: Date.now() + 120000 });
  return options;
}

function finishWindowsHelloRegistration(response) {
  const user = getCurrentUser();
  if (!user) throw new Error('نشست کاربر معتبر نیست.');
  const key = `register:${user.id}`;
  const pending = webAuthnChallenges.get(key);
  webAuthnChallenges.delete(key);
  if (!pending || pending.expiresAt < Date.now()) throw new Error('درخواست Windows Hello منقضی شده است.');
  const verification = verifyRegistrationResponse({ response, expectedChallenge: pending.challenge, expectedOrigin: webAuthnOrigin, expectedRPID: webAuthnRpId, requireUserVerification: true });
  if (!verification.verified || !verification.registrationInfo) throw new Error('ثبت Windows Hello تأیید نشد.');
  const info = verification.registrationInfo;
  requireDatabase().prepare(`INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)`)
    .run(user.id, Buffer.from(info.credential.id).toString('base64url'), Buffer.from(info.credential.publicKey).toString('base64'), Number(info.credential.counter || 0), JSON.stringify(info.credential.transports || []));
  auditLog('auth.webauthn.register', 'user', user.id);
  return { verified: true };
}

function beginWindowsHelloAuthentication(username = '') {
  const user = requireDatabase().prepare('SELECT id FROM users WHERE username = ? AND is_active = 1').get(String(username || '').trim());
  if (!user) throw new Error('کاربر فعال پیدا نشد.');
  const credentials = requireDatabase().prepare('SELECT credential_id AS credentialId FROM webauthn_credentials WHERE user_id = ?').all(user.id);
  if (!credentials.length) throw new Error('برای این کاربر Windows Hello ثبت نشده است.');
  const options = generateAuthenticationOptions({ rpID: webAuthnRpId, userVerification: 'required', allowCredentials: credentials.map((row) => ({ id: row.credentialId, type: 'public-key' })) });
  webAuthnChallenges.set(`authenticate:${user.id}`, { challenge: options.challenge, expiresAt: Date.now() + 120000 });
  return options;
}

function finishWindowsHelloAuthentication(username, response) {
  const db = requireDatabase();
  const user = db.prepare('SELECT id FROM users WHERE username = ? AND is_active = 1').get(String(username || '').trim());
  if (!user) throw new Error('اطلاعات Windows Hello معتبر نیست.');
  const key = `authenticate:${user.id}`;
  const pending = webAuthnChallenges.get(key);
  webAuthnChallenges.delete(key);
  if (!pending || pending.expiresAt < Date.now()) throw new Error('درخواست Windows Hello منقضی شده است.');
  const stored = db.prepare('SELECT * FROM webauthn_credentials WHERE user_id = ? AND credential_id = ?').get(user.id, String(response?.id || ''));
  if (!stored) throw new Error('credential Windows Hello پیدا نشد.');
  const verification = verifyAuthenticationResponse({ response, expectedChallenge: pending.challenge, expectedOrigin: webAuthnOrigin, expectedRPID: webAuthnRpId, requireUserVerification: true, credential: { id: stored.credential_id, publicKey: Buffer.from(stored.public_key, 'base64'), counter: Number(stored.counter || 0), transports: JSON.parse(stored.transports || '[]') } });
  if (!verification.verified) throw new Error('ورود با Windows Hello تأیید نشد.');
  db.prepare('UPDATE webauthn_credentials SET counter = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(Number(verification.authenticationInfo.newCounter || stored.counter), stored.id);
  setCurrentUser(Number(user.id));
  auditLog('auth.webauthn.login', 'user', user.id);
  return getCurrentUser();
}

function validateQuickPin(pin) {
  const value = String(pin || '').trim();
  if (!/^\d{4,6}$/.test(value)) throw new Error('PIN باید ۴ تا ۶ رقم باشد.');
  return value;
}

function setQuickPin(pin, currentPassword = '') {
  const user = getCurrentUser();
  if (!user) throw new Error('برای تنظیم PIN ابتدا وارد حساب شوید.');
  const db = requireDatabase();
  const account = db.prepare('SELECT password_hash AS passwordHash, password_salt AS passwordSalt FROM users WHERE id = ?').get(user.id);
  if (getAppSettings().security?.passwordlessLogin !== true) {
    const { passwordHash } = hashPassword(currentPassword, account.passwordSalt);
    if (!crypto.timingSafeEqual(Buffer.from(passwordHash, 'hex'), Buffer.from(account.passwordHash, 'hex'))) throw new Error('رمز عبور فعلی نادرست است.');
  }
  const value = validateQuickPin(pin);
  const { passwordHash, passwordSalt } = hashPassword(value);
  db.prepare(`INSERT INTO quick_pin_credentials (user_id, pin_hash, pin_salt, failed_attempts, locked_until, updated_at)
    VALUES (?, ?, ?, 0,  0, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET pin_hash=excluded.pin_hash, pin_salt=excluded.pin_salt, failed_attempts=0, locked_until=0, updated_at=CURRENT_TIMESTAMP`)
    .run(user.id, passwordHash, passwordSalt);
  auditLog('auth.quick_pin.set', 'user', user.id);
  return { enabled: true };
}

function clearQuickPin(currentPassword = '') {
  const user = getCurrentUser();
  if (!user) throw new Error('نشست کاربر معتبر نیست.');
  const db = requireDatabase();
  const account = db.prepare('SELECT password_hash AS passwordHash, password_salt AS passwordSalt FROM users WHERE id = ?').get(user.id);
  if (getAppSettings().security?.passwordlessLogin !== true) {
    const { passwordHash } = hashPassword(currentPassword, account.passwordSalt);
    if (!crypto.timingSafeEqual(Buffer.from(passwordHash, 'hex'), Buffer.from(account.passwordHash, 'hex'))) throw new Error('رمز عبور فعلی نادرست است.');
  }
  db.prepare('DELETE FROM quick_pin_credentials WHERE user_id = ?').run(user.id);
  auditLog('auth.quick_pin.clear', 'user', user.id);
  return { enabled: false };
}

function getQuickPinStatus() {
  const user = getCurrentUser();
  if (!user) return { enabled: false };
  const row = requireDatabase().prepare('SELECT failed_attempts AS failedAttempts, locked_until AS lockedUntil FROM quick_pin_credentials WHERE user_id = ?').get(user.id);
  return { enabled: Boolean(row), lockedUntil: Number(row?.lockedUntil || 0), failedAttempts: Number(row?.failedAttempts || 0) };
}

function unlockWithQuickPin(pin) {
  const user = getCurrentUser();
  if (!user) throw new Error('نشست کاربر معتبر نیست.');
  const db = requireDatabase();
  const row = db.prepare('SELECT * FROM quick_pin_credentials WHERE user_id = ?').get(user.id);
  if (!row) throw new Error('برای این کاربر PIN تنظیم نشده است.');
  if (Number(row.locked_until || 0) > Date.now()) throw new Error('PIN موقتاً قفل شده است. چند دقیقه بعد دوباره تلاش کنید.');
  const value = String(pin || '').trim();
  const { passwordHash } = hashPassword(value, row.pin_salt);
  const valid = /^\d{4,6}$/.test(value) && crypto.timingSafeEqual(Buffer.from(passwordHash, 'hex'), Buffer.from(row.pin_hash, 'hex'));
  if (!valid) {
    const attempts = Number(row.failed_attempts || 0) + 1;
    db.prepare('UPDATE quick_pin_credentials SET failed_attempts = ?, locked_until = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
      .run(attempts, attempts >= 5 ? Date.now() + 5 * 60 * 1000 : 0, user.id);
    auditLog('auth.quick_pin.failed', 'user', user.id, { attempts });
    throw new Error(attempts >= 5 ? 'پنج تلاش ناموفق؛ PIN برای ۵ دقیقه قفل شد.' : 'PIN نادرست است.');
  }
  db.prepare('UPDATE quick_pin_credentials SET failed_attempts = 0, locked_until = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(user.id);
  auditLog('auth.quick_pin.unlock', 'user', user.id);
  return user;
}

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

module.exports = {
  beginWindowsHelloAuthentication,
  beginWindowsHelloRegistration,
  changeCurrentUserPassword,
  clearQuickPin,
  createUser,
  finishWindowsHelloAuthentication,
  finishWindowsHelloRegistration,
  getQuickPinStatus,
  listAuditLogs,
  listUsers,
  loginUser,
  logoutUser,
  resetAdminPassword,
  setQuickPin,
  setUserActive,
  unlockWithQuickPin,
  userUsesDefaultPassword
};
