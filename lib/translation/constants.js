/**
 * Backend identifiers. "auto" walks TRANSLATION_CHAIN in resolve.js.
 * Future: MV2 or legacy Chromium builds could load a smaller bundle; keep IDs stable.
 */
export const BackendId = {
  AUTO: "auto",
  DEEPL: "deepl",
  GOOGLE: "google",
  AZURE: "azure",
  LIBRETRANSLATE: "libretranslate",
  CUSTOM: "custom",
  ONDEVICE: "ondevice",
};
