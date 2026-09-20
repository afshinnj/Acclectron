// Downloads the offline semantic-search model into assets/models.
// Run once on a machine with internet access: npm run ai:fetch
// After that the app performs all AI work fully offline.
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline: streamPipeline } = require('node:stream/promises');

const REPO_BASE = 'https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/';
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_quantized.onnx'
];
const DESTINATION = path.join(__dirname, '..', 'assets', 'models', 'multilingual-minilm');

async function downloadFile(relativePath) {
  const response = await fetch(REPO_BASE + relativePath);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} — ${REPO_BASE + relativePath}`);
  const destination = path.join(DESTINATION, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await streamPipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
  const sizeMb = (fs.statSync(destination).size / (1024 * 1024)).toFixed(1);
  console.log(`دانلود شد: ${relativePath} (${sizeMb} MB)`);
}

(async () => {
  console.log('مسیر مقصد:', DESTINATION);
  for (const file of FILES) {
    const destination = path.join(DESTINATION, file);
    if (fs.existsSync(destination) && fs.statSync(destination).size > 0) {
      console.log(`موجود است، رد شد: ${file}`);
      continue;
    }
    await downloadFile(file);
  }
  console.log('مدل جست‌وجوی هوشمند آماده است. حالا می‌توانید در برنامه دکمه «هوشمند» را فعال کنید.');
})().catch((error) => {
  console.error('دانلود ناموفق بود:', error.message);
  process.exit(1);
});
