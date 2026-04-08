import { normalizeHttpServiceBaseUrl } from "./normalizeServiceUrl.js";

/**
 * @param {unknown} row
 * @returns {{ code: string, name: string, targets: string[] } | null}
 */
function normalizeLanguageRow(row) {
  if (!row || typeof row !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (row);
  const code = typeof o.code === "string" ? o.code : "";
  if (!code) return null;
  const name = typeof o.name === "string" ? o.name : code;
  let targets = o.targets;
  if (Array.isArray(targets)) {
    targets = targets.filter((t) => typeof t === "string" && t);
  } else if (targets && typeof targets === "object") {
    targets = Object.keys(/** @type {Record<string, unknown>} */ (targets));
  } else {
    targets = [];
  }
  return { code, name, targets };
}

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
  return data.map(normalizeLanguageRow).filter((r) => r != null);
}
