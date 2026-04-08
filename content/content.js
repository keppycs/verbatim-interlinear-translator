/**
 * Mirrors `lib/translation/libreStyleLang.js` — content scripts stay non-module for broad browser support.
 * @param {string} code
 * @returns {string}
 */
function toLibreStyleLang(code) {
  if (!code || code === "auto") return "auto";
  const i = code.indexOf("-");
  return i === -1 ? code : code.slice(0, i);
}

/**
 * Lowercase primary subtag for comparing source vs target (e.g. en-US and en → same).
 * @param {string} code
 * @returns {string}
 */
function primarySubtagForCompare(code) {
  if (typeof code !== "string") return "";
  const t = code.trim();
  if (!t) return "";
  return toLibreStyleLang(t).toLowerCase();
}

/**
 * Space-separated tokenization only (no CJK/Thai segmenter yet).
 * @param {string} text
 * @returns {string[]}
 */
function splitWordsWhitespaceOnly(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

/**
 * Leading/trailing whitespace of the whole text node (spaces, tabs, newlines at edges).
 * Inner newlines stay in `middle` for multiline handling.
 * @param {string} text
 */
function getEdgeWhitespaceAndMiddle(text) {
  const leading = text.match(/^\s*/)?.[0] ?? "";
  const trailing = text.match(/\s*$/)?.[0] ?? "";
  const middle = text.slice(leading.length, text.length - trailing.length);
  return { leading, trailing, middle };
}

/**
 * Split a text run into lines and align with the flat word/gloss arrays from the same run.
 * @param {string} middle - segment text without outer leading/trailing whitespace
 * @param {string[]} flatWords
 */
function splitWordsIntoLines(middle, flatWords) {
  const lines = middle.split(/\r\n|\n|\r/);
  /** @type {{ lineText: string, words: string[], glossSliceStart: number, glossSliceLen: number }[]} */
  const out = [];
  let offset = 0;
  for (const lineText of lines) {
    const w = splitWordsWhitespaceOnly(lineText);
    const len = w.length;
    out.push({
      lineText,
      words: w,
      glossSliceStart: offset,
      glossSliceLen: len,
    });
    offset += len;
  }
  if (offset !== flatWords.length) {
    console.warn("[Verbatim] word/line alignment mismatch", {
      offset,
      n: flatWords.length,
      middle,
    });
  }
  return out;
}

/**
 * Block ancestors for merging text runs split by inline elements (&lt;a&gt;, &lt;strong&gt;, …).
 */
const VIT_BLOCK_ANCESTOR_TAGS = new Set([
  "P",
  "LI",
  "TD",
  "TH",
  "DD",
  "DT",
  "BLOCKQUOTE",
  "FIGCAPTION",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "SUMMARY",
  "CAPTION",
  "ADDRESS",
  "PRE",
]);

/**
 * @param {Element | null} el
 * @returns {Element | null}
 */
function nearestBlockAncestor(el) {
  if (!el) return null;
  let n = el;
  while (n && n !== document.body) {
    if (n.nodeType === Node.ELEMENT_NODE && VIT_BLOCK_ANCESTOR_TAGS.has(n.tagName)) {
      return n;
    }
    n = n.parentElement;
  }
  return null;
}

/**
 * @param {Text} prev
 * @param {Text} next
 */
function canMergeTextNodes(prev, next) {
  const bp = nearestBlockAncestor(prev.parentElement);
  const bn = nearestBlockAncestor(next.parentElement);
  return bp !== null && bp === bn;
}

/**
 * @param {Text[]} textNodes
 * @returns {Text[][]}
 */
function groupTextNodesByBlock(textNodes) {
  /** @type {Text[][]} */
  const groups = [];
  if (!textNodes.length) return groups;
  let cur = [textNodes[0]];
  for (let i = 1; i < textNodes.length; i++) {
    const prev = textNodes[i - 1];
    const next = textNodes[i];
    if (canMergeTextNodes(prev, next)) {
      cur.push(next);
    } else {
      groups.push(cur);
      cur = [next];
    }
  }
  groups.push(cur);
  return groups;
}

/**
 * @param {string} middle
 * @param {string[]} words
 * @param {(string|null)[]} glosses
 * @param {string} fullOriginalForRestore
 * @param {string|null} fullTranslation
 */
function buildMultilineWrap(middle, words, glosses, fullOriginalForRestore, fullTranslation) {
  const groups = splitWordsIntoLines(middle, words);
  const wrap = document.createElement("span");
  wrap.setAttribute("data-vit-wrap", "1");
  wrap.setAttribute("data-vit-original-text", fullOriginalForRestore);
  wrap.className = "vit-wrap";
  for (let i = 0; i < groups.length; i++) {
    if (i > 0) {
      wrap.appendChild(document.createElement("br"));
    }
    const g = groups[i];
    const lineLeading = g.lineText.match(/^\s*/)?.[0] ?? "";
    if (lineLeading) {
      wrap.appendChild(document.createTextNode(lineLeading));
    }
    if (!g.words.length) {
      continue;
    }
    const glossSlice = glosses.slice(g.glossSliceStart, g.glossSliceStart + g.glossSliceLen);
    const lineForFull = g.lineText.trim();
    const root = buildInterlinearFragment(g.words, glossSlice, lineForFull, fullTranslation);
    wrap.appendChild(root);
  }
  return { wrap, groups };
}

/**
 * Replace one or more adjacent Text nodes (e.g. inside &lt;a&gt; + sibling text in the same &lt;p&gt;)
 * with interlinear markup so hyperlinks do not split the sentence.
 * @param {Text[]} textNodes
 * @param {string[]} words
 * @param {(string|null)[]} glosses
 * @param {string} originalText
 * @param {string|null} fullTranslation
 * @returns {{ primary: HTMLElement, wrap: HTMLElement | null, groups: ReturnType<typeof splitWordsIntoLines> | null }}
 */
function mountInterlinearReplacement(textNodes, words, glosses, originalText, fullTranslation) {
  if (!textNodes.length) {
    throw new Error("mountInterlinearReplacement: empty textNodes");
  }
  const first = textNodes[0];
  const last = textNodes[textNodes.length - 1];
  const range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last);
  const { leading, trailing, middle } = getEdgeWhitespaceAndMiddle(originalText);
  const multiline = /\r|\n/.test(middle);
  const frag = document.createDocumentFragment();
  if (!multiline) {
    const root = buildInterlinearFragment(words, glosses, originalText, fullTranslation);
    if (leading) frag.appendChild(document.createTextNode(leading));
    frag.appendChild(root);
    if (trailing) frag.appendChild(document.createTextNode(trailing));
    range.deleteContents();
    range.insertNode(frag);
    return { primary: root, wrap: null, groups: null };
  }
  const { wrap, groups } = buildMultilineWrap(
    middle,
    words,
    glosses,
    originalText,
    fullTranslation,
  );
  if (leading) frag.appendChild(document.createTextNode(leading));
  frag.appendChild(wrap);
  if (trailing) frag.appendChild(document.createTextNode(trailing));
  range.deleteContents();
  range.insertNode(frag);
  return { primary: wrap, wrap, groups };
}

