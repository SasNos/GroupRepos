import { beforeEach, describe, expect, it, vi } from 'vitest';

const repoItem = (name) => `
  <li itemprop="owns"><div><h3><a href="/me/${name}" itemprop="name codeRepository">${name}</a></h3>
  <p>${name} description</p></div></li>`;

const page = (...names) => `
  <meta name="user-login" content="me">
  <div class="border-bottom color-border-muted"><form><input id="your-repos-filter"></form></div>
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
  ...extra,
});

function fakeChrome(initial) {
  const data = initial ? { groupReposLists: initial } : {};
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
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let api;

beforeEach(async () => {
  api?.stop();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  delete globalThis.chrome;
  localStorage.clear();
  api = await loadScript();
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

  it('reads repos from the headings GitHub uses on list pages', () => {
    const doc = parse(`<div><h2 class="h3"><a href="/me/one">
      <span class="text-normal">me / </span>one</a></h2></div><h2><a href="/me/two">two</a></h2>`);
    expect(api.parseRepoLinks(doc)).toEqual(['me/one', 'me/two']);
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
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

  it('tries the stars tab when the lists page does not exist', async () => {
    const getDoc = vi.fn(async (url) => {
      if (url === '/stars/me/lists') throw new Error('404');
      return parse(url.includes('tab=stars') ? '<a href="/stars/me/lists/games">Games</a>' : listPage('one'));
    });
    const result = await api.collect('me', getDoc);
    expect(result.membership).toEqual({ 'me/one': ['games'] });
  });

  it('falls back to the stars tab and copes with having no lists', async () => {
    const getDoc = vi.fn(async (url) =>
      parse(url.includes('tab=stars') ? '<a href="/stars/me/lists/games">Games</a>' : '<p>nothing</p>'),
    );
    const result = await api.collect('me', getDoc);
    expect(result.lists).toHaveLength(1);
    expect(getDoc.mock.calls.map((c) => c[0])).toEqual(['/stars/me/lists', '/me?tab=stars', '/stars/me/lists/games']);
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

  it('uses localStorage when there is no extension API, as in Spark', async () => {
    expect(await api.load()).toEqual(api.emptyState());
    await api.save(state());
    expect(JSON.parse(localStorage.getItem('groupReposLists')).lists).toHaveLength(2);
    expect((await api.load()).membership['me/two']).toEqual(['tools', 'games']);
  });

  it('starts over when localStorage holds broken data', async () => {
    localStorage.setItem('groupReposLists', '{broken');
    expect(await api.load()).toEqual(api.emptyState());
  });
});

const visible = () =>
  [...document.querySelectorAll('li:not(.gr-hide) a[itemprop~="codeRepository"]')].map((a) => a.textContent);
const tabs = () => [...document.querySelectorAll('.gr-tabs [data-list]')];
const tab = (slug) => document.querySelector(`.gr-tabs [data-list="${slug}"]`);
const label = (slug) => tab(slug).textContent.replace(/\s+/g, ' ').trim();

describe('mount', () => {
  const setup = (st, ...repos) => {
    document.body.innerHTML = page(...repos);
    return api.mount(document, st);
  };

  it('does nothing on pages without a repository list', () => {
    document.body.innerHTML = '';
    expect(api.mount(document, state())).toBe(false);
    expect(document.querySelector('.gr-tabs')).toBeNull();
  });

  it('puts the tabs between the filter bar and the list, with counts', () => {
    setup(state(), 'one', 'two', 'three');
    const nav = document.querySelector('.gr-tabs');
    expect(nav.nextElementSibling.id).toBe('user-repositories-list');
    expect(nav.previousElementSibling.className).toContain('border-bottom');
    expect(tabs().map((t) => label(t.getAttribute('data-list')))).toEqual(['All 3', 'Games 2', 'Tools 1']);
    expect(tab('').classList.contains('selected')).toBe(true);
    expect(tab('').getAttribute('aria-current')).toBe('page');
    expect(visible()).toEqual(['one', 'two', 'three']);
  });

  it('shows only the repos of the clicked list and goes back to all', () => {
    setup(state(), 'one', 'two', 'three');
    tab('tools').click();
    expect(visible()).toEqual(['two']);
    expect(tab('tools').classList.contains('selected')).toBe(true);
    expect(tab('').classList.contains('selected')).toBe(false);
    expect(tab('').hasAttribute('aria-current')).toBe(false);
    tab('games').click();
    expect(visible()).toEqual(['one', 'two']);
    tab('').click();
    expect(visible()).toEqual(['one', 'two', 'three']);
  });

  it('is idempotent and keeps the chosen tab on a re-mount', () => {
    setup(state(), 'one', 'two');
    tab('games').click();
    api.mount(document, state());
    expect(document.querySelectorAll('.gr-tabs')).toHaveLength(1);
    expect(tab('games').classList.contains('selected')).toBe(true);
    expect(visible()).toEqual(['one', 'two']);
  });

  it('falls back to all when the chosen list no longer exists', () => {
    setup(state(), 'one', 'three');
    tab('tools').click();
    api.mount(document, state({ lists: [{ slug: 'games', name: 'Games' }] }));
    expect(tab('').classList.contains('selected')).toBe(true);
    expect(visible()).toEqual(['one', 'three']);
  });

  it('shows just All while no lists are known', () => {
    setup(api.emptyState(), 'one');
    expect(tabs()).toHaveLength(1);
    expect(visible()).toEqual(['one']);
  });

  it('filters again when GitHub reloads the list in place', async () => {
    setup(state(), 'one', 'two');
    tab('tools').click();
    document.getElementById('user-repositories-list').innerHTML =
      '<ul data-filterable-for="your-repos-filter">' + repoItem('two') + repoItem('three') + repoItem('four') + '</ul>';
    await flush();
    expect(visible()).toEqual(['two']);
    expect(label('')).toBe('All 3');
    expect(label('tools')).toBe('Tools 1');
  });

  it('puts the tabs back if the page removes them', async () => {
    setup(state(), 'one');
    document.querySelector('.gr-tabs').remove();
    await flush();
    expect(document.querySelectorAll('.gr-tabs')).toHaveLength(1);
  });

  it('survives the list being removed and watches only the newest page', async () => {
    setup(state(), 'one');
    api.mount(document, state());
    document.getElementById('user-repositories-list').remove();
    await flush();
    expect(document.querySelectorAll('.gr-tabs')).toHaveLength(1);
  });
});

describe('run and start', () => {
  const stubGitHub = () => {
    const pages = {
      '/stars/me/lists': '<a href="/stars/me/lists/games">Games</a>',
      '/stars/me/lists/games': listPage('one'),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => ({ ok: true, text: async () => pages[url] })),
    );
  };

  it('skips pages that have no repository list', async () => {
    globalThis.chrome = fakeChrome();
    expect(await api.run(document)).toBe(false);
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
  });

  it('uses the cache without fetching while it is fresh', async () => {
    globalThis.chrome = fakeChrome(state());
    vi.stubGlobal('fetch', vi.fn());
    document.body.innerHTML = page('one', 'two');
    expect(await api.run(document)).toBe(true);
    tab('games').click();
    expect(visible()).toEqual(['one', 'two']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads the lists from GitHub when the cache is stale and stores them', async () => {
    globalThis.chrome = fakeChrome();
    stubGitHub();
    document.body.innerHTML = page('one', 'two');
    await api.run(document);
    expect(label('games')).toBe('Games 1');
    tab('games').click();
    expect(visible()).toEqual(['one']);
    expect(chrome.data.groupReposLists.membership).toEqual({ 'me/one': ['games'] });
  });

  it('keeps the old data quietly when GitHub cannot be read', async () => {
    globalThis.chrome = fakeChrome(state({ fetchedAt: 1 }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 })),
    );
    document.body.innerHTML = page('one', 'two');
    await api.run(document);
    tab('tools').click();
    expect(visible()).toEqual(['two']);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('does not fetch when no user is known', async () => {
    globalThis.chrome = fakeChrome();
    vi.stubGlobal('fetch', vi.fn());
    document.body.innerHTML = page('one').replace(/<meta[^>]*>/, '');
    await api.run(document);
    expect(fetch).not.toHaveBeenCalled();
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
    expect(document.querySelectorAll('.gr-tabs')).toHaveLength(1);
  });

  it('does not start by itself without the extension API, Spark starts it', async () => {
    document.body.innerHTML = page('one');
    await loadScript();
    await flush();
    expect(document.querySelector('.gr-tabs')).toBeNull();
  });

  it('starts by itself when the extension storage is available', async () => {
    globalThis.chrome = fakeChrome(state());
    document.body.innerHTML = page('one');
    await loadScript();
    await flush();
    expect(document.querySelector('.gr-tabs')).not.toBeNull();
  });
});
