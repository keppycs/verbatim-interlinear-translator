function setPopupStatus(text) {
  const el = document.getElementById("popupStatus");
  if (el) el.textContent = text || "";
}

document.getElementById("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL("options/options.html"));
  }
});

document.getElementById("translateSelection").addEventListener("click", async () => {
  setPopupStatus("");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setPopupStatus("No active tab.");
    return;
  }
  const url = tab.url || "";
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("edge://")) {
    setPopupStatus("This page does not allow extensions. Try a normal web page.");
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "APPLY_INTERLINEAR" }, (response) => {
    if (chrome.runtime.lastError) {
      setPopupStatus(chrome.runtime.lastError.message);
      return;
    }
    if (response?.error) {
      setPopupStatus(String(response.error));
    }
  });
});