/**
 * @param {HTMLElement} wrap
 * @param {string[]} fullGlosses
 */
function updateGlossesInWrap(wrap, fullGlosses) {
  const roots = wrap.querySelectorAll("[data-vit-root]");
  let offset = 0;
  for (const root of roots) {
    const n = root.querySelectorAll(".vit-gloss").length;
    updateGlossesInRoot(root, fullGlosses.slice(offset, offset + n));
    offset += n;
  }
}

/**
 * @param {HTMLElement} wrap
 * @param {ReturnType<typeof splitWordsIntoLines>} groups
 */
function scheduleFullLinesForWrap(wrap, groups, scheduleFullLine) {
  const roots = wrap.querySelectorAll("[data-vit-root]");
  let r = 0;
  for (const g of groups) {
    if (!g.words.length) {
      continue;
    }
    const root = roots[r++];
    if (root) {
      scheduleFullLine(root, g.lineText.trim(), g.words.length);
    }
  }
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

/**
 * Cache vs API phase — mirrored to the toolbar popup while loading.
 * @type {"idle" | "cache" | "api_words" | "api_sentences"}
 */
let translationStatusPhase = "idle";
/** @type {string | null} */
let translationStatusDetail = null;

/**
 * Last successful run summary for the popup (one line).
 * @type {string | null}
 */
let lastLoadSummaryText = null;

/** Coalesce concurrent translateWholePage calls into one in-flight run. */
let translateWholePagePromise = null;

/** @type {MutationObserver | null} */
let contentMutationObserver = null;

/** @type {ReturnType<typeof setTimeout> | null} */
let mutateDebounceTimer = null;

const TRANSLATE_CHUNK_WORDS = 80;

const MUTATION_DEBOUNCE_MS = 450;

const NO_BACKEND_MESSAGE = "Set your LibreTranslate URL in the extension menu.";

/**
 * Primary language subtag from a BCP-47 `lang` value (e.g. en-US → en).
 * @param {string} raw
 * @returns {string} lowercase ISO 639 code, or "" if unusable
 */
function primaryLangFromHtmlLang(raw) {
  if (typeof raw !== "string") return "";
  const t = raw.trim();
  if (!t) return "";
  const base = t.split(/[-_]/)[0];
  if (!/^[A-Za-z]{2,3}$/.test(base)) return "";
  return base.toLowerCase();
}

/**
 * When the user picks "Auto", use only the document `<html lang="…">` (no API detection).
 * @param {string} storedSource - "auto" or an explicit language code
 * @returns {{ ok: true, sourceLang: string } | { ok: false, error: string, message: string }}
 */
function resolveAutoSourceToConcrete(storedSource) {
  const src = (storedSource || "auto").trim() || "auto";
  if (src !== "auto") {
    return { ok: true, sourceLang: src };
  }
  const raw = document.documentElement.getAttribute("lang") || document.documentElement.lang || "";
  const primary = primaryLangFromHtmlLang(raw);
  if (!primary) {
    return {
      ok: false,
      error: "no_page_lang",
      message:
        'Source is “Auto”, but this page has no usable <html lang="…">. Set a language on the root element, or choose a fixed source language in the extension menu.',
    };
  }
  return { ok: true, sourceLang: primary };
}

function storageGet() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(null, resolve);
  });
}

