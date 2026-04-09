import { defaultSettings } from "../lib/defaultSettings.js";
import { stripLibreTranslateHostForStorage } from "../lib/translation/normalizeServiceUrl.js";
import { toLibreStyleLang } from "../lib/translation/libreStyleLang.js";
import { isLegacyCompat } from "../lib/compat.js";
import { ensureVitContentScript } from "../lib/ensureVitContentScript.js";
import { mountCustomSelect } from "./customSelect.js";

/** Browsers without `chrome.storage.session` - translation cache is forced off in the service worker. */
const legacyMode = isLegacyCompat();

const subEl = document.getElementById("toggleSub");

const toggleEl = document.getElementById("pageToggle");
const loadingEl = document.getElementById("toggleLoading");
const sourceLangEl = document.getElementById("sourceLang");
const targetLangEl = document.getElementById("targetLang");
const baseUrlEl = document.getElementById("libreTranslateBaseUrl");
const libreUrlTestBtn = document.getElementById("libreUrlTestBtn");
const swapLangEl = document.getElementById("swapLang");
const useCacheEl = document.getElementById("useTranslationCache");
const syncPageTranslationAcrossTabsEl = document.getElementById("syncPageTranslationAcrossTabs");
const clearCacheEl = document.getElementById("clearTranslationCache");
const legacyCacheHintEl = document.getElementById("legacyCacheHint");

const NO_BACKEND_MESSAGE = "Set your LibreTranslate URL above.";

let resyncSourceSelectUi = () => {};
let resyncTargetSelectUi = () => {};
if (sourceLangEl) resyncSourceSelectUi = mountCustomSelect(sourceLangEl);
if (targetLangEl) resyncTargetSelectUi = mountCustomSelect(targetLangEl);

function resyncLanguageSelectUis() {
  resyncSourceSelectUi();
  resyncTargetSelectUi();
}

const NO_TARGET_MESSAGE = "Choose a target language before translating";
const NO_SOURCE_MESSAGE = "Choose a source language before translating";

/** Popup has no scrollbars; keep strings short so they fit clipped message areas. */
const POPUP_TEXT_SOFT_CAP = 420;

/** Page toast can show a bit more than inline popup text. */
const TOAST_TEXT_MAX = 900;

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
/** @type {ReturnType<typeof setTimeout> | null} */
let libreUrlTestResetTimer = null;

/**
 * Injected when `tabs.sendMessage` fails (content script not ready / no receiver).
 * Must be self-contained - serialized into the tab by `scripting.executeScript`.
 * Keep in sync with `showToast` in content/content.js (enter → timer → exit).
 * @param {string} toastText
 */
