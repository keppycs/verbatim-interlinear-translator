import { translateWithSettings, hasConfiguredTranslationBackend } from "../lib/translation/resolve.js";
import { defaultSettings } from "../lib/defaultSettings.js";

function mergeSettings(stored) {
  return { ...defaultSettings, ...stored };
}

function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      {
        id: "vit-toggle-page",
        title: "Toggle Verbatim interlinear (whole page)",
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "TRANSLATION_BACKEND_READY") {
    chrome.storage.sync.get(null, (stored) => {
      try {
        const settings = mergeSettings(stored);
        const ok = hasConfiguredTranslationBackend(settings) === true;
        sendResponse({ ok });
      } catch {
        sendResponse({ ok: false });
      }
    });
    return true;
  }
  if (msg?.type !== "TRANSLATE") return undefined;
  chrome.storage.sync.get(null, async (stored) => {
    const settings = mergeSettings(stored);
    const result = await translateWithSettings(
      settings,
      msg.texts || [],
      msg.sourceLang ?? settings.sourceLang,
      msg.targetLang ?? settings.targetLang
    );
    sendResponse(result);
  });
  return true;
});
