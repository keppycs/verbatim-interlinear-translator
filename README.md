# Verbatim Interlinear Translator

A **Chrome extension** (Manifest V3) that injects **word-by-word interlinear translation** into web pages: each word is shown with a gloss directly under it. For **multi-word phrases and sentences**, the extension also adds a **full translated line** below that interlinear row, so you see both per-word glosses and a normal sentence translation in one block. Translation uses a [LibreTranslate](https://libretranslate.com/)-compatible API.

## Install (development)

1. Clone or download this repository.
2. Open Chrome → **Extensions** → enable **Developer mode**.
3. Click **Load unpacked** and select the extension folder (the one containing `manifest.json`).

## Setup

1. Click the extension icon to open the popup.
2. Set **LibreTranslate URL** to your server (for example a public instance or your own [LibreTranslate](https://github.com/LibreTranslate/LibreTranslate) install). The field must point at the HTTP(S) root of the API.
3. Choose **source** and **target** languages. Source can be **auto** when supported.
4. Optional: enable **translation cache** and **sync interlinear on/off across tabs** in the popup.

Until a valid backend URL and languages are configured, translation will not run.

## Usage

- **Toolbar**: Click the extension action to open settings; use the controls there to turn interlinear translation on or off for the current page (exact labels match your UI).
- **Keyboard**: **Ctrl+Shift+Y** (Windows/Linux) or **⌘⇧Y** (macOS) — toggles whole-page interlinear translation on the active tab.
- **Context menu**: Right-click the page → **Toggle Verbatim interlinear on this page**.

## Requirements

- **Chrome** 88+ (see `manifest.json` → `minimum_chrome_version`).
- A reachable **LibreTranslate-compatible** HTTP API. The extension does not bundle a translator; it talks to whatever URL you configure.

## Privacy

Translation requests go to the **LibreTranslate URL you configure**. Review that service’s privacy policy if you use a third-party instance.
