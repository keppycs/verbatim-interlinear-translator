import { translateWithSettings } from "../lib/translation/resolve.js";
import { defaultSettings } from "../lib/defaultSettings.js";

function mergeSettings(stored) {
  return { ...defaultSettings, ...stored };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(null, (stored) => {
    const patch = {};
    for (const key of Object.keys(defaultSettings)) {
      if (stored[key] === undefined) patch[key] = defaultSettings[key];
    }
    if (Object.keys(patch).length) chrome.storage.sync.set(patch);
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
