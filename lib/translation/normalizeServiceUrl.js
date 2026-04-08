/**
 * Host-only form for sync storage and the popup field: no scheme, no trailing slash.
 * Strips http(s):// so the input can stay clean (e.g. "192.168.1.18:5000" stays as typed).
 * @param {string} raw
 * @returns {string}
 */
export function stripLibreTranslateHostForStorage(raw) {
  let t = typeof raw === "string" ? raw.trim() : "";
  if (!t) return "";
  t = t.replace(/^https?:\/\//i, "");
  t = t.replace(/^\/+/, "");
  t = t.replace(/\/+$/, "");
  return t.trim();
}

/**
 * Prefer http for typical self-hosted / LAN cases; https for public hostnames.
 * @param {string} hostPortPath - no scheme (e.g. "192.168.1.18:5000", "lt.mydomain.com/api")
 * @returns {"http" | "https"}
 */
function inferHttpSchemeForLibreHost(hostPortPath) {
  const raw = hostPortPath.trim().replace(/^\/+/, "");
  if (!raw) return "https";
  const probe = raw.startsWith("[") ? `http://${raw}` : `http://${raw}`;
  try {
    const u = new URL(probe);
    const host = u.hostname.toLowerCase();
    if (host === "localhost") return "http";
    if (host === "127.0.0.1" || host === "::1") return "http";
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return "http";
    if (host.includes(":")) return "http";
    if (/\.(local|lan|internal)$/i.test(host)) return "http";
    return "https";
  } catch {
    return "https";
  }
}

/**
 * Absolute base URL for LibreTranslate HTTP calls. Accepts stored host-only values,
 * bare IPs, paths, or full http(s) URLs.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeHttpServiceBaseUrl(raw) {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) {
    return t.replace(/\/+$/, "");
  }
  const hostPath = t.replace(/\/+$/, "");
  const scheme = inferHttpSchemeForLibreHost(hostPath);
  return `${scheme}://${hostPath}`;
}
