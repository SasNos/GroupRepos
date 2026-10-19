# Group Repos in Spark

Spark (`SasNos/Spark`) has no extension system. Group Repos becomes a built-in tool there (Spark `CONCEPT.md`, section 6.16, target version 0.3). The page code stays the same for both: `content.js` and `content.css` run as they are, only the start and the storage differ.

`spark.json` describes the tool for Spark:

- **Where:** tab views whose URL matches `https://github.com/*`.
- **What:** inject `content.css`, then `content.js`, once the document is idle (WebView2: after `DOMContentLoaded`; WKWebView: `WKUserScript` at document end). Then run `GroupRepos.start(document)`. The script does not start by itself without the extension API.
- **Storage:** without `chrome.storage` the cache goes to the page's `localStorage` (key `groupReposLists`). Tab views get no Tauri API, so nothing else is needed.
- **Network:** only same-origin requests to github.com with the user's session, listed under `network`. They belong in Spark's `docs/NETWORK.md`.
- **Switch:** Spark's own setting for the tool decides whether it injects at all.
- **Look:** none of its own. The tab bar uses GitHub's `UnderlineNav` and `Counter` classes, so it looks like GitHub.

How Spark copies the files in (vendored copy or `include_str!` from a pinned version) is decided in the Spark repository when the tool is built.
