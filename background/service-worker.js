import { translateWithSettings } from "../lib/translation/resolve.js";
import { defaultSettings } from "../lib/defaultSettings.js";

function mergeSettings(stored) {
  return { ...defaultSettings, ...stored };
}

function ensureContextMenu() {
  chrome.contextMenus.create(
    {
      id: "vit-translate-selection",
      title: "Verbatim interlinear translate",
      contexts: ["selection"],
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
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
  if (info.menuItemId !== "vit-translate-selection" || tab?.id == null) return;
  chrome.tabs.sendMessage(tab.id, { type: "APPLY_INTERLINEAR" });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "translate-selection") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const id = tabs[0]?.id;
    if (id != null) chrome.tabs.sendMessage(id, { type: "APPLY_INTERLINEAR" });
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
