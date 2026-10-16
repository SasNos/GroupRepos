// Group Repos: show the repositories on your GitHub profile grouped by your own GitHub lists,
// with folding and filtering. The lists are read from GitHub with your own session; the result
// is cached in chrome.storage.local and nothing leaves the browser.
(() => {
  const KEY = 'groupReposData';
  const LIST_SELECTOR = '#user-repositories-list';
  const STALE_MS = 10 * 60 * 1000;
  const MAX_PAGES = 20;
  const NONE = '__none';

  const emptyState = () => ({ lists: [], membership: {}, fetchedAt: 0, collapsed: {} });

  // Shared between mounts so typing in the filter survives a re-mount.
  const ui = { status: '', query: '', list: '' };

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

  function el(doc, tag, attrs = {}, text = '') {
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    node.textContent = text;
    return node;
  }

  function button(doc, text, onClick) {
    const node = el(doc, 'button', { type: 'button', class: 'btn btn-sm gr-btn' }, text);
    node.addEventListener('click', onClick);
    return node;
  }

  function buildBar(doc, state, env, applyAll, setAllCollapsed) {
    const bar = el(doc, 'div', { class: 'gr-bar' });
    const input = el(doc, 'input', {
      type: 'search',
      class: 'form-control input-sm gr-input',
      placeholder: 'Filter repos',
      'aria-label': 'Filter repositories',
    });
    input.value = ui.query;
    input.addEventListener('input', () => {
      ui.query = input.value;
      applyAll();
    });

    const select = el(doc, 'select', { class: 'form-select select-sm gr-select', 'aria-label': 'Show one list' });
    select.append(el(doc, 'option', { value: '' }, 'All lists'), el(doc, 'option', { value: NONE }, 'Not in a list'));
    for (const list of state.lists) select.append(el(doc, 'option', { value: list.slug }, list.name));
    if (![...select.options].some((o) => o.value === ui.list)) ui.list = '';
    select.value = ui.list;
    select.addEventListener('change', () => {
      ui.list = select.value;
      applyAll();
    });

    bar.append(
      input,
      select,
      button(doc, 'Collapse all', () => setAllCollapsed(true)),
      button(doc, 'Expand all', () => setAllCollapsed(false)),
      button(doc, 'Refresh', () => env.refresh()),
      el(doc, 'span', { class: 'gr-status', role: 'status' }, ui.status),
    );
    return bar;
  }

  // Idempotent: safe to call again after every data change and after every page navigation.
  function mount(doc, state, env) {
    const host = doc.querySelector(LIST_SELECTOR);
    const original = host && host.querySelector('ul[data-filterable-for]');
    if (!original) return false;

    let root = host.querySelector('.gr-root');
    if (!root) {
      root = el(doc, 'div', { class: 'gr-root' });
      host.insertBefore(root, host.firstChild);
    }

    const items = [...host.querySelectorAll('li[itemprop="owns"]')];
    items.forEach((item, index) => {
      if (!item.dataset.grIndex) item.dataset.grIndex = String(index + 1);
    });
    items.sort((a, b) => a.dataset.grIndex - b.dataset.grIndex);

    const groups = [];
    const groupFor = (key, name) => {
      let group = groups.find((g) => g.key === key);
      if (!group) {
        const section = el(doc, 'section', { class: 'gr-group' });
        const toggle = el(doc, 'button', { type: 'button', class: 'gr-toggle' });
        const list = el(doc, 'ul', { class: 'gr-items' });
        section.append(toggle, list);
        group = { key, name, section, toggle, list, entries: [] };
        toggle.addEventListener('click', () => {
          state.collapsed[key] = !state.collapsed[key];
          paint(group);
          env.save(state);
        });
        groups.push(group);
      }
      return group;
    };

    const grouped = state.lists.length > 0;
    const names = new Map(state.lists.map((l) => [l.slug, l.name]));
    for (const item of grouped ? items : []) {
      const repo = repoName(item);
      const mine = state.lists.filter((l) => (state.membership[repo] || []).includes(l.slug));
      const header = item.querySelector('h3') || item;
      header.querySelectorAll('.gr-chip').forEach((chip) => chip.remove());
      for (const list of mine) header.append(el(doc, 'span', { class: 'Label Label--secondary gr-chip' }, names.get(list.slug)));
      const group = mine.length ? groupFor(mine[0].slug, mine[0].name) : groupFor(NONE, 'Not in a list');
      group.entries.push({ item, slugs: mine.map((l) => l.slug), text: item.textContent.toLowerCase() });
    }

    // GitHub's own order of lists first, the rest last.
    const order = (g) => (g.key === NONE ? state.lists.length : state.lists.findIndex((l) => l.slug === g.key));
    groups.sort((a, b) => order(a) - order(b));

    const paint = (group) => {
      const collapsed = !!state.collapsed[group.key];
      const total = group.entries.length;
      group.list.classList.toggle('gr-hide', collapsed);
      group.toggle.setAttribute('aria-expanded', String(!collapsed));
      const count = group.visible === total ? String(total) : group.visible + ' of ' + total;
      group.toggle.textContent = (collapsed ? '▸ ' : '▾ ') + group.name + ' (' + count + ')';
    };

    const matches = (entry) =>
      entry.text.includes(ui.query.trim().toLowerCase()) &&
      (ui.list === '' || (ui.list === NONE ? entry.slugs.length === 0 : entry.slugs.includes(ui.list)));

    const applyAll = () => {
      for (const group of groups) {
        group.visible = 0;
        for (const entry of group.entries) {
          const show = matches(entry);
          entry.item.classList.toggle('gr-hide', !show);
          if (show) group.visible++;
        }
        group.section.classList.toggle('gr-hide', group.visible === 0);
        paint(group);
      }
    };

    const setAllCollapsed = (collapsed) => {
      for (const group of groups) state.collapsed[group.key] = collapsed;
      applyAll();
      env.save(state);
    };

    root.replaceChildren(buildBar(doc, state, env, applyAll, setAllCollapsed), ...groups.map((g) => g.section));
    for (const group of groups) {
      for (const entry of group.entries) group.list.append(entry.item);
    }
    original.classList.toggle('gr-hide', grouped);
    if (!grouped) for (const item of items) original.append(item);
    applyAll();
    return true;
  }

  async function run(doc) {
    if (!doc.querySelector(LIST_SELECTOR)) return false;
    const state = await load();
    const viewer = viewerName(doc);

    const env = {
      save,
      async refresh() {
        if (!viewer) {
          ui.status = 'Sign in to GitHub to group by your lists.';
          return mount(doc, state, env);
        }
        ui.status = 'Reading your lists…';
        mount(doc, state, env);
        try {
          Object.assign(state, await collect(viewer, fetchDoc));
          ui.status = state.lists.length + ' lists loaded';
          await save(state);
        } catch {
          ui.status = '';
        }
        return mount(doc, state, env);
      },
    };

    const mounted = mount(doc, state, env);
    if (Date.now() - state.fetchedAt > STALE_MS) await env.refresh();
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
    mount, run, start, load, save, emptyState, ui,
  };

  if (typeof chrome !== 'undefined' && chrome.storage) start(document);
})();
