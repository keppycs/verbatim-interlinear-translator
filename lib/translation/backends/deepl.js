/**
 * DeepL API (free tier uses api-free.deepl.com).
 * https://developers.deepl.com/docs/api-reference/translate
 */
export async function translateDeepL({ authKey, useProApi, texts, sourceLang, targetLang }) {
  if (!authKey || !texts.length) return null;
  const base = useProApi ? "https://api.deepl.com" : "https://api-free.deepl.com";
  const url = `${base}/v2/translate`;
  const body = new URLSearchParams();
  for (const t of texts) body.append("text", t);
  body.append("target_lang", targetLang.toUpperCase());
  if (sourceLang && sourceLang !== "auto") {
    body.append("source_lang", sourceLang.toUpperCase());
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${authKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepL ${res.status}: ${err}`);
  }
  const data = await res.json();
  const out = (data.translations || []).map((x) => x.text);
  return out.length === texts.length ? out : null;
}
