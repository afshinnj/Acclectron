/* Extended settings workspace: replaces the initial two-card screen with
   tabbed, persisted configuration while keeping backward-compatible APIs. */
function initializeSettingsPageV2() {
  const root = $('#settingsPage');
  if (!root || root.dataset.v2) return;
  root.dataset.v2 = '1';
  root.innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">\u062a\u0646\u0638\u06cc\u0645\u0627\u062a \u0628\u0631\u0646\u0627\u0645\u0647</span><h2>\u0645\u0631\u06a9\u0632 \u062a\u0646\u0638\u06cc\u0645\u0627\u062a</h2></div><button id="saveAllSettings" class="primary">\u0630\u062e\u06cc\u0631\u0647 \u0647\u0645\u0647 \u062a\u063a\u06cc\u06cc\u0631\u0627\u062a</button></div>
    <div class="settings-shell"><aside class="settings-tabs">
      <button class="settings-tab active" data-settings-tab="store">\u0641\u0631\u0648\u0634\u06af\u0627\u0647</button><button class="settings-tab" data-settings-tab="print">\u0686\u0627\u067e \u0648 \u0641\u0627\u06a9\u062a\u0648\u0631</button><button class="settings-tab" data-settings-tab="currency">\u0648\u0627\u062d\u062f \u067e\u0648\u0644\u06cc</button><button class="settings-tab" data-settings-tab="units">\u0648\u0627\u062d\u062f \u0645\u062d\u0635\u0648\u0644\u0627\u062a</button><button class="settings-tab" data-settings-tab="sales">\u0641\u0631\u0648\u0634</button><button class="settings-tab" data-settings-tab="products">\u06a9\u0627\u0644\u0627 \u0648 \u0627\u0646\u0628\u0627\u0631</button><button class="settings-tab" data-settings-tab="financial">\u0645\u0627\u0644\u06cc \u0648 \u0645\u0627\u0644\u06cc\u0627\u062a</button><button class="settings-tab" data-settings-tab="appearance">\u0638\u0627\u0647\u0631 \u0648 \u0631\u0641\u062a\u0627\u0631</button><button class="settings-tab" data-settings-tab="backup">\u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc \u0648 \u062f\u0627\u062f\u0647</button>
    </aside><div class="settings-panels">
      <section class="settings-panel active" data-settings-panel="store"><form id="v2Store" class="panel settings-card"><h3>\u0645\u0634\u062e\u0635\u0627\u062a \u0641\u0631\u0648\u0634\u06af\u0627\u0647</h3><div class="form-grid"><label>\u0646\u0627\u0645 *<input id="v2Name" required></label><label>\u0634\u0639\u0627\u0631<input id="v2Slogan"></label><label>\u062a\u0644\u0641\u0646<input id="v2Phone"></label><label>\u06a9\u062f \u067e\u0633\u062a\u06cc<input id="v2Postal"></label><label class="full-field">\u0622\u062f\u0631\u0633<textarea id="v2Address"></textarea></label><label>\u0648\u0628\u200c\u0633\u0627\u06cc\u062a<input id="v2Website"></label><label>\u0627\u06cc\u0646\u0633\u062a\u0627\u06af\u0631\u0627\u0645<input id="v2Instagram"></label><label>\u0631\u0648\u0628\u06cc\u06a9\u0627<input id="v2Rubika"></label><label class="full-field">\u067e\u0627\u06cc\u06db\u0627\u0646 \u0641\u0627\u06a9\u062a\u0648\u0631<textarea id="v2Footer"></textarea></label></div><div class="logo-picker"><span id="v2LogoLabel"></span><button id="v2ChooseLogo" type="button" class="secondary">\u0627\u0646\u062a\u062e\u0627\u0628 \u0644\u0648\u06af\u0648</button><input id="v2Logo" type="hidden"></div><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647</button></form></section>
      <section class="settings-panel" data-settings-panel="print"><form id="v2Print" class="panel settings-card"><h3>\u0686\u0627\u067e \u0648 \u0641\u0627\u06a9\u062a\u0648\u0631</h3><div class="form-grid"><label>\u067e\u0631\u06cc\u0646\u062a\u0631<select id="v2Printer"></select></label><label>\u06a9\u0627\u063a\u0630<select id="v2Paper"><option>A4</option><option>A5</option><option value="80mm">\u0631\u0648\u0644 ۸۰</option><option value="58mm">\u0631\u0648\u0644 ۵۸</option></select></label><label>\u062a\u0639\u062f\u0627\u062f \u0646\u0633\u062e\u0647<input id="v2Copies" type="number" min="1" max="10"></label><label>\u062d\u0627\u0634\u06cc\u0647<select id="v2Margin"><option value="narrow">\u06a9\u0645</option><option value="normal">\u0645\u0639\u0645\u0648\u0644\u06cc</option><option value="wide">\u0632\u06cc\u0627\u062f</option></select></label></div><div class="settings-checks"><label class="settings-check"><input id="v2Color" type="checkbox">\u0631\u0646\u06af\u06cc</label><label class="settings-check"><input id="v2ShowLogo" type="checkbox">\u0646\u0645\u0627\u06cc\u0634 \u0644\u0648\u06af\u0648</label><label class="settings-check"><input id="v2ShowInfo" type="checkbox">\u0646\u0645\u0627\u06cc\u0634 \u0627\u0637\u0644\u0627\u0639\u0627\u062a</label><label class="settings-check"><input id="v2ShowDiscount" type="checkbox">\u0646\u0645\u0627\u06cc\u0634 \u062a\u062e\u0641\u06cc\u0641</label><label class="settings-check"><input id="v2ShowTax" type="checkbox">\u0646\u0645\u0627\u06cc\u0634 \u0645\u0627\u0644\u06cc\u0627\u062a</label><label class="settings-check"><input id="v2Preview" type="checkbox">\u067e\u06cc\u0634\u200c\u0646\u0645\u0627\u06cc\u0634</label><label class="settings-check"><input id="v2AutoSale" type="checkbox">\u0686\u0627\u067e \u062e\u0648\u062f\u06a9\u0627\u0631 \u0641\u0631\u0648\u0634</label><label class="settings-check"><input id="v2AutoPurchase" type="checkbox">\u0686\u0627\u067e \u062e\u0648\u062f\u06a9\u0627\u0631 \u062e\u0631\u06cc\u062f</label></div><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647</button></form></section>
      <section class="settings-panel" data-settings-panel="currency"><form id="v2Currency" class="panel settings-card"><h3>\u0648\u0627\u062d\u062f \u067e\u0648\u0644\u06cc</h3><div class="form-grid"><label>\u06a9\u062f<input id="v2CurCode"></label><label>\u0646\u0627\u0645<input id="v2CurName"></label><label>\u0646\u0645\u0627\u062f<input id="v2CurSymbol"></label><label>\u0645\u0648\u0642\u0639\u06cc\u062a<select id="v2CurPosition"><option value="suffix">\u067e\u0633</option><option value="prefix">\u0642\u0628\u0644</option></select></label><label>\u0627\u0639\u0634\u0627\u0631<input id="v2CurDecimals" type="number" min="0" max="4"></label><label>\u0648\u0627\u062d\u062f \u0648\u0631\u0648\u062f<select id="v2CurInput"><option value="toman">\u062a\u0648\u0645\u0627\u0646</option><option value="rial">\u0631\u06cc\u0627\u0644</option></select></label><label>\u06af\u0631\u062f \u06a9\u0631\u062f\u0646<select id="v2CurRound"><option value="none">\u0628\u062f\u0648\u0646</option><option value="100">\u06cc\u06a9\u0635\u062f</option><option value="1000">\u0647\u0632\u0627\u0631</option></select></label></div><label class="settings-check"><input id="v2CurSep" type="checkbox">\u062c\u062f\u0627\u06a9\u0646\u0646\u062f\u0647 \u0647\u0632\u0627\u0631\u06af\u0627\u0646</label><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647</button></form></section>
      <section class="settings-panel" data-settings-panel="units"><div class="panel settings-card"><h3>\u0648\u0627\u062d\u062f\u0647\u0627\u06cc \u0645\u062d\u0635\u0648\u0644</h3><form id="v2Unit" class="unit-editor"><input id="v2UnitId" type="hidden"><input id="v2UnitName" placeholder="\u0646\u0627\u0645" required><input id="v2UnitSymbol" placeholder="\u0646\u0645\u0627\u062f"><input id="v2UnitDecimals" type="number" min="0" max="6" value="0" placeholder="\u0627\u0639\u0634\u0627\u0631"><input id="v2UnitFactor" type="number" min="0.0001" step="any" value="1" placeholder="\u0636\u0631\u06cc\u0628"><label class="settings-check"><input id="v2UnitFraction" type="checkbox">\u06a9\u0633\u0631\u06cc</label><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647 \u0648\u0627\u062d\u062f</button><button id="v2UnitCancel" type="button" class="secondary">\u067e\u0627\u06a9 \u06a9\u0631\u062f\u0646</button></form><div class="table-wrap"><table><thead><tr><th>\u0646\u0627\u0645</th><th>\u0646\u0645\u0627\u062f</th><th>\u0627\u0639\u0634\u0627\u0631</th><th>\u06a9\u0633\u0631\u06cc</th><th>\u0648\u06cc\u0631\u0627\u06cc\u0634</th></tr></thead><tbody id="v2UnitsTable"></tbody></table></div></div></section>
      <section class="settings-panel" data-settings-panel="sales"><form id="v2Sales" class="panel settings-card"><h3>\u0641\u0631\u0648\u0634</h3><div class="form-grid"><label>\u0642\u06cc\u0645\u062a \u067e\u06cc\u0634\u200c\u0641\u0631\u0636<select id="v2PriceType"><option value="retail">\u062e\u0631\u062f\u0647</option><option value="wholesale">\u0639\u0645\u062f\u0647</option></select></label><label>\u0645\u0627\u0644\u06cc\u0627\u062a (%)<input id="v2SaleTax" type="number" min="0"></label><label>\u067e\u06cc\u0634\u0648\u0646\u062f \u0641\u0627\u06a9\u062a\u0648\u0631<input id="v2InvoicePrefix"></label><label>\u067e\u0631\u062f\u0627\u062e\u062a<select id="v2Payment"><option value="cash">\u0646\u0642\u062f\u06cc</option><option value="card">\u06a9\u0627\u0631\u062a</option><option value="credit">\u0646\u0633\u06cc\u0647</option></select></label></div><div class="settings-checks"><label class="settings-check"><input id="v2Oversell" type="checkbox">\u062c\u0644\u0648\u06af\u06cc\u0631\u06cc \u0627\u0632 \u0641\u0631\u0648\u0634 \u0628\u06cc\u0634\u062a\u0631 \u0627\u0632 \u0645\u0648\u062c\u0648\u062f\u06cc</label><label class="settings-check"><input id="v2AutoDate" type="checkbox">\u062a\u0627\u0631\u06cc\u062e \u062e\u0648\u062f\u06a9\u0627\u0631</label></div><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647</button></form></section>
      <section class="settings-panel" data-settings-panel="products"><form id="v2Products" class="panel settings-card"><h3>\u06a9\u0627\u0644\u0627 \u0648 \u0627\u0646\u0628\u0627\u0631</h3><div class="form-grid"><label>\u067e\u06cc\u0634\u0648\u0646\u062f \u06a9\u062f<input id="v2ProductPrefix"></label><label>\u062d\u062f\u0627\u0642\u0644 \u0645\u0648\u062c\u0648\u062f\u06cc<input id="v2MinStock" type="number" min="0" step="0.01"></label><label>\u0648\u0627\u062d\u062f \u067e\u06cc\u0634\u200c\u0641\u0631\u0636<select id="v2DefaultUnit"></select></label></div><div class="settings-checks"><label class="settings-check"><input id="v2RequireBarcode" type="checkbox">\u0628\u0627\u0631\u06a9\u062f \u0627\u0644\u0632\u0627\u0645\u06cc</label><label class="settings-check"><input id="v2Negative" type="checkbox">\u0645\u0648\u062c\u0648\u062f\u06cc \u0645\u0646\u0641\u06cc</label><label class="settings-check"><input id="v2LowStock" type="checkbox">\u0647\u0634\u062f\u0627\u0631 \u0645\u0648\u062c\u0648\u062f\u06cc \u06a9\u0645</label><label class="settings-check"><input id="v2Fractional" type="checkbox">\u0641\u0631\u0648\u0634 \u06a9\u0633\u0631\u06cc</label></div><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647</button></form></section>
      <section class="settings-panel" data-settings-panel="financial"><form id="v2Financial" class="panel settings-card"><h3>\u0645\u0627\u0644\u06cc \u0648 \u0645\u0627\u0644\u06cc\u0627\u062a</h3><div class="form-grid"><label>\u0646\u0631\u062e \u0645\u0627\u0644\u06cc\u0627\u062a (%)<input id="v2TaxRate" type="number" min="0"></label><label>\u062d\u062f\u0627\u06a9\u062b\u0631 \u062a\u062e\u0641\u06cc\u0641 (%)<input id="v2MaxDiscount" type="number" min="0"></label><label>\u06af\u0631\u062f \u06a9\u0631\u062f\u0646<select id="v2FinRound"><option value="none">\u0628\u062f\u0648\u0646</option><option value="100">\u06cc\u06a9\u0635\u062f</option><option value="1000">\u0647\u0632\u0627\u0631</option></select></label></div><div class="settings-checks"><label class="settings-check"><input id="v2TaxEnabled" type="checkbox">\u0645\u0627\u0644\u06cc\u0627\u062a \u0641\u0639\u0627\u0644</label><label class="settings-check"><input id="v2TaxAfter" type="checkbox">\u0645\u062d\u0627\u0633\u0628\u0647 \u067e\u0633 \u0627\u0632 \u062a\u062e\u0641\u06cc\u0641</label></div><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647</button></form></section>
      <section class="settings-panel" data-settings-panel="appearance"><form id="v2Appearance" class="panel settings-card"><h3>\u0638\u0627\u0647\u0631 \u0648 \u0631\u0641\u062a\u0627\u0631</h3><div class="form-grid"><label>\u067e\u0648\u0633\u062a\u0647<select id="v2Theme"><option value="dark">\u062a\u0627\u0631\u06cc\u06a9</option><option value="light">\u0631\u0648\u0634\u0646</option><option value="system">\u0633\u06cc\u0633\u062a\u0645</option><option value="hacker">\u0647\u06a9\u0631\u06cc</option></select></label><label>\u062a\u0642\u0648\u06cc\u0645<select id="v2Calendar"><option value="gregorian">\u0645\u06cc\u0644\u0627\u062f\u06cc</option><option value="jalali">\u0634\u0645\u0633\u06cc</option></select></label><label>\u0641\u0648\u0646\u062a (%)<input id="v2Font" type="number" min="80" max="130"></label></div><div class="settings-checks"><label class="settings-check"><input id="v2Notify" type="checkbox">\u0627\u0639\u0644\u0627\u0646\u200c\u0647\u0627</label><label class="settings-check"><input id="v2Shortcuts" type="checkbox">\u0645\u06cc\u0627\u0646\u0628\u0631\u0647\u0627</label><label class="settings-check"><input id="v2Passwordless" type="checkbox">\u0648\u0631\u0648\u062f \u0628\u062f\u0648\u0646 \u0631\u0645\u0632 \u0641\u0642\u0637 \u0628\u0627 \u0646\u0627\u0645 \u06a9\u0627\u0631\u0628\u0631\u06cc</label></div><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647</button></form></section>
      <section class="settings-panel" data-settings-panel="backup"><form id="v2Backup" class="panel settings-card"><h3>\u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc \u0648 \u062f\u0627\u062f\u0647</h3><label>\u0645\u0633\u06cc\u0631 \u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc<div class="input-with-action"><input id="v2BackupPath" readonly><button id="v2ChooseBackup" type="button">...</button></div></label><label>\u062f\u0648\u0631\u0647<select id="v2BackupFrequency"><option value="daily">\u0631\u0648\u0632\u0627\u0646\u0647</option><option value="weekly">\u0647\u0641\u062a\u06af\u06cc</option></select></label><label class="settings-check"><input id="v2BackupAuto" type="checkbox">\u062e\u0648\u062f\u06a9\u0627\u0631</label><div class="modal-actions"><button id="v2BackupNow" type="button" class="secondary">\u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc \u0647\u0645\u06cc\u0646 \u0627\u0644\u0627\u0646</button><button class="primary" type="submit">\u0630\u062e\u06cc\u0631\u0647</button></div></form></section>
    </div></div>`;
  const printForm = $('#v2Print');
  const paperField = $('#v2Paper')?.closest('label');
  if (printForm && !$('#v2Orientation')) {
    paperField?.insertAdjacentHTML('afterend', '<label>جهت صفحه<select id="v2Orientation"><option value="portrait">عمودی</option><option value="landscape">افقی</option></select></label>');
    $('#v2ShowInfo')?.closest('label')?.insertAdjacentHTML('afterend', '<label class="settings-check"><input id="v2ShowUnit" type="checkbox">نمایش واحد</label>');
  }
  if (printForm && !$('#v2ShowPrintDialog')) {
    const printChecks = printForm.querySelector('.settings-checks');
    printChecks?.insertAdjacentHTML('beforeend', '<label class="settings-check"><input id="v2ShowPrintDialog" type="checkbox">نمایش پنجره چاپ ویندوز</label>');
  }
  let settings = {};
  const val = (id, value) => { const n = $(`#${id}`); if (n) n.value = value ?? ''; };
  const chk = (id, value) => { const n = $(`#${id}`); if (n) n.checked = Boolean(value); };
  const renderUnits = () => { const units = managementState.units || []; $('#v2UnitsTable').innerHTML = units.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.symbol || '—')}</td><td>${u.decimals || 0}</td><td>${u.allowFraction ? '✓' : '—'}</td><td><button class="table-action v2-edit-unit" data-id="${u.id}">\u0648\u06cc\u0631\u0627\u06cc\u0634</button></td></tr>`).join(''); $('#v2DefaultUnit').innerHTML = '<option value="">\u0628\u062f\u0648\u0646 \u0648\u0627\u062d\u062f</option>' + units.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join(''); };
  const loadPrinters = async (selected) => { try { const list = await window.api.settings.printers(); $('#v2Printer').innerHTML = '<option value="">\u067e\u06cc\u0634\u200c\u0641\u0631\u0636 \u0633\u06cc\u0633\u062a\u0645</option>' + list.map((p) => `<option value="${esc(p.name)}">${esc(p.displayName)}</option>`).join(''); $('#v2Printer').value = selected || ''; } catch {} };
  const load = async () => { settings = await window.api.settings.get(); if (settings.currency) uiCurrency = { ...uiCurrency, ...settings.currency }; const s = settings.store || {}, p = settings.print || {}, c = settings.currency || {}, sl = settings.sales || {}, pr = settings.product || {}, f = settings.financial || {}, a = settings.appearance || {}, b = settings.backup || {}, sec = settings.security || {}; [['v2Name',s.name],['v2Slogan',s.slogan],['v2Phone',s.phone],['v2Postal',s.postalCode],['v2Address',s.address],['v2Website',s.website],['v2Instagram',s.instagram],['v2Rubika',s.rubika],['v2Footer',s.footer],['v2Logo',s.logoPath],['v2Paper',p.paperSize],['v2Copies',p.copies],['v2Margin',p.margin],['v2CurCode',c.code],['v2CurName',c.name],['v2CurSymbol',c.symbol],['v2CurPosition',c.position],['v2CurDecimals',c.decimals],['v2CurInput',c.inputUnit],['v2CurRound',c.rounding],['v2PriceType',sl.defaultPriceType],['v2SaleTax',sl.defaultTax],['v2InvoicePrefix',sl.invoicePrefix],['v2Payment',sl.paymentMethod],['v2ProductPrefix',pr.codePrefix],['v2MinStock',pr.defaultMinimumStock],['v2DefaultUnit',pr.defaultUnitId],['v2TaxRate',f.taxRate],['v2MaxDiscount',f.maxDiscount],['v2FinRound',f.rounding],['v2Theme',a.theme],['v2Calendar',a.calendar],['v2Font',a.fontScale],['v2BackupPath',b.path],['v2BackupFrequency',b.frequency]].forEach(([id,v]) => val(id,v)); [['v2Color',p.color],['v2ShowLogo',p.showLogo],['v2ShowInfo',p.showStoreInfo],['v2ShowDiscount',p.showDiscount],['v2ShowTax',p.showTax],['v2Preview',p.previewBeforePrint],['v2ShowPrintDialog',p.showPrintDialog],['v2AutoSale',p.autoPrintSale],['v2AutoPurchase',p.autoPrintPurchase],['v2CurSep',c.separator],['v2Oversell',sl.preventOversell],['v2AutoDate',sl.autoDate],['v2RequireBarcode',pr.requireBarcode],['v2Negative',pr.allowNegativeStock],['v2LowStock',pr.warnLowStock],['v2Fractional',pr.allowFractional],['v2TaxEnabled',f.taxEnabled],['v2TaxAfter',f.taxAfterDiscount],['v2Notify',a.notifications],['v2Shortcuts',a.shortcuts],['v2Passwordless',sec.passwordlessLogin],['v2BackupAuto',b.auto]].forEach(([id,v]) => chk(id,v)); managementState.units = await window.api.units.list(); renderUnits(); loadPrinters(p.printerName); $('#v2LogoLabel').textContent = s.logoPath || '\u0644\u0648\u06af\u0648\u06cc\u06cc \u0627\u0646\u062a\u062e\u0627\u0628 \u0646\u0634\u062f\u0647'; };
  const collect = () => ({ ...settings, store: { name: $('#v2Name').value, slogan: $('#v2Slogan').value, phone: $('#v2Phone').value, postalCode: $('#v2Postal').value, address: $('#v2Address').value, website: $('#v2Website').value, instagram: $('#v2Instagram').value, rubika: $('#v2Rubika').value, footer: $('#v2Footer').value, logoPath: $('#v2Logo').value }, print: { printerName: $('#v2Printer').value, paperSize: $('#v2Paper').value, copies: Number($('#v2Copies').value || 1), margin: $('#v2Margin').value, color: $('#v2Color').checked, showLogo: $('#v2ShowLogo').checked, showStoreInfo: $('#v2ShowInfo').checked, showDiscount: $('#v2ShowDiscount').checked, showTax: $('#v2ShowTax').checked, previewBeforePrint: $('#v2Preview').checked, showPrintDialog: $('#v2ShowPrintDialog').checked, autoPrintSale: $('#v2AutoSale').checked, autoPrintPurchase: $('#v2AutoPurchase').checked }, currency: { code: $('#v2CurCode').value, name: $('#v2CurName').value, symbol: $('#v2CurSymbol').value, position: $('#v2CurPosition').value, decimals: Number($('#v2CurDecimals').value || 0), separator: $('#v2CurSep').checked, rounding: $('#v2CurRound').value, inputUnit: $('#v2CurInput').value }, sales: { defaultPriceType: $('#v2PriceType').value, defaultTax: Number($('#v2SaleTax').value || 0), preventOversell: $('#v2Oversell').checked, invoicePrefix: $('#v2InvoicePrefix').value, paymentMethod: $('#v2Payment').value, autoDate: $('#v2AutoDate').checked }, product: { codePrefix: $('#v2ProductPrefix').value, defaultMinimumStock: Number($('#v2MinStock').value || 0), defaultUnitId: $('#v2DefaultUnit').value, requireBarcode: $('#v2RequireBarcode').checked, allowNegativeStock: $('#v2Negative').checked, warnLowStock: $('#v2LowStock').checked, allowFractional: $('#v2Fractional').checked }, financial: { taxRate: Number($('#v2TaxRate').value || 0), maxDiscount: Number($('#v2MaxDiscount').value || 0), rounding: $('#v2FinRound').value, taxEnabled: $('#v2TaxEnabled').checked, taxAfterDiscount: $('#v2TaxAfter').checked }, appearance: { theme: $('#v2Theme').value, calendar: $('#v2Calendar').value, fontScale: Number($('#v2Font').value || 100), notifications: $('#v2Notify').checked, shortcuts: $('#v2Shortcuts').checked }, security: { passwordlessLogin: $('#v2Passwordless').checked }, backup: { path: $('#v2BackupPath').value, frequency: $('#v2BackupFrequency').value, auto: $('#v2BackupAuto').checked } });
  const save = async () => {
    const payload = collect();
    payload.print.orientation = $('#v2Orientation')?.value || 'portrait';
    payload.print.showUnit = $('#v2ShowUnit')?.checked !== false;
    settings = await window.api.settings.save(payload);
    const appearance = settings.appearance || {};
    applyAppearanceSettings(appearance);
    if (settings.currency) {
      uiCurrency = { ...uiCurrency, ...settings.currency };
      await refreshCurrencyDisplays();
    }
    const configuredMethod = settings.sales?.paymentMethod;
    if (['cash', 'card', 'check'].includes(configuredMethod)) defaultSettlementMethod = configuredMethod;
    showToast('\u062a\u0645\u0627\u0645 \u062a\u0646\u0638\u06cc\u0645\u0627\u062a \u0630\u062e\u06cc\u0631\u0647 \u0634\u062f.');
  };
  document.querySelectorAll('.settings-tab').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('.settings-tab,.settings-panel').forEach((n) => n.classList.remove('active')); tab.classList.add('active'); $(`[data-settings-panel="${tab.dataset.settingsTab}"]`).classList.add('active'); }));
  document.querySelectorAll('#settingsPage form').forEach((form) => form.addEventListener('submit', (e) => { e.preventDefault(); save().catch((err) => showToast(err.message, true)); }));
  $('#saveAllSettings').addEventListener('click', () => save().catch((err) => showToast(err.message, true)));
  $('#v2ChooseLogo').addEventListener('click', async () => { const r = await window.api.settings.chooseLogo(); if (!r.canceled) { $('#v2Logo').value = r.path; $('#v2LogoLabel').textContent = r.path; } });
  $('#v2ChooseBackup').addEventListener('click', async () => { const r = await window.api.settings.chooseBackupPath(); if (!r.canceled) $('#v2BackupPath').value = r.path; });
  $('#v2BackupNow').addEventListener('click', async () => { try { const r = await window.api.settings.backupNow($('#v2BackupPath').value); showToast(`\u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc \u0630\u062e\u06cc\u0631\u0647 \u0634\u062f: ${r.path}`); } catch (e) { showToast(e.message, true); } });
  $('#v2Unit').addEventListener('submit', async (e) => { e.preventDefault(); try { const p = { name: $('#v2UnitName').value, symbol: $('#v2UnitSymbol').value, decimals: Number($('#v2UnitDecimals').value || 0), conversionFactor: Number($('#v2UnitFactor').value || 1), allowFraction: $('#v2UnitFraction').checked }; const id = $('#v2UnitId').value; if (id) await window.api.units.update(Number(id), p); else await window.api.units.create(p); $('#v2Unit').reset(); $('#v2UnitFactor').value = 1; $('#v2UnitId').value = ''; managementState.units = await window.api.units.list(); renderUnits(); showToast('\u0648\u0627\u062d\u062f \u0630\u062e\u06cc\u0631\u0647 \u0634\u062f.'); } catch (e) { showToast(e.message, true); } });
  $('#v2UnitCancel').addEventListener('click', () => { $('#v2Unit').reset(); $('#v2UnitId').value = ''; $('#v2UnitFactor').value = 1; });
  $('#settingsPage').addEventListener('click', (e) => { const b = e.target.closest('.v2-edit-unit'); if (!b) return; const u = managementState.units.find((x) => x.id === Number(b.dataset.id)); if (!u) return; $('#v2UnitId').value = u.id; $('#v2UnitName').value = u.name; $('#v2UnitSymbol').value = u.symbol || ''; $('#v2UnitDecimals').value = u.decimals || 0; $('#v2UnitFactor').value = u.conversionFactor || 1; $('#v2UnitFraction').checked = Boolean(u.allowFraction); });
  load().then(() => {
    $('#v2Orientation').value = settings.print?.orientation || 'portrait';
    $('#v2ShowUnit').checked = settings.print?.showUnit !== false;
  }).catch((e) => showToast(e.message, true));
}
initializeSettingsPage = initializeSettingsPageV2;
initializeSettingsPageV2();
window.api.settings.get().then((settings) => {
  applyAppearanceSettings(settings.appearance || {});
  if (settings.currency) uiCurrency = { ...uiCurrency, ...settings.currency };
  const configuredMethod = settings.sales?.paymentMethod;
  if (['cash', 'card', 'check'].includes(configuredMethod)) defaultSettlementMethod = configuredMethod;
  applyDefaultPaymentMethod(document);
}).catch(() => {});

function applyDefaultPaymentMethod(root = document) {
  root.querySelectorAll?.('.payment-method,#detailPaymentMethod').forEach((select) => {
    if (['cash', 'card', 'check'].includes(defaultSettlementMethod)) select.value = defaultSettlementMethod;
    if (select.id === 'detailPaymentMethod') $('#detailCheckFields')?.classList.toggle('hidden', select.value !== 'check');
  });
}

function printPaymentReceipt(invoice, payment) {
  document.querySelector('#paymentReceipt')?.remove();
  const receipt = document.createElement('section');
  receipt.id = 'paymentReceipt';
  receipt.className = 'payment-receipt';
  const party = invoice.partyName || 'بدون طرف حساب';
  const methodLabel = payment.method === 'card' ? 'کارت' : payment.method === 'check' ? `چک ${payment.checkNumber || ''}` : 'نقدی';
  receipt.innerHTML = `<div class="payment-receipt-heading"><h2>رسید پرداخت</h2><small>Acclectron</small></div><div class="payment-receipt-row"><span>شماره فاکتور</span><strong>${esc(invoice.invoice_number || '')}</strong></div><div class="payment-receipt-row"><span>طرف حساب</span><strong>${esc(party)}</strong></div><div class="payment-receipt-row"><span>تاریخ</span><strong>${isoToJalali(new Date().toISOString().slice(0, 10))}</strong></div><div class="payment-receipt-row"><span>روش پرداخت</span><strong>${esc(methodLabel)}</strong></div><div class="payment-receipt-total"><span>مبلغ پرداختی</span><strong>${money(payment.amount)}</strong></div><p>این رسید بابت تسویه فاکتور صادر شده است.</p></section>`;
  document.body.append(receipt);
  document.body.classList.add('printing-payment-receipt');
  const cleanup = () => {
    receipt.remove();
    document.body.classList.remove('printing-payment-receipt');
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
  setTimeout(cleanup, 15000);
}

const faDigits = (value) => String(value ?? '').replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
function invoicePrintMarkup(invoice, settings, kind = 'sale') {
  const store = settings.store || {};
  const print = settings.print || {};
  const paperSize = ['A4', 'A5', '80mm', '58mm'].includes(String(print.paperSize)) ? String(print.paperSize) : 'A4';
  const orientation = ['portrait', 'landscape'].includes(String(print.orientation)) ? String(print.orientation) : 'portrait';
  const isPurchase = kind === 'purchase';
  const invoiceTitle = isPurchase ? 'فاکتور خرید' : 'فاکتور فروش';
  const showUnit = print.showUnit !== false;
  const showDiscount = print.showDiscount !== false;
  const visibleColumns = 5 + (showUnit ? 1 : 0) + (showDiscount ? 1 : 0);
  const number = (value) => faDigits(value);
  const rows = (invoice.items || []).map((item, index) => `<tr>
    <td>${number(index + 1)}</td>
    <td class="product-name"><strong>${number(esc(item.productName || ''))}</strong><small>${number(esc(item.productCode || ''))}</small></td>
    ${showUnit ? `<td>${number(esc(item.unitName || item.unitSymbol || 'عدد'))}</td>` : ''}
    <td>${number(new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(Number(item.quantity || 0)))}</td>
    <td>${money(item.unit_price)}</td>
    ${showDiscount ? `<td>${money(item.discount)}</td>` : ''}
    <td>${money(item.total)}</td>
  </tr>`).join('');
  const logoUrl = store.logoPath ? encodeURI(`file:///${String(store.logoPath).replace(/\\/g, '/')}`) : '';
  const logo = logoUrl ? `<img class="invoice-print-logo" src="${esc(logoUrl)}" alt="لوگو">` : '';
  const storeInfo = print.showStoreInfo !== false ? `<section class="invoice-print-store-info invoice-print-store-info-bottom"><div><b>تلفن:</b> ${number(esc(store.phone || '—'))}</div><div><b>کد پستی:</b> ${number(esc(store.postalCode || '—'))}</div><div class="wide"><b>آدرس:</b> ${number(esc(store.address || '—'))}</div></section>` : '';
  const margin = ['narrow', 'normal', 'wide'].includes(String(print.margin)) ? String(print.margin) : 'normal';
  return `<article class="invoice-print-sheet paper-${paperSize.replace(/[^a-zA-Z0-9]/g, '')} orientation-${orientation} margin-${margin}" dir="rtl">
    <header class="invoice-print-header">
      <div class="invoice-print-logo-side">${print.showLogo !== false ? logo : ''}</div>
      <div class="invoice-print-store-centered"><h1>${number(esc(store.name || 'فروشگاه'))}</h1>${store.slogan ? `<p>${number(esc(store.slogan))}</p>` : ''}</div>
      <div class="invoice-print-title"><h2>${invoiceTitle}</h2><div>شماره: <strong>${number(esc(invoice.invoice_number || ''))}</strong></div><div>تاریخ: <strong>${number(isoToJalali(invoice.date))}</strong></div></div>
    </header>
    <section class="invoice-print-customer"><div><b>طرف حساب:</b> ${number(esc(invoice.partyName || 'بدون طرف حساب'))}</div><div><b>تلفن:</b> ${number(esc(invoice.partyPhone || '—'))}</div><div><b>آدرس:</b> ${number(esc(invoice.partyAddress || '—'))}</div></section>
    <table class="invoice-print-items columns-${visibleColumns} ${showUnit ? 'has-unit' : 'no-unit'} ${showDiscount ? 'has-discount' : 'no-discount'}"><thead><tr><th>ردیف</th><th>شرح کالا</th>${showUnit ? '<th>واحد</th>' : ''}<th>تعداد</th><th>قیمت واحد</th>${showDiscount ? '<th>تخفیف</th>' : ''}<th>مبلغ کل</th></tr></thead><tbody>${rows || `<tr><td colspan="${visibleColumns}">قلمی ثبت نشده است.</td></tr>`}</tbody></table>
    <section class="invoice-print-summary"><div><span>جمع کالاها</span><strong>${money(Number(invoice.subtotal || 0))}</strong></div>${showDiscount ? `<div><span>تخفیف کل</span><strong>${money(Number(invoice.discount || 0))}</strong></div>` : ''}${print.showTax !== false ? `<div><span>مالیات</span><strong>${money(Number(invoice.tax || 0))}</strong></div>` : ''}<div class="grand"><span>مبلغ نهایی</span><strong>${money(Number(invoice.total || 0))}</strong></div><div><span>مبلغ پرداختی</span><strong>${money(Number(invoice.paid_amount || 0))}</strong></div><div><span>مانده</span><strong>${money(Number(invoice.remaining_amount || 0))}</strong></div></section>
    ${storeInfo}
    <footer class="invoice-print-footer">${number(esc(store.footer || 'از خرید شما سپاسگزاریم.'))}</footer>
  </article>`;
}

