# Group Repos

A small Chrome extension for the **Repositories** tab of your GitHub profile. GitHub lets you put repos into lists (the ones you create under Stars), but the repositories page ignores them. This extension adds a tab bar above the repo list, built from your lists: **All**, **Games**, **Tools**, and so on.

## How it works

Open `github.com/<you>?tab=repositories`. Between the search bar and the list there is now a tab bar. Click a tab and the page shows only the repos in that list; click **All** to see everything again. Each tab has a small counter with the number of repos on the current page. The tabs use GitHub's own underline navigation style.

The chosen tab survives searching and sorting: GitHub reloads the list in place when you do that, and the extension filters the new result again. A repo that is in several lists shows up under each of them.

Your lists are read with your own GitHub session (`/stars/<you>/lists/...`), so private repos work too. The result is cached in `chrome.storage.local` and read again when it is older than ten minutes, on the next page load. If reading fails, the cached lists stay. Nothing is sent anywhere else. You keep managing the lists on GitHub itself (the "Lists" menu on a repo).

## Install

1. Run `npm install` once if you want to run the tests.
2. Open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked** and pick this folder.

## Known limits

- Only the Repositories tab of a profile is handled. Organisation pages use a different layout.
- GitHub paginates the repo list, so the tabs and counters only cover the repos on the current page.
- GitHub lists belong to starred repos. A repo is only in a list if you starred it first.
- The reading of GitHub's list pages is based on its current markup and has not been checked against your account yet. If only **All** shows up, the lists could not be read.

## Tests

```
npm test
```

Runs Vitest in jsdom with hand-written markup and a faked `fetch` and `chrome.storage`, and enforces 100 % line, branch, function and statement coverage of `content.js`. It has not been run in a real Chrome against the live site.
