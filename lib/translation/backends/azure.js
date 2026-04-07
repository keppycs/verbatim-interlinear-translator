/**
 * Azure Translator Text API v3.0 (global endpoint).
 * https://learn.microsoft.com/en-us/azure/ai-services/translator/reference/v3-0-translate
 */
export async function translateAzure({ key, region, texts, sourceLang, targetLang }) {
  if (!key || !texts.length) return null;
  const from = sourceLang && sourceLang !== "auto" ? sourceLang : null;
  let path = `translate?api-version=3.0&to=${encodeURIComponent(targetLang)}`;
  if (from) path += `&from=${encodeURIComponent(from)}`;
  const url = `https://api.cognitive.microsofttranslator.com/${path}`;
  const body = texts.map((text) => ({ Text: text }));
  const headers = {
    "Ocp-Apim-Subscription-Key": key,
    "Content-Type": "application/json",
  };
  if (region) headers["Ocp-Apim-Subscription-Region"] = region;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Azure Translator ${res.status}: ${err}`);
  }
  const data = await res.json();
  if (!Array.isArray(data) || data.length !== texts.length) return null;
  const out = data.map((item) => item.translations?.[0]?.text);
  return out.every(Boolean) ? out : null;
}
