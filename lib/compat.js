/**
 * True when `chrome.storage.session` is missing (Chrome &lt; 102 and some older Chromium builds).
 * In this mode the extension skips session-backed tab snapshots and disables the translation cache
 * so behavior stays predictable without newer storage APIs.
 * @returns {boolean}
 */
export function isLegacyCompat() {
  try {
    return typeof chrome === "undefined" || !chrome.storage || !chrome.storage.session;
  } catch {
    return true;
  }
}
