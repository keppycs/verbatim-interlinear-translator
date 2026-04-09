# Privacy Policy for Verbatim Interlinear Translator

Last updated: 2026-04-09

## Quick summary (read this first)

- The extension processes text from webpages you choose to translate.
- That text is sent only to the **LibreTranslate-compatible server you configure** so translation can work.
- I do **not** run a separate central service that stores your browsing text.
- Settings are stored using Chrome extension storage and may sync with your signed-in Chrome profile depending on browser settings and storage area used.
- Optional **translation cache** is stored locally (`chrome.storage.local`); you can clear it from the extension popup anytime.
- There are **no ads** in the extension and I do **not** use your data for advertising.

---

## What Data the Extension Uses

The extension may process:

- Text content from webpages that the user chooses to translate.
- Extension settings stored using Chrome extension storage (`chrome.storage.sync` in this extension), which may sync across a signed-in Chrome profile depending on browser settings, such as:
  - LibreTranslate base URL
  - selected source language
  - selected target language
  - cache preference
  - sync-across-tabs preference
- Cached translation entries stored locally when cache is enabled.

## Why Data Is Used

Data is used only to provide extension features:

- word-by-word interlinear glossing
- full-sentence translation lines
- user settings persistence
- optional local translation caching

## Data Sharing

When translation is performed, text is transmitted to the LibreTranslate-compatible endpoint configured by the user.

This means data is shared with:

- the translation service operator for the configured endpoint (which may be self-hosted by the user or a third-party service).

No other third-party data sharing is performed by the extension for advertising, brokering, or profiling purposes.

### Important Note About Translation Servers

- This extension does not provide its own translation backend.
- You choose the translation server.
- If you use a third-party server, that provider's logging, privacy, and security practices apply to requests sent to that server.

## Data Retention

- Settings remain in Chrome extension storage until changed or removed by the user.
- Translation cache remains locally until cleared by the user, disabled, or removed by browser/extension lifecycle.
- The extension does not maintain a separate remote database of user browsing text.

## Security

- Network requests are made to the endpoint configured by the user.
- Users should prefer trusted HTTPS translation endpoints.
- The extension does not intentionally read password or payment form fields for translation.

### Sensitive Pages

Consider disabling translation on pages containing passwords, financial information, health information, private messages, or other sensitive content unless you fully trust the configured translation server.

## User Controls

Users can:

- enable/disable translation
- change source and target languages
- change the translation endpoint URL
- enable/disable cache
- clear cached translations from the popup
- uninstall the extension to remove extension data

## Children's Privacy

This extension is not designed specifically for children.

## Changes to This Policy

This policy may be updated as the extension changes. The "Last updated" date above reflects the latest version.

## Contact

For privacy questions, use the contact information provided on the Chrome Web Store listing for this extension.
