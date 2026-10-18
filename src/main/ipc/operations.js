'use strict';

const database = require('../database');

function registerOperationsHandlers(secureHandle) {
  secureHandle('cash:create', (_event, payload) => database.createCashTransaction(payload));
  secureHandle('cash:details', (_event, id) => database.getCashTransaction(id));
  secureHandle('cash:list', (_event, payload) => database.listCashTransactions(payload));
  secureHandle('cash:summary', (_event, payload) => database.getCashSummary(payload));
  secureHandle('parties:ledger', (_event, id, payload) => database.getPartyLedger(id, payload));
  secureHandle('inventory:adjust', (_event, id, payload) => database.adjustProductStock(id, payload));
  secureHandle('inventory:movements', (_event, payload) => database.listStockMovements(payload));
  secureHandle('profit-loss:report', (_event, payload) => database.getProfitLossReport(payload));
  secureHandle('daily-close:create', (_event, payload) => database.closeDailyAccount(payload));
  secureHandle('daily-close:details', (_event, id) => database.getDailyClosure(id));
  secureHandle('daily-close:list', (_event, payload) => database.listDailyClosures(payload));
}

module.exports = { registerOperationsHandlers };
