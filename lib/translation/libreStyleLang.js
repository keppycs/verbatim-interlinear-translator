/**
 * LibreTranslate-style APIs often expect ISO-like codes (e.g. zh, pt) not BCP-47 (zh-CN, pt-BR).
 * @param {string} code
 * @returns {string}
 */
export function toLibreStyleLang(code) {
  if (!code || code === "auto") return "auto";
  const i = code.indexOf("-");
  return i === -1 ? code : code.slice(0, i);
}

/**
 * Lowercase primary subtag for comparing source vs target (e.g. en-US and en → same).
 * Empty string if input is not a non-empty string.
 * @param {string} code
 * @returns {string}
 */
export function primarySubtagForCompare(code) {
  if (typeof code !== "string") return "";
  const t = code.trim();
  if (!t) return "";
  return toLibreStyleLang(t).toLowerCase();
}