function injectVitToast(toastText) {
  const PROGRESS_MS = 4500;
  const ENTER_MS = 300;
  const EXIT_MS = 300;
  const id = "vit-lang-toast";
  let root = document.getElementById(id);
  if (!root) {
    root = document.createElement("div");
    root.id = id;
    root.setAttribute("role", "status");
    (document.body || document.documentElement).appendChild(root);
  }
  const t = /** @type {any} */ (root)._vitHide;
  if (t) clearTimeout(t);
  /** @type {any} */ (root)._vitHide = null;
  for (const k of ["_vitEnter", "_vitAnim", "_vitExit", "_vitIdleAnim"]) {
    const a = /** @type {any} */ (root)[k];
    if (a && typeof a.cancel === "function") {
      try {
        a.cancel();
      } catch {
        /* ignore */
      }
    }
    /** @type {any} */ (root)[k] = null;
  }

  root.replaceChildren();

  const shell = document.createElement("div");
  shell.style.cssText = [
    "overflow:hidden",
    "border-radius:20px",
    "max-width:min(96vw,700px)",
    "min-width:min(96vw,340px)",
    "background:linear-gradient(165deg,#34312c 0%,#262320 42%,#181614 100%)",
    "border:1px solid rgba(255,153,51,0.55)",
    "box-shadow:0 22px 64px rgba(0,0,0,.58),0 0 0 1px rgba(255,153,51,0.14),0 0 48px rgba(255,153,51,0.24)",
    "pointer-events:auto",
    "cursor:default",
    "will-change:transform,opacity",
  ].join(";");

  const msgEl = document.createElement("div");
  msgEl.textContent = toastText;
  msgEl.style.cssText = [
    "padding:24px 32px 18px",
    "font:19px/1.55 system-ui,Segoe UI,sans-serif",
    "color:#f4f0eb",
    "text-shadow:0 1px 2px rgba(0,0,0,0.4)",
  ].join(";");

  const track = document.createElement("div");
  track.style.cssText = "position:relative;height:7px;background:rgba(0,0,0,0.4);overflow:hidden;";

  const bar = document.createElement("div");
  bar.style.cssText = [
    "height:100%",
    "width:100%",
    "transform-origin:0 50%",
    "background:linear-gradient(90deg,#ffb04d,#ff9933,#e07a18)",
    "box-shadow:0 0 16px rgba(255,153,51,0.7)",
  ].join(";");

  track.appendChild(bar);
  shell.appendChild(msgEl);
  shell.appendChild(track);
  root.appendChild(shell);

  root.style.cssText = [
    "position:fixed",
    "top:12px",
    "left:50%",
    "transform:translateX(-50%)",
    "z-index:2147483646",
  ].join(";");

  root.removeAttribute("hidden");

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const finishHide = () => {
    root.hidden = true;
  };

  /** Mirrors `vitToastAttachHover` in content/content.js (inlined for executeScript). */
  function attachVitToastHover(shellEl, barEl, barAnim, rootEl, reducedMotion) {
    let idleAnim = null;
    const stopIdle = () => {
      if (idleAnim) {
        try {
          idleAnim.cancel();
        } catch {
          /* ignore */
        }
        idleAnim = null;
      }
      /** @type {any} */ (rootEl)._vitIdleAnim = null;
      barEl.style.boxShadow = "";
      barEl.style.filter = "";
    };
    const startIdle = () => {
      stopIdle();
      if (reducedMotion) {
        idleAnim = barEl.animate(
          [
            { boxShadow: "0 0 8px rgba(255,153,51,0.35)" },
            { boxShadow: "0 0 18px rgba(255,153,51,0.75)" },
            { boxShadow: "0 0 8px rgba(255,153,51,0.35)" },
          ],
          { duration: 1600, iterations: Infinity, easing: "ease-in-out" },
        );
      } else {
        idleAnim = barEl.animate(
          [
            { boxShadow: "0 0 10px rgba(255,153,51,0.45)", filter: "brightness(1)" },
            { boxShadow: "0 0 26px rgba(255,153,51,0.95)", filter: "brightness(1.12)" },
            { boxShadow: "0 0 10px rgba(255,153,51,0.45)", filter: "brightness(1)" },
          ],
          { duration: 1500, iterations: Infinity, easing: "ease-in-out" },
        );
      }
      /** @type {any} */ (rootEl)._vitIdleAnim = idleAnim;
    };
    shellEl.addEventListener("pointerenter", () => {
      if (barAnim.playState === "finished") return;
      try {
        barAnim.pause();
      } catch {
        /* ignore */
      }
      startIdle();
    });
    shellEl.addEventListener("pointerleave", () => {
      stopIdle();
      if (barAnim.playState === "finished") return;
      try {
        barAnim.play();
      } catch {
        /* ignore */
      }
    });
  }

  try {
    if (reduced) {
      shell.style.opacity = "1";
      bar.style.opacity = "0.85";
      const barAnim = bar.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
        duration: PROGRESS_MS,
        easing: "linear",
        fill: "forwards",
      });
      /** @type {any} */ (root)._vitAnim = barAnim;
      attachVitToastHover(shell, bar, barAnim, root, true);
      void barAnim.finished
        .then(() => {
          const fade = shell.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: 180,
            easing: "ease-out",
            fill: "forwards",
          });
          /** @type {any} */ (root)._vitExit = fade;
          return fade.finished;
        })
        .then(finishHide)
        .catch(() => {});
      return;
    }

    const enter = shell.animate(
      [
        {
          transform: "translateY(-44px) scale(0.92)",
          opacity: 0,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        },
        {
          transform: "translateY(4px) scale(1.015)",
          opacity: 1,
          offset: 0.58,
          easing: "cubic-bezier(0.33, 1, 0.68, 1)",
        },
        {
          transform: "translateY(-2px) scale(0.998)",
          opacity: 1,
          offset: 0.82,
          easing: "cubic-bezier(0.33, 1, 0.68, 1)",
        },
        { transform: "translateY(0) scale(1)", opacity: 1, offset: 1 },
      ],
      { duration: ENTER_MS, fill: "both" },
    );
    /** @type {any} */ (root)._vitEnter = enter;

    void enter.finished
      .then(() => {
        const barAnim = bar.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
          duration: PROGRESS_MS,
          easing: "linear",
          fill: "forwards",
        });
        /** @type {any} */ (root)._vitAnim = barAnim;
        attachVitToastHover(shell, bar, barAnim, root, false);
        return barAnim.finished;
      })
      .then(() => {
        const exit = shell.animate(
          [
            {
              transform: "translateY(0) scale(1)",
              opacity: 1,
              easing: "cubic-bezier(0.33, 1, 0.68, 1)",
            },
            {
              transform: "translateY(-2px) scale(0.998)",
              opacity: 1,
              offset: 0.18,
              easing: "cubic-bezier(0.33, 1, 0.68, 1)",
            },
            {
              transform: "translateY(4px) scale(1.015)",
              opacity: 1,
              offset: 0.4,
              easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            },
            { transform: "translateY(-44px) scale(0.92)", opacity: 0, offset: 1 },
          ],
          { duration: EXIT_MS, fill: "forwards" },
        );
        /** @type {any} */ (root)._vitExit = exit;
        return exit.finished;
      })
      .then(finishHide)
      .catch(() => {});
  } catch {
    /** @type {any} */ (root)._vitHide = setTimeout(finishHide, ENTER_MS + PROGRESS_MS + EXIT_MS);
  }
}

