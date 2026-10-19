// Group Repos: a tab bar above the repository list (All, Games, Tools, ...) built from your GitHub
// lists. The lists are read from GitHub with your own session; the result is cached in
// chrome.storage.local and nothing leaves the browser.
(() => {
  const KEY = 'groupReposLists';
  const LIST_SELECTOR = '#user-repositories-list';
  const STALE_MS = 10 * 60 * 1000;
  const MAX_PAGES = 20;

  const emptyState = () => ({ lists: [], membership: {}, fetchedAt: 0 });

  // The chosen tab (a list slug, or '' for all) and the watcher of the repo list.
  let selected = '';
  let observer = null;
  let loading = false;

  const viewerName = (doc) => {
    const meta = doc.querySelector('meta[name="user-login"]');
    return meta ? meta.content : '';
  };

  function listLabel(link, slug) {
    const heading = link.querySelector('h3') || link;
    const lines = heading.textContent
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
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
    for (const link of doc.querySelectorAll('h1 a[href], h2 a[href], h3 a[href], a[itemprop~="codeRepository"]')) {
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
    let failure = null;
    for (const url of ['/stars/' + viewer + '/lists', '/' + viewer + '?tab=stars']) {
      try {
        lists = parseListLinks(await getDoc(url), viewer);
      } catch (error) {
        failure = error; // this page may not exist for the account, try the next one
        continue;
      }
      if (lists.length) break;
    }
    if (!lists.length && failure) throw failure;
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

  function el(doc, tag, attrs = {}, text = '') {
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    node.textContent = text;
    return node;
  }

  const inList = (state, item, slug) => (state.membership[repoName(item)] || []).includes(slug);

  // Hides the repos outside the chosen list and keeps the counters in step with the page.
  // It only touches classes and changed counters, so it can run from the observer without looping.
  function applyFilter(doc, state) {
    const host = doc.querySelector(LIST_SELECTOR);
    if (!host) return;
    const items = [...host.querySelectorAll('li[itemprop="owns"]')];
    for (const item of items) item.classList.toggle('gr-hide', !!selected && !inList(state, item, selected));
    for (const tab of doc.querySelectorAll('.gr-tabs [data-list]')) {
      const slug = tab.getAttribute('data-list');
      const count = String(slug ? items.filter((i) => inList(state, i, slug)).length : items.length);
      const counter = tab.querySelector('.Counter');
      if (counter.textContent !== count) counter.textContent = count;
    }
  }

  const nextPageUrl = (scope) => {
    const link = scope.querySelector('.paginate-container a.next_page, .paginate-container a[rel="next"]');
    return link ? link.getAttribute('href') : '';
  };

  // GitHub shows 30 repos per page. Fetch the rest and append it to the first page, so the tabs
  // and counters cover every repo. A failed fetch leaves the pagination in place.
  async function loadAllPages(doc, state) {
    const host = doc.querySelector(LIST_SELECTOR);
    const list = host && host.querySelector('ul[data-filterable-for]');
    if (loading || !list || !nextPageUrl(host)) return;
    loading = true;
    try {
      let next = nextPageUrl(host);
      for (let page = 0; next && page < MAX_PAGES; page++) {
        const more = (await fetchDoc(next)).querySelector(LIST_SELECTOR);
        if (!more) break;
        for (const item of more.querySelectorAll('li[itemprop="owns"]')) {
          // The sparkline placeholders would start loading in the live page and spill their error text.
          item.querySelectorAll('include-fragment, poll-include-fragment').forEach((fragment) => fragment.remove());
          list.append(doc.importNode(item, true));
        }
        next = nextPageUrl(more);
      }
      if (list.isConnected) host.querySelectorAll('.paginate-container').forEach((bar) => bar.remove());
    } catch {
      // Keep the first page and its pagination; the next page load tries again.
    } finally {
      loading = false;
    }
    applyFilter(doc, state);
  }

  function paintTabs(doc) {
    for (const tab of doc.querySelectorAll('.gr-tabs [data-list]')) {
      const on = tab.getAttribute('data-list') === selected;
      tab.classList.toggle('selected', on);
      if (on) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
  }

  function stop() {
    if (observer) observer.disconnect();
    observer = null;
  }

  // Idempotent: safe to call again after every data change and after every page navigation.
  function mount(doc, state) {
    const host = doc.querySelector(LIST_SELECTOR);
    if (!host) return false;
    if (selected && !state.lists.some((l) => l.slug === selected)) selected = '';

    let nav = doc.querySelector('.gr-tabs');
    if (!nav) {
      nav = el(doc, 'nav', { class: 'UnderlineNav gr-tabs', 'aria-label': 'Lists' });
      host.before(nav);
    }
    const body = el(doc, 'div', { class: 'UnderlineNav-body' });
    for (const tab of [{ slug: '', name: 'All' }, ...state.lists]) {
      const button = el(doc, 'button', { type: 'button', class: 'UnderlineNav-item', 'data-list': tab.slug });
      button.append(el(doc, 'span', {}, tab.name), ' ', el(doc, 'span', { class: 'Counter' }, '0'));
      button.addEventListener('click', () => {
        selected = tab.slug;
        paintTabs(doc);
        applyFilter(doc, state);
      });
      body.append(button);
    }
    nav.replaceChildren(body);
    paintTabs(doc);
    applyFilter(doc, state);

    // GitHub reloads the repo list in place when you search or sort, so filter again afterwards.
    stop();
    observer = new doc.defaultView.MutationObserver(() => {
      if (!doc.querySelector('.gr-tabs')) mount(doc, state);
      else {
        applyFilter(doc, state);
        loadAllPages(doc, state);
      }
    });
    observer.observe(host.parentNode, { childList: true, subtree: true });
    loadAllPages(doc, state);
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
    parseListLinks,
    parseRepoLinks,
    fetchRepos,
    collect,
    fetchDoc,
    repoName,
    viewerName,
    mount,
    run,
    start,
    stop,
    load,
    save,
    emptyState,
  };

  if (typeof chrome !== 'undefined' && chrome.storage) start(document);
})();
