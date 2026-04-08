import { LANGUAGE_OPTIONS } from "../lib/languageOptions.js";
import { defaultSettings } from "../lib/defaultSettings.js";

const subEl = document.getElementById("toggleSub");
const toggleEl = document.getElementById("pageToggle");
const loadingEl = document.getElementById("toggleLoading");
const statusLineEl = document.getElementById("statusLine");
const idleHintEl = document.getElementById("idleHint");
const errorEl = document.getElementById("popupError");
const sourceLangEl = document.getElementById("sourceLang");
const targetLangEl = document.getElementById("targetLang");

const NO_BACKEND_MESSAGE =
  "Add at least one translation API in Options — use “Options & API keys” below.";

const NO_TARGET_MESSAGE = "Choose a target language above before turning interlinear mode on.";

/** While the toggle is busy, poll the tab for live phase/detail (session sync can lag). */
let tabStatePollTimer = null;

function setPopupError(text) {
  if (!errorEl) return;
  if (!text) {
    errorEl.textContent = "";
    errorEl.hidden = true;
    return;
  }
  errorEl.textContent = text;
  errorEl.hidden = false;
}

function formatToggleError(res) {
  if (res?.message) return res.message;
  const e = res?.error;
  if (e === "translation_mismatch") return "Translation could not be completed. Try again.";
  if (e === "no_target_language") return NO_TARGET_MESSAGE;
  if (typeof e === "string") return e;
  return "Something went wrong.";
}

function setSubtext(enabled) {
  if (subEl) {
    subEl.textContent = enabled ? "Interlinear on" : "Off";
  }
  if (toggleEl) toggleEl.checked = !!enabled;
}

/**
 * When interlinear is on and not loading: explain the pipeline and what “On” means, plus last-run stats.
 * @param {boolean} on
 * @param {boolean} loading
 * @param {string} [lastSummary]
 */
function updateIdleHintForSnap(on, loading, lastSummary) {
  if (!idleHintEl) return;
  if (!on || loading) {
    idleHintEl.hidden = true;
    return;
  }
  idleHintEl.hidden = false;
  const intro =
    "“Interlinear on” means this tab shows glosses — not that the last run used only the cache.";
  const order =
    "How it runs: ① word glosses from the extension cache first, ② missing words via your Translation API settings (backend / auto chain), ③ full-sentence lines after that (same cache + API).";
  const trimmed = typeof lastSummary === "string" ? lastSummary.trim() : "";
  idleHintEl.textContent = trimmed ? `${intro}\n\n${order}\n\n${trimmed}` : `${intro}\n\n${order}`;
}

/**
 * Short label next to “Interlinear mode” while work is in progress.
 * @param {string} [phase]
 */
function formatStatusSub(phase) {
  switch (phase) {
    case "cache":
      return "From cache…";
    case "api_words":
      return "API (words)…";
    case "api_sentences":
      return "API (sentences)…";
    default:
      return "Working…";
  }
}

/**
 * Longer explanation below the toggle (cache vs API steps).
 * @param {string} [phase]
 * @param {string | null} [detail]
 */
function formatStatusLine(phase, detail) {
  if (detail && String(detail).trim()) {
    return String(detail).trim();
  }
  switch (phase) {
    case "cache":
      return "Reading saved glosses from the extension cache and laying out the page. No network yet.";
    case "api_words":
      return "Requesting missing word glosses from the translation API.";
    case "api_sentences":
      return "Full-sentence lines: cache when this text was translated before, otherwise the translation API.";
    default:
      return "";
  }
}

function stopTabStatePoll() {
  if (tabStatePollTimer != null) {
    clearInterval(tabStatePollTimer);
    tabStatePollTimer = null;
  }
}

function startTabStatePoll() {
  stopTabStatePoll();
  tabStatePollTimer = setInterval(() => {
    void (async () => {
      if (!toggleEl?.disabled) {
        stopTabStatePoll();
        return;
      }
      const tab = await getActiveTab();
      if (!tab?.id || isRestrictedUrl(tab.url || "")) return;
      chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_TRANSLATION_STATE" }, (res) => {
        if (chrome.runtime.lastError) return;
        applyTabStateSnapshot(res);
      });
    })();
  }, 320);
}

