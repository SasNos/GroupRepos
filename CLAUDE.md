# Group Repos: working rules

Read this first in every session, then `README.md` (use, limits, state).

- The user writes in German; reply in German. Everything in the repository is English: file and folder names, code, comments, commit messages, documentation. UI texts are English.
- Write texts the way a person would: plain, short, no filler. The user does not want it to read like AI output.
- Global rules of the user apply: commit the previous change when a new task comes in (named paths only, one logical change per commit, Co-Authored-By line of the model in use), 100 % test coverage of `content.js` enforced by `npm test`, a bug gets a failing test first, report honestly what was tested.
- Remote: `origin` is the public GitHub repository `SasNos/GroupRepos`; the user allowed pushing there (2026-10-17).
- LF line endings, UTF-8.
- State: v0.1.0 filters the repositories tab through the existing "Find a repository" box by the user's GitHub star lists (comma separated names). No UI of its own, by the user's wish. Unit-tested in jsdom only; the parsing of GitHub's list pages is a guess until checked in Chrome.
