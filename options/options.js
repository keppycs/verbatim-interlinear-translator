import { BackendId } from "../lib/translation/constants.js";
import { defaultSettings } from "../lib/defaultSettings.js";

const backendLabels = [
  [BackendId.AUTO, "Auto (priority chain)"],
  [BackendId.DEEPL, "DeepL only"],
  [BackendId.GOOGLE, "Google Cloud Translation only"],
  [BackendId.AZURE, "Azure Translator only"],
  [BackendId.LIBRETRANSLATE, "LibreTranslate only"],
  [BackendId.CUSTOM, "Custom endpoint only"],
  [BackendId.ONDEVICE, "On-device only (not implemented)"],
];

function fillBackendSelect() {
  const sel = document.getElementById("translationBackend");
  for (const [value, label] of backendLabels) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  }
}

function formToObject() {
  return {
    translationBackend: document.getElementById("translationBackend").value,
    deeplAuthKey: document.getElementById("deeplAuthKey").value.trim(),
    deeplUseProApi: document.getElementById("deeplUseProApi").checked,
    googleApiKey: document.getElementById("googleApiKey").value.trim(),
    azureTranslatorKey: document.getElementById("azureTranslatorKey").value.trim(),
    azureTranslatorRegion: document.getElementById("azureTranslatorRegion").value.trim(),
    libreTranslateBaseUrl: document.getElementById("libreTranslateBaseUrl").value.trim(),
    customTranslateBaseUrl: document.getElementById("customTranslateBaseUrl").value.trim(),
    customTranslatePath: document.getElementById("customTranslatePath").value.trim() || "/translate",
    layoutMode: document.getElementById("layoutMode").value,
  };
}

function applyToForm(settings) {
  const merged = { ...defaultSettings, ...settings };
  document.getElementById("translationBackend").value = merged.translationBackend;
  document.getElementById("deeplAuthKey").value = merged.deeplAuthKey || "";
  document.getElementById("deeplUseProApi").checked = !!merged.deeplUseProApi;
  document.getElementById("googleApiKey").value = merged.googleApiKey || "";
  document.getElementById("azureTranslatorKey").value = merged.azureTranslatorKey || "";
  document.getElementById("azureTranslatorRegion").value = merged.azureTranslatorRegion || "";
  document.getElementById("libreTranslateBaseUrl").value = merged.libreTranslateBaseUrl || "";
  document.getElementById("customTranslateBaseUrl").value = merged.customTranslateBaseUrl || "";
  document.getElementById("customTranslatePath").value = merged.customTranslatePath || "/translate";
  document.getElementById("layoutMode").value = merged.layoutMode || "inject";
}

function setStatus(text, ok) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.classList.toggle("err", ok === false);
}

fillBackendSelect();

chrome.storage.sync.get(null, (stored) => {
  applyToForm(stored);
});

document.getElementById("save").addEventListener("click", () => {
  const data = formToObject();
  chrome.storage.sync.set(data, () => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, false);
      return;
    }
    setStatus("Saved.", true);
  });
});
