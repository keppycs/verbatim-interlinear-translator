import { defaultSettings } from "../lib/defaultSettings.js";
import { normalizeHttpServiceBaseUrl } from "../lib/translation/normalizeServiceUrl.js";
import { toLibreStyleLang } from "../lib/translation/libreStyleLang.js";
import { isLegacyCompat } from "../lib/compat.js";

/** Browsers without `chrome.storage.session` — translation cache is forced off in the service worker. */
const legacyMode = isLegacyCompat();

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
const legacyCacheHintEl = document.getElementById("legacyCacheHint");
const cacheStatusEl = document.getElementById("cacheStatus");

const NO_BACKEND_MESSAGE = "Set your LibreTranslate URL above.";

const NO_TARGET_MESSAGE = "Choose a target language before turning interlinear mode on.";

/** Popup has no scrollbars; keep strings short so they fit clipped message areas. */
const POPUP_TEXT_SOFT_CAP = 420;

function truncatePopupText(s, max = POPUP_TEXT_SOFT_CAP) {
  const str = String(s);
  if (str.length <= max) return str;
  return `${str.slice(0, Math.max(0, max - 1))}…`;
}

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
  errorEl.textContent = truncatePopupText(text);
  errorEl.hidden = false;
}

function setLanguagesError(text) {
  if (!languagesErrorEl) return;
  if (!text) {
    languagesErrorEl.textContent = "";
    languagesErrorEl.hidden = true;
    return;
  }
  languagesErrorEl.textContent = truncatePopupText(text);
  languagesErrorEl.hidden = false;
}

function applyLegacyCacheUi() {
  if (!legacyCacheHintEl) return;
  if (legacyMode) {
    legacyCacheHintEl.textContent =
      "Translation cache is unavailable on this browser version. Glosses are not saved locally between visits.";
    legacyCacheHintEl.hidden = false;
  } else {
    legacyCacheHintEl.textContent = "";
    legacyCacheHintEl.hidden = true;
  }
}

function setCacheStatus(text) {
  if (!cacheStatusEl) return;
  if (!text) {
    cacheStatusEl.textContent = "";
    cacheStatusEl.hidden = true;
    return;
  }
  cacheStatusEl.textContent = truncatePopupText(text);
  cacheStatusEl.hidden = false;
}

