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
 * Unbroken CJK/Kana/Hangul without spaces — needs a future segmenter.
 * @param {string} text
 */
function shouldSkipForSegmenter(text) {
  const t = text.trim();
  if (!t) return true;
  if (/\s/.test(t)) return false;
  return /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(t);
}

/** @type {boolean} */
let pageTranslationEnabled = false;

const TRANSLATE_CHUNK_WORDS = 80;

const NO_BACKEND_MESSAGE =
  "Add at least one translation API in Options — use “Options & API keys” in this menu.";

function storageGet() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(null, resolve);
  });
}

function sendTranslate(texts) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "TRANSLATE", texts }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

function checkTranslationBackendConfigured() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "TRANSLATION_BACKEND_READY" }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false });
        return;
      }
      resolve({ ok: response?.ok === true });
    });
  });
}

function yieldToMain() {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: 250 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * @param {string[]} words
 * @param {string[]} glosses
 * @param {string} originalText
 * @param {"inject"|"absolute"} layoutMode
 */
function buildInterlinearFragment(words, glosses, originalText, layoutMode) {
  const root = document.createElement("span");
  root.setAttribute("data-vit-root", "1");
  root.setAttribute("data-vit-original-text", originalText);
  root.setAttribute("data-vit-layout", layoutMode === "absolute" ? "absolute" : "inject");
  root.className = "vit-root";
  for (let i = 0; i < words.length; i++) {
    const word = document.createElement("span");
    word.className = "vit-word";
    const src = document.createElement("span");
    src.className = "vit-source";
    src.textContent = words[i];
    const gloss = document.createElement("span");
    gloss.className = "vit-gloss";
    gloss.textContent = glosses[i] ?? "";
    word.appendChild(src);
    word.appendChild(gloss);
    root.appendChild(word);
  }
  return root;
}

/**
 * Collect visible text nodes suitable for word splitting.
 * @returns {Text[]}
 */
function collectTextNodes() {
  const root = document.body;
  if (!root) return [];
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(/** @type {Node} */ node) {
      const t = /** @type {Text} */ (node);
      const p = t.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA" || tag === "OPTION") {
        return NodeFilter.FILTER_REJECT;
      }
      if (p.closest("[data-vit-root]")) return NodeFilter.FILTER_REJECT;
      if (p.closest("svg")) return NodeFilter.FILTER_REJECT;
      if (p.isContentEditable) return NodeFilter.FILTER_REJECT;
      const text = t.nodeValue;
      if (!text || !text.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n = walker.nextNode();
  while (n) {
    out.push(/** @type {Text} */ (n));
    n = walker.nextNode();
  }
  return out;
}

/**
 * @param {Text[]} textNodes
 */
function buildSegments(textNodes) {
  /** @type {{ node: Text, words: string[], originalText: string }[]} */
  const segments = [];
  for (const node of textNodes) {
    const originalText = node.nodeValue || "";
    if (shouldSkipForSegmenter(originalText)) continue;
    const words = splitWordsWhitespaceOnly(originalText);
    if (!words.length) continue;
    segments.push({ node, words, originalText });
  }
  return segments;
}

/**
 * @param {string[]} flatWords
 */
async function translateAllWords(flatWords) {
  /** @type {string[]} */
  const allTranslations = [];
  for (let i = 0; i < flatWords.length; i += TRANSLATE_CHUNK_WORDS) {
    const chunk = flatWords.slice(i, i + TRANSLATE_CHUNK_WORDS);
    const result = await sendTranslate(chunk);
    if (result?.error) return { error: result.error };
    if (!result?.translations || result.translations.length !== chunk.length) {
      return { error: "translation_mismatch" };
    }
    allTranslations.push(...result.translations);
    await yieldToMain();
  }
  return { translations: allTranslations };
}

async function translateWholePage() {
  const textNodes = collectTextNodes();
  const segments = buildSegments(textNodes);
  if (!segments.length) {
    return { ok: true, wordCount: 0, empty: true };
  }

  /** @type {{ node: Text, words: string[], originalText: string, start: number, end: number }[]} */
  const indexed = [];
  let offset = 0;
  for (const seg of segments) {
    const start = offset;
    const end = offset + seg.words.length;
    indexed.push({ ...seg, start, end });
    offset = end;
  }

  const flatWords = segments.flatMap((s) => s.words);
  const tr = await translateAllWords(flatWords);
  if (tr.error) {
    return { ok: false, error: tr.error };
  }

  const translations = tr.translations;
  const stored = await storageGet();
  const layoutMode = stored.layoutMode === "absolute" ? "absolute" : "inject";

  for (const seg of indexed) {
    const slice = translations.slice(seg.start, seg.end);
    if (slice.length !== seg.words.length) {
      return { ok: false, error: "translation_mismatch" };
    }
    const parent = seg.node.parentNode;
    if (!parent || !seg.node.isConnected) continue;
    try {
      const frag = buildInterlinearFragment(seg.words, slice, seg.originalText, layoutMode);
      parent.replaceChild(frag, seg.node);
    } catch (e) {
      console.warn("[Verbatim]", e);
    }
  }

  return { ok: true, wordCount: flatWords.length };
}

function restorePage() {
  const roots = Array.from(document.querySelectorAll("[data-vit-root]"));
  for (const el of roots) {
    const orig = el.getAttribute("data-vit-original-text");
    if (orig == null) continue;
    const parent = el.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(orig), el);
  }
}

async function setPageTranslationEnabled(enabled) {
  try {
    if (enabled) {
      if (pageTranslationEnabled) {
        return { ok: true, enabled: true, already: true };
      }
      const backendReady = await checkTranslationBackendConfigured();
      if (!backendReady.ok) {
        return {
          ok: false,
          error: "no_backend",
          message: NO_BACKEND_MESSAGE,
          enabled: false,
        };
      }
      const r = await translateWholePage();
      if (!r.ok) {
        let msg = typeof r.error === "string" ? r.error : String(r.error);
        if (r.error === "translation_mismatch") {
          msg = "Translation could not be applied. Try again.";
        }
        return {
          ok: false,
          error: r.error,
          message: msg,
          enabled: false,
        };
      }
      pageTranslationEnabled = true;
      return { ok: true, enabled: true, wordCount: r.wordCount, empty: r.empty };
    }
    restorePage();
    pageTranslationEnabled = false;
    return { ok: true, enabled: false };
  } catch (e) {
    return {
      ok: false,
      error: "exception",
      message: e?.message || String(e),
      enabled: false,
    };
  }
}

async function togglePageTranslation() {
  return setPageTranslationEnabled(!pageTranslationEnabled);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "TOKENIZE_WORDS") {
    const t = msg.text ?? "";
    if (shouldSkipForSegmenter(t)) {
      sendResponse({ words: [], skipped: "needs_segmenter" });
      return true;
    }
    sendResponse({ words: splitWordsWhitespaceOnly(t), skipped: null });
    return true;
  }
  if (msg?.type === "GET_PAGE_TRANSLATION_STATE") {
    sendResponse({ enabled: pageTranslationEnabled });
    return true;
  }
  if (msg?.type === "SET_PAGE_TRANSLATION") {
    setPageTranslationEnabled(!!msg.enabled).then(sendResponse);
    return true;
  }
  if (msg?.type === "TOGGLE_PAGE_TRANSLATION") {
    togglePageTranslation().then(sendResponse);
    return true;
  }
  return undefined;
});