function persistGlobalPageTranslation(enabled) {
  chrome.storage.sync.set(
    { globalPageTranslation: !!enabled },
    () => void chrome.runtime.lastError,
  );
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

/** Lets the browser paint; avoid requestIdleCallback (its timeout can add hundreds of ms per call). */
function yieldToMain() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * @param {string[]} words
 * @param {(string|null)[]} glosses - null = pending (shows … until filled)
 * @param {string} originalText
 * @param {string|null} fullTranslation - null = omit full-sentence line until `updateFullLineInRoot`; ignored when single-word
 */
function buildInterlinearFragment(words, glosses, originalText, fullTranslation) {
  const root = document.createElement("span");
  root.setAttribute("data-vit-root", "1");
  root.setAttribute("data-vit-original-text", originalText);
  root.setAttribute("data-vit-layout", "inject");
  root.className = "vit-root";

  const multiWord = words.length > 1;
  root.setAttribute("data-vit-segment", multiWord ? "sentence" : "word");

  /* Interlinear block: original word on top, gloss directly below (same column). */
  const wordsRow = document.createElement("span");
  wordsRow.className = "vit-words-row";
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
    wordsRow.appendChild(word);
  }
  root.appendChild(wordsRow);

  if (multiWord && fullTranslation !== null) {
    const fullLine = document.createElement("span");
    fullLine.className = "vit-full-line";
    fullLine.setAttribute("data-vit-full", "1");
    fullLine.textContent = fullTranslation ?? "";
    root.appendChild(fullLine);
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

/**
 * @param {HTMLElement} root
 * @param {string} text
 */
function updateFullLineInRoot(root, text) {
  if (!root.querySelector(".vit-words-row")) return;
  let el = root.querySelector(".vit-full-line");
  if (!el) {
    el = document.createElement("span");
    el.className = "vit-full-line";
    el.setAttribute("data-vit-full", "1");
    root.appendChild(el);
  }
  el.textContent = text ?? "";
}

function broadcastVitState() {
  chrome.runtime
    .sendMessage({
      type: "VIT_STATE_UPDATE",
      state: {
        enabled: pageTranslationEnabled,
        loading: translationInProgress,
        toggleOn: pageTranslationEnabled || translationInProgress,
        statusPhase: translationStatusPhase,
        statusDetail: translationStatusDetail,
        lastLoadSummary: lastLoadSummaryText,
      },
    })
    .catch(() => {});
}

/**
 * @param {{
 *   segmentsAllCache: number,
 *   wordSegmentsApi: number,
 *   missingWords: number,
 *   sentenceLines: number,
 *   empty?: boolean,
 * }} s
 */
function formatLoadSummaryText(s) {
  if (s.empty) {
    return "Last run: no translatable text on the page.";
  }
  const wordApi =
    s.wordSegmentsApi > 0 ?
      `${s.missingWords} missing word(s) / ${s.wordSegmentsApi} segment(s) — LibreTranslate`
    : "no word-level API";
  const sentences =
    s.sentenceLines > 0 ? `${s.sentenceLines} full-sentence line(s)` : "no full-sentence lines";
  return `Last: ${s.segmentsAllCache} segment(s) fully cached; ${wordApi}; ${sentences}.`;
}

/**
 * @param {"idle" | "cache" | "api_words" | "api_sentences"} phase
 * @param {string | null} [detail]
 */
function setTranslationStatus(phase, detail = null) {
  translationStatusPhase = phase;
  translationStatusDetail = detail;
  broadcastVitState();
}

/** @param {string} [id] */
function friendlyBackendName(id) {
  if (!id || id === "cache" || id === "none") return null;
  if (id === "libretranslate") return "LibreTranslate";
  return id;
}

function sendCacheProbe(texts, sourceLang, targetLang) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "TRANSLATE_CACHE_PROBE", texts, sourceLang, targetLang },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      },
    );
  });
}