/**
 * Same visual as API errors on the page: fixed toast bar (see content `showToast`).
 * Tries messaging the content script first; falls back to `scripting.executeScript` when
 * the receiver is missing (common right after navigation or before `document_idle`).
 */
async function toastOnActiveTab(text) {
  const msg = truncatePopupText(String(text || "").trim(), TOAST_TEXT_MAX);
  if (!msg) return;
  let tab;
  try {
    tab = await getActiveTab();
  } catch (e) {
    console.warn("[Verbatim] toast:", e);
    return;
  }
  if (!tab?.id || isRestrictedUrl(tab.url || "")) return;

  const delivered = await new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tab.id, { type: "VIT_TOAST", message: msg }, () => {
        if (chrome.runtime.lastError) resolve(false);
        else resolve(true);
      });
    } catch {
      resolve(false);
    }
  });

  if (delivered) return;

  const ok = await ensureVitContentScript(tab.id);
  if (ok) {
    const delivered2 = await new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tab.id, { type: "VIT_TOAST", message: msg }, () => {
          if (chrome.runtime.lastError) resolve(false);
          else resolve(true);
        });
      } catch {
        resolve(false);
      }
    });
    if (delivered2) return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectVitToast,
      args: [msg],
    });
  } catch (e) {
    console.warn("[Verbatim] toast inject failed:", e);
  }
}

function setPopupError(text) {
  if (!text) return;
  void toastOnActiveTab(text);
}

function setLanguagesError(text) {
  if (!text) return;
  void toastOnActiveTab(text);
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

function formatToggleError(res) {
  if (res?.message) return res.message;
  const e = res?.error;
  if (e === "translation_mismatch") return "Translation could not be completed. Try again.";
  if (e === "no_target_language") return NO_TARGET_MESSAGE;
  if (e === "no_source_language") return NO_SOURCE_MESSAGE;
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
    subEl.textContent = enabled ? "Translation done" : "Translation off";
  }
  if (toggleEl) toggleEl.checked = !!enabled;
}

/**
 * Match a LibreTranslate `/languages` row by code (handles zh vs zh-CN style mismatches).
 * Prefer exact `row.code` first - otherwise `zh` can win before `zh-CN` and you get the wrong `targets` list.
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
 * Order: empty “Select language”, then `auto`, then fixed codes (see defaultSettings.sourceLang).
 * @param {Array<{ code: string; name: string; targets: string[] }>} languages
 */
function rebuildSourceSelect(languages) {
  if (!sourceLangEl) return;
  sourceLangEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select language";
  sourceLangEl.appendChild(placeholder);
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
  resyncSourceSelectUi();
}

function setAutoSourceOptionLabel(text) {
  const opt = sourceLangEl?.querySelector('option[value="auto"]');
  if (opt) opt.textContent = text;
  resyncSourceSelectUi();
}

/**
 * Primary language subtag from the active tab’s &lt;html lang&gt; (same signal as translation uses for Auto).
 * @returns {Promise<string | null>}
 */
