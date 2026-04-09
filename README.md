# Verbatim Interlinear Translator

## 👀 At a Glance

Turn any webpage into a **word-by-word interlinear view**.  
Each word gets a gloss underneath, and multi-word segments can also show a **full natural translation line** below the interlinear row.

This is a **Chrome extension (Manifest V3)** that uses a **LibreTranslate-compatible API** you configure.

## ✨ What You Get

- Interlinear glosses directly in-page
- Full-line translation for multi-word chunks
- Quick toggle from popup, keyboard shortcut, or context menu
- Optional translation cache
- Optional sync of on/off page state across tabs

## 🚀 Quick Start

### 1) Install (Development Load)

1. Clone or download this repository.
2. Open Chrome -> **Extensions** -> enable **Developer mode**.
3. Click **Load unpacked** and select this folder (contains `manifest.json`).

### 2) Configure

1. Click the extension icon to open the popup.
2. Set **LibreTranslate URL** to your server (must be the HTTP(S) API root).
3. Choose **source** and **target** languages (source can be **auto**).
4. Optional: enable **translation cache** and **sync interlinear on/off across tabs**.

> Until backend URL and languages are configured, translation will not run.

### 3) Use It

- **Toolbar**: Open popup and toggle translation for the current page.
- **Keyboard**: **Ctrl+Shift+Y** (Windows/Linux) or **Command+Shift+Y** (macOS).
- **Context menu**: Right-click page -> **Toggle Verbatim interlinear on this page**.

## 📋 Requirements

- **Chrome 88+** (`manifest.json` -> `minimum_chrome_version`)
- A reachable **LibreTranslate-compatible** backend

## 🔒 Privacy

See `PRIVACY_POLICY.md` for a short plain-language summary at the top and the full policy below.
