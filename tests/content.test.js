import { beforeEach, describe, expect, it, vi } from 'vitest';

const repoItem = (name) => `
  <li itemprop="owns"><div><h3><a href="/me/${name}" itemprop="name codeRepository">${name}</a></h3>
  <p>${name} description</p></div></li>`;

const page = (...names) => `
  <meta name="user-login" content="me">
  <div id="user-repositories-list">
    <ul data-filterable-for="your-repos-filter">${names.map(repoItem).join('')}</ul>
  </div>`;

const listPage = (...repos) => `<main>${repos.map((r) => `<h3><a href="/me/${r}">${r}</a></h3>`).join('')}</main>`;

const state = (extra = {}) => ({
  lists: [
    { slug: 'games', name: 'Games' },
    { slug: 'tools', name: 'Tools' },
  ],
  membership: { 'me/one': ['games'], 'me/two': ['tools', 'games'] },
  fetchedAt: Date.now(),
  collapsed: {},
  ...extra,
});

function fakeChrome(initial) {
  const data = initial ? { groupReposData: initial } : {};
  return {
    data,
    storage: {
      local: {
        get: vi.fn(async (key) => (key in data ? { [key]: data[key] } : {})),
        set: vi.fn(async (value) => Object.assign(data, value)),
      },
    },
  };
}

async function loadScript() {
  vi.resetModules();
  await import('../content.js');
  return globalThis.GroupRepos;
}

const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
const names = (parent) => [...parent.querySelectorAll('a[itemprop~="codeRepository"]')].map((a) => a.textContent);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const env = () => ({ save: vi.fn(async () => {}), refresh: vi.fn(async () => {}) });
const section = (title) => [...document.querySelectorAll('.gr-group')].find((s) => s.textContent.includes(title));

let api;

beforeEach(async () => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  delete globalThis.chrome;
  api = await loadScript();
  Object.assign(api.ui, { status: '', query: '', list: '' });
});

describe('reading GitHub pages', () => {
  const lists = (html) => api.parseListLinks(parse(html), 'Me');

  it('finds list links and takes the name from a heading or the first line', () => {
    expect(
      lists(`
        <a href="/stars/me/lists/websites"><h3>Websites</h3><span>12 repositories</span></a>
        <a href="/stars/me/lists/tools">Tools
          1 repository</a>
        <a href="/stars/me/lists/plugins?page=2">Plugins 3 repositories</a>
        <a href="/stars/me/lists/new">New</a><a href="/stars/me/lists/">All</a>
        <a href="/stars/me/lists/a/b">Nested</a><a href="/other/path">Other</a>`),
    ).toEqual([
      { slug: 'websites', name: 'Websites' },
      { slug: 'tools', name: 'Tools' },
      { slug: 'plugins', name: 'Plugins' },
    ]);
  });

  it('falls back to the slug and upgrades it when a later link has a name', () => {
    expect(lists('<a href="/stars/me/lists/games"></a><a href="/stars/me/lists/games">Games</a>')).toEqual([
      { slug: 'games', name: 'Games' },
    ]);
    expect(lists('<a href="/stars/me/lists/games">Games</a><a href="/stars/me/lists/games"></a>')).toEqual([
      { slug: 'games', name: 'Games' },
    ]);
    expect(lists('<a href="/stars/me/lists/a"></a><a href="/stars/me/lists/a"></a>')).toEqual([
      { slug: 'a', name: 'a' },
    ]);
  });

  it('reads repo names from list pages and ignores other links', () => {
    const doc = parse(`
      <h3><a href="/me/one">one</a></h3><h3><a href="https://github.com/me/two/">two</a></h3>
      <h3><a href="/me/one">again</a></h3><h3><a href="/me/one/issues">deep</a></h3>
      <a itemprop="name codeRepository" href="/me/three">three</a>`);
    expect(api.parseRepoLinks(doc)).toEqual(['me/one', 'me/two', 'me/three']);
  });

  it('reads the signed-in user from the page', () => {
    expect(api.viewerName(parse('<meta name="user-login" content="me">'))).toBe('me');
    expect(api.viewerName(parse(''))).toBe('');
  });

  it('reads the full name from a repo item, or nothing', () => {
    document.body.innerHTML = '<ul>' + repoItem('one') + '<li id="bare"></li></ul>';
    expect(api.repoName(document.querySelector('li'))).toBe('me/one');
    expect(api.repoName(document.getElementById('bare'))).toBe('');
  });
});

