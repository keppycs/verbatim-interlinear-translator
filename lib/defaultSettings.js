import { BackendId } from "./translation/constants.js";

export const defaultSettings = {
  translationBackend: BackendId.AUTO,
  deeplAuthKey: "",
  deeplUseProApi: false,
  googleApiKey: "",
  azureTranslatorKey: "",
  azureTranslatorRegion: "",
  libreTranslateBaseUrl: "",
  customTranslateBaseUrl: "",
  customTranslatePath: "/translate",
  /** BCP-47 or "auto" */
  sourceLang: "auto",
  /** BCP-47; empty until user picks a language in the toolbar menu */
  targetLang: "",
  /** "inject" = in-flow HTML; "absolute" = gloss positioned without affecting layout */
  layoutMode: "inject",
};
