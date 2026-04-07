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

/** True while translateWholePage is running (initial or incremental). */
let translationInProgress = false;

/** Coalesce concurrent translateWholePage calls into one in-flight run. */
let translateWholePagePromise = null;

/** @type {MutationObserver | null} */
let contentMutationObserver = null;

/** @type {ReturnType<typeof setTimeout> | null} */
let mutateDebounceTimer = null;

const TRANSLATE_CHUNK_WORDS = 80;

const MUTATION_DEBOUNCE_MS = 450;

const NO_BACKEND_MESSAGE =
  "Add at least one translation API in Options — use “Options & API keys” in this menu.";

function storageGet() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(null, resolve);
  });
}

function sendTranslate(texts, sourceLang, targetLang) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "TRANSLATE", texts, sourceLang, targetLang }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

async function checkTranslationBackendConfigured() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "TRANSLATION_BACKEND_READY" });
    return { ok: response?.ok === true };
  } catch {
    return { ok: false };
  }
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
 * @param {(string|null)[]} glosses - null = pending (shows … until filled)
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
    const g = glosses[i];
    if (g === null) {
      gloss.textContent = "…";
      gloss.classList.add("vit-gloss-pending");
    } else {
      gloss.textContent = g ?? "";
    }
    word.appendChild(src);
    word.appendChild(gloss);
    root.appendChild(word);
  }
  return root;
}

/**
 * @param {HTMLElement} root
 * @param {string[]} glosses
 */
function updateGlossesInRoot(root, glosses) {
  const glossEls = root.querySelectorAll(".vit-gloss");
  for (let i = 0; i < glosses.length; i++) {
    const el = glossEls[i];
    if (el) {
      el.textContent = glosses[i] ?? "";
      el.classList.remove("vit-gloss-pending");
    }
  }
}

function broadcastVitState() {
  chrome.runtime
    .sendMessage({
      type: "VIT_STATE_UPDATE",
      state: {
        enabled: pageTranslationEnabled,
        loading: translationInProgress,
        toggleOn: pageTranslationEnabled || translationInProgress,
      },
    })
    .catch(() => {});
}

function sendCacheProbe(texts, sourceLang, targetLang) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "TRANSLATE_CACHE_PROBE", texts, sourceLang, targetLang }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

/**
 * @param {string[]} words
 * @param {string} sourceLang
 * @param {string} targetLang
 */
