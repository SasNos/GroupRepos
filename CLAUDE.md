# Group Repos: working rules

Read this first in every session, then `README.md` (use, limits, state).

- The user writes in German; reply in German. Everything in the repository is English: file and folder names, code, comments, commit messages, documentation. UI texts are English.
- Write texts the way a person would: plain, short, no filler. The user does not want it to read like AI output.
- Global rules of the user apply: commit the previous change when a new task comes in (named paths only, one logical change per commit, Co-Authored-By line of the model in use), 100 % test coverage of `content.js` enforced by `npm test`, a bug gets a failing test first, report honestly what was tested.
- Remote: `origin` is the public GitHub repository `SasNos/GroupRepos`; the user allowed pushing there (2026-10-17).
- LF line endings, UTF-8.
- State: v1.0.0 puts a tab bar (All + the user's GitHub star lists) between the filter bar and the repo list on the repositories tab. GitHub reloads that list in place on search, so a MutationObserver re-applies the filter. Checked by the user in Chrome on the live repositories page (2026-10-17); list pages mark repos with h2 headings.
