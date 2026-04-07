import { LANGUAGE_OPTIONS } from "../lib/languageOptions.js";
import { defaultSettings } from "../lib/defaultSettings.js";

const subEl = document.getElementById("toggleSub");
const toggleEl = document.getElementById("pageToggle");
const loadingEl = document.getElementById("toggleLoading");
const errorEl = document.getElementById("popupError");
const sourceLangEl = document.getElementById("sourceLang");
const targetLangEl = document.getElementById("targetLang");

const NO_BACKEND_MESSAGE =
  "Add at least one translation API in Options — use “Options & API keys” below.";

const NO_TARGET_MESSAGE = "Choose a target language above before turning interlinear mode on.";

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
    subEl.textContent = enabled ? "On — whole page" : "Off";
  }
  if (toggleEl) toggleEl.checked = !!enabled;
}

/** Disables controls and shows spinner while the content script is translating. */
function setLoading(loading) {
  if (loadingEl) loadingEl.hidden = !loading;
  if (toggleEl) toggleEl.disabled = !!loading;
  if (sourceLangEl) sourceLangEl.disabled = !!loading;
  if (targetLangEl) targetLangEl.disabled = !!loading;
  if (loading && subEl) {
    subEl.textContent = "Translating…";
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

async function syncToggleFromTab() {
  setPopupError("");
  const tab = await getActiveTab();
  if (!tab?.id || isRestrictedUrl(tab.url || "")) {
    setLoading(false);
    setSubtext(false);
    if (toggleEl) toggleEl.disabled = true;
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_TRANSLATION_STATE" }, (res) => {
    if (chrome.runtime.lastError) {
      setLoading(false);
      setSubtext(false);
      if (toggleEl) {
        toggleEl.checked = false;
        toggleEl.disabled = false;
      }
      return;
    }
    const loading = !!res?.loading;
    const enabled = !!res?.enabled;
    if (loading) {
      setLoading(true);
      if (toggleEl) toggleEl.checked = true;
    } else {
      setLoading(false);
      if (toggleEl) toggleEl.disabled = false;
      setSubtext(enabled);
    }
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
    return;
  }
  toggleEl.checked = !wantOn;
  setSubtext(!wantOn);
  setPopupError(formatToggleError(res));
}

buildLanguageSelects();
syncLangFromStorage();

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
  setLoading(true);
  sendSetPage();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    syncLangFromStorage();
    syncToggleFromTab();
  }
});

syncToggleFromTab();
