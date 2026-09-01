const fs = require('node:fs');
const yauzl = require('yauzl');

function decodeXmlEntities(value = '') {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, number) => String.fromCodePoint(Number(number)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function normalizePersianText(value = '') {
  return String(value)
    .replace(/[\u064A\u06CC]/g, 'ی')
    .replace(/[\u0643\u06A9]/g, 'ک')
    .replace(/\u0640/g, '')
    .replace(/[\u200c\u200d\u200e\u200f]/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(value) {
  const normalized = String(value ?? '')
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[٬,،]/g, '')
    .replace(/[^\d.-]/g, '');
  if (!normalized || normalized === '-' || normalized === '.') return 0;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : NaN;
}

function readZipEntries(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, zipFile) => {
      if (error) return reject(error);
      const entries = new Map();
      zipFile.readEntry();
      zipFile.on('entry', (entry) => {
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zipFile.readEntry();
          });
          stream.on('error', reject);
        });
      });
      zipFile.on('end', () => resolve(entries));
      zipFile.on('error', reject);
    });
  });
}

function xmlText(xml, tag) {
  const match = String(xml).match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
  return match ? decodeXmlEntities(match[1]) : '';
}

function parseSharedStrings(xml) {
  return [...String(xml).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((textMatch) => decodeXmlEntities(textMatch[1]))
      .join('')
  );
}

function parseWorksheet(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of String(xml).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = {};
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2];
      const reference = (attributes.match(/\br="([A-Z]+\d+)"/) || [])[1];
      if (!reference) continue;
      const type = (attributes.match(/\bt="([^"]+)"/) || [])[1];
      const value = xmlText(body, 'v');
      let result = value;
      if (type === 's' && value !== '') result = sharedStrings[Number(value)] ?? '';
      if (type === 'inlineStr') result = xmlText(body, 't');
      row[reference.replace(/\d+$/, '')] = decodeXmlEntities(result);
    }
    rows.push(row);
  }
  return rows;
}

async function parseXlsxFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('فایل اکسل پیدا نشد.');
  if (!/\.xlsx$/i.test(filePath)) throw new Error('لطفاً فایل با پسوند xlsx انتخاب کنید.');
  const entries = await readZipEntries(filePath);
  const workbook = entries.get('xl/workbook.xml')?.toString('utf8');
  const relationships = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8');
  if (!workbook || !relationships) throw new Error('ساختار فایل اکسل معتبر نیست.');

  const sheetMatch = workbook.match(/<sheet\b[^>]*r:id="([^"]+)"[^>]*\/?>/);
  const relationId = sheetMatch?.[1];
  const relation = relationId
    ? [...relationships.matchAll(/<Relationship\b([^>]*)\/?>/g)]
      .map((match) => match[1])
      .map((attributes) => ({
        id: (attributes.match(/\bId="([^"]+)"/) || [])[1],
        target: (attributes.match(/\bTarget="([^"]+)"/) || [])[1]
      }))
      .find((item) => item.id === relationId)
    : null;
  const worksheetPath = relation?.target
    ? `xl/${relation.target.replace(/^\/+/, '')}`
    : 'xl/worksheets/sheet1.xml';
  const worksheet = entries.get(worksheetPath)?.toString('utf8');
  if (!worksheet) throw new Error('برگه اطلاعاتی فایل اکسل پیدا نشد.');

  const sharedStrings = entries.get('xl/sharedStrings.xml')
    ? parseSharedStrings(entries.get('xl/sharedStrings.xml').toString('utf8'))
    : [];
  const rows = parseWorksheet(worksheet, sharedStrings);
  if (rows.length < 2) throw new Error('فایل اکسل باید حداقل یک ردیف محصول داشته باشد.');
  return {
    sheetName: decodeXmlEntities((sheetMatch?.[0].match(/\bname="([^"]+)"/) || [])[1] || ''),
    rows
  };
}

function normalizeProductRows(rows) {
  const headers = rows[0] || {};
  const header = (column) => normalizePersianText(headers[column]).replace(/\s+/g, ' ');
  const expected = {
    category: ['گروه اصلی', 'دسته بندی', 'دسته‌بندی', 'گروه'],
    name: ['نام کالا', 'نام محصول', 'محصول'],
    stock: ['تعداد بدهکار', 'موجودی', 'تعداد'],
    purchasePrice: ['قيمت خريد', 'قیمت خرید', 'خرید'],
    wholesalePrice: ['قيمت فروش عمده', 'قیمت فروش عمده', 'عمده'],
    retailPrice: ['قيمت فروش', 'قیمت فروش', 'فروش']
  };
  const columns = {};
  for (const [key, aliases] of Object.entries(expected)) {
    const found = Object.entries(headers).find(([, value]) => aliases.includes(normalizePersianText(value)));
    if (found) columns[key] = found[0];
  }
  const missing = Object.keys(expected).filter((key) => !columns[key]);
  if (missing.length) throw new Error(`ستون‌های ضروری پیدا نشدند: ${missing.join('، ')}`);

  const normalized = [];
  const errors = [];
  for (let index = 1; index < rows.length; index += 1) {
    const source = rows[index] || {};
    const rowNumber = index + 1;
    const product = {
      sourceRow: rowNumber,
      category: normalizePersianText(source[columns.category]),
      name: normalizePersianText(source[columns.name]),
      stock: parseNumber(source[columns.stock]),
      purchasePrice: parseNumber(source[columns.purchasePrice]),
      wholesalePrice: parseNumber(source[columns.wholesalePrice]),
      retailPrice: parseNumber(source[columns.retailPrice])
    };
    if (!product.category || !product.name) {
      errors.push({ row: rowNumber, message: 'دسته‌بندی یا نام کالا خالی است.' });
      continue;
    }
    if ([product.stock, product.purchasePrice, product.wholesalePrice, product.retailPrice]
      .some((value) => !Number.isFinite(value) || value < 0)) {
      errors.push({ row: rowNumber, message: 'مقدار عددی نامعتبر است.' });
      continue;
    }
    normalized.push(product);
  }
  return { columns, rows: normalized, errors };
}

module.exports = {
  normalizePersianText,
  normalizeProductRows,
  parseXlsxFile
};
