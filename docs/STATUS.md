# Status

## 10 November 2026: shared standards of the Spark tools

- `docs/STATUS.md` (this file) takes the state that was in `CLAUDE.md`; `CLAUDE.md` gets the shared standards of the
  Spark tools. `.gitattributes`, `.editorconfig` and an explicit Prettier `trailingComma` as in the other tools.
- New test `tests/spark.test.js`: `spark.json` has the same version, matches, scripts, styles and run time as
  `manifest.json` and the same version as `package.json`.
- Tested: `npm run check` (lint, Prettier, 45 tests, 100 % coverage). No change to the extension itself.

## State (1.2.1)

v1.1.0 puts a tab bar (All + the user's GitHub star lists) between the filter bar and the repo list on the repositories tab. GitHub reloads that list in place on search, so a MutationObserver re-applies the filter. Checked by the user in Chrome on the live repositories page (2026-10-17); list pages mark repos with h2 headings. Since 1.1.0 it also loads all pages of the repo list (30 per page) and strips the sparkline placeholders from the later pages; checked by the user in Chrome (2026-10-19). Since 1.2.1 the lists are re-read when the cache is older than 15 seconds (was 10 minutes), so new lists show up on the next visit; a repo in several lists is listed under each of them and counted once in All. Since 1.2.0 it also runs as a built-in tool of Spark (`spark.json`, `docs/SPARK.md`): without `chrome.storage` it caches in `localStorage` and Spark calls `GroupRepos.start(document)`; not yet tried in Spark, which has no code yet (2026-10-19).

## Open work

1. Try it in Spark once Spark can host tools (`docs/SPARK.md`).
