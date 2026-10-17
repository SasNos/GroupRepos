import { beforeEach, describe, expect, it, vi } from 'vitest';

const repoItem = (name) => `
  <li itemprop="owns"><div><h3><a href="/me/${name}" itemprop="name codeRepository">${name}</a></h3>
  <p>${name} description</p></div></li>`;

const page = (...names) => `
  <meta name="user-login" content="me">
  <input id="your-repos-filter" placeholder="Find a repository…">
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
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let api;

beforeEach(async () => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  delete globalThis.chrome;
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

const visible = () => [...document.querySelectorAll('li:not(.gr-hide) a[itemprop~="codeRepository"]')].map((a) => a.textContent);
const type = (text) => {
  const input = document.getElementById('your-repos-filter');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
};

describe('query', () => {
  const st = state();

  it('reads @ words as list prefixes and the rest as search terms', () => {
    expect(api.parseQuery(' @GAM , @too, extra ', st)).toEqual({
      slugs: ['games', 'tools'], terms: ['extra'], byList: true,
    });
  });

  it('ignores @ words shorter than three letters and plain text', () => {
    expect(api.parseQuery('@ @ga foo', st)).toEqual({ slugs: [], terms: ['foo'], byList: false });
    expect(api.parseQuery('  ', st)).toEqual({ slugs: [], terms: [], byList: false });
  });

  it('keeps a prefix that matches no list as a list filter with no lists', () => {
    expect(api.parseQuery('@zzz', st)).toEqual({ slugs: [], terms: [], byList: true });
  });

  it('matches every list a prefix fits, once', () => {
    const many = state({ lists: [{ slug: 'a', name: 'Web apps' }, { slug: 'b', name: 'Web sites' }] });
    expect(api.parseQuery('@web @web', many).slugs).toEqual(['a', 'b']);
  });
});

describe('mount', () => {
  const setup = (st, ...repos) => {
    document.body.innerHTML = page(...repos);
    return api.mount(document, st);
  };

  it('does nothing on pages without a repository list or filter field', () => {
    document.body.innerHTML = '<div id="user-repositories-list"></div>';
    expect(api.mount(document, state())).toBe(false);
    document.body.innerHTML = '';
    expect(api.mount(document, state())).toBe(false);
    document.body.innerHTML = page('one').replace('id="your-repos-filter"', 'id="other"');
    expect(api.mount(document, state())).toBe(false);
  });

  it('adds no elements to the page', () => {
    document.body.innerHTML = page('one');
    const count = document.body.querySelectorAll('*').length;
    api.mount(document, state());
    expect(document.body.querySelectorAll('*').length).toBe(count);
  });

  it('names example lists in the placeholder once lists are known', () => {
    setup(api.emptyState(), 'one');
    expect(document.getElementById('your-repos-filter').placeholder).toBe('Find a repository…');
    api.mount(document, state());
    expect(document.getElementById('your-repos-filter').placeholder).toBe(
      'Find a repository or @list, e.g. @Games…',
    );
  });

  it('shows only the repos of the typed lists, live while typing', () => {
    setup(state(), 'one', 'two', 'three');
    expect(visible()).toEqual(['one', 'two', 'three']);
    type('@Gam');
    expect(visible()).toEqual(['one', 'two']);
    type('@too');
    expect(visible()).toEqual(['two']);
    type('@ga');
    expect(visible()).toEqual(['one', 'two', 'three']);
    type('@zzz');
    expect(visible()).toEqual([]);
    type('@tools, @games');
    expect(visible()).toEqual(['one', 'two']);
    type('');
    expect(visible()).toEqual(['one', 'two', 'three']);
  });

  it('narrows a list by further words', () => {
    setup(state(), 'one', 'two', 'three');
    type('@games two');
    expect(visible()).toEqual(['two']);
  });

  it('searches plain words when no @ list is given', () => {
    setup(state(), 'one', 'two', 'three');
    type(' TWO ');
    expect(visible()).toEqual(['two']);
    type('zzz');
    expect(visible()).toEqual([]);
  });

  it("keeps GitHub's own filter from seeing the typing", () => {
    setup(state(), 'one');
    const own = vi.fn();
    document.getElementById('your-repos-filter').addEventListener('input', own);
    type('@Games');
    expect(own).not.toHaveBeenCalled();
  });

  it('ignores typing in other fields and binds the field only once', () => {
    setup(state(), 'one', 'two');
    api.mount(document, state());
    api.mount(document, state());
    const other = document.createElement('input');
    document.body.append(other);
    other.dispatchEvent(new Event('input', { bubbles: true }));
    type('@Games, one');
    expect(visible()).toEqual(['one']);
  });

  it('uses the newest data after a re-mount', () => {
    setup(state(), 'one', 'two');
    api.mount(document, state({ membership: { 'me/two': ['games'] } }));
    type('@games');
    expect(visible()).toEqual(['two']);
  });
});

describe('run and start', () => {
  const stubGitHub = () => {
    const pages = {
      '/stars/me/lists': '<a href="/stars/me/lists/games">Games</a>',
      '/stars/me/lists/games': listPage('one'),
    };
    vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: true, text: async () => pages[url] })));
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
    type('@Games');
    expect(visible()).toEqual(['one', 'two']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads the lists from GitHub when the cache is stale and stores them', async () => {
    globalThis.chrome = fakeChrome();
    stubGitHub();
    document.body.innerHTML = page('one', 'two');
    await api.run(document);
    type('@Games');
    expect(visible()).toEqual(['one']);
    expect(chrome.data.groupReposData.membership).toEqual({ 'me/one': ['games'] });
  });

  it('keeps the old data quietly when GitHub cannot be read', async () => {
    globalThis.chrome = fakeChrome(state({ fetchedAt: 1 }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    document.body.innerHTML = page('one', 'two');
    await api.run(document);
    type('@Tools');
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
  });

  it('starts by itself when the extension storage is available', async () => {
    globalThis.chrome = fakeChrome(state());
    document.body.innerHTML = page('one');
    await loadScript();
    await flush();
    expect(document.getElementById('your-repos-filter').dataset.grBound).toBe('1');
  });
});
