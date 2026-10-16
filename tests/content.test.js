import { beforeEach, describe, expect, it, vi } from 'vitest';

const repoItem = (name) => `
  <li itemprop="owns"><div><h3><a href="/me/${name}" itemprop="name codeRepository">${name}</a></h3></div></li>`;

const page = (...names) => `
  <div id="user-repositories-list">
    <ul data-filterable-for="your-repos-filter">${names.map(repoItem).join('')}</ul>
  </div>`;

function fakeChrome(initial) {
  const data = initial ? { groupRepos: initial } : {};
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

const names = (parent) => [...parent.querySelectorAll('a[itemprop~="codeRepository"]')].map((a) => a.textContent);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let api;

beforeEach(async () => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  delete globalThis.chrome;
  api = await loadScript();
});

describe('state helpers', () => {
  it('adds a trimmed list with a unique id', () => {
    const state = api.emptyState();
    const id = api.addList(state, '  Work   stuff ');
    expect(state.lists).toEqual([{ id, name: 'Work stuff', collapsed: false }]);
    expect(api.addList(state, 'x'.repeat(100))).not.toBe(id);
    expect(state.lists[1].name).toHaveLength(40);
  });

  it('rejects empty and duplicate names, ignoring case', () => {
    const state = api.emptyState();
    api.addList(state, 'Games');
    expect(api.addList(state, '   ')).toBeNull();
    expect(api.addList(state, 'games')).toBeNull();
    expect(state.lists).toHaveLength(1);
  });

  it('renames a list but not into an empty or taken name', () => {
    const state = api.emptyState();
    const a = api.addList(state, 'A');
    api.addList(state, 'B');
    expect(api.renameList(state, a, 'C')).toBe(true);
    expect(state.lists[0].name).toBe('C');
    expect(api.renameList(state, a, 'b')).toBe(false);
    expect(api.renameList(state, a, ' ')).toBe(false);
    expect(api.renameList(state, 'nope', 'D')).toBe(false);
    expect(api.renameList(state, a, 'c')).toBe(true);
  });

  it('removes a list together with its assignments only', () => {
    const state = api.emptyState();
    const a = api.addList(state, 'A');
    const b = api.addList(state, 'B');
    api.assignRepo(state, 'me/one', a);
    api.assignRepo(state, 'me/two', b);
    api.removeList(state, a);
    expect(state.lists.map((l) => l.id)).toEqual([b]);
    expect(state.assign).toEqual({ 'me/two': b });
  });

  it('assigns and unassigns, ignoring unknown lists', () => {
    const state = api.emptyState();
    const a = api.addList(state, 'A');
    api.assignRepo(state, 'me/one', a);
    expect(state.assign['me/one']).toBe(a);
    api.assignRepo(state, 'me/one', 'ghost');
    expect(state.assign).toEqual({});
    api.assignRepo(state, 'me/one', '');
    expect(state.assign).toEqual({});
  });

  it('toggles collapsed and ignores unknown ids', () => {
    const state = api.emptyState();
    const a = api.addList(state, 'A');
    api.toggleList(state, a);
    expect(state.lists[0].collapsed).toBe(true);
    api.toggleList(state, a);
    expect(state.lists[0].collapsed).toBe(false);
    api.toggleList(state, 'ghost');
    expect(state.lists).toHaveLength(1);
  });

  it('reads the full name from the repo link, or nothing', () => {
    document.body.innerHTML = '<ul>' + repoItem('one') + '<li id="bare"></li></ul>';
    expect(api.repoName(document.querySelector('li'))).toBe('me/one');
    expect(api.repoName(document.getElementById('bare'))).toBe('');
  });
});

describe('storage', () => {
  it('loads an empty state when nothing is stored', async () => {
    globalThis.chrome = fakeChrome();
    expect(await api.load()).toEqual({ lists: [], assign: {} });
  });

  it('round-trips a saved state', async () => {
    globalThis.chrome = fakeChrome();
    const state = { lists: [{ id: 'a', name: 'A', collapsed: true }], assign: { 'me/one': 'a' } };
    await api.save(state);
    expect(await api.load()).toEqual(state);
  });
});

