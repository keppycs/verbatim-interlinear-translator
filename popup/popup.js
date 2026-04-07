const subEl = document.getElementById("toggleSub");
const toggleEl = document.getElementById("pageToggle");

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
  const tab = await getActiveTab();
  if (!tab?.id || isRestrictedUrl(tab.url || "")) {
    toggleEl.checked = false;
    return;
  }
  const wantOn = toggleEl.checked;
  chrome.tabs.sendMessage(tab.id, { type: "SET_PAGE_TRANSLATION", enabled: wantOn }, (res) => {
    if (chrome.runtime.lastError) {
      toggleEl.checked = !wantOn;
      return;
    }
    if (res?.ok === false) {
      toggleEl.checked = false;
      setSubtext(false);
      return;
    }
    setSubtext(!!res?.enabled);
  });
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncToggleFromTab();
});

syncToggleFromTab();
