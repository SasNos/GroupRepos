# Group Repos

A small Chrome extension that lets you sort the repositories on a GitHub profile into your own lists. Each list can be folded away, so a long repo page stays readable.

## How it works

Open a profile's **Repositories** tab (`github.com/<user>?tab=repositories`). Above the list you get a field to create a list. Every repo has a small dropdown next to its name: pick a list and the repo moves into it. Click a list's title to fold or unfold it. Lists can be renamed or deleted; deleting one never touches the repos, they just fall back to the plain list.

Lists and assignments are stored in `chrome.storage.local`, so they stay in your browser and nothing is sent anywhere. They are kept per browser profile, not synced.

## Install

1. Run `npm install` once if you want to run the tests.
2. Open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked** and pick this folder.

## Known limits

- Only the Repositories tab of a profile is handled. Starred repos and organisation pages use a different layout and are not touched.
- Repos inside a list are no longer part of GitHub's own "Find a repository" filter, because that filter only looks at the original list.
- GitHub paginates the list. Grouping is applied to whatever page you are looking at, and a list's count only covers that page.
- The selectors follow GitHub's current markup (`#user-repositories-list`, `itemprop="codeRepository"`). If GitHub changes it, the extension quietly does nothing.

## Tests

```
npm test
```

Runs Vitest in jsdom with a fake `chrome.storage` and enforces 100 % line, branch, function and statement coverage of `content.js`. The tests run against hand-written markup that mirrors GitHub's page, not against the live site; the extension has not been loaded into Chrome yet.
