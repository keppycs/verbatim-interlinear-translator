import { defaultSettings } from "../lib/defaultSettings.js";
import { normalizeHttpServiceBaseUrl } from "../lib/translation/normalizeServiceUrl.js";
import { toLibreStyleLang } from "../lib/translation/libreStyleLang.js";

const subEl = document.getElementById("toggleSub");
const toggleEl = document.getElementById("pageToggle");
const loadingEl = document.getElementById("toggleLoading");
const statusLineEl = document.getElementById("statusLine");
const idleHintEl = document.getElementById("idleHint");
const errorEl = document.getElementById("popupError");
const sourceLangEl = document.getElementById("sourceLang");
const targetLangEl = document.getElementById("targetLang");
const baseUrlEl = document.getElementById("libreTranslateBaseUrl");
const languagesErrorEl = document.getElementById("languagesError");
const swapLangEl = document.getElementById("swapLang");
const useCacheEl = document.getElementById("useTranslationCache");
const clearCacheEl = document.getElementById("clearTranslationCache");
const cacheStatusEl = document.getElementById("cacheStatus");

const NO_BACKEND_MESSAGE = "Set your LibreTranslate URL above.";

const NO_TARGET_MESSAGE = "Choose a target language before turning interlinear mode on.";

/** @type {Array<{ code: string; name: string; targets: string[] }> | null} */
let lastLanguages = null;

/** While the toggle is busy, poll the tab for live phase/detail (session sync can lag). */
let tabStatePollTimer = null;

let baseUrlDebounceTimer = null;

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

function setLanguagesError(text) {
  if (!languagesErrorEl) return;
  if (!text) {
    languagesErrorEl.textContent = "";
    languagesErrorEl.hidden = true;
    return;
  }
  languagesErrorEl.textContent = text;
  languagesErrorEl.hidden = false;
}

function setCacheStatus(text) {
  if (!cacheStatusEl) return;
  if (!text) {
    cacheStatusEl.textContent = "";
    cacheStatusEl.hidden = true;
    return;
  }
  cacheStatusEl.textContent = text;
  cacheStatusEl.hidden = false;
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
 * @param {Array<{ code: string; name: string; targets: string[] }>} languages
 * @param {string} code
 */
function displayNameForCode(languages, code) {
  const row = languages.find((r) => r.code === code);
  return row ? row.name : code;
}

/**
 * @param {Array<{ code: string; name: string; targets: string[] }>} languages
 * @param {string} sourceValue
 */
function targetCodesForSource(languages, sourceValue) {
  if (sourceValue === "auto") {
    const set = new Set();
    for (const row of languages) {
      if (Array.isArray(row.targets)) {
        for (const t of row.targets) set.add(t);
      }
    }
    if (set.size === 0) {
      for (const row of languages) {
        if (row.code) set.add(row.code);
      }
    }
    return Array.from(set).sort();
  }
  const st = toLibreStyleLang(sourceValue);
  const row = languages.find((r) => r.code === sourceValue || r.code === st);
  if (!row || !Array.isArray(row.targets)) return [];
  return [...row.targets].sort();
}

/**
 * @param {Array<{ code: string; name: string; targets: string[] }>} languages
 */
function rebuildSourceSelect(languages) {
  if (!sourceLangEl) return;
  sourceLangEl.innerHTML = "";
  const autoOpt = document.createElement("option");
  autoOpt.value = "auto";
  autoOpt.textContent = "Auto";
  sourceLangEl.appendChild(autoOpt);
  const sorted = [...languages].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  for (const row of sorted) {
    const opt = document.createElement("option");
    opt.value = row.code;
    opt.textContent = row.name || row.code;
    sourceLangEl.appendChild(opt);
  }
}

/**
 * @param {Array<{ code: string; name: string; targets: string[] }>} languages
 * @param {string} sourceValue
 * @param {string} [preferredTarget] - if set, prefer this value when still valid (e.g. from storage)
 */
function rebuildTargetSelect(languages, sourceValue, preferredTarget) {
  if (!targetLangEl) return;
  const prev =
    preferredTarget !== undefined ? preferredTarget : targetLangEl.value;
  targetLangEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select language";
  targetLangEl.appendChild(placeholder);
  const codes = targetCodesForSource(languages, sourceValue || "auto");
  for (const code of codes) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = displayNameForCode(languages, code);
    targetLangEl.appendChild(opt);
  }
  const want = (prev || "").trim();
  if (want && Array.from(targetLangEl.options).some((o) => o.value === want)) {
    targetLangEl.value = want;
  } else {
    targetLangEl.value = "";
  }
}