function formatToggleError(res) {
  if (res?.message) return res.message;
  const e = res?.error;
  if (e === "translation_mismatch") return "Translation could not be completed. Try again.";
  if (e === "no_target_language") return NO_TARGET_MESSAGE;
  if (e === "no_page_lang") {
    return 'This page needs <html lang="…"> when source is “Auto”, or pick a fixed source language.';
  }
  if (e === "source_same_as_target") {
    return "Source and target language are the same. Choose a different target.";
  }
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
 * Match a LibreTranslate `/languages` row by code (handles zh vs zh-CN style mismatches).
 * Prefer exact `row.code` first — otherwise `zh` can win before `zh-CN` and you get the wrong `targets` list.
 * @param {Array<{ code: string; name: string; targets: string[] }>} languages
 * @param {string} code
 */
function findLanguageRow(languages, code) {
  if (!code || !languages?.length) return null;
  const exact = languages.find((r) => r.code === code);
  if (exact) return exact;
  const want = toLibreStyleLang(code);
  return languages.find((r) => toLibreStyleLang(r.code) === want) ?? null;
}

/**
 * @param {Array<{ code: string; name: string; targets: string[] }>} languages
 * @param {string} code
 */
function displayNameForCode(languages, code) {
  const row = findLanguageRow(languages, code);
  return row ? row.name : code;
}

/**
 * Human-readable language name for a primary subtag when Libre has no matching row.
 * @param {string} primary
 */
function intlLanguageNameForPrimary(primary) {
  if (!primary) return "";
  try {
    const loc = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en";
    const dn = new Intl.DisplayNames([loc], { type: "language" });
    const tag = primary.toLowerCase();
    const name = dn.of(tag);
    return name && name !== tag ? name : primary;
  } catch {
    return primary;
  }
}

/**
 * Label for the Auto option parenthetical: Libre name when available, else Intl.
 * @param {Array<{ code: string; name: string; targets: string[] }>} languages
 * @param {string} primary
 */
function labelForAutoParenthetical(languages, primary) {
  const row = findLanguageRow(languages, primary);
  if (row) return row.name || row.code;
  return intlLanguageNameForPrimary(primary);
}

/**
 * Target codes for a concrete source: that row’s `targets` from `/languages`, excluding self.
 * For “Auto”, the content script resolves source from &lt;html lang&gt;; use the same primary here.
 * @param {Array<{ code: string; name: string; targets: string[] }>} languages
 * @param {string} concreteSourceCode
 */
function targetCodesForConcreteSource(languages, concreteSourceCode) {
  const row = findLanguageRow(languages, concreteSourceCode);
  if (!row || !Array.isArray(row.targets)) return [];
  const srcNorm = toLibreStyleLang(row.code);
  return row.targets.filter((c) => toLibreStyleLang(c) !== srcNorm);
}

/**
 * True if this language can be chosen as a fixed source (has at least one target other than itself).
 * @param {Array<{ code: string; name: string; targets: string[] }>} languages
 * @param {string} code
 */
function fixedSourceHasNonSelfTarget(languages, code) {
  return targetCodesForConcreteSource(languages, code).length > 0;
}

/**
 * Fixed source options: only Libre `/languages` rows that have at least one non-self target.
 * The synthetic `auto` option is always first (see defaultSettings.sourceLang).
 * @param {Array<{ code: string; name: string; targets: string[] }>} languages
 */
function rebuildSourceSelect(languages) {
  if (!sourceLangEl) return;
  sourceLangEl.innerHTML = "";
  const autoOpt = document.createElement("option");
  autoOpt.value = "auto";
  autoOpt.textContent = "Auto";
  sourceLangEl.appendChild(autoOpt);
  const sorted = [...languages].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }),
  );
  for (const row of sorted) {
    if (!fixedSourceHasNonSelfTarget(languages, row.code)) continue;
    const opt = document.createElement("option");
    opt.value = row.code;
    opt.textContent = row.name || row.code;
    sourceLangEl.appendChild(opt);
  }
}

function setAutoSourceOptionLabel(text) {
  const opt = sourceLangEl?.querySelector('option[value="auto"]');
  if (opt) opt.textContent = text;
}

/**
 * Primary language subtag from the active tab’s &lt;html lang&gt; (same signal as translation uses for Auto).
 * @returns {Promise<string | null>}
 */
async function getHtmlLangPrimaryForActiveTab() {
  const tab = await getActiveTab();
  if (!tab?.id || isRestrictedUrl(tab.url || "")) return null;
  const resp = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { type: "GET_HTML_LANG" }, (r) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(r);
    });
  });
  const primary = typeof resp?.primary === "string" ? resp.primary.trim() : "";
  return primary || null;
}

/**
 * Label Auto using the active tab’s &lt;html lang&gt; and Libre or Intl names.
 * @param {string | null | undefined} [htmlPrimaryHint] - when passed (including null), avoids GET_HTML_LANG
 */
async function refreshAutoSourceLabel(htmlPrimaryHint) {
  if (!lastLanguages || !sourceLangEl) return;
  const primary =
    htmlPrimaryHint !== undefined ? htmlPrimaryHint : await getHtmlLangPrimaryForActiveTab();
  if (!primary) {
    setAutoSourceOptionLabel("Auto");
    return;
  }
  const name = labelForAutoParenthetical(lastLanguages, primary);
  setAutoSourceOptionLabel(`Auto (${name})`);
}

/**
 * Target options: placeholder first, then only that source row’s `targets` (no global union).
 * For `auto`, the concrete source is the active tab’s &lt;html lang&gt; primary (same as content script).
 * @param {Array<{ code: string; name: string; targets: string[] }>} languages
 * @param {string} sourceValue - "auto" or a fixed source code (must match the source &lt;select&gt; value)
 * @param {string} [preferredTarget] - if set, prefer this value when still valid (e.g. from storage)
 * @param {string | null | undefined} [htmlPrimaryHint] - for `auto` only: when set (including null), skips GET_HTML_LANG
 */
