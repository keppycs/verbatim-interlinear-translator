import { normalizeHttpServiceBaseUrl } from "./normalizeServiceUrl.js";

/**
 * @param {string} baseUrl
 * @returns {Promise<Array<{ code: string, name: string, targets: string[] }>>}
 */
export async function fetchLibreLanguages(baseUrl) {
  const root = normalizeHttpServiceBaseUrl(baseUrl).replace(/\/$/, "");
  if (!root) {
    throw new Error("Invalid LibreTranslate URL");
  }
  const res = await fetch(`${root}/languages`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LibreTranslate ${res.status}: ${err || res.statusText}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Invalid languages response");
  }
  return data;
}