describe('mount', () => {
  const setup = (state, ...repos) => {
    document.body.innerHTML = page(...repos);
    const store = vi.fn(async () => {});
    return { store, mounted: api.mount(document, state, store) };
  };

  it('does nothing on pages without a repository list', () => {
    document.body.innerHTML = '<div id="user-repositories-list"></div>';
    expect(api.mount(document, api.emptyState(), vi.fn())).toBe(false);
    document.body.innerHTML = '';
    expect(api.mount(document, api.emptyState(), vi.fn())).toBe(false);
  });

  it('moves assigned repos into their list and leaves the rest in place', () => {
    const state = api.emptyState();
    const a = api.addList(state, 'Games');
    api.assignRepo(state, 'me/two', a);
    const { mounted } = setup(state, 'one', 'two', 'three');
    expect(mounted).toBe(true);
    expect(names(document.querySelector(`[data-list="${a}"]`))).toEqual(['two']);
    expect(names(document.querySelector('ul[data-filterable-for]'))).toEqual(['one', 'three']);
    expect(document.querySelector('.gr-toggle').textContent).toBe('▾ Games (1)');
  });

  it('is idempotent and keeps the original order when a repo leaves a list', () => {
    const state = api.emptyState();
    const a = api.addList(state, 'Games');
    api.assignRepo(state, 'me/one', a);
    const { store } = setup(state, 'one', 'two', 'three');
    api.mount(document, state, store);
    expect(document.querySelectorAll('.gr-root')).toHaveLength(1);
    expect(document.querySelectorAll('.gr-select')).toHaveLength(3);

    const select = document.querySelector('.gr-select');
    select.value = '';
    select.dispatchEvent(new Event('change'));
    expect(names(document.querySelector('ul[data-filterable-for]'))).toEqual(['one', 'two', 'three']);
    expect(store).toHaveBeenCalledWith(state);
  });

  it('assigns a repo through its select', () => {
    const state = api.emptyState();
    const a = api.addList(state, 'Tools');
    const { store } = setup(state, 'one');
    const select = document.querySelector('.gr-select');
    expect([...select.options].map((o) => o.textContent)).toEqual(['No list', 'Tools']);
    select.value = a;
    select.dispatchEvent(new Event('change'));
    expect(state.assign['me/one']).toBe(a);
    expect(names(document.querySelector(`[data-list="${a}"]`))).toEqual(['one']);
    expect(document.querySelector('.gr-select').value).toBe(a);
    expect(store).toHaveBeenCalledTimes(1);
  });

  it('ignores assignments to lists that no longer exist', () => {
    const state = { lists: [], assign: { 'me/one': 'ghost' } };
    setup(state, 'one');
    expect(names(document.querySelector('ul[data-filterable-for]'))).toEqual(['one']);
    expect(document.querySelector('.gr-toggle')).toBeNull();
  });

  it('folds and unfolds a list', () => {
    const state = api.emptyState();
    const a = api.addList(state, 'Games');
    api.assignRepo(state, 'me/one', a);
    const { store } = setup(state, 'one');
    document.querySelector('.gr-toggle').click();
    expect(document.querySelector('.gr-items').hidden).toBe(true);
    expect(document.querySelector('.gr-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.gr-toggle').textContent).toBe('▸ Games (1)');
    document.querySelector('.gr-toggle').click();
    expect(document.querySelector('.gr-items').hidden).toBe(false);
    expect(store).toHaveBeenCalledTimes(2);
  });

  it('adds a list from the form and ignores a rejected name', () => {
    const { store } = setup(api.emptyState(), 'one');
    const input = document.querySelector('.gr-input');
    const submit = () => document.querySelector('.gr-add').dispatchEvent(new Event('submit', { cancelable: true }));
    input.value = '   ';
    submit();
    expect(store).not.toHaveBeenCalled();
    input.value = 'Ideas';
    submit();
    expect(document.querySelector('.gr-toggle').textContent).toBe('▾ Ideas (0)');
    expect(store).toHaveBeenCalledTimes(1);
  });

  it('renames a list, and keeps it when the prompt is cancelled or invalid', () => {
    const state = api.emptyState();
    api.addList(state, 'Old');
    const { store } = setup(state, 'one');
    const prompt = vi.spyOn(window, 'prompt');
    const rename = () => [...document.querySelectorAll('.gr-head .gr-btn')][0].click();
    prompt.mockReturnValueOnce(null);
    rename();
    prompt.mockReturnValueOnce('  ');
    rename();
    expect(store).not.toHaveBeenCalled();
    prompt.mockReturnValueOnce('New');
    rename();
    expect(document.querySelector('.gr-toggle').textContent).toBe('▾ New (0)');
    expect(prompt).toHaveBeenCalledWith('Rename list', 'Old');
    expect(store).toHaveBeenCalledTimes(1);
  });

  it('deletes a list only after confirming', () => {
    const state = api.emptyState();
    const a = api.addList(state, 'Gone');
    api.assignRepo(state, 'me/one', a);
    const { store } = setup(state, 'one');
    const confirm = vi.spyOn(window, 'confirm');
    const remove = () => [...document.querySelectorAll('.gr-head .gr-btn')][1].click();
    confirm.mockReturnValueOnce(false);
    remove();
    expect(state.lists).toHaveLength(1);
    confirm.mockReturnValueOnce(true);
    remove();
    expect(state.lists).toHaveLength(0);
    expect(names(document.querySelector('ul[data-filterable-for]'))).toEqual(['one']);
    expect(store).toHaveBeenCalledTimes(1);
  });
});

describe('run and start', () => {
  it('skips pages that have no repository list', async () => {
    globalThis.chrome = fakeChrome();
    expect(await api.run(document)).toBe(false);
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
  });

  it('mounts with the stored state', async () => {
    globalThis.chrome = fakeChrome({ lists: [{ id: 'a', name: 'Kept', collapsed: false }], assign: { 'me/one': 'a' } });
    document.body.innerHTML = page('one');
    expect(await api.run(document)).toBe(true);
    expect(names(document.querySelector('[data-list="a"]'))).toEqual(['one']);
  });

  it('runs once on start and again after each navigation event', async () => {
    globalThis.chrome = fakeChrome();
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
    globalThis.chrome = fakeChrome();
    document.body.innerHTML = page('one');
    await loadScript();
    await flush();
    expect(document.querySelector('.gr-root')).not.toBeNull();
  });
});
