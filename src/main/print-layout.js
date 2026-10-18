// Electron printing uses microns; PDF custom pages use inches.
function resolvePrintLayout(settings = {}, payload = {}) {
  const print = { ...(settings.print || {}), ...(payload.print || {}) };
  const sizes = { A4: [210000, 297000], A5: [148000, 210000], '80mm': [80000, 200000], '58mm': [58000, 200000] };
  const paperSize = Object.hasOwn(sizes, print.paperSize) ? print.paperSize : 'A4';
  const orientation = print.orientation === 'landscape' ? 'landscape' : 'portrait';
  const [width, defaultHeight] = sizes[paperSize];
  const thermal = paperSize === '80mm' || paperSize === '58mm';
  const requested = Number(payload.contentHeightMicrons);
  const height = thermal && Number.isFinite(requested) ? Math.max(40000, Math.min(1000000, Math.ceil(requested))) : defaultHeight;
  return { print, paperSize, orientation, thermal, size: { width, height } };
}

function getPrintOptions(settings, payload) {
  const layout = resolvePrintLayout(settings, payload);
  const copies = Number(layout.print.copies);
  const options = {
    silent: Boolean(layout.print.printerName) && !layout.print.showPrintDialog,
    printBackground: true,
    color: layout.print.color !== false,
    copies: Number.isFinite(copies) ? Math.max(1, Math.min(10, Math.trunc(copies))) : 1,
    margins: { marginType: 'none' },
    landscape: layout.orientation === 'landscape' && !layout.thermal,
    scaleFactor: 100,
    pageSize: layout.thermal ? layout.size : layout.paperSize
  };
  if (layout.print.printerName) options.deviceName = String(layout.print.printerName);
  return { layout, options };
}

function getPdfOptions(settings, payload) {
  const layout = resolvePrintLayout(settings, payload);
  return {
    printBackground: true,
    displayHeaderFooter: false,
    preferCSSPageSize: true,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    landscape: layout.orientation === 'landscape' && !layout.thermal,
    pageSize: layout.thermal ? { width: layout.size.width / 25400, height: layout.size.height / 25400 } : layout.paperSize
  };
}

module.exports = { resolvePrintLayout, getPrintOptions, getPdfOptions };