/**
 * @param {string[]} words
 * @param {string} sourceLang
 * @param {string} targetLang
 */
async function sendTranslateWordsInChunks(words, sourceLang, targetLang) {
  const allTranslations = [];
  /** @type {string | undefined} */
  let backend;
  for (let i = 0; i < words.length; i += TRANSLATE_CHUNK_WORDS) {
    const chunk = words.slice(i, i + TRANSLATE_CHUNK_WORDS);
    const result = await sendTranslate(chunk, sourceLang, targetLang);
    if (result?.error) return { error: result.error, message: result.message };
    if (!result?.translations || result.translations.length !== chunk.length) {
      return { error: "translation_mismatch" };
    }
    if (backend === undefined && result.backend) backend = result.backend;
    allTranslations.push(...result.translations);
  }
  return { translations: allTranslations, backend };
}

/**
 * Natural full-sentence translation for context (not concatenated glosses).
 * Uses the same extension cache as word glosses (`translateWithCache`).
 * @param {string} originalText
 * @param {string} sourceLang
 * @param {string} targetLang
 */
async function resolveFullSentenceTranslation(originalText, sourceLang, targetLang) {
  const r = await sendTranslate([originalText], sourceLang, targetLang);
  if (r?.error) return { ok: false, error: r.error, message: r.message };
  if (!r?.translations || r.translations.length !== 1) {
    return { ok: false, error: "translation_mismatch" };
  }
  return { ok: true, text: r.translations[0] ?? "" };
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
      if (
        tag === "SCRIPT" ||
        tag === "STYLE" ||
        tag === "NOSCRIPT" ||
        tag === "TEXTAREA" ||
        tag === "OPTION"
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      if (p.closest("[data-vit-root]")) return NodeFilter.FILTER_REJECT;
      if (p.closest("[data-vit-wrap]")) return NodeFilter.FILTER_REJECT;
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
 * One segment per block-level run: merges adjacent Text nodes in the same paragraph (e.g. link + following text).
 * @param {Text[]} textNodes
 */
function buildSegments(textNodes) {
  const groups = groupTextNodesByBlock(textNodes);
  /** @type {{ nodes: Text[], words: string[], originalText: string }[]} */
  const segments = [];
  for (const nodes of groups) {
    const originalText = nodes.map((n) => n.nodeValue || "").join("");
    if (shouldSkipForSegmenter(originalText)) continue;
    const words = splitWordsWhitespaceOnly(originalText);
    if (!words.length) continue;
    segments.push({ nodes, words, originalText });
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
 * Phase 1: cache probe + mount per segment (cached glosses and … for misses).
 * Phase 2: API for cache misses runs in parallel with phase 1 — each segment’s missing words
 * translate as soon as that segment’s cache probe finishes (not after the full-page cache scan).
 * Full-sentence lines run after all word-level work so glosses are applied first.
 * @param {{ activatingFirst?: boolean }} [options] - First enable: set pageTranslationEnabled after phase 1 so the popup stays on if the API fails later.
 */
function translateWholePage(options = {}) {
  const activatingFirst = options.activatingFirst === true;

  if (translateWholePagePromise) {
    return translateWholePagePromise;
  }

  translateWholePagePromise = (async () => {
    translationInProgress = true;
    setTranslationStatus(
      "cache",
      "Cached glosses first; API for gaps runs per segment as it finishes (not after the full page).",
    );
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
      const sourceLangSetting = (stored.sourceLang || "auto").trim() || "auto";
      const resolvedSource = resolveAutoSourceToConcrete(sourceLangSetting);
      if (!resolvedSource.ok) {
        return {
          ok: false,
          error: resolvedSource.error,
          message: resolvedSource.message,
        };
      }
      const sourceLang = resolvedSource.sourceLang;
      if (primarySubtagForCompare(sourceLang) === primarySubtagForCompare(targetLang)) {
        return {
          ok: false,
          error: "source_same_as_target",
          message:
            "Source and target language are the same. Choose a different target (or a fixed source language) in the extension menu.",
        };
      }

      const textNodes = collectTextNodes();
      const segments = buildSegments(textNodes);
      if (!segments.length) {
        if (activatingFirst) {
          pageTranslationEnabled = true;
        }
        lastLoadSummaryText = formatLoadSummaryText({
          segmentsAllCache: 0,
          wordSegmentsApi: 0,
          missingWords: 0,
          sentenceLines: 0,
          empty: true,
        });
        return { ok: true, wordCount: 0, empty: true, loadSummary: lastLoadSummaryText };
      }

      let totalWords = 0;

      /** Full-sentence line promises (filled after phase 2). */
      const pendingFullLines = [];
      /** Deferred so full-sentence API runs only after cache mounts + word-level API attempts. */
      const pendingFullLineSchedulers = [];

      /**
       * @param {HTMLElement} rootRef
       * @param {string} originalText
       */
      function scheduleFullLineDeferred(rootRef, originalText, wordCount) {
        if (wordCount < 2) return;
        pendingFullLineSchedulers.push(() => {
          pendingFullLines.push(
            resolveFullSentenceTranslation(originalText, sourceLang, targetLang).then((fullRes) => {
              if (!fullRes.ok) return;
              if (rootRef?.isConnected) updateFullLineInRoot(rootRef, fullRes.text);
            }),
          );
        });
      }

      /**
       * @typedef {{
       *   kind: "all_miss",
       *   primary: HTMLElement,
       *   wrap: HTMLElement | null,
       *   groups: ReturnType<typeof splitWordsIntoLines> | null,
       *   words: string[],
       * } | {
       *   kind: "partial",
       *   rootRef: HTMLElement,
       *   words: string[],
       *   missingIdx: number[],
       *   probes: (string | null)[],
       * }} DeferredWordApi
       */

      /** @type {DeferredWordApi[]} */
      const deferredWordApi = [];

      /** Set if phase 1 aborts (e.g. probe shape error); in-flight word-API tasks skip DOM updates. */
      let abortWholePass = false;

      /** @type {Promise<void>[]} */
      const wordApiPromises = [];

      /** Segments where every word gloss was already in the extension cache. */
      let segmentsAllCacheHits = 0;
      /** Word-level API calls only — for end-of-run stats. */
      let missingWordsTotal = 0;

      let apiErrorToastShown = false;
      function showApiErrorOnce(message) {
        if (apiErrorToastShown) return;
        apiErrorToastShown = true;
        const m =
          message ||
          "Could not reach the translation API. Cached glosses stay visible; try again later.";
        setTranslationStatus("api_words", m);
        showToast(m);
      }

      /** Shown once until a friendly backend id arrives (concurrent segment jobs). */
      let firstWordApiStatusSent = false;
      let wordApiBackendReported = false;
      /**
       * Pending: generic status. After first response with a displayable backend: specific line (once).
       * @param {string} [backend]
       */
      function setWordApiStatusDetail(backend) {
        const name = backend ? friendlyBackendName(backend) : null;
        if (backend && !name) return;
        if (name) {
          if (!wordApiBackendReported) {
            wordApiBackendReported = true;
            setTranslationStatus("api_words", `Translation API (${name}): missing word glosses`);
          }
          return;
        }
        if (!firstWordApiStatusSent) {
          firstWordApiStatusSent = true;
          setTranslationStatus(
            "api_words",
            "Translation API — missing word glosses (LibreTranslate).",
          );
        }
      }

      /**
       * Fills glosses for one segment (runs concurrently with phase 1 for other segments).
       * @param {DeferredWordApi} job
       */
      async function processDeferredWordJob(job) {
        if (abortWholePass) return;
        if (job.kind === "all_miss") {
          setWordApiStatusDetail();
          const tr = await sendTranslateWordsInChunks(job.words, sourceLang, targetLang);
          if (abortWholePass) return;
          if (tr.error) {
            showApiErrorOnce(tr.message || tr.error);
            await yieldToMain();
            return;
          }
          if (!tr.translations || tr.translations.length !== job.words.length) {
            showApiErrorOnce("Translation could not be applied. Try again.");
            await yieldToMain();
            return;
          }
          setWordApiStatusDetail(tr.backend);
          try {
            if (job.wrap && job.groups) {
              updateGlossesInWrap(job.wrap, tr.translations);
            } else {
              updateGlossesInRoot(job.primary, tr.translations);
            }
          } catch (e) {
            console.warn("[Verbatim]", e);
          }
          await yieldToMain();
          return;
        }

        setWordApiStatusDetail();
        const missing = job.missingIdx.map((i) => job.words[i]);
        /** @type {string[]} */
        const apiFlat = [];
        let chunkFailed = false;
        for (let i = 0; i < missing.length; i += TRANSLATE_CHUNK_WORDS) {
          const chunk = missing.slice(i, i + TRANSLATE_CHUNK_WORDS);
          const tr = await sendTranslate(chunk, sourceLang, targetLang);
          if (abortWholePass) return;
          if (tr.error) {
            showApiErrorOnce(tr.message || tr.error);
            chunkFailed = true;
            break;
          }
          if (!tr.translations || tr.translations.length !== chunk.length) {
            showApiErrorOnce("Translation could not be applied. Try again.");
            chunkFailed = true;
            break;
          }
          setWordApiStatusDetail(tr.backend);
          apiFlat.push(...tr.translations);
        }
        if (chunkFailed) {
          await yieldToMain();
          return;
        }

        const fullGlosses = job.words.map((_, i) => {
          const g = job.probes[i];
          return g != null ? String(g) : "";
        });
        for (let j = 0; j < job.missingIdx.length; j++) {
          fullGlosses[job.missingIdx[j]] = apiFlat[j];
        }

        try {
          if (job.rootRef.hasAttribute("data-vit-wrap")) {
            updateGlossesInWrap(job.rootRef, fullGlosses);
          } else {
            updateGlossesInRoot(job.rootRef, fullGlosses);
          }
        } catch (e) {
          console.warn("[Verbatim]", e);
        }
        await yieldToMain();
      }

      function enqueueWordApi(job) {
        deferredWordApi.push(job);
        missingWordsTotal += job.kind === "all_miss" ? job.words.length : job.missingIdx.length;
        wordApiPromises.push(
          processDeferredWordJob(job).catch((e) => {
            console.warn("[Verbatim]", e);
          }),
        );
      }

      /* —— Phase 1: cache only (mount UI; defer API) —— */
      for (const seg of segments) {
        const words = seg.words;
        totalWords += words.length;
        if (!seg.nodes.every((n) => n.isConnected)) continue;

        const probe = await sendCacheProbe(words, sourceLang, targetLang);
        /** @type {(string | null)[] | null} */
        let probes = null;
        if (probe.error) {
          probes = words.map(() => null);
        } else {
          const t = probe.translations;
          if (!Array.isArray(t) || t.length !== words.length) {
            abortWholePass = true;
            return { ok: false, error: "translation_mismatch" };
          }
          probes = t;
        }

        /** @type {number[]} */
        const missingIdx = [];
        for (let i = 0; i < probes.length; i++) {
          if (probes[i] == null) missingIdx.push(i);
        }

        if (missingIdx.length === 0) {
          segmentsAllCacheHits += 1;
          /** @type {string[]} */
          const glosses = probes.map((g) => (g == null ? "" : String(g)));
          try {
            const { primary, wrap, groups } = mountInterlinearReplacement(
              seg.nodes,
              words,
              glosses,
              seg.originalText,
              null,
            );
            if (wrap && groups) {
              scheduleFullLinesForWrap(wrap, groups, scheduleFullLineDeferred);
            } else {
              scheduleFullLineDeferred(primary, seg.originalText, words.length);
            }
          } catch (e) {
            console.warn("[Verbatim]", e);
          }
          await yieldToMain();
          continue;
        }

        if (missingIdx.length === words.length) {
          try {
            const { primary, wrap, groups } = mountInterlinearReplacement(
              seg.nodes,
              words,
              words.map(() => null),
              seg.originalText,
              null,
            );
            enqueueWordApi({ kind: "all_miss", primary, wrap, groups, words });
            if (wrap && groups) {
              scheduleFullLinesForWrap(wrap, groups, scheduleFullLineDeferred);
            } else {
              scheduleFullLineDeferred(primary, seg.originalText, words.length);
            }
          } catch (e) {
            console.warn("[Verbatim]", e);
          }
          await yieldToMain();
          continue;
        }

        /** @type {(string|null)[]} */
        const partialGlosses = probes.map((g) => (g == null ? null : g));
        /** @type {HTMLElement | null} */
        let rootRef = null;
        try {
          const { primary, wrap, groups } = mountInterlinearReplacement(
            seg.nodes,
            words,
            partialGlosses,
            seg.originalText,
            null,
          );
          rootRef = wrap || primary;
          enqueueWordApi({
            kind: "partial",
            rootRef: /** @type {HTMLElement} */ (rootRef),
            words,
            missingIdx,
            probes,
          });
          if (wrap && groups) {
            scheduleFullLinesForWrap(wrap, groups, scheduleFullLineDeferred);
          } else {
            scheduleFullLineDeferred(primary, seg.originalText, words.length);
          }
        } catch (e) {
          console.warn("[Verbatim]", e);
          continue;
        }

        await yieldToMain();
      }

      if (activatingFirst) {
        pageTranslationEnabled = true;
      }

      /* —— Phase 2: await all in-flight word-level API (started during phase 1) —— */
      if (wordApiPromises.length) {
        await Promise.allSettled(wordApiPromises);
      }

      /* —— Phase 3: full-sentence lines (cache first, then API via translateWithCache) —— */
      if (pendingFullLineSchedulers.length) {
        setTranslationStatus(
          "api_sentences",
          "Full-sentence lines after word glosses; cache first, then API.",
        );
      }
      for (const fn of pendingFullLineSchedulers) fn();
      if (pendingFullLines.length) {
        await Promise.allSettled(pendingFullLines);
      }

      lastLoadSummaryText = formatLoadSummaryText({
        segmentsAllCache: segmentsAllCacheHits,
        wordSegmentsApi: deferredWordApi.length,
        missingWords: missingWordsTotal,
        sentenceLines: pendingFullLineSchedulers.length,
      });

      return { ok: true, wordCount: totalWords, loadSummary: lastLoadSummaryText };
    } finally {
      translationInProgress = false;
      translationStatusPhase = "idle";
      translationStatusDetail = null;
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
  const wraps = Array.from(document.querySelectorAll("[data-vit-wrap]"));
  for (const el of wraps) {
    const orig = el.getAttribute("data-vit-original-text");
    if (orig == null) continue;
    const parent = el.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(orig), el);
  }
  const roots = Array.from(document.querySelectorAll("[data-vit-root]"));
  for (const el of roots) {
    if (el.closest("[data-vit-wrap]")) continue;
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
        translationStatusPhase = "idle";
        translationStatusDetail = null;
        broadcastVitState();
        persistGlobalPageTranslation(true);
        return { ok: true, enabled: true, already: true, loadSummary: lastLoadSummaryText };
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
      persistGlobalPageTranslation(true);
      return {
        ok: true,
        enabled: true,
        wordCount: r.wordCount,
        empty: r.empty,
        loadSummary: r.loadSummary,
      };
    }
    restorePage();
    persistGlobalPageTranslation(false);
    pageTranslationEnabled = false;
    translationStatusPhase = "idle";
    translationStatusDetail = null;
    lastLoadSummaryText = null;
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
  if (
    !res.ok &&
    res.message &&
    (res.error === "no_target_language" ||
      res.error === "no_page_lang" ||
      res.error === "source_same_as_target")
  ) {
    showToast(res.message);
  }
  return res;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GET_HTML_LANG") {
    const raw =
      document.documentElement.getAttribute("lang") || document.documentElement.lang || "";
    sendResponse({ raw, primary: primaryLangFromHtmlLang(raw) });
    return true;
  }
  if (msg?.type === "GET_PAGE_TRANSLATION_STATE") {
    sendResponse({
      enabled: pageTranslationEnabled,
      loading: translationInProgress,
      /** Reflects toggle: on while translating or when interlinear is active (avoids stale UI gaps). */
      toggleOn: pageTranslationEnabled || translationInProgress,
      statusPhase: translationStatusPhase,
      statusDetail: translationStatusDetail,
      lastLoadSummary: lastLoadSummaryText,
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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes.globalPageTranslation) return;
  const nv = changes.globalPageTranslation.newValue === true;
  if (!nv) {
    if (pageTranslationEnabled) {
      restorePage();
      pageTranslationEnabled = false;
      translationStatusPhase = "idle";
      translationStatusDetail = null;
      lastLoadSummaryText = null;
      broadcastVitState();
    }
    return;
  }
  if (!pageTranslationEnabled && !translationInProgress) {
    void setPageTranslationEnabled(true);
  }
});

void chrome.storage.sync.get(["globalPageTranslation"], (s) => {
  if (s?.globalPageTranslation !== true) return;
  if (pageTranslationEnabled || translationInProgress) return;
  void setPageTranslationEnabled(true);
});