async function getHtmlLangPrimaryForActiveTab() {
  const tab = await getActiveTab();
  if (!tab?.id || isRestrictedUrl(tab.url || "")) return null;
  const ready = await ensureVitContentScript(tab.id);
  if (!ready) return null;
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
 * Uses the same rule as fixed source options: if Libre lists no non-self targets for that code,
 * the resolved “Auto” source cannot translate - show that explicitly instead of “Auto (Italian)”.
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
  const canUseAsSource = fixedSourceHasNonSelfTarget(lastLanguages, primary);
  setAutoSourceOptionLabel(canUseAsSource ? `Auto (${name})` : `Auto (${name} - unsupported)`);
}

/**
 * Target options: placeholder first, then only that source row’s `targets` (no global union).
 * For `auto`, the concrete source is the active tab’s &lt;html lang&gt; primary (same as content script).
 * @param {Array<{ code: string; name: string; targets: string[] }>} languages
 * @param {string} sourceValue - "", "auto", or a fixed source code (must match the source &lt;select&gt; value)
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
  const src = (sourceValue ?? "").trim();
  if (!src) {
    targetLangEl.value = "";
    resyncTargetSelectUi();
    return;
  }
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
  resyncTargetSelectUi();
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
        typeof merged.sourceLang === "string"
          ? merged.sourceLang.trim()
          : defaultSettings.sourceLang;
      const rawTarget = typeof merged.targetLang === "string" ? merged.targetLang.trim() : "";
      const optionValues = [...sourceLangEl.options].map((o) => o.value);
      const preferredTarget = preferTarget || rawTarget;
      void (async () => {
        const primaryHint = await getHtmlLangPrimaryForActiveTab();
        const src = pickSourceLangValue(optionValues, preferSource, fromStorage, primaryHint);
        sourceLangEl.value = src;
        resyncSourceSelectUi();
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
    resyncLanguageSelectUis();
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
    resyncLanguageSelectUis();
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
    resyncLanguageSelectUis();
  }
}

function clearLibreUrlTestResetTimer() {
  if (libreUrlTestResetTimer != null) {
    clearTimeout(libreUrlTestResetTimer);
    libreUrlTestResetTimer = null;
  }
}

/**
 * @param {"idle" | "loading" | "success" | "error"} state
 */
function setLibreUrlTestState(state) {
  if (!libreUrlTestBtn) return;
  libreUrlTestBtn.dataset.state = state;
  libreUrlTestBtn.disabled = state === "loading";
  libreUrlTestBtn.setAttribute("aria-busy", state === "loading" ? "true" : "false");
}

function maybeResetLibreUrlTestAfterUrlEdit() {
  const s = libreUrlTestBtn?.dataset.state;
  if (s === "success" || s === "error") {
    clearLibreUrlTestResetTimer();
    setLibreUrlTestState("idle");
  }
}

