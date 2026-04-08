import { normalizeHttpServiceBaseUrl } from "../normalizeServiceUrl.js";
import { toLibreStyleLang } from "../libreStyleLang.js";

/**
 * LibreTranslate-compatible API (local or public instance).
 * https://github.com/LibreTranslate/LibreTranslate
 *
 * Requests are limited to a small concurrency pool: firing one fetch per string in parallel
 * (e.g. 80+ POSTs) often overwhelms a local server and surfaces as "Failed to fetch".
 */
const TRANSLATE_CONCURRENCY = 4;
const FETCH_RETRIES = 2;

/**
 * @param {string} url
 * @param {object} body
 * @returns {Promise<object>}
 */
async function postTranslateJson(url, body) {
  let lastErr;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`LibreTranslate ${res.status}: ${err}`);
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      const msg = e?.message || String(e);
      const retryable =
        msg === "Failed to fetch" ||
        msg.includes("NetworkError") ||
        /network|load failed|aborted/i.test(msg);
      if (attempt < FETCH_RETRIES && retryable) {
        await new Promise((r) => setTimeout(r, 90 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

export async function translateLibreTranslate({ baseUrl, texts, sourceLang, targetLang }) {
  if (!baseUrl || !texts.length) return null;
  const root = normalizeHttpServiceBaseUrl(baseUrl).replace(/\/$/, "");
  if (!root) return null;
  const url = `${root}/translate`;
  const source = sourceLang && sourceLang !== "auto" ? toLibreStyleLang(sourceLang) : "auto";
  const target = toLibreStyleLang(targetLang);

  const results = new Array(texts.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= texts.length) return;
      const data = await postTranslateJson(url, {
        q: texts[i],
        source,
        target,
        format: "text",
      });
      const out = data.translatedText ?? data.translated_text;
      if (typeof out !== "string") {
        throw new Error("LibreTranslate: response missing translatedText");
      }
      results[i] = out;
    }
  }

  const n = Math.min(TRANSLATE_CONCURRENCY, texts.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
