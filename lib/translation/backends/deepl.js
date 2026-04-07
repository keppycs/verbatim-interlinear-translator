/**
 * DeepL POST /v2/translate — JSON body per API docs (free: api-free.deepl.com, pro: api.deepl.com).
 * Scripts cannot set User-Agent on fetch; browser default is sent.
 */
export async function translateDeepL({ authKey, useProApi, texts, sourceLang, targetLang }) {
  if (!authKey || !texts.length) return null;
  const base = useProApi ? "https://api.deepl.com" : "https://api-free.deepl.com";
  const url = `${base}/v2/translate`;
  /** @type {{ text: string[], target_lang: string, source_lang?: string }} */
  const payload = {
    text: texts,
    target_lang: targetLang.toUpperCase(),
  };
  if (sourceLang && sourceLang !== "auto") {
    payload.source_lang = sourceLang.toUpperCase();
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${authKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepL ${res.status}: ${err}`);
  }
  const data = await res.json();
  const out = (data.translations || []).map((x) => x.text);
  return out.length === texts.length ? out : null;
}
