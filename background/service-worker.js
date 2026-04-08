import { translateWithCache, probeCacheOnly, clearTranslationCache } from "../lib/translation/cache.js";
import { hasConfiguredTranslationBackend } from "../lib/translation/resolve.js";
import { defaultSettings } from "../lib/defaultSettings.js";
import { normalizeHttpServiceBaseUrl } from "../lib/translation/normalizeServiceUrl.js";
import { fetchLibreLanguages } from "../lib/translation/fetchLibreLanguages.js";
import { isLegacyCompat } from "../lib/compat.js";

function mergeSettings(stored) {
  const m = { ...defaultSettings, ...stored };
  if (isLegacyCompat()) {
    m.useTranslationCache = false;
  }
  return m;
}

/** @type {{ key: string, languages: unknown[] | null }} */
let libreLanguagesMemCache = { key: "", languages: null };

function libreBaseKey(url) {
  const t = typeof url === "string" ? url.trim() : "";
  if (!t) return "";
  return normalizeHttpServiceBaseUrl(t).replace(/\/$/, "");
}

function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      {
        id: "vit-toggle-page",
        title: "Toggle Verbatim interlinear on this page",
        contexts: ["page"],
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  });
}

ensureContextMenu();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(null, (stored) => {
    const patch = {};
    for (const key of Object.keys(defaultSettings)) {
      if (stored[key] === undefined) patch[key] = defaultSettings[key];
    }
    if (Object.keys(patch).length) chrome.storage.sync.set(patch);
  });
  ensureContextMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "vit-toggle-page" || tab?.id == null) return;
  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PAGE_TRANSLATION" });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-page-translation") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const id = tabs[0]?.id;
    if (id != null) chrome.tabs.sendMessage(id, { type: "TOGGLE_PAGE_TRANSLATION" });
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "VIT_STATE_UPDATE" && sender.tab?.id != null) {
    const id = sender.tab.id;
    const s = msg.state ?? {};
    const enabled = !!s.enabled;
    const loading = !!s.loading;
    const toggleOn = !!(s.toggleOn ?? (enabled || loading));
    const statusPhase = typeof s.statusPhase === "string" ? s.statusPhase : "idle";
    const statusDetail = s.statusDetail != null ? String(s.statusDetail) : null;
    if (chrome.storage.session) {
      void chrome.storage.session.set({
        [`vit_tab_${id}`]: {
          enabled,
          loading,
          toggleOn,
          statusPhase,
          statusDetail,
          updatedAt: Date.now(),
        },
      });
    }
    return;
  }

  if (msg?.type === "GET_LIBRE_LANGUAGES") {
    (async () => {
      try {
        const rawUrl = typeof msg.baseUrl === "string" ? msg.baseUrl : "";
        const key = libreBaseKey(rawUrl);
        if (!key) {
          sendResponse({ ok: false, error: "Missing LibreTranslate URL." });
          return;
        }
        if (libreLanguagesMemCache.key === key && libreLanguagesMemCache.languages) {
          sendResponse({ ok: true, languages: libreLanguagesMemCache.languages });
          return;
        }
        const languages = await fetchLibreLanguages(rawUrl);
        libreLanguagesMemCache = { key, languages };
        sendResponse({ ok: true, languages });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "CLEAR_TRANSLATION_CACHE") {
    void (async () => {
      try {
        await clearTranslationCache();
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "TRANSLATE_CACHE_PROBE") {
    (async () => {
      try {
        const stored = await chrome.storage.sync.get(null);
        const settings = mergeSettings(stored);
        if (settings.useTranslationCache === false) {
          const texts = msg.texts || [];
          sendResponse({ translations: texts.map(() => null) });
          return;
        }
        const sourceLang = msg.sourceLang ?? settings.sourceLang;
        const targetLang = String(msg.targetLang ?? settings.targetLang ?? "").trim();
        if (!targetLang) {
          sendResponse({
            error: "no_target_language",
            message: "Choose a target language in the extension toolbar menu.",
          });
          return;
        }
        const { translations } = await probeCacheOnly(msg.texts || [], sourceLang, targetLang);
        sendResponse({ translations });
      } catch (e) {
        sendResponse({ error: "probe_failed", message: e?.message || String(e) });
      }
    })();
    return true;
  }
  if (msg?.type === "TRANSLATION_BACKEND_READY") {
    (async () => {
      try {
        const stored = await chrome.storage.sync.get(null);
        const settings = mergeSettings(stored);
        const ok = hasConfiguredTranslationBackend(settings) === true;
        sendResponse({ ok });
      } catch {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }
  if (msg?.type !== "TRANSLATE") return undefined;
  (async () => {
    const stored = await chrome.storage.sync.get(null);
    const settings = mergeSettings(stored);
    const sourceLang = msg.sourceLang ?? settings.sourceLang;
    const targetLang = String(msg.targetLang ?? settings.targetLang ?? "").trim();
    if (!targetLang) {
      sendResponse({
        error: "no_target_language",
        message: "Choose a target language in the extension toolbar menu.",
      });
      return;
    }
    const result = await translateWithCache(settings, msg.texts || [], sourceLang, targetLang);
    sendResponse(result);
  })();
  return true;
});
