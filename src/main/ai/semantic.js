// Local, offline semantic product search.
// Embeds product names with a small multilingual MiniLM model shipped under
// assets/models (see scripts/fetch-ai-model.js) and ranks products by cosine
// similarity against the user's query. All inference runs on-device via
// onnxruntime-node; no network access is ever performed here.
const path = require('node:path');
const fs = require('node:fs');
const { normalizePersianText } = require('../importer');

const MODEL_ID = 'multilingual-minilm';
const EMBEDDING_CACHE_LIMIT = 5000;
const embeddingCache = new Map();
let pipelinePromise = null;

function normalizeProductText(value) {
  return normalizePersianText(String(value ?? '')).toLowerCase();
}

function resolveModelDir(searchRoots = []) {
  for (const root of searchRoots) {
    if (!root) continue;
    const dir = path.join(String(root), MODEL_ID);
    if (fs.existsSync(path.join(dir, 'config.json'))) return dir;
  }
  return null;
}

function libraryAvailable() {
  try {
    require.resolve('@huggingface/transformers');
    return true;
  } catch {
    return false;
  }
}

function aiStatus(searchRoots = []) {
  const modelPath = resolveModelDir(searchRoots);
  const library = libraryAvailable();
  return {
    available: Boolean(library && modelPath),
    library,
    modelPath,
    modelId: MODEL_ID
  };
}

function getPipeline(searchRoots) {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const modelPath = resolveModelDir(searchRoots);
      if (!modelPath) throw new Error('مدل جست‌وجوی هوشمند یافت نشد؛ با دستور npm run ai:fetch آن را دانلود کنید.');
      const { pipeline, env } = require('@huggingface/transformers');
      env.allowRemoteModels = false;
      return pipeline('feature-extraction', modelPath, { dtype: 'q8' });
    })().catch((error) => {
      pipelinePromise = null;
      throw error;
    });
  }
  return pipelinePromise;
}

async function embedText(embedder, text) {
  const output = await embedder(normalizeProductText(text), { pooling: 'mean', normalize: true });
  return output.data;
}

function dotProduct(a, b) {
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) sum += a[index] * b[index];
  return sum;
}

async function rankProductsBySimilarity(query, products, searchRoots = []) {
  const embedder = await getPipeline(searchRoots);
  const queryVector = await embedText(embedder, query);
  const scored = [];
  for (const product of products) {
    const key = `${product.id}:${product.name}:${product.categoryName || ''}`;
    let vector = embeddingCache.get(key);
    if (!vector) {
      vector = await embedText(embedder, [product.name, product.categoryName].filter(Boolean).join(' - '));
      if (embeddingCache.size >= EMBEDDING_CACHE_LIMIT) embeddingCache.clear();
      embeddingCache.set(key, vector);
      // Yield so a large first-run embedding pass cannot starve other IPC traffic.
      await new Promise((resolve) => setImmediate(resolve));
    }
    scored.push({ id: Number(product.id), score: Math.round(dotProduct(queryVector, vector) * 10000) / 10000 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

module.exports = { aiStatus, rankProductsBySimilarity, dotProduct, normalizeProductText };
