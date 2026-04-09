# Chrome Web Store Disclosure Notes

Use these snippets in your Chrome Web Store listing so listing text, privacy answers, and extension behavior stay aligned.

## Web Store quick summary (privacy / data disclosure)

Paste the one that fits the field (character limits vary by screen).

### Ultra-short (one line)

Page text is sent only to the LibreTranslate URL you configure for translation. Settings use Chrome extension storage (and may sync by profile settings); optional cache is local and clearable. No ads, no sale of data, no profiling.

### Short paragraph

When you turn on translation, the extension processes page text and sends it only to the LibreTranslate-compatible server you choose. I do not run a separate central service that stores your browsing text, and I do not collect or sell your browsing data for ads or profiling. Settings (server URL, languages, cache, sync) are stored using Chrome extension storage and may sync with the user's signed-in Chrome profile depending on browser settings and storage area used. Optional translation cache is stored locally and can be cleared in the popup. If you use a third-party translation server, that provider's logging and privacy practices apply.

### If the form asks “what user data do you collect?” (checklist-style)

- **Page text:** Only when you enable translation, sent to your configured translation server.
- **Settings:** Stored using Chrome extension storage (`storage.sync` in this extension), and may sync across a signed-in Chrome profile.
- **Cache:** Optional, local only; user can clear.
- **Not collected for:** Advertising, resale, or analytics unrelated to translation.

## Single Purpose

Verbatim Interlinear Translator adds inline word-by-word interlinear glosses to webpages and, when applicable, adds a full translated sentence line below each segment.

## Permission Rationale

### Why all-page access is needed

The extension modifies webpage text where the user enables translation.  
To support the feature consistently across normal websites, it needs access to page content on visited pages.

### Why host permissions are needed

Users can configure any LibreTranslate-compatible server URL.  
Because the backend is user-defined and not fixed to a single domain, the extension needs network access to user-specified HTTP(S) hosts.

### Why storage is needed

To save user settings (backend URL, language choices, cache toggle, sync preference) and optional local cache state.

### Why tabs / activeTab / scripting are needed

To apply translation state to the active tab, inject or ensure content script availability when needed, and keep popup state synchronized with current tab behavior.

### Why contextMenus is needed

To provide the right-click action: "Toggle Verbatim interlinear on this page."
