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

function showVitToast(message, isError) {
  const el = document.createElement("div");
  el.setAttribute("data-vit-toast", "1");
  el.textContent = message;
  el.style.cssText = [
    "position:fixed",
    "top:12px",
    "left:50%",
    "transform:translateX(-50%)",
    "z-index:2147483647",
    "max-width:min(90vw,28rem)",
    "padding:8px 12px",
    "border-radius:6px",
    "font:14px system-ui,Segoe UI,sans-serif",
    "box-shadow:0 2px 10px rgba(0,0,0,.25)",
    isError ? "background:#3d1515;color:#ffecec" : "background:#152a15;color:#ecffec",
  ].join(";");
  const root = document.body || document.documentElement;
  root.appendChild(el);
  window.setTimeout(() => {
    el.remove();
  }, 4500);
}

/**
 * @param {string[]} words
 * @param {string[]} glosses
 * @param {"inject"|"absolute"} layoutMode
 */
function buildInterlinearFragment(words, glosses, layoutMode) {
  const root = document.createElement("span");
  root.setAttribute("data-vit-root", "1");
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

async function applyInterlinearToSelection() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    showVitToast("Select some text first.", true);
    return { ok: false, error: "no_selection" };
  }

  const text = sel.toString();
  if (!text.trim()) {
    showVitToast("Nothing to translate.", true);
    return { ok: false, error: "empty" };
  }

  if (shouldSkipForSegmenter(text)) {
    showVitToast("This selection needs a segmenter (not supported yet).", true);
    return { ok: false, error: "needs_segmenter" };
  }

  const words = splitWordsWhitespaceOnly(text);
  if (!words.length) {
    showVitToast("Nothing to translate.", true);
    return { ok: false, error: "empty" };
  }

  const range = sel.getRangeAt(0).cloneRange();
  const stored = await storageGet();
  const layoutMode = stored.layoutMode === "absolute" ? "absolute" : "inject";

  const result = await sendTranslate(words);
  if (result?.error) {
    showVitToast(String(result.error), true);
    return { ok: false, error: result.error };
  }
  if (!result?.translations || result.translations.length !== words.length) {
    showVitToast("Translation failed.", true);
    return { ok: false, error: "translation_mismatch" };
  }

  if (!range.commonAncestorContainer.isConnected) {
    showVitToast("The page changed while translating. Try again.", true);
    return { ok: false, error: "stale_range" };
  }

  try {
    range.deleteContents();
    const frag = buildInterlinearFragment(words, result.translations, layoutMode);
    range.insertNode(frag);
    sel.removeAllRanges();
  } catch (e) {
    showVitToast(
      "Could not insert translation here (complex selection). Try a smaller selection.",
      true
    );
    return { ok: false, error: String(e?.message || e) };
  }

  showVitToast(`Interlinear translation added (${result.backend || "ok"}).`, false);
  return { ok: true, backend: result.backend, wordCount: words.length };
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
  if (msg?.type === "APPLY_INTERLINEAR") {
    applyInterlinearToSelection().then(sendResponse);
    return true;
  }
  return undefined;
});
