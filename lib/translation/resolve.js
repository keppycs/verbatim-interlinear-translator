import { BackendId } from "./constants.js";
import { translateDeepL } from "./backends/deepl.js";
import { translateGoogle } from "./backends/google.js";
import { translateAzure } from "./backends/azure.js";
import { translateLibreTranslate } from "./backends/libretranslate.js";
import { translateCustom } from "./backends/custom.js";
import { translateOnDevice } from "./backends/ondevice.js";

/**
 * When backend is "auto", try configured providers in priority order:
 * DeepL → Google Cloud Translation → Azure → LibreTranslate (URL) → Custom (URL) → on-device (future).
 */
const AUTO_CHAIN = [
  BackendId.DEEPL,
  BackendId.GOOGLE,
  BackendId.AZURE,
  BackendId.LIBRETRANSLATE,
  BackendId.CUSTOM,
  BackendId.ONDEVICE,
];

function canUse(settings, id) {
  switch (id) {
    case BackendId.DEEPL:
      return Boolean(settings.deeplAuthKey?.trim());
    case BackendId.GOOGLE:
      return Boolean(settings.googleApiKey?.trim());
    case BackendId.AZURE:
      return Boolean(settings.azureTranslatorKey?.trim());
    case BackendId.LIBRETRANSLATE:
      return Boolean(settings.libreTranslateBaseUrl?.trim());
    case BackendId.CUSTOM:
      return Boolean(settings.customTranslateBaseUrl?.trim());
    case BackendId.ONDEVICE:
      return true;
    default:
      return false;
  }
}

async function runBackend(settings, id, texts, sourceLang, targetLang) {
  switch (id) {
    case BackendId.DEEPL:
      return translateDeepL({
        authKey: settings.deeplAuthKey,
        useProApi: !!settings.deeplUseProApi,
        texts,
        sourceLang,
        targetLang,
      });
    case BackendId.GOOGLE:
      return translateGoogle({
        apiKey: settings.googleApiKey,
        texts,
        sourceLang,
        targetLang,
      });
    case BackendId.AZURE:
      return translateAzure({
        key: settings.azureTranslatorKey,
        region: settings.azureTranslatorRegion,
        texts,
        sourceLang,
        targetLang,
      });
    case BackendId.LIBRETRANSLATE:
      return translateLibreTranslate({
        baseUrl: settings.libreTranslateBaseUrl,
        texts,
        sourceLang,
        targetLang,
      });
    case BackendId.CUSTOM:
      return translateCustom({
        baseUrl: settings.customTranslateBaseUrl,
        path: settings.customTranslatePath,
        texts,
        sourceLang,
        targetLang,
      });
    case BackendId.ONDEVICE:
      return translateOnDevice();
    default:
      return null;
  }
}

/**
 * @param {object} settings - from chrome.storage (see options/defaultSettings)
 * @param {string[]} texts - segments to translate (e.g. words)
 * @param {string} sourceLang - BCP-47 or "auto"
 * @param {string} targetLang - BCP-47
 * @returns {{ backend: string, translations: string[] } | { error: string }}
 */
export async function translateWithSettings(settings, texts, sourceLang, targetLang) {
  if (!texts.length) return { backend: "none", translations: [] };
  const mode = settings.translationBackend || BackendId.AUTO;

  const tryOne = async (id) => {
    if (!canUse(settings, id)) return null;
    const translations = await runBackend(settings, id, texts, sourceLang, targetLang);
    if (translations && translations.length === texts.length) return { backend: id, translations };
    return null;
  };

  if (mode !== BackendId.AUTO) {
    if (!canUse(settings, mode)) {
      return { error: `Backend "${mode}" is not configured.` };
    }
    try {
      const translations = await runBackend(settings, mode, texts, sourceLang, targetLang);
      if (!translations || translations.length !== texts.length) {
        return { error: mode === BackendId.ONDEVICE ? "On-device translation is not implemented yet." : "Translation returned no result." };
      }
      return { backend: mode, translations };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  }

  for (const id of AUTO_CHAIN) {
    if (!canUse(settings, id)) continue;
    try {
      const translations = await runBackend(settings, id, texts, sourceLang, targetLang);
      if (translations && translations.length === texts.length) {
        return { backend: id, translations };
      }
    } catch {
      /* try next */
    }
  }

  return {
    error:
      "No working translation backend. Configure DeepL, Google, Azure, LibreTranslate URL, or custom endpoint in extension options.",
  };
}
