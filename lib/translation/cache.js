import { translateWithSettings } from "./resolve.js";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = "vitTranslationCache";
const MAX_CACHE_ENTRIES = 60000;

/** @type {Record<string, { exp: number, tr: string }> | null} */
let memoryCache = null;
/** Coalesces concurrent first loads so we never assign memoryCache twice from overlapping storage reads. */
let cacheLoadPromise = null;

/**
 * Stable language tag for cache keys (probe + translate must match).
 * @param {string} lang
 */
function normalizeLangForCache(lang) {
  if (typeof lang !== "string") return "";
  const t = lang.trim();
  if (!t) return "";
  if (t.toLowerCase() === "auto") return "auto";
  return t.toLowerCase();
}

/**
 * Stable segment text for cache keys (avoids NFC/NFD and trim mismatches).
 * @param {string} text
 */
function normalizeTextForCache(text) {
  if (typeof text !== "string") return "";
  try {
    return text.normalize("NFC").trim();
  } catch {
    return text.trim();
  }
}

/**
 * @param {string} sourceLang
 * @param {string} targetLang
 * @param {string} text
 */
function entryKey(sourceLang, targetLang, text) {
  return `${normalizeLangForCache(sourceLang)}\0${normalizeLangForCache(targetLang)}\0${normalizeTextForCache(text)}`;
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
 * @returns {Promise<void>}
 */
async function persistCache(cache) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: cache });
  } catch (e) {
    console.warn("[Verbatim] translation cache persist failed:", e?.message || e);
  }
}

/**
 * Load persisted cache once per service worker lifetime (then reuse for all TRANSLATE chunks).
 * @returns {Promise<Record<string, { exp: number, tr: string }>>}
 */
async function ensureCacheLoaded() {
  if (memoryCache !== null) return memoryCache;
  if (!cacheLoadPromise) {
    cacheLoadPromise = (async () => {
      try {
        const raw = await chrome.storage.local.get(STORAGE_KEY);
        const loaded =
          raw[STORAGE_KEY] && typeof raw[STORAGE_KEY] === "object" ? { ...raw[STORAGE_KEY] } : {};
        pruneExpired(loaded, Date.now());
        memoryCache = loaded;
        return memoryCache;
      } catch (e) {
        console.warn("[Verbatim] translation cache load failed:", e?.message || e);
        memoryCache = {};
        return memoryCache;
      } finally {
        cacheLoadPromise = null;
      }
    })();
  }
  return cacheLoadPromise;
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
  if (settings?.useTranslationCache === false) {
    return translateWithoutCache(settings, texts, sourceLang, targetLang);
  }

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
    const tr = apiResult.translations[j];
    translations[i] = tr;
    if (typeof tr !== "string") continue;
    const k = entryKey(sourceLang, targetLang, missing[j]);
    cache[k] = { exp, tr };
  }

  pruneExpired(cache, now);
  trimIfHuge(cache);
  await persistCache(cache);

  return { backend: apiResult.backend, translations };
}

/**
 * Direct API translation only — no read/write of the extension cache.
 * Used when “Use translation cache” is off (`translateWithCache` delegates here).
 * @param {object} settings
 * @param {string[]} texts
 * @param {string} sourceLang
 * @param {string} targetLang
 * @returns {Promise<{ backend: string, translations: string[] } | { error: string }>}
 */
export async function translateWithoutCache(settings, texts, sourceLang, targetLang) {
  return translateWithSettings(settings, texts, sourceLang, targetLang);
}

/**
 * Clears persisted translation cache and in-memory state (call from service worker).
 * @returns {Promise<void>}
 */
export async function clearTranslationCache() {
  memoryCache = {};
  cacheLoadPromise = null;
  try {
    await chrome.storage.local.remove(STORAGE_KEY);
  } catch (e) {
    console.warn("[Verbatim] translation cache clear failed:", e?.message || e);
  }
}
