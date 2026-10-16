# Group Repos: working rules

Read this first in every session, then `README.md` (use, limits, state).

- The user writes in German; reply in German. Everything in the repository is English: file and folder names, code, comments, commit messages, documentation. UI texts are English.
- Write texts the way a person would: plain, short, no filler. The user does not want it to read like AI output.
- Global rules of the user apply: commit the previous change when a new task comes in (named paths only, one logical change per commit, Co-Authored-By line of the model in use), 100 % test coverage of `content.js` enforced by `npm test`, a bug gets a failing test first, report honestly what was tested.
- Remote: `origin` is the GitHub repository `SasNos/GroupRepos`, which is **public**. The global rule says never push to a public remote, so push only after the user has said so for this repository.
- LF line endings, UTF-8.
- State: v0.1.0, unit-tested in jsdom only. Not yet loaded into Chrome or tried on the live GitHub page.
