// Group Repos: type the names of your GitHub lists into "Find a repository" (for example
// "Games, Tools") and only the repos in those lists stay visible. The lists are read from GitHub
// with your own session; the result is cached in chrome.storage.local and nothing leaves the browser.
(() => {
  const KEY = 'groupReposData';
  const LIST_SELECTOR = '#user-repositories-list';
  const STALE_MS = 10 * 60 * 1000;
  const MAX_PAGES = 20;

  const emptyState = () => ({ lists: [], membership: {}, fetchedAt: 0 });

  // The latest mounted page, read by the one input listener per page.
  let current = null;

  const viewerName = (doc) => {
    const meta = doc.querySelector('meta[name="user-login"]');
    return meta ? meta.content : '';
  };

  function listLabel(link, slug) {
    const heading = link.querySelector('h3') || link;
    const lines = heading.textContent.split('\n').map((s) => s.trim()).filter(Boolean);
    const name = (lines[0] || '').replace(/\s*\d+\s+repositor(y|ies)\s*$/i, '').trim();
    return name || slug;
  }

  function parseListLinks(doc, viewer) {
    const prefix = '/stars/' + viewer.toLowerCase() + '/lists/';
    const found = new Map();
    for (const link of doc.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href').split(/[?#]/)[0];
      if (!href.toLowerCase().startsWith(prefix)) continue;
      const slug = href.slice(prefix.length);
      if (!slug || slug === 'new' || slug.includes('/')) continue;
      const name = listLabel(link, slug);
      const known = found.get(slug);
      if (!known || (known.name === slug && name !== slug)) found.set(slug, { slug, name });
    }
    return [...found.values()];
  }

  function parseRepoLinks(doc) {
    const names = [];
    for (const link of doc.querySelectorAll('h3 a[href], a[itemprop~="codeRepository"]')) {
      const match = /^\/([^/]+\/[^/]+)\/?$/.exec(new URL(link.getAttribute('href'), 'https://github.com').pathname);
      if (match && !names.includes(match[1])) names.push(match[1]);
    }
    return names;
  }

  async function fetchDoc(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('GitHub answered ' + response.status + ' for ' + url);
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }

  async function fetchRepos(url, getDoc) {
    const repos = [];
    let next = url;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const doc = await getDoc(next);
      for (const name of parseRepoLinks(doc)) if (!repos.includes(name)) repos.push(name);
      const link = doc.querySelector('a[rel="next"], a.next_page');
      next = link ? link.getAttribute('href') : '';
    }
    return repos;
  }

  async function collect(viewer, getDoc) {
    let lists = [];
    for (const url of ['/stars/' + viewer + '/lists', '/' + viewer + '?tab=stars']) {
      lists = parseListLinks(await getDoc(url), viewer);
      if (lists.length) break;
    }
    const membership = {};
    for (const list of lists) {
      for (const repo of await fetchRepos('/stars/' + viewer + '/lists/' + list.slug, getDoc)) {
        (membership[repo] ||= []).push(list.slug);
      }
    }
    return { lists, membership, fetchedAt: Date.now() };
  }

  function repoName(item) {
    const link = item.querySelector('a[itemprop~="codeRepository"]');
    return link ? link.getAttribute('href').replace(/^\//, '') : '';
  }

  async function load() {
    const stored = await chrome.storage.local.get(KEY);
    return { ...emptyState(), ...stored[KEY] };
  }

  const save = (state) => chrome.storage.local.set({ [KEY]: state });

  // "Games, Tools" selects the repos in either list. Words that are not list names narrow it
  // further; without any list name the whole text is an ordinary search, like GitHub's own.
  function parseQuery(query, state) {
    const byName = new Map(state.lists.map((l) => [l.name.toLowerCase(), l.slug]));
    const slugs = [];
    const terms = [];
    for (const raw of query.split(',')) {
      const token = raw.trim().toLowerCase();
      if (!token) continue;
      if (byName.has(token)) slugs.push(byName.get(token));
      else terms.push(token);
    }
    const whole = query.trim().toLowerCase();
    return { slugs, terms: slugs.length ? terms : whole ? [whole] : [] };
  }

  function applyFilter() {
    const { host, input, state } = current;
    const { slugs, terms } = parseQuery(input.value, state);
    for (const item of host.querySelectorAll('li[itemprop="owns"]')) {
      const text = item.textContent.toLowerCase();
      const inLists = state.membership[repoName(item)] || [];
      const show = terms.every((t) => text.includes(t)) && (!slugs.length || slugs.some((s) => inLists.includes(s)));
      item.classList.toggle('gr-hide', !show);
    }
  }

  // Idempotent: safe to call again after every data change and after every page navigation.
  function mount(doc, state) {
    const host = doc.querySelector(LIST_SELECTOR);
    const original = host && host.querySelector('ul[data-filterable-for]');
    const input = original && doc.getElementById(original.getAttribute('data-filterable-for'));
    if (!input) return false;

    current = { host, input, state };
    if (state.lists.length) {
      const examples = state.lists.slice(0, 2).map((l) => l.name).join(', ');
      input.placeholder = 'Find a repository or lists, e.g. ' + examples + '…';
    }
    if (!input.dataset.grBound) {
      input.dataset.grBound = '1';
      // Capture on the document so GitHub's own filter never sees the typing and cannot hide
      // everything because "Games, Tools" is not part of any repo name.
      doc.addEventListener(
        'input',
        (event) => {
          if (event.target !== input) return;
          event.stopImmediatePropagation();
          applyFilter();
        },
        true,
      );
    }
    applyFilter();
    return true;
  }

  async function run(doc) {
    if (!doc.querySelector(LIST_SELECTOR)) return false;
    const state = await load();
    const viewer = viewerName(doc);
    const mounted = mount(doc, state);
    if (viewer && Date.now() - state.fetchedAt > STALE_MS) {
      try {
        Object.assign(state, await collect(viewer, fetchDoc));
        await save(state);
        mount(doc, state);
      } catch {
        // Keep working with the cached lists; the next page load tries again.
      }
    }
    return mounted;
  }

  function start(doc) {
    run(doc);
    // GitHub swaps pages without a reload, so look again after each navigation.
    doc.addEventListener('turbo:load', () => run(doc));
    doc.addEventListener('pjax:end', () => run(doc));
  }

  globalThis.GroupRepos = {
    parseListLinks, parseRepoLinks, fetchRepos, collect, fetchDoc, repoName, viewerName,
    parseQuery, mount, run, start, load, save, emptyState,
  };

  if (typeof chrome !== 'undefined' && chrome.storage) start(document);
})();
