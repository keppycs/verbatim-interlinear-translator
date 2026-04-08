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
