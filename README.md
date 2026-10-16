# Group Repos

A small Chrome extension for the **Repositories** tab of your GitHub profile. GitHub lets you put repos into lists (the ones you create under Stars), but the repositories page ignores them. This extension reads those lists and groups the page by them, so you can fold lists away and filter your repos.

## How it works

Open `github.com/<you>?tab=repositories`. Above the repo list there is a bar:

- **Filter repos**: type to narrow the repos by name or description.
- **All lists** dropdown: show one list only, or only the repos that are in no list.
- **Collapse all / Expand all**, and a click on any list title folds that list. Folding is remembered.
- **Refresh**: read your lists from GitHub again.

Each list becomes a section. A repo that is in several lists sits in the first one (in GitHub's order of your lists) and shows small chips for all of its lists. Repos in no list collect under "Not in a list".

Your lists are read with your own GitHub session (`/stars/<you>/lists/...`), so private repos work too. The result is cached in `chrome.storage.local` and refreshed when it is older than ten minutes. Nothing is sent anywhere else. You keep managing the lists on GitHub itself (the "Lists" menu on a repo); this extension only shows them.

## Install

1. Run `npm install` once if you want to run the tests.
2. Open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked** and pick this folder.

## Known limits

- Only the Repositories tab of a profile is handled. Organisation pages use a different layout.
- GitHub's own "Find a repository" box only searches the original list, so use the filter in the bar instead.
- GitHub paginates the repo list. Grouping applies to the page you are looking at, and the counts only cover that page.
- GitHub lists belong to starred repos. A repo is only in a list if you starred it first.
- The reading of GitHub's pages is based on its current markup and has not been checked against your account yet. If the bar says it could not read your lists, GitHub's markup probably differs from what the parser expects.

## Tests

```
npm test
```

Runs Vitest in jsdom with hand-written markup and a faked `fetch` and `chrome.storage`, and enforces 100 % line, branch, function and statement coverage of `content.js`. It has not been run in a real Chrome against the live site.