function applyLanguageValuesFromStorage() {
  if (!lastLanguages || !sourceLangEl || !targetLangEl) return;
  chrome.storage.sync.get(["sourceLang", "targetLang"], (stored) => {
    const merged = { ...defaultSettings, ...stored };
    const src = merged.sourceLang && merged.sourceLang !== "" ? merged.sourceLang : "auto";
    const rawTarget = typeof merged.targetLang === "string" ? merged.targetLang.trim() : "";
    if ([...sourceLangEl.options].some((o) => o.value === src)) {
      sourceLangEl.value = src;
    } else {
      sourceLangEl.value = "auto";
    }
    rebuildTargetSelect(lastLanguages, sourceLangEl.value, rawTarget);
  });
}

async function fetchLanguagesFromSw(baseUrl) {
  const res = await chrome.runtime.sendMessage({ type: "GET_LIBRE_LANGUAGES", baseUrl });
  if (!res?.ok) {
    throw new Error(res?.error || "Could not load languages.");
  }
  return res.languages;
}

async function refreshLanguagesUi() {
  const raw = (baseUrlEl?.value || "").trim();
  if (!raw) {
    lastLanguages = null;
    if (sourceLangEl) {
      sourceLangEl.innerHTML = "";
      sourceLangEl.disabled = true;
    }
    if (targetLangEl) {
      targetLangEl.innerHTML = "";
      targetLangEl.disabled = true;
    }
    if (swapLangEl) swapLangEl.disabled = true;
    setLanguagesError("");
    return;
  }
  setLanguagesError("");
  if (sourceLangEl) sourceLangEl.disabled = true;
  if (targetLangEl) targetLangEl.disabled = true;
  if (swapLangEl) swapLangEl.disabled = true;
  try {
    const languages = await fetchLanguagesFromSw(raw);
    lastLanguages = languages;
    rebuildSourceSelect(languages);
    applyLanguageValuesFromStorage();
    if (sourceLangEl) sourceLangEl.disabled = false;
    if (targetLangEl) targetLangEl.disabled = false;
    if (swapLangEl) swapLangEl.disabled = false;
  } catch (e) {
    lastLanguages = null;
    if (sourceLangEl) {
      sourceLangEl.innerHTML = "";
      sourceLangEl.disabled = true;
    }
    if (targetLangEl) {
      targetLangEl.innerHTML = "";
      targetLangEl.disabled = true;
    }
    if (swapLangEl) swapLangEl.disabled = true;
    setLanguagesError(e?.message || String(e));
  }
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
    "How it runs: ① word glosses from the extension cache first (if enabled), ② missing words via LibreTranslate, ③ full-sentence lines after that.";
  const trimmed = typeof lastSummary === "string" ? lastSummary.trim() : "";
  idleHintEl.textContent = trimmed ? `${intro}\n\n${order}\n\n${trimmed}` : `${intro}\n\n${order}`;
}

/**
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
      return "Requesting missing word glosses from LibreTranslate.";
    case "api_sentences":
      return "Full-sentence lines: cache when this text was translated before, otherwise LibreTranslate.";
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
 * @param {boolean} loading
 * @param {string} [phase]
 * @param {string | null} [detail]
 */
