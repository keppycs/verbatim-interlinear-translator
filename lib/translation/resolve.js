import { translateLibreTranslate } from "./backends/libretranslate.js";

/**
 * @param {object} settings - from chrome.storage
 */
export function hasConfiguredTranslationBackend(settings) {
  return Boolean(settings?.libreTranslateBaseUrl?.trim());
}

/**
 * @param {object} settings
 * @param {string[]} texts
 * @param {string} sourceLang - BCP-47 or "auto"
 * @param {string} targetLang - BCP-47
 * @returns {Promise<{ backend: string, translations: string[] } | { error: string }>}
 */
export async function translateWithSettings(settings, texts, sourceLang, targetLang) {
  if (!texts.length) return { backend: "none", translations: [] };
  if (!hasConfiguredTranslationBackend(settings)) {
    return { error: "Configure LibreTranslate URL in the extension menu." };
  }
  try {
    const translations = await translateLibreTranslate({
      baseUrl: settings.libreTranslateBaseUrl,
      texts,
      sourceLang,
      targetLang,
    });
    if (!translations || translations.length !== texts.length) {
      return { error: "Translation returned no result." };
    }
    return { backend: "libretranslate", translations };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}