function invoicePrintPageStyle(settings, heightMm) {
  const print = settings.print || {};
  const paper = ['A4', 'A5', '80mm', '58mm'].includes(String(print.paperSize)) ? String(print.paperSize) : 'A4';
  const orientation = ['portrait', 'landscape'].includes(String(print.orientation)) ? String(print.orientation) : 'portrait';
  const sizes = { A4: [210, 297], A5: [148, 210], '80mm': [80, heightMm || 200], '58mm': [58, heightMm || 200] };
  let [width, height] = sizes[paper];
  if (orientation === 'landscape' && paper !== '80mm' && paper !== '58mm') [width, height] = [height, width];
  return `@page{size:${width}mm ${height}mm;margin:0}`;
}

function syncInvoicePrintPageStyle(settings, heightMm) {
  let style = document.querySelector('#invoicePrintPageStyle');
  if (!style) {
    style = document.createElement('style');
    style.id = 'invoicePrintPageStyle';
    document.head.append(style);
  }
  style.textContent = invoicePrintPageStyle(settings, heightMm);
}

function invoicePrintPayload(settings) {
  const sheet = document.querySelector('.invoice-print-sheet');
  const print = settings.print || {};
  const paper = String(print.paperSize || 'A4');
  if (!sheet || !['80mm', '58mm'].includes(paper)) return {};
  const heightMm = Math.max(40, Math.ceil((sheet.scrollHeight * 25.4) / 96 + 2));
  syncInvoicePrintPageStyle(settings, heightMm);
  return { contentHeightMicrons: Math.ceil(heightMm * 1000) };
}
const afterPaint = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function openInvoicePrintPreview(kind, id) {
  const [invoice, settings] = await Promise.all([window.api.invoices.details(kind, id), window.api.settings.get()]);
  if (settings.currency) uiCurrency = { ...uiCurrency, ...settings.currency };
  const previousPrintZoom = document.documentElement.style.zoom;
  document.querySelector('#invoicePrintPreviewBackdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.id = 'invoicePrintPreviewBackdrop';
  backdrop.className = 'modal-backdrop invoice-print-preview-backdrop';
  const invoiceTitle = kind === 'purchase' ? 'فاکتور خرید' : 'فاکتور فروش';
  backdrop.innerHTML = `<div class="modal invoice-print-preview-modal"><div class="modal-header"><div><span class="eyebrow">پیش‌نمایش چاپ</span><h3>${invoiceTitle}</h3></div><div class="invoice-preview-actions"><label class="invoice-preview-setting">کاغذ<select class="invoice-preview-paper"><option value="A4">A4</option><option value="A5">A5</option><option value="80mm">رول ۸۰</option><option value="58mm">رول ۵۸</option></select></label><label class="invoice-preview-setting">جهت<select class="invoice-preview-orientation"><option value="portrait">عمودی</option><option value="landscape">افقی</option></select></label><button type="button" class="secondary invoice-preview-pdf">PDF</button><button type="button" class="secondary invoice-preview-print">چاپ</button><button type="button" class="modal-close invoice-preview-close">×</button></div></div><div class="invoice-print-preview-content">${invoicePrintMarkup(invoice, settings, kind)}</div></div>`;
  document.body.append(backdrop);
  const paperSelect = backdrop.querySelector('.invoice-preview-paper');
  const orientationSelect = backdrop.querySelector('.invoice-preview-orientation');
  paperSelect.value = settings.print?.paperSize || 'A4';
  orientationSelect.value = settings.print?.orientation || 'portrait';
  syncInvoicePrintPageStyle(settings);
  const rerender = () => {
    settings.print = { ...(settings.print || {}), paperSize: paperSelect.value, orientation: orientationSelect.value };
    backdrop.querySelector('.invoice-print-preview-content').innerHTML = invoicePrintMarkup(invoice, settings, kind);
    syncInvoicePrintPageStyle(settings);
  };
  paperSelect.addEventListener('change', rerender);
  orientationSelect.addEventListener('change', rerender);
  const setPrintMode = (enabled) => {
    if (enabled) {
      document.documentElement.style.zoom = '1';
      document.body.style.zoom = '1';
      document.body.classList.add('printing-invoice');
    } else {
      document.documentElement.style.zoom = previousPrintZoom;
      document.body.style.zoom = '';
      document.body.classList.remove('printing-invoice');
    }
  };
  const close = () => {
    backdrop.remove();
    setPrintMode(false);
    document.querySelector('#invoicePrintPageStyle')?.remove();
  };
  backdrop.querySelector('.invoice-preview-close').addEventListener('click', close);
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  backdrop.querySelector('.invoice-preview-print').addEventListener('click', () => {
    setPrintMode(true);
    afterPaint().then(() => window.api.print.invoice({ print: settings.print, ...invoicePrintPayload(settings) }))
      .then(close)
      .catch((error) => {
        setPrintMode(false);
        showToast(error.message || 'چاپ فاکتور انجام نشد.', true);
      });
  });
  backdrop.querySelector('.invoice-preview-pdf').addEventListener('click', () => {
    setPrintMode(true);
    afterPaint().then(() => window.api.print.invoicePdf({ print: settings.print, fileName: `${invoiceTitle}-${faDigits(invoice.invoice_number || '')}`, ...invoicePrintPayload(settings) }))
      .then((result) => {
        setPrintMode(false);
        if (!result?.canceled) showToast(`PDF ذخیره شد: ${result.filePath}`);
      })
      .catch((error) => {
        setPrintMode(false);
        showToast(error.message || 'خروجی PDF ساخته نشد.', true);
      });
  });
}

