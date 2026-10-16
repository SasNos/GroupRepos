# Group Repos

A small Chrome extension for the **Repositories** tab of your GitHub profile. GitHub lets you put repos into lists (the ones you create under Stars), but the repositories page ignores them. With this extension you can type list names into the existing "Find a repository" box and the page shows only the repos in those lists.

## How it works

Open `github.com/<you>?tab=repositories` and type into "Find a repository":

- `Games` shows the repos in your list Games.
- `Games, Tools` shows the repos that are in Games or in Tools.
- `Games, parser` shows the repos in Games whose name or description contains "parser".
- Anything that is not a list name works as the normal search.

The list narrows while you type. List names are matched exactly, ignoring case. Nothing is added to the page; once your lists are known the placeholder of the box names two of them as an example.

Your lists are read with your own GitHub session (`/stars/<you>/lists/...`), so private repos work too. The result is cached in `chrome.storage.local` and read again when it is older than ten minutes, on the next page load. Nothing is sent anywhere else. You keep managing the lists on GitHub itself (the "Lists" menu on a repo).

## Install

1. Run `npm install` once if you want to run the tests.
2. Open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked** and pick this folder.

## Known limits

- Only the Repositories tab of a profile is handled. Organisation pages use a different layout.
- GitHub paginates the repo list, so the filter only sees the repos on the current page.
- GitHub lists belong to starred repos. A repo is only in a list if you starred it first.
- The reading of GitHub's list pages is based on its current markup and has not been checked against your account yet. If typing a list name does nothing, the parser probably does not match the real markup.

## Tests

```
npm test
```

Runs Vitest in jsdom with hand-written markup and a faked `fetch` and `chrome.storage`, and enforces 100 % line, branch, function and statement coverage of `content.js`. It has not been run in a real Chrome against the live site.