/**
 * Disables controls and shows spinner while the content script is translating.
 * @param {boolean} loading
 * @param {string} [phase] idle | cache | api_words | api_sentences
 * @param {string | null} [detail]
 */
function setLoading(loading, phase = "idle", detail = null) {
  if (loadingEl) loadingEl.hidden = !loading;
  if (toggleEl) toggleEl.disabled = !!loading;
  if (sourceLangEl) sourceLangEl.disabled = !!loading;
  if (targetLangEl) targetLangEl.disabled = !!loading;
  /** While loading, default unknown phase to cache (matches content script start). */
  const effectivePhase =
    loading && (!phase || phase === "idle") ? "cache" : phase || "idle";
  if (statusLineEl) {
    if (loading) {
      statusLineEl.textContent = formatStatusLine(effectivePhase, detail);
      statusLineEl.hidden = false;
    } else {
      statusLineEl.textContent = "";
      statusLineEl.hidden = true;
    }
  }
  if (loading && subEl) {
    subEl.textContent = formatStatusSub(effectivePhase);
  }
  if (loading) {
    startTabStatePoll();
  } else {
    stopTabStatePoll();
  }
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:")
  );
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function buildLanguageSelects() {
  if (!sourceLangEl || !targetLangEl) return;

  sourceLangEl.innerHTML = "";
  const autoOpt = document.createElement("option");
  autoOpt.value = "auto";
  autoOpt.textContent = "Auto detect";
  sourceLangEl.appendChild(autoOpt);
  for (const { value, label } of LANGUAGE_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    sourceLangEl.appendChild(opt);
  }

  targetLangEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select language";
  targetLangEl.appendChild(placeholder);
  for (const { value, label } of LANGUAGE_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    targetLangEl.appendChild(opt);
  }
}

function ensureTargetOption(value) {
  if (!value || !targetLangEl) return;
  const exists = Array.from(targetLangEl.options).some((o) => o.value === value);
  if (exists) return;
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = value;
  targetLangEl.appendChild(opt);
}

async function syncLangFromStorage() {
  if (!sourceLangEl || !targetLangEl) return;
  const stored = await chrome.storage.sync.get(["sourceLang", "targetLang"]);
  const merged = { ...defaultSettings, ...stored };
  const src = merged.sourceLang && merged.sourceLang !== "" ? merged.sourceLang : "auto";
  sourceLangEl.value = src;
  if (sourceLangEl.value !== src) {
    sourceLangEl.value = "auto";
  }

  const rawTarget = typeof merged.targetLang === "string" ? merged.targetLang.trim() : "";
  if (!rawTarget) {
    targetLangEl.value = "";
    return;
  }
  ensureTargetOption(rawTarget);
  targetLangEl.value = rawTarget;
  if (targetLangEl.value !== rawTarget) {
    targetLangEl.value = "";
  }
}

function saveLanguagesPartial(patch) {
  chrome.storage.sync.set(patch, () => void chrome.runtime.lastError);
}

/** Apply tab snapshot from session storage or a GET_PAGE_TRANSLATION_STATE response. */
function applyTabStateSnapshot(snap) {
  if (!snap || typeof snap !== "object") return;
  const loading = !!snap.loading;
  const on = !!(snap.toggleOn ?? snap.enabled ?? loading);
  const phase = typeof snap.statusPhase === "string" ? snap.statusPhase : "idle";
  const detail = snap.statusDetail != null ? String(snap.statusDetail) : null;
  const lastSummary = snap.lastLoadSummary != null ? String(snap.lastLoadSummary) : "";
  if (loading) {
    setLoading(true, phase, detail);
  } else {
    setLoading(false, "idle", null);
    if (toggleEl) toggleEl.disabled = false;
  }
  if (toggleEl) toggleEl.checked = on;
  if (subEl && !loading) {
    subEl.textContent = on ? "Interlinear on" : "Off";
  }
  updateIdleHintForSnap(on, loading, lastSummary);
}

