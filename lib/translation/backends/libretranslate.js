/**
 * LibreTranslate-compatible API (local or public instance).
 * https://github.com/LibreTranslate/LibreTranslate
 */
export async function translateLibreTranslate({ baseUrl, texts, sourceLang, targetLang }) {
  if (!baseUrl || !texts.length) return null;
  const root = baseUrl.replace(/\/$/, "");
  const url = `${root}/translate`;
  const source = sourceLang && sourceLang !== "auto" ? sourceLang : "auto";
  const results = await Promise.all(
    texts.map(async (q) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ q, source, target: targetLang, format: "text" }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`LibreTranslate ${res.status}: ${err}`);
      }
      const data = await res.json();
      return data.translatedText;
    })
  );
  return results.length === texts.length ? results : null;
}
