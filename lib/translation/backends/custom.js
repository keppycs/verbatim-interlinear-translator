import { normalizeHttpServiceBaseUrl } from "../normalizeServiceUrl.js";
import { toLibreStyleLang } from "../libreStyleLang.js";

/**
 * Custom HTTP endpoint: POST JSON body compatible with LibreTranslate /translate.
 * Body: { q, source, target, format: "text" }
 * Response: { translatedText: string }
 * Override path via settings.customTranslatePath (default "/translate").
 */
export async function translateCustom({ baseUrl, path, texts, sourceLang, targetLang }) {
  if (!baseUrl || !texts.length) return null;
  const root = normalizeHttpServiceBaseUrl(baseUrl).replace(/\/$/, "");
  if (!root) return null;
  const raw = path || "/translate";
  const p = raw.startsWith("/") ? raw : `/${raw}`;
  const url = `${root}${p}`;
  const source = sourceLang && sourceLang !== "auto" ? toLibreStyleLang(sourceLang) : "auto";
  const target = toLibreStyleLang(targetLang);
  const results = await Promise.all(
    texts.map(async (q) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ q, source, target, format: "text" }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Custom endpoint ${res.status}: ${err}`);
      }
      const data = await res.json();
      const text = data.translatedText ?? data.translated_text ?? data.text;
      if (typeof text !== "string") throw new Error("Custom endpoint: missing translatedText");
      return text;
    })
  );
  return results.length === texts.length ? results : null;
}
