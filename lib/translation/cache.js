import { translateWithSettings } from "./resolve.js";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = "vitTranslationCache";
const MAX_CACHE_ENTRIES = 60000;

/** In-memory mirror of `vitTranslationCache` — avoids re-reading the full blob on every chunk. */
let memoryCache = null;

/**
 * @param {string} sourceLang
 * @param {string} targetLang
 * @param {string} text
 */
function entryKey(sourceLang, targetLang, text) {
  return `${sourceLang}\0${targetLang}\0${text}`;
}

/**
 * @param {Record<string, { exp: number, tr: string }>} cache
 * @param {number} now
 */
function pruneExpired(cache, now) {
  for (const k of Object.keys(cache)) {
    const e = cache[k];
    if (!e || e.exp <= now) delete cache[k];
  }
}

/**
 * @param {Record<string, { exp: number, tr: string }>} cache
 */
function trimIfHuge(cache) {
  const keys = Object.keys(cache);
  if (keys.length <= MAX_CACHE_ENTRIES) return;
  const sorted = keys.map((k) => ({ k, exp: cache[k].exp })).sort((a, b) => a.exp - b.exp);
  const remove = sorted.length - MAX_CACHE_ENTRIES;
  for (let i = 0; i < remove; i++) delete cache[sorted[i].k];
}

/**
 * Load persisted cache once per service worker lifetime (then reuse for all TRANSLATE chunks).
 * @returns {Promise<Record<string, { exp: number, tr: string }>>}
 */
async function ensureCacheLoaded() {
  if (memoryCache !== null) return memoryCache;
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  memoryCache =
    raw[STORAGE_KEY] && typeof raw[STORAGE_KEY] === "object" ? { ...raw[STORAGE_KEY] } : {};
  pruneExpired(memoryCache, Date.now());
  return memoryCache;
}

/**
 * Memory-only lookup (no API). Same shape as translate: one entry per input string, null = cache miss.
 * @param {string[]} texts
 * @param {string} sourceLang
 * @param {string} targetLang
 * @returns {Promise<{ translations: (string|null)[] }>}
 */
export async function probeCacheOnly(texts, sourceLang, targetLang) {
  if (!texts.length) return { translations: [] };
  const cache = await ensureCacheLoaded();
  const now = Date.now();
  const translations = texts.map((text) => {
    const k = entryKey(sourceLang, targetLang, text);
    const ent = cache[k];
    if (ent && ent.exp > now && typeof ent.tr === "string") {
      return ent.tr;
    }
    return null;
  });
  return { translations };
}

/**
 * @param {object} settings
 * @param {string[]} texts
 * @param {string} sourceLang
 * @param {string} targetLang
 * @returns {Promise<{ backend: string, translations: string[] } | { error: string }>}
 */
export async function translateWithCache(settings, texts, sourceLang, targetLang) {
  if (!texts.length) return { backend: "none", translations: [] };

  const cache = await ensureCacheLoaded();
  const now = Date.now();

  const translations = new Array(texts.length);
  const missing = [];
  const missingIdx = [];

  for (let i = 0; i < texts.length; i++) {
    const k = entryKey(sourceLang, targetLang, texts[i]);
    const ent = cache[k];
    if (ent && ent.exp > now && typeof ent.tr === "string") {
      translations[i] = ent.tr;
    } else {
      missing.push(texts[i]);
      missingIdx.push(i);
    }
  }

  if (missing.length === 0) {
    return { backend: "cache", translations };
  }

  const apiResult = await translateWithSettings(settings, missing, sourceLang, targetLang);
  if (apiResult.error) return apiResult;

  const exp = now + CACHE_TTL_MS;
  for (let j = 0; j < missing.length; j++) {
    const i = missingIdx[j];
    translations[i] = apiResult.translations[j];
    const k = entryKey(sourceLang, targetLang, missing[j]);
    cache[k] = { exp, tr: apiResult.translations[j] };
  }

  pruneExpired(cache, now);
  trimIfHuge(cache);
  await chrome.storage.local.set({ [STORAGE_KEY]: cache });

  return { backend: apiResult.backend, translations };
}
