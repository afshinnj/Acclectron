'use strict';

const database = require('../database');

function registerAccountHandlers(secureHandle) {
  secureHandle('auth:login', (_event, username, password) => database.loginUser(username, password));
  secureHandle('auth:logout', () => database.logoutUser());
  secureHandle('auth:current', () => database.getCurrentUser());
  secureHandle('users:create', (_event, payload) => database.createUser(payload));
  secureHandle('users:list', () => database.listUsers());
  secureHandle('users:set-active', (_event, id, active) => database.setUserActive(id, active));
  secureHandle('audit:list', (_event, payload) => database.listAuditLogs(payload));
  secureHandle('checks:list', (_event, payload) => database.listChecks(payload));
  secureHandle('checks:update-status', (_event, id, status, notes) => database.updateCheckStatus(id, status, notes));
  secureHandle('installments:create-plan', (_event, payload) => database.createInstallmentPlan(payload));
  secureHandle('installments:list-plans', (_event, payload) => database.listInstallmentPlans(payload));
  secureHandle('installments:record-payment', (_event, id, payload) => database.recordInstallmentPayment(id, payload));
  secureHandle('auth:change-password', (_event, currentPassword, newPassword) => database.changeCurrentUserPassword(currentPassword, newPassword));
  secureHandle('auth:webauthn:registration-options', () => database.beginWindowsHelloRegistration());
  secureHandle('auth:webauthn:registration-verify', (_event, response) => database.finishWindowsHelloRegistration(response));
  secureHandle('auth:webauthn:authentication-options', (_event, username) => database.beginWindowsHelloAuthentication(username));
  secureHandle('auth:webauthn:authentication-verify', (_event, username, response) => database.finishWindowsHelloAuthentication(username, response));
  secureHandle('auth:quick-pin:set', (_event, pin, currentPassword) => database.setQuickPin(pin, currentPassword));
  secureHandle('auth:quick-pin:clear', (_event, currentPassword) => database.clearQuickPin(currentPassword));
  secureHandle('auth:quick-pin:status', () => database.getQuickPinStatus());
  secureHandle('auth:quick-pin:unlock', (_event, pin) => database.unlockWithQuickPin(pin));
}

module.exports = { registerAccountHandlers };
