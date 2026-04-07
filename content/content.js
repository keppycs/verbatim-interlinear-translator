/**
 * Space-separated tokenization only (no CJK/Thai segmenter yet).
 * @param {string} text
 * @returns {string[]}
 */
function splitWordsWhitespaceOnly(text) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isLikelySpaceSeparatedText(text) {
  if (!text || !text.trim()) return false;
  return /\s/.test(text);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "TOKENIZE_WORDS") {
    const text = msg.text ?? "";
    if (!isLikelySpaceSeparatedText(text)) {
      sendResponse({ words: [], skipped: "needs_segmenter" });
      return true;
    }
    sendResponse({ words: splitWordsWhitespaceOnly(text), skipped: null });
    return true;
  }
  return undefined;
});
