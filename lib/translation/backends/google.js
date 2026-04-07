/**
 * Google Cloud Translation API v2 (REST).
 * https://cloud.google.com/translate/docs/reference/rest/v2/translate
 */
export async function translateGoogle({ apiKey, texts, sourceLang, targetLang }) {
  if (!apiKey || !texts.length) return null;
  const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`;
  const body = {
    q: texts,
    target: targetLang,
  };
  if (sourceLang && sourceLang !== "auto") body.source = sourceLang;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Translation ${res.status}: ${err}`);
  }
  const data = await res.json();
  const translations = data?.data?.translations;
  if (!translations || translations.length !== texts.length) return null;
  return translations.map((t) => t.translatedText);
}
