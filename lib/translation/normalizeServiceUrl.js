/**
 * Ensures LAN / IP bases work when pasted without a scheme (browser bar adds http implicitly).
 * @param {string} raw
 * @returns {string}
 */
export function normalizeHttpServiceBaseUrl(raw) {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return `http://${t}`;
}
