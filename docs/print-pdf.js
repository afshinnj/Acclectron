const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: electron docs\\print-pdf.js input.html output.pdf');
  process.exit(1);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { backgroundThrottling: false }
  });

  try {
    await window.loadFile(path.resolve(input));
    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' },
      preferCSSPageSize: true
    });
    fs.writeFileSync(path.resolve(output), pdf);
    console.log(`PDF created: ${path.resolve(output)}`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