async function runLibreUrlConnectionTest() {
  if (!libreUrlTestBtn || !baseUrlEl) return;
  const raw = (baseUrlEl.value || "").trim();
  if (!raw) {
    setLanguagesError("Enter a LibreTranslate host first.");
    clearLibreUrlTestResetTimer();
    setLibreUrlTestState("error");
    libreUrlTestResetTimer = setTimeout(() => setLibreUrlTestState("idle"), 1500);
    return;
  }
  clearLibreUrlTestResetTimer();
  setLibreUrlTestState("loading");
  try {
    await fetchLanguagesFromSw(raw);
    setLibreUrlTestState("success");
    libreUrlTestResetTimer = setTimeout(() => setLibreUrlTestState("idle"), 2400);
    await refreshLanguagesUi();
  } catch (e) {
    setLibreUrlTestState("error");
    setLanguagesError(e?.message || String(e));
    libreUrlTestResetTimer = setTimeout(() => setLibreUrlTestState("idle"), 1700);
  }
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
  if (loading && subEl) {
    subEl.textContent = formatStatusSub(effectivePhase);
  }
  if (loading) {
    startTabStatePoll();
  } else {
    stopTabStatePoll();
  }
  resyncLanguageSelectUis();
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
  const o = await chrome.storage.sync.get([
    "syncPageTranslationAcrossTabs",
    "globalPageTranslation",
  ]);
  return o?.syncPageTranslationAcrossTabs === true && o?.globalPageTranslation === true;
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
 * When storage is `auto` but the tab has no usable &lt;html lang&gt;, show empty (Select language).
 * @param {string[]} optionValues
 * @param {string} prefer
 * @param {string} fromStorage
 * @param {string | null} primaryHint - primary subtag from the active tab (null = none)
 */
function pickSourceLangValue(optionValues, prefer, fromStorage, primaryHint) {
  const p = (prefer || "").trim();
  if (p && optionValues.includes(p)) return p;
  const s = (fromStorage || "").trim();
  if (s && s !== "auto" && optionValues.includes(s)) return s;
  if (s === "" && optionValues.includes("")) return "";
  if (s === "auto") {
    if (!primaryHint) return optionValues.includes("") ? "" : "auto";
    return optionValues.includes("auto") ? "auto" : "";
  }
  if (optionValues.includes("")) return "";
  if (optionValues.includes("auto")) return "auto";
  return optionValues[0] ?? "";
}

/** Apply tab snapshot from session storage or a GET_PAGE_TRANSLATION_STATE response. */
function applyTabStateSnapshot(snap, globalOn = false) {
  if (!snap || typeof snap !== "object") return;
  const loading = !!snap.loading;
  const on = globalOn || !!(snap.toggleOn ?? snap.enabled ?? loading);
  const phase = typeof snap.statusPhase === "string" ? snap.statusPhase : "idle";
  const detail = snap.statusDetail != null ? String(snap.statusDetail) : null;
  if (loading) {
    setLoading(true, phase, detail);
  } else {
    setLoading(false, "idle", null);
    if (toggleEl) toggleEl.disabled = false;
  }
  if (toggleEl) toggleEl.checked = on;
  if (subEl && !loading) {
    subEl.textContent = on ? "Translation done" : "Translation off";
  }
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
        resolve();
        return;
      }
      await applySessionSnapshotForTab(tab.id, globalOn);
      const ready = await ensureVitContentScript(tab.id);
      if (!ready) {
        applyTabStateSnapshot({ toggleOn: globalOn, enabled: false, loading: false }, globalOn);
        resolve();
        return;
      }
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
    return;
  }
  toggleEl.checked = !wantOn;
  setSubtext(!wantOn);
  setPopupError(formatToggleError(res));
}

async function loadSettingsIntoForm() {
  const stored = await chrome.storage.sync.get(null);
  const merged = { ...defaultSettings, ...stored };
  if (baseUrlEl) {
    baseUrlEl.value = stripLibreTranslateHostForStorage(merged.libreTranslateBaseUrl || "");
  }
  if (useCacheEl) {
    useCacheEl.checked = legacyMode ? false : merged.useTranslationCache !== false;
  }
  if (syncPageTranslationAcrossTabsEl) {
    syncPageTranslationAcrossTabsEl.checked = merged.syncPageTranslationAcrossTabs === true;
  }
  applyLegacyCacheUi();
  await refreshLanguagesUi();
}

baseUrlEl?.addEventListener("input", () => {
  maybeResetLibreUrlTestAfterUrlEdit();
  clearTimeout(baseUrlDebounceTimer);
  baseUrlDebounceTimer = setTimeout(() => {
    const v = stripLibreTranslateHostForStorage(baseUrlEl.value);
    chrome.storage.sync.set({ libreTranslateBaseUrl: v }, () => void refreshLanguagesUi());
  }, 400);
});

baseUrlEl?.addEventListener("blur", () => {
  maybeResetLibreUrlTestAfterUrlEdit();
  const v = stripLibreTranslateHostForStorage(baseUrlEl.value);
  baseUrlEl.value = v;
  chrome.storage.sync.set({ libreTranslateBaseUrl: v }, () => void refreshLanguagesUi());
});

libreUrlTestBtn?.addEventListener("click", () => {
  void runLibreUrlConnectionTest();
});

useCacheEl?.addEventListener("change", () => {
  if (legacyMode) return;
  chrome.storage.sync.set({ useTranslationCache: !!useCacheEl.checked });
});

clearCacheEl?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_TRANSLATION_CACHE" }, (res) => {
    if (chrome.runtime.lastError) {
      void toastOnActiveTab(chrome.runtime.lastError.message || "Could not clear cache.");
      return;
    }
    if (res?.ok) {
      void toastOnActiveTab("Translation cache cleared.");
    } else {
      void toastOnActiveTab(res?.error || "Could not clear cache.");
    }
  });
});

