import { normalizeHttpServiceBaseUrl } from "../normalizeServiceUrl.js";
import { toLibreStyleLang } from "../libreStyleLang.js";

/**
 * LibreTranslate-compatible API (local or public instance).
 * https://github.com/LibreTranslate/LibreTranslate
 */
export async function translateLibreTranslate({ baseUrl, texts, sourceLang, targetLang }) {
  if (!baseUrl || !texts.length) return null;
  const root = normalizeHttpServiceBaseUrl(baseUrl).replace(/\/$/, "");
  if (!root) return null;
  const url = `${root}/translate`;
  const source = sourceLang && sourceLang !== "auto" ? toLibreStyleLang(sourceLang) : "auto";
  const target = toLibreStyleLang(targetLang);
  return Promise.all(
    texts.map(async (q) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ q, source, target, format: "text" }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`LibreTranslate ${res.status}: ${err}`);
      }
      const data = await res.json();
      const out = data.translatedText ?? data.translated_text;
      if (typeof out !== "string") {
        throw new Error("LibreTranslate: response missing translatedText");
      }
      return out;
    })
  );
}
