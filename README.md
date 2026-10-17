# Group Repos

A small Chrome extension for the **Repositories** tab of your GitHub profile. GitHub lets you put repos into lists (the ones you create under Stars), but the repositories page ignores them. With this extension you can type list names into the existing "Find a repository" box and the page shows only the repos in those lists.

## How it works

Open `github.com/<you>?tab=repositories` and type into "Find a repository":

- `@gam` shows the repos in lists whose name starts with "gam", for example Games.
- `@gam @too` shows the repos that are in a list starting with "gam" or one starting with "too".
- `@gam parser` shows those repos whose name or description also contains "parser".
- Words without an @ work as the normal search.

An @ word needs at least three letters before it counts, and the page narrows while you type. Letters are matched from the start of the list name, ignoring case. If no list fits, nothing is shown. Nothing is added to the page; once your lists are known the placeholder of the box shows one of them as an example.

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