describe('fetching', () => {
  it('fetches a page with the session and parses it', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '<p id="x">hi</p>' }));
    vi.stubGlobal('fetch', fetchMock);
    const doc = await api.fetchDoc('/stars/me/lists');
    expect(doc.getElementById('x').textContent).toBe('hi');
    expect(fetchMock).toHaveBeenCalledWith('/stars/me/lists', { credentials: 'same-origin' });
  });

  it('throws when GitHub answers with an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(api.fetchDoc('/gone')).rejects.toThrow('GitHub answered 404 for /gone');
  });

  it('follows next links and drops duplicates', async () => {
    const pages = {
      '/p1': listPage('one', 'two') + '<a rel="next" href="/p2">Next</a>',
      '/p2': listPage('two', 'three') + '<a class="next_page" href="/p3">Next</a>',
      '/p3': listPage('four'),
    };
    const getDoc = vi.fn(async (url) => parse(pages[url]));
    expect(await api.fetchRepos('/p1', getDoc)).toEqual(['one', 'two', 'three', 'four'].map((n) => 'me/' + n));
    expect(getDoc).toHaveBeenCalledTimes(3);
  });

  it('stops after the page limit', async () => {
    const getDoc = vi.fn(async () => parse(listPage('one') + '<a rel="next" href="/again">Next</a>'));
    await api.fetchRepos('/again', getDoc);
    expect(getDoc).toHaveBeenCalledTimes(20);
  });

  it('collects lists and which repos are in them', async () => {
    const pages = {
      '/stars/me/lists': '<a href="/stars/me/lists/games">Games</a><a href="/stars/me/lists/tools">Tools</a>',
      '/stars/me/lists/games': listPage('one', 'two'),
      '/stars/me/lists/tools': listPage('two'),
    };
    const result = await api.collect('me', async (url) => parse(pages[url]));
    expect(result.lists.map((l) => l.slug)).toEqual(['games', 'tools']);
    expect(result.membership).toEqual({ 'me/one': ['games'], 'me/two': ['games', 'tools'] });
    expect(result.fetchedAt).toBeGreaterThan(0);
  });

  it('falls back to the stars tab and copes with having no lists', async () => {
    const getDoc = vi.fn(async (url) =>
      parse(url.includes('tab=stars') ? '<a href="/stars/me/lists/games">Games</a>' : '<p>nothing</p>'),
    );
    const result = await api.collect('me', getDoc);
    expect(result.lists).toHaveLength(1);
    expect(getDoc.mock.calls.map((c) => c[0])).toEqual([
      '/stars/me/lists', '/me?tab=stars', '/stars/me/lists/games',
    ]);
    const none = await api.collect('me', async () => parse('<p>nothing</p>'));
    expect(none.lists).toEqual([]);
  });
});

describe('storage', () => {
  it('loads an empty state when nothing is stored', async () => {
    globalThis.chrome = fakeChrome();
    expect(await api.load()).toEqual(api.emptyState());
  });

  it('round-trips a saved state', async () => {
    globalThis.chrome = fakeChrome();
    await api.save(state());
    expect((await api.load()).lists).toHaveLength(2);
  });
});