async function sendTranslateWordsInChunks(words, sourceLang, targetLang) {
  const allTranslations = [];
  for (let i = 0; i < words.length; i += TRANSLATE_CHUNK_WORDS) {
    const chunk = words.slice(i, i + TRANSLATE_CHUNK_WORDS);
    const result = await sendTranslate(chunk, sourceLang, targetLang);
    if (result?.error) return { error: result.error, message: result.message };
    if (!result?.translations || result.translations.length !== chunk.length) {
      return { error: "translation_mismatch" };
    }
    allTranslations.push(...result.translations);
    await yieldToMain();
  }
  return { translations: allTranslations };
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

function stopObserveNewContent() {
  if (mutateDebounceTimer) {
    clearTimeout(mutateDebounceTimer);
    mutateDebounceTimer = null;
  }
  if (contentMutationObserver) {
    contentMutationObserver.disconnect();
    contentMutationObserver = null;
  }
}

function scheduleTranslateNewContent() {
  if (!pageTranslationEnabled || translationInProgress) return;
  if (mutateDebounceTimer) clearTimeout(mutateDebounceTimer);
  mutateDebounceTimer = setTimeout(() => {
    mutateDebounceTimer = null;
    void translateWholePage();
  }, MUTATION_DEBOUNCE_MS);
}

function startObserveNewContent() {
  if (!pageTranslationEnabled || contentMutationObserver) return;
  contentMutationObserver = new MutationObserver(() => {
    if (!pageTranslationEnabled || translationInProgress) return;
    scheduleTranslateNewContent();
  });
  contentMutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

/**
 * Walk the DOM for plain text not yet wrapped in interlinear spans, translate, and replace.
 * Per-segment: cache probe shows cached glosses immediately; API runs only for misses (then fills in).
 * @param {{ activatingFirst?: boolean }} [options] - First enable: set pageTranslationEnabled before clearing loading so the popup never sees a stale "off" gap.
 */
function translateWholePage(options = {}) {
  const activatingFirst = options.activatingFirst === true;

  if (translateWholePagePromise) {
    return translateWholePagePromise;
  }

  translateWholePagePromise = (async () => {
    translationInProgress = true;
    broadcastVitState();
    stopObserveNewContent();
    try {
      const stored = await storageGet();
      const targetLang = (stored.targetLang || "").trim();
      if (!targetLang) {
        return {
          ok: false,
          error: "no_target_language",
          message: "Choose a target language in the extension toolbar menu.",
        };
      }
      const sourceLang = (stored.sourceLang || "auto").trim() || "auto";
      const layoutMode = stored.layoutMode === "absolute" ? "absolute" : "inject";

      const textNodes = collectTextNodes();
      const segments = buildSegments(textNodes);
      if (!segments.length) {
        if (activatingFirst) {
          pageTranslationEnabled = true;
        }
        return { ok: true, wordCount: 0, empty: true };
      }

      let totalWords = 0;

      for (const seg of segments) {
        const words = seg.words;
        totalWords += words.length;
        const parent = seg.node.parentNode;
        if (!parent || !seg.node.isConnected) continue;

        let probe = await sendCacheProbe(words, sourceLang, targetLang);
        if (probe.error) {
          const tr = await sendTranslateWordsInChunks(words, sourceLang, targetLang);
          if (tr.error) {
            return { ok: false, error: tr.error, message: tr.message };
          }
          try {
            const frag = buildInterlinearFragment(words, tr.translations, seg.originalText, layoutMode);
            parent.replaceChild(frag, seg.node);
          } catch (e) {
            console.warn("[Verbatim]", e);
          }
          await yieldToMain();
          continue;
        }

        const probes = probe.translations;
        if (!Array.isArray(probes) || probes.length !== words.length) {
          return { ok: false, error: "translation_mismatch" };
        }

        /** @type {number[]} */
        const missingIdx = [];
        for (let i = 0; i < probes.length; i++) {
          if (probes[i] == null) missingIdx.push(i);
        }

        if (missingIdx.length === 0) {
          /** @type {string[]} */
          const glosses = probes.map((g) => (g == null ? "" : String(g)));
          try {
            const frag = buildInterlinearFragment(words, glosses, seg.originalText, layoutMode);
            parent.replaceChild(frag, seg.node);
          } catch (e) {
            console.warn("[Verbatim]", e);
          }
          await yieldToMain();
          continue;
        }

        if (missingIdx.length === words.length) {
          const tr = await sendTranslateWordsInChunks(words, sourceLang, targetLang);
          if (tr.error) {
            return { ok: false, error: tr.error, message: tr.message };
          }
          try {
            const frag = buildInterlinearFragment(words, tr.translations, seg.originalText, layoutMode);
            parent.replaceChild(frag, seg.node);
          } catch (e) {
            console.warn("[Verbatim]", e);
          }
          await yieldToMain();
          continue;
        }

        /** @type {(string|null)[]} */
        const partialGlosses = probes.map((g) => (g == null ? null : g));
        /** @type {HTMLSpanElement | null} */
        let rootRef = null;
        try {
          const frag = buildInterlinearFragment(words, partialGlosses, seg.originalText, layoutMode);
          parent.replaceChild(frag, seg.node);
          rootRef = frag;
        } catch (e) {
          console.warn("[Verbatim]", e);
          continue;
        }

        const missing = missingIdx.map((i) => words[i]);
        /** @type {string[]} */
        const apiFlat = [];
        for (let i = 0; i < missing.length; i += TRANSLATE_CHUNK_WORDS) {
          const chunk = missing.slice(i, i + TRANSLATE_CHUNK_WORDS);
          const tr = await sendTranslate(chunk, sourceLang, targetLang);
          if (tr.error) {
            return { ok: false, error: tr.error, message: tr.message };
          }
          if (!tr.translations || tr.translations.length !== chunk.length) {
            return { ok: false, error: "translation_mismatch" };
          }
          apiFlat.push(...tr.translations);
          await yieldToMain();
        }

        const fullGlosses = words.map((_, i) => {
          const g = probes[i];
          return g != null ? String(g) : "";
        });
        for (let j = 0; j < missingIdx.length; j++) {
          fullGlosses[missingIdx[j]] = apiFlat[j];
        }

        if (rootRef) {
          updateGlossesInRoot(rootRef, fullGlosses);
        }
        await yieldToMain();
      }

      if (activatingFirst) {
        pageTranslationEnabled = true;
      }
      return { ok: true, wordCount: totalWords };
    } finally {
      translationInProgress = false;
      translateWholePagePromise = null;
      broadcastVitState();
      if (pageTranslationEnabled) {
        startObserveNewContent();
      }
    }
  })();

  return translateWholePagePromise;
}

function showToast(message) {
  const id = "vit-lang-toast";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.setAttribute("role", "status");
    el.style.cssText = [
      "position:fixed",
      "top:16px",
      "left:50%",
      "transform:translateX(-50%)",
      "z-index:2147483646",
      "max-width:min(92vw,420px)",
      "padding:12px 16px",
      "border-radius:12px",
      "font:14px/1.45 system-ui,Segoe UI,sans-serif",
      "color:#f4f0eb",
      "background:#1c1916",
      "border:1px solid rgba(255,153,51,0.35)",
      "box-shadow:0 12px 40px rgba(0,0,0,.45)",
      "pointer-events:none",
    ].join(";");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.hidden = false;
  clearTimeout(/** @type {any} */ (el)._vitHide);
  /** @type {any} */ (el)._vitHide = setTimeout(() => {
    el.hidden = true;
  }, 4500);
}

function restorePage() {
  stopObserveNewContent();
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
        broadcastVitState();
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
      const r = await translateWholePage({ activatingFirst: true });
      if (!r.ok) {
        let msg = r.message;
        if (r.error === "translation_mismatch") {
          msg = "Translation could not be applied. Try again.";
        } else if (!msg && typeof r.error === "string") {
          msg = r.error;
        } else if (!msg) {
          msg = String(r.error ?? "Unknown error");
        }
        return {
          ok: false,
          error: r.error,
          message: msg,
          enabled: false,
        };
      }
      return { ok: true, enabled: true, wordCount: r.wordCount, empty: r.empty };
    }
    restorePage();
    pageTranslationEnabled = false;
    broadcastVitState();
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
  const res = await setPageTranslationEnabled(!pageTranslationEnabled);
  if (!res.ok && res.error === "no_target_language" && res.message) {
    showToast(res.message);
  }
  return res;
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
    sendResponse({
      enabled: pageTranslationEnabled,
      loading: translationInProgress,
      /** Reflects toggle: on while translating or when interlinear is active (avoids stale UI gaps). */
      toggleOn: pageTranslationEnabled || translationInProgress,
    });
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