/** Last state pushed from the tab via the background (instant; avoids waiting on the busy content script). */
async function applySessionSnapshotForTab(tabId) {
  if (tabId == null) return;
  try {
    const key = `vit_tab_${tabId}`;
    const obj = await chrome.storage.session.get(key);
    const snap = obj[key];
    applyTabStateSnapshot(snap);
  } catch {
    /* session storage may be unavailable in some environments */
  }
}

function syncToggleFromTab() {
  return new Promise((resolve) => {
    void (async () => {
      setPopupError("");
      const tab = await getActiveTab();
      if (!tab?.id || isRestrictedUrl(tab.url || "")) {
        setLoading(false);
        setSubtext(false);
        if (toggleEl) toggleEl.disabled = true;
        if (idleHintEl) idleHintEl.hidden = true;
        resolve();
        return;
      }
      await applySessionSnapshotForTab(tab.id);
      chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_TRANSLATION_STATE" }, (res) => {
        if (chrome.runtime.lastError) {
          resolve();
          return;
        }
        applyTabStateSnapshot(res);
        resolve();
      });
    })();
  });
}

document.getElementById("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL("options/options.html"));
  }
});

/**
 * @param {boolean} wantOn - target state user chose (checkbox after change)
 * @param {object|undefined} res
 */
function applyToggleResponse(wantOn, res) {
  setLoading(false);
  if (res?.ok === true) {
    setPopupError("");
    setSubtext(!!res.enabled);
    const ls = typeof res.loadSummary === "string" ? res.loadSummary : "";
    updateIdleHintForSnap(!!res.enabled, false, ls);
    return;
  }
  toggleEl.checked = !wantOn;
  setSubtext(!wantOn);
  updateIdleHintForSnap(!wantOn, false, "");
  setPopupError(formatToggleError(res));
}

buildLanguageSelects();

void (async () => {
  await syncLangFromStorage();
  await syncToggleFromTab();
})();

chrome.storage.session.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session") return;
  void (async () => {
    const tab = await getActiveTab();
    if (!tab?.id) return;
    const key = `vit_tab_${tab.id}`;
    const ch = changes[key];
    if (!ch?.newValue) return;
    applyTabStateSnapshot(ch.newValue);
  })();
});

sourceLangEl?.addEventListener("change", () => {
  setPopupError("");
  const v = sourceLangEl.value || "auto";
  saveLanguagesPartial({ sourceLang: v });
});

targetLangEl?.addEventListener("change", () => {
  setPopupError("");
  const v = targetLangEl.value.trim();
  saveLanguagesPartial({ targetLang: v });
});

toggleEl.addEventListener("change", async () => {
  setPopupError("");
  const tab = await getActiveTab();
  if (!tab?.id || isRestrictedUrl(tab.url || "")) {
    toggleEl.checked = false;
    setPopupError("This page does not allow extensions. Try a normal website.");
    return;
  }
  const wantOn = toggleEl.checked;

  const sendSetPage = () => {
    chrome.tabs.sendMessage(tab.id, { type: "SET_PAGE_TRANSLATION", enabled: wantOn }, (res) => {
      if (chrome.runtime.lastError) {
        setLoading(false);
        toggleEl.checked = !wantOn;
        setSubtext(!wantOn);
        setPopupError(chrome.runtime.lastError.message);
        return;
      }
      applyToggleResponse(wantOn, res);
    });
  };

  if (!wantOn) {
    sendSetPage();
    return;
  }

  const langSnap = await chrome.storage.sync.get(["targetLang"]);
  const target = (langSnap.targetLang ?? "").trim();
  if (!target) {
    toggleEl.checked = false;
    setSubtext(false);
    setPopupError(NO_TARGET_MESSAGE);
    return;
  }

  let pref;
  try {
    pref = await chrome.runtime.sendMessage({ type: "TRANSLATION_BACKEND_READY" });
  } catch (e) {
    toggleEl.checked = false;
    setSubtext(false);
    setPopupError(e?.message || "Could not read extension settings.");
    return;
  }
  if (pref?.ok !== true) {
    toggleEl.checked = false;
    setSubtext(false);
    setPopupError(NO_BACKEND_MESSAGE);
    return;
  }
  setLoading(true, "cache", null);
  sendSetPage();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void (async () => {
      await syncLangFromStorage();
      await syncToggleFromTab();
    })();
  }
});
