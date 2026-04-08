/**
 * Tabs that never got manifest content scripts (opened before install/update, or after
 * an extension reload) have no `chrome.runtime` listener until we inject programmatically.
 */

/**
 * @returns {boolean}
 */
function isNoContentScriptReceiverError() {
  const m = chrome.runtime.lastError?.message || "";
  return /Receiving end does not exist|Could not establish connection/i.test(m);
}

/**
 * Pings the tab; if nothing responds with the usual "no receiver" error, injects
 * `content/content.css` and `content/content.js` so messaging works without a refresh.
 *
 * @param {number} tabId
 * @returns {Promise<boolean>} true if the tab should accept messages (already had script or inject succeeded)
 */
export async function ensureVitContentScript(tabId) {
  const probe = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_TRANSLATION_STATE" }, () => {
      const err = chrome.runtime.lastError;
      if (!err) {
        resolve({ ready: true });
        return;
      }
      resolve({
        ready: false,
        inject: isNoContentScriptReceiverError(),
      });
    });
  });

  if (probe.ready) return true;
  if (!probe.inject) return false;

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content/content.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content.js"],
    });
  } catch (e) {
    console.warn("[Verbatim] ensureVitContentScript:", e);
    return false;
  }
  return true;
}