sourceLangEl?.addEventListener("change", () => {
  if (!lastLanguages) return;
  setPopupError("");
  const prev = targetLangEl?.value || "";
  void (async () => {
    const v = sourceLangEl.value.trim();
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
  const src = sourceLangEl.value.trim();
  const tgt = targetLangEl.value.trim();
  if (!tgt || src === "") return;
  void (async () => {
    let patch;
    if (src === "auto") {
      const primaryHint = await getHtmlLangPrimaryForActiveTab();
      const canUse =
        primaryHint && fixedSourceHasNonSelfTarget(lastLanguages, primaryHint);
      const row = primaryHint ? findLanguageRow(lastLanguages, primaryHint) : null;
      const concrete = row?.code || primaryHint || "";
      if (canUse && concrete) {
        patch = { sourceLang: tgt, targetLang: concrete };
      } else {
        patch = { sourceLang: tgt, targetLang: "" };
      }
    } else {
      patch = { sourceLang: tgt, targetLang: src };
    }
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
  if (!changes.globalPageTranslation && !changes.syncPageTranslationAcrossTabs) return;
  void (async () => {
    const globalOn = await getGlobalPageTranslationOn();
    const tab = await getActiveTab();
    if (!tab?.id || isRestrictedUrl(tab.url || "")) {
      setSubtext(globalOn);
      if (toggleEl) toggleEl.checked = globalOn;
      return;
    }
    const ready = await ensureVitContentScript(tab.id);
    if (!ready) return;
    chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_TRANSLATION_STATE" }, (res) => {
      if (chrome.runtime.lastError) return;
      applyTabStateSnapshot(res, globalOn);
    });
  })();
});

syncPageTranslationAcrossTabsEl?.addEventListener("change", () => {
  const on = !!syncPageTranslationAcrossTabsEl.checked;
  void (async () => {
    if (!on) {
      await saveLanguagesPartial({
        syncPageTranslationAcrossTabs: false,
        globalPageTranslation: false,
      });
      await syncToggleFromTab();
      return;
    }
    const tab = await getActiveTab();
    let interlinearOn = false;
    if (tab?.id && !isRestrictedUrl(tab.url || "")) {
      const ready = await ensureVitContentScript(tab.id);
      if (ready) {
        interlinearOn = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_TRANSLATION_STATE" }, (res) => {
            if (chrome.runtime.lastError) {
              resolve(false);
              return;
            }
            resolve(!!(res?.toggleOn ?? res?.enabled));
          });
        });
      }
    }
    await saveLanguagesPartial({
      syncPageTranslationAcrossTabs: true,
      globalPageTranslation: interlinearOn,
    });
    await syncToggleFromTab();
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
    const syncSnap = await chrome.storage.sync.get(["syncPageTranslationAcrossTabs"]);
    if (syncSnap?.syncPageTranslationAcrossTabs === true) {
      await saveLanguagesPartial({ globalPageTranslation: false });
    }
    const readyOff = await ensureVitContentScript(tab.id);
    if (!readyOff) {
      toggleEl.checked = true;
      setSubtext(true);
      setPopupError("Could not connect to this page. Try refreshing it.");
      return;
    }
    sendSetPage();
    return;
  }

  const langSnap = await chrome.storage.sync.get(["targetLang", "sourceLang"]);
  const target = (langSnap.targetLang ?? "").trim();
  if (!target) {
    toggleEl.checked = false;
    setSubtext(false);
    setPopupError(NO_TARGET_MESSAGE);
    return;
  }
  const sourceRaw = (langSnap.sourceLang ?? "").trim();
  if (!sourceRaw) {
    toggleEl.checked = false;
    setSubtext(false);
    setPopupError(NO_SOURCE_MESSAGE);
    return;
  }
  if (sourceRaw === "auto") {
    const primary = await getHtmlLangPrimaryForActiveTab();
    if (!primary) {
      toggleEl.checked = false;
      setSubtext(false);
      setPopupError(formatToggleError({ error: "no_page_lang" }));
      return;
    }
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
  const readyOn = await ensureVitContentScript(tab.id);
  if (!readyOn) {
    setLoading(false);
    toggleEl.checked = false;
    setSubtext(false);
    setPopupError("Could not connect to this page. Try refreshing it.");
    return;
  }
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