describe('mount', () => {
  const setup = (st, ...repos) => {
    document.body.innerHTML = page(...repos);
    const e = env();
    return { e, mounted: api.mount(document, st, e) };
  };

  it('does nothing on pages without a repository list', () => {
    document.body.innerHTML = '<div id="user-repositories-list"></div>';
    expect(api.mount(document, api.emptyState(), env())).toBe(false);
    document.body.innerHTML = '';
    expect(api.mount(document, api.emptyState(), env())).toBe(false);
  });

  it('leaves the page alone while there are no lists yet', () => {
    const { mounted } = setup(api.emptyState(), 'one', 'two');
    expect(mounted).toBe(true);
    expect(document.querySelectorAll('.gr-group')).toHaveLength(0);
    expect(names(document.querySelector('ul[data-filterable-for]'))).toEqual(['one', 'two']);
    expect(document.querySelector('ul[data-filterable-for]').classList.contains('gr-hide')).toBe(false);
  });

  it('puts each repo in its first list, adds chips, and keeps the rest together', () => {
    setup(state(), 'one', 'two', 'three');
    expect(names(section('Games'))).toEqual(['one', 'two']);
    expect(names(section('Not in a list'))).toEqual(['three']);
    expect([...document.querySelectorAll('.gr-group')].map((s) => s.querySelector('.gr-toggle').textContent)).toEqual([
      '▾ Games (2)', '▾ Not in a list (1)',
    ]);
    const chips = (name) => [...document.querySelectorAll('a[href$="/' + name + '"]')][0]
      .closest('h3').querySelectorAll('.gr-chip');
    expect([...chips('two')].map((c) => c.textContent)).toEqual(['Games', 'Tools']);
    expect(document.querySelector('ul[data-filterable-for]').classList.contains('gr-hide')).toBe(true);
  });

  it('orders groups by GitHub list order and skips lists without repos here', () => {
    setup(state({ membership: { 'me/one': ['tools'], 'me/two': ['games'] } }), 'one', 'two', 'three');
    expect([...document.querySelectorAll('.gr-toggle')].map((t) => t.textContent.split(' (')[0].slice(2))).toEqual([
      'Games', 'Tools', 'Not in a list',
    ]);
    setup(state({ membership: { 'me/one': ['gone'] } }), 'one');
    expect(document.querySelectorAll('.gr-group')).toHaveLength(1);
  });

  it('is idempotent and keeps the original order', () => {
    const { e } = setup(state(), 'one', 'two', 'three');
    api.mount(document, state({ membership: {} }), e);
    expect(document.querySelectorAll('.gr-root')).toHaveLength(1);
    expect(document.querySelectorAll('.gr-chip')).toHaveLength(0);
    expect(names(section('Not in a list'))).toEqual(['one', 'two', 'three']);
    api.mount(document, api.emptyState(), e);
    expect(names(document.querySelector('ul[data-filterable-for]'))).toEqual(['one', 'two', 'three']);
  });

  it('copes with an item that has no heading', () => {
    document.body.innerHTML = page('one');
    document.querySelector('h3').replaceWith(document.createElement('div'));
    expect(api.mount(document, state(), env())).toBe(true);
  });

  it('folds, unfolds and saves', () => {
    const { e } = setup(state(), 'one');
    const toggle = () => document.querySelector('.gr-toggle');
    toggle().click();
    expect(document.querySelector('.gr-items').classList.contains('gr-hide')).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent).toBe('▸ Games (1)');
    toggle().click();
    expect(document.querySelector('.gr-items').classList.contains('gr-hide')).toBe(false);
    expect(e.save).toHaveBeenCalledTimes(2);
  });

  it('collapses and expands everything', () => {
    const st = state();
    const { e } = setup(st, 'one', 'three');
    const bar = [...document.querySelectorAll('.gr-bar .gr-btn')];
    bar[0].click();
    expect(document.querySelectorAll('.gr-items.gr-hide')).toHaveLength(2);
    expect(st.collapsed).toEqual({ games: true, __none: true });
    bar[1].click();
    expect(document.querySelectorAll('.gr-items.gr-hide')).toHaveLength(0);
    expect(e.save).toHaveBeenCalledTimes(2);
  });

  it('filters by text and hides sections that end up empty', () => {
    setup(state({ membership: { 'me/alpha': ['games'], 'me/beta': ['games'] } }), 'alpha', 'beta');
    const input = document.querySelector('.gr-input');
    input.value = ' ALP ';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('.gr-group:not(.gr-hide)')).toHaveLength(1);
    expect(section('Games').querySelector('.gr-toggle').textContent).toBe('▾ Games (1 of 2)');
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('.gr-group:not(.gr-hide)')).toHaveLength(0);
    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('li.gr-hide')).toHaveLength(0);
  });

  it('filters by one list, by no list, and shows the count of matches', () => {
    setup(state(), 'one', 'two', 'three');
    const select = document.querySelector('.gr-select');
    expect([...select.options].map((o) => o.textContent)).toEqual(['All lists', 'Not in a list', 'Games', 'Tools']);
    select.value = 'tools';
    select.dispatchEvent(new Event('change'));
    expect(section('Games').querySelector('.gr-toggle').textContent).toBe('▾ Games (1 of 2)');
    expect(document.querySelectorAll('li.gr-hide')).toHaveLength(2);
    select.value = '__none';
    select.dispatchEvent(new Event('change'));
    expect(document.querySelectorAll('li:not(.gr-hide)')).toHaveLength(1);
    select.value = '';
    select.dispatchEvent(new Event('change'));
    expect(document.querySelectorAll('li.gr-hide')).toHaveLength(0);
  });

  it('keeps the filter across mounts and drops a list that no longer exists', () => {
    const { e } = setup(state(), 'one', 'two');
    Object.assign(api.ui, { query: 'one', list: 'games' });
    api.mount(document, state(), e);
    expect(document.querySelector('.gr-input').value).toBe('one');
    expect(document.querySelector('.gr-select').value).toBe('games');
    api.ui.list = 'gone';
    api.mount(document, state(), e);
    expect(api.ui.list).toBe('');
  });

  it('refresh button calls the refresh hook and shows the status', () => {
    api.ui.status = 'Working';
    const { e } = setup(state(), 'one');
    expect(document.querySelector('.gr-status').textContent).toBe('Working');
    [...document.querySelectorAll('.gr-bar .gr-btn')][2].click();
    expect(e.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('run and start', () => {
  const lists = '<a href="/stars/me/lists/games">Games</a>';

  const stubGitHub = () => {
    const pages = { '/stars/me/lists': lists, '/stars/me/lists/games': listPage('one') };
    vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: true, text: async () => pages[url] })));
  };

  it('skips pages that have no repository list', async () => {
    globalThis.chrome = fakeChrome();
    expect(await api.run(document)).toBe(false);
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
  });

  it('shows the cache without fetching while it is fresh', async () => {
    globalThis.chrome = fakeChrome(state());
    vi.stubGlobal('fetch', vi.fn());
    document.body.innerHTML = page('one');
    expect(await api.run(document)).toBe(true);
    expect(names(section('Games'))).toEqual(['one']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads the lists from GitHub when the cache is stale and stores them', async () => {
    globalThis.chrome = fakeChrome();
    stubGitHub();
    document.body.innerHTML = page('one', 'two');
    await api.run(document);
    expect(names(section('Games'))).toEqual(['one']);
    expect(names(section('Not in a list'))).toEqual(['two']);
    expect(document.querySelector('.gr-status').textContent).toBe('1 lists loaded');
    expect(chrome.data.groupReposData.membership).toEqual({ 'me/one': ['games'] });
  });

  it('says so when GitHub cannot be read and keeps the old data', async () => {
    globalThis.chrome = fakeChrome(state({ fetchedAt: 1 }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    document.body.innerHTML = page('one');
    await api.run(document);
    expect(document.querySelector('.gr-status').textContent).toBe('Could not read your GitHub lists.');
    expect(names(section('Games'))).toEqual(['one']);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('asks to sign in when no user is known', async () => {
    globalThis.chrome = fakeChrome();
    vi.stubGlobal('fetch', vi.fn());
    document.body.innerHTML = page('one').replace(/<meta[^>]*>/, '');
    await api.run(document);
    expect(document.querySelector('.gr-status').textContent).toBe('Sign in to GitHub to group by your lists.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refreshes again from the button', async () => {
    globalThis.chrome = fakeChrome();
    stubGitHub();
    document.body.innerHTML = page('one');
    await api.run(document);
    fetch.mockClear();
    [...document.querySelectorAll('.gr-bar .gr-btn')][2].click();
    await flush();
    expect(fetch).toHaveBeenCalled();
  });

  it('runs once on start and again after each navigation event', async () => {
    globalThis.chrome = fakeChrome(state());
    document.body.innerHTML = page('one');
    api.start(document);
    await flush();
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('turbo:load'));
    document.dispatchEvent(new Event('pjax:end'));
    await flush();
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(3);
    expect(document.querySelectorAll('.gr-root')).toHaveLength(1);
  });

  it('starts by itself when the extension storage is available', async () => {
    globalThis.chrome = fakeChrome(state());
    document.body.innerHTML = page('one');
    await loadScript();
    await flush();
    expect(document.querySelector('.gr-root')).not.toBeNull();
  });
});
