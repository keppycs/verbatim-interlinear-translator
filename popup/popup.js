const subEl = document.getElementById("toggleSub");
const toggleEl = document.getElementById("pageToggle");
const errorEl = document.getElementById("popupError");

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
  if (typeof e === "string") return e;
  return "Something went wrong.";
}

function setSubtext(enabled) {
  if (subEl) {
    subEl.textContent = enabled ? "On — whole page" : "Off";
  }
  if (toggleEl) toggleEl.checked = !!enabled;
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

async function syncToggleFromTab() {
  setPopupError("");
  const tab = await getActiveTab();
  if (!tab?.id || isRestrictedUrl(tab.url || "")) {
    setSubtext(false);
    if (toggleEl) toggleEl.disabled = true;
    return;
  }
  if (toggleEl) toggleEl.disabled = false;
  chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_TRANSLATION_STATE" }, (res) => {
    if (chrome.runtime.lastError) {
      setSubtext(false);
      if (toggleEl) toggleEl.checked = false;
      return;
    }
    setSubtext(!!res?.enabled);
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

toggleEl.addEventListener("change", async () => {
  setPopupError("");
  const tab = await getActiveTab();
  if (!tab?.id || isRestrictedUrl(tab.url || "")) {
    toggleEl.checked = false;
    setPopupError("This page does not allow extensions. Try a normal website.");
    return;
  }
  const wantOn = toggleEl.checked;
  chrome.tabs.sendMessage(tab.id, { type: "SET_PAGE_TRANSLATION", enabled: wantOn }, (res) => {
    if (chrome.runtime.lastError) {
      toggleEl.checked = !wantOn;
      setPopupError(chrome.runtime.lastError.message);
      return;
    }
    if (res?.ok === false) {
      toggleEl.checked = false;
      setSubtext(false);
      setPopupError(formatToggleError(res));
      return;
    }
    setPopupError("");
    setSubtext(!!res?.enabled);
  });
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncToggleFromTab();
});

syncToggleFromTab();