async function rebuildTargetSelect(languages, sourceValue, preferredTarget, htmlPrimaryHint) {
  if (!targetLangEl) return;
  const prev = preferredTarget !== undefined ? preferredTarget : targetLangEl.value;
  targetLangEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select language";
  targetLangEl.appendChild(placeholder);
  const src = (sourceValue || "auto").trim();
  let codes;
  if (src === "auto") {
    let primary = htmlPrimaryHint;
    if (primary === undefined) {
      primary = await getHtmlLangPrimaryForActiveTab();
    }
    codes = primary ? targetCodesForConcreteSource(languages, primary) : [];
  } else {
    codes = targetCodesForConcreteSource(languages, src);
  }
  const labelByCode = new Map(codes.map((c) => [c, displayNameForCode(languages, c)]));
  codes.sort((a, b) =>
    (labelByCode.get(a) || "").localeCompare(labelByCode.get(b) || "", undefined, {
      sensitivity: "base",
    }),
  );
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

/**
 * @param {{ preferSource?: string, preferTarget?: string }} [opts] - values from the UI before a rebuild (beats stale storage during sync.set races)
 * @returns {Promise<void>}
 */
function applyLanguageValuesFromStorage(opts = {}) {
  if (!lastLanguages || !sourceLangEl || !targetLangEl) return Promise.resolve();
  const preferSource = typeof opts.preferSource === "string" ? opts.preferSource : "";
  const preferTarget = typeof opts.preferTarget === "string" ? opts.preferTarget.trim() : "";
  return new Promise((resolve) => {
    chrome.storage.sync.get(["sourceLang", "targetLang"], (stored) => {
      const merged = { ...defaultSettings, ...stored };
      const fromStorage =
        merged.sourceLang && merged.sourceLang !== "" ? merged.sourceLang : "auto";
      const rawTarget = typeof merged.targetLang === "string" ? merged.targetLang.trim() : "";
      const optionValues = [...sourceLangEl.options].map((o) => o.value);
      const src = pickSourceLangValue(optionValues, preferSource, fromStorage);
      sourceLangEl.value = src;
      const preferredTarget = preferTarget || rawTarget;
      void (async () => {
        const primaryHint = await getHtmlLangPrimaryForActiveTab();
        await rebuildTargetSelect(lastLanguages, sourceLangEl.value, preferredTarget, primaryHint);
        await refreshAutoSourceLabel(primaryHint);
        resolve();
      })();
    });
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
    const preferSource = sourceLangEl ? sourceLangEl.value : "";
    const preferTarget = targetLangEl ? targetLangEl.value : "";
    const languages = await fetchLanguagesFromSw(raw);
    lastLanguages = languages;
    rebuildSourceSelect(languages);
    await applyLanguageValuesFromStorage({ preferSource, preferTarget });
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
 * When interlinear is on and not loading: show last-run stats when available.
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
  const trimmed = typeof lastSummary === "string" ? lastSummary.trim() : "";
  if (!trimmed) {
    idleHintEl.textContent = "";
    idleHintEl.hidden = true;
    return;
  }
  idleHintEl.hidden = false;
  idleHintEl.textContent = truncatePopupText(trimmed, 320);
}

/**
 * @param {string} [phase]
 */
function formatStatusSub(phase) {
  switch (phase) {
    case "cache":
      return "Loading from cache…";
    case "api_words":
      return "Translating words...";
    case "api_sentences":
      return "Translating sentences...";
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
      return "Loading cached glosses and layout (no network yet).";
    case "api_words":
      return "Requesting missing word glosses from LibreTranslate.";
    case "api_sentences":
      return "Full-sentence lines: cache first, then API.";
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
  if (useCacheEl) useCacheEl.disabled = !!loading || legacyMode;
  if (clearCacheEl) clearCacheEl.disabled = !!loading || legacyMode;
  const effectivePhase = loading && (!phase || phase === "idle") ? "cache" : phase || "idle";
  if (statusLineEl) {
    if (loading) {
      statusLineEl.textContent = truncatePopupText(formatStatusLine(effectivePhase, detail), 300);
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

async function getGlobalPageTranslationOn() {
  const o = await chrome.storage.sync.get(["globalPageTranslation"]);
  return o?.globalPageTranslation === true;
}

function saveLanguagesPartial(patch) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(patch, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

/**
 * Prefer UI selection when still valid (fixes stale sync before storage.write finishes).
 * @param {string[]} optionValues
 * @param {string} prefer
 * @param {string} fromStorage
 */
function pickSourceLangValue(optionValues, prefer, fromStorage) {
  const p = (prefer || "").trim();
  if (p && optionValues.includes(p)) return p;
  const s = (fromStorage || "").trim() || "auto";
  if (optionValues.includes(s)) return s;
  return "auto";
}

/** Apply tab snapshot from session storage or a GET_PAGE_TRANSLATION_STATE response. */
function applyTabStateSnapshot(snap, globalOn = false) {
  if (!snap || typeof snap !== "object") return;
  const loading = !!snap.loading;
  const on = globalOn || !!(snap.toggleOn ?? snap.enabled ?? loading);
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

async function applySessionSnapshotForTab(tabId, globalOn) {
  if (tabId == null) return;
  if (!chrome.storage.session) return;
  try {
    const key = `vit_tab_${tabId}`;
    const obj = await chrome.storage.session.get(key);
    const snap = obj[key];
    applyTabStateSnapshot(snap, globalOn);
  } catch {
    /* session storage may be unavailable */
  }
}

function syncToggleFromTab() {
  return new Promise((resolve) => {
    void (async () => {
      setPopupError("");
      const tab = await getActiveTab();
      const globalOn = await getGlobalPageTranslationOn();
      if (!tab?.id || isRestrictedUrl(tab.url || "")) {
        setLoading(false);
        setSubtext(globalOn);
        if (toggleEl) {
          toggleEl.checked = globalOn;
          toggleEl.disabled = true;
        }
        if (idleHintEl) idleHintEl.hidden = true;
        resolve();
        return;
      }
      await applySessionSnapshotForTab(tab.id, globalOn);
      chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_TRANSLATION_STATE" }, (res) => {
        if (chrome.runtime.lastError) {
          applyTabStateSnapshot({ toggleOn: globalOn, enabled: false, loading: false }, globalOn);
          resolve();
          return;
        }
        applyTabStateSnapshot(res, globalOn);
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
    useCacheEl.checked = legacyMode ? false : merged.useTranslationCache !== false;
  }
  applyLegacyCacheUi();
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
  if (legacyMode) return;
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
  const prev = targetLangEl?.value || "";
  void (async () => {
    const v = (sourceLangEl.value || "auto").trim();
    const primaryHint = await getHtmlLangPrimaryForActiveTab();
    await rebuildTargetSelect(lastLanguages, v, prev, primaryHint);
    await refreshAutoSourceLabel(primaryHint);
    const still = targetLangEl?.value?.trim() || "";
    await saveLanguagesPartial({ sourceLang: v, targetLang: still });
  })();
});

targetLangEl?.addEventListener("change", () => {
  setPopupError("");
  const v = targetLangEl.value.trim();
  void saveLanguagesPartial({ targetLang: v });
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
  void (async () => {
    await saveLanguagesPartial(patch);
    await applyLanguageValuesFromStorage();
  })();
});

void (async () => {
  await loadSettingsIntoForm();
  await syncToggleFromTab();
})();

if (chrome.storage.session?.onChanged) {
  chrome.storage.session.onChanged.addListener((changes, areaName) => {
    if (areaName !== "session") return;
    void (async () => {
      const tab = await getActiveTab();
      if (!tab?.id) return;
      const key = `vit_tab_${tab.id}`;
      const ch = changes[key];
      if (!ch?.newValue) return;
      const globalOn = await getGlobalPageTranslationOn();
      applyTabStateSnapshot(ch.newValue, globalOn);
    })();
  });
}

chrome.storage.sync.onChanged.addListener((changes) => {
  if (!changes.globalPageTranslation) return;
  void (async () => {
    const globalOn = await getGlobalPageTranslationOn();
    const tab = await getActiveTab();
    if (!tab?.id || isRestrictedUrl(tab.url || "")) {
      setSubtext(globalOn);
      if (toggleEl) toggleEl.checked = globalOn;
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_TRANSLATION_STATE" }, (res) => {
      if (chrome.runtime.lastError) return;
      applyTabStateSnapshot(res, globalOn);
    });
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
    await saveLanguagesPartial({ globalPageTranslation: false });
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
