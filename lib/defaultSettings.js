export const defaultSettings = {
  libreTranslateBaseUrl: "",
  /** BCP-47 or "auto" */
  sourceLang: "auto",
  /** BCP-47; empty until user picks a target in the toolbar menu */
  targetLang: "",
  useTranslationCache: true,
  /**
   * When true, interlinear on/off is mirrored in sync storage so every tab shares the same mode.
   * When false (default), each tab is independent; turning interlinear on only affects the current page.
   */
  syncPageTranslationAcrossTabs: false,
  /** Only used when `syncPageTranslationAcrossTabs` is true: persisted on/off state for all tabs. */
  globalPageTranslation: false,
};
