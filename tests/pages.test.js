import { beforeEach, describe, expect, it, vi } from 'vitest';

const repoItem = (name) => `
  <li itemprop="owns"><div><h3><a href="/me/${name}" itemprop="name codeRepository">${name}</a></h3></div></li>`;

const pagination = (next) =>
  next
    ? `<div class="paginate-container"><div class="pagination"><em class="current">1</em>
       <a rel="next" class="next_page" href="${next}">Next</a></div></div>`
    : '<div class="paginate-container"><div class="pagination"><span class="next_page disabled">Next</span></div></div>';

const page = (names, next) => `
  <meta name="user-login" content="me">
  <div class="border-bottom"><input id="your-repos-filter"></div>
  <div id="user-repositories-list">
    <ul data-filterable-for="your-repos-filter">${names.map(repoItem).join('')}</ul>
    ${pagination(next)}
  </div>`;

const state = () => ({
  lists: [{ slug: 'games', name: 'Games' }],
  membership: { 'me/one': ['games'], 'me/four': ['games'], 'me/six': ['games'] },
  fetchedAt: Date.now(),
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const visible = () => [...document.querySelectorAll('li:not(.gr-hide) a[itemprop~="codeRepository"]')].map((a) => a.textContent);
const label = (slug) => document.querySelector(`.gr-tabs [data-list="${slug}"]`).textContent.replace(/\s+/g, ' ').trim();

const stubPages = (pages) => {
  const fetchMock = vi.fn(async (url) =>
    url in pages ? { ok: true, text: async () => pages[url] } : { ok: false, status: 404 },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

let api;

beforeEach(async () => {
  api?.stop();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  delete globalThis.chrome;
  vi.resetModules();
  await import('../content.js');
  api = globalThis.GroupRepos;
});

describe('all pages', () => {
  it('appends the later pages, drops the pagination and counts everything', async () => {
    const fetchMock = stubPages({
      '/me?page=2': page(['three', 'four'], '/me?page=3'),
      '/me?page=3': page(['five', 'six']),
    });
    document.body.innerHTML = page(['one', 'two'], '/me?page=2');
    api.mount(document, state());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('li[itemprop="owns"]')).toHaveLength(6);
    expect(document.querySelectorAll('.paginate-container')).toHaveLength(0);
    expect(label('')).toBe('All 6');
    expect(label('games')).toBe('Games 3');
    document.querySelector('.gr-tabs [data-list="games"]').click();
    expect(visible()).toEqual(['one', 'four', 'six']);
  });

  it('keeps the chosen tab for rows that arrive later', async () => {
    stubPages({ '/me?page=2': page(['three', 'four']) });
    document.body.innerHTML = page(['one', 'two'], '/me?page=2');
    api.mount(document, state());
    document.querySelector('.gr-tabs [data-list="games"]').click();
    await flush();
    expect(visible()).toEqual(['one', 'four']);
  });

  it('does nothing when there is only one page', async () => {
    const fetchMock = stubPages({});
    document.body.innerHTML = page(['one']);
    api.mount(document, state());
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.paginate-container')).toHaveLength(1);
  });

  it('keeps the first page and its pagination when a fetch fails, and can try again', async () => {
    stubPages({});
    document.body.innerHTML = page(['one', 'two'], '/me?page=2');
    api.mount(document, state());
    await flush();
    expect(document.querySelectorAll('li[itemprop="owns"]')).toHaveLength(2);
    expect(document.querySelectorAll('.paginate-container')).toHaveLength(1);
    stubPages({ '/me?page=2': page(['three']) });
    api.mount(document, state());
    await flush();
    expect(document.querySelectorAll('li[itemprop="owns"]')).toHaveLength(3);
  });

  it('stops when a fetched page has no repository list', async () => {
    stubPages({ '/me?page=2': '<p>nothing here</p>' });
    document.body.innerHTML = page(['one'], '/me?page=2');
    api.mount(document, state());
    await flush();
    expect(document.querySelectorAll('li[itemprop="owns"]')).toHaveLength(1);
  });

  it('gives up after the page limit', async () => {
    const fetchMock = stubPages({ '/me?page=2': page(['more'], '/me?page=2') });
    document.body.innerHTML = page(['one'], '/me?page=2');
    api.mount(document, state());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(20));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it('leaves the pagination alone when the page was replaced while loading', async () => {
    stubPages({ '/me?page=2': page(['three']) });
    document.body.innerHTML = page(['one'], '/me?page=2');
    const host = document.getElementById('user-repositories-list');
    api.mount(document, state());
    host.querySelector('ul').remove();
    await flush();
    expect(host.querySelectorAll('.paginate-container')).toHaveLength(1);
  });

  it('loads again after GitHub reloads the list in place', async () => {
    stubPages({ '/me?page=2': page(['three']) });
    document.body.innerHTML = page(['one'], '/me?page=2');
    api.mount(document, state());
    await flush();
    document.getElementById('user-repositories-list').innerHTML =
      '<ul data-filterable-for="your-repos-filter">' + repoItem('four') + '</ul>' + pagination('/me?page=2');
    await flush();
    await flush();
    expect(document.querySelectorAll('li[itemprop="owns"]')).toHaveLength(2);
    expect(document.querySelectorAll('.paginate-container')).toHaveLength(0);
  });
});