function setLoading(loading, phase = "idle", detail = null) {
  if (loadingEl) loadingEl.hidden = !loading;
  if (toggleEl) toggleEl.disabled = !!loading;
  if (sourceLangEl) sourceLangEl.disabled = !!loading || !lastLanguages;
  if (targetLangEl) targetLangEl.disabled = !!loading || !lastLanguages;
  if (baseUrlEl) baseUrlEl.disabled = !!loading;
  if (swapLangEl) swapLangEl.disabled = !!loading || !lastLanguages;
  if (useCacheEl) useCacheEl.disabled = !!loading;
  if (clearCacheEl) clearCacheEl.disabled = !!loading;
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

async function applySessionSnapshotForTab(tabId) {
  if (tabId == null) return;
  try {
    const key = `vit_tab_${tabId}`;
    const obj = await chrome.storage.session.get(key);
    const snap = obj[key];
    applyTabStateSnapshot(snap);
  } catch {
    /* session storage may be unavailable */
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

/**
 * @param {boolean} wantOn
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

async function loadSettingsIntoForm() {
  const stored = await chrome.storage.sync.get(null);
  const merged = { ...defaultSettings, ...stored };
  if (baseUrlEl) {
    baseUrlEl.value = merged.libreTranslateBaseUrl || "";
  }
  if (useCacheEl) {
    useCacheEl.checked = merged.useTranslationCache !== false;
  }
  await refreshLanguagesUi();
}

baseUrlEl?.addEventListener("input", () => {
  clearTimeout(baseUrlDebounceTimer);
  baseUrlDebounceTimer = setTimeout(() => {
    const v = normalizeHttpServiceBaseUrl(baseUrlEl.value.trim());
    chrome.storage.sync.set({ libreTranslateBaseUrl: v }, () => void refreshLanguagesUi());
  }, 400);
});

baseUrlEl?.addEventListener("blur", () => {
  const v = normalizeHttpServiceBaseUrl(baseUrlEl.value.trim());
  baseUrlEl.value = v;
  chrome.storage.sync.set({ libreTranslateBaseUrl: v }, () => void refreshLanguagesUi());
});

useCacheEl?.addEventListener("change", () => {
  chrome.storage.sync.set({ useTranslationCache: !!useCacheEl.checked });
});

clearCacheEl?.addEventListener("click", () => {
  setCacheStatus("");
  chrome.runtime.sendMessage({ type: "CLEAR_TRANSLATION_CACHE" }, (res) => {
    if (chrome.runtime.lastError) {
      setCacheStatus("Could not clear cache.");
      return;
    }
    if (res?.ok) {
      setCacheStatus("Translation cache cleared.");
      setTimeout(() => setCacheStatus(""), 2500);
    } else {
      setCacheStatus(res?.error || "Could not clear cache.");
    }
  });
});

sourceLangEl?.addEventListener("change", () => {
  if (!lastLanguages) return;
  setPopupError("");
  const v = sourceLangEl.value || "auto";
  const prev = targetLangEl?.value || "";
  rebuildTargetSelect(lastLanguages, v, prev);
  const still = targetLangEl?.value?.trim() || "";
  saveLanguagesPartial({ sourceLang: v, targetLang: still });
});

targetLangEl?.addEventListener("change", () => {
  setPopupError("");
  const v = targetLangEl.value.trim();
  saveLanguagesPartial({ targetLang: v });
});

swapLangEl?.addEventListener("click", () => {
  if (!lastLanguages || !sourceLangEl || !targetLangEl) return;
  const src = sourceLangEl.value;
  const tgt = targetLangEl.value.trim();
  let patch;
  if (src === "auto") {
    if (!tgt) return;
    patch = { sourceLang: tgt, targetLang: "" };
  } else {
    if (!tgt) return;
    patch = { sourceLang: tgt, targetLang: src };
  }
  chrome.storage.sync.set(patch, () => {
    applyLanguageValuesFromStorage();
  });
});

void (async () => {
  await loadSettingsIntoForm();
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

toggleEl?.addEventListener("change", async () => {
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
      await loadSettingsIntoForm();
      await syncToggleFromTab();
    })();
  }
});
