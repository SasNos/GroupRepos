// Group Repos: sort the repositories on a GitHub profile into named lists you can fold away.
// Lists and assignments live in chrome.storage.local, nothing leaves the browser.
(() => {
  const KEY = 'groupRepos';
  const LIST_SELECTOR = '#user-repositories-list';
  const MAX_NAME = 40;

  const emptyState = () => ({ lists: [], assign: {} });

  const cleanName = (name) => String(name).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

  const nameTaken = (state, name, exceptId) =>
    state.lists.some((l) => l.id !== exceptId && l.name.toLowerCase() === name.toLowerCase());

  function addList(state, name) {
    const clean = cleanName(name);
    if (!clean || nameTaken(state, clean)) return null;
    const id = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    state.lists.push({ id, name: clean, collapsed: false });
    return id;
  }

  function renameList(state, id, name) {
    const clean = cleanName(name);
    const list = state.lists.find((l) => l.id === id);
    if (!list || !clean || nameTaken(state, clean, id)) return false;
    list.name = clean;
    return true;
  }

  function removeList(state, id) {
    state.lists = state.lists.filter((l) => l.id !== id);
    for (const repo of Object.keys(state.assign)) {
      if (state.assign[repo] === id) delete state.assign[repo];
    }
  }

  function assignRepo(state, repo, id) {
    if (state.lists.some((l) => l.id === id)) state.assign[repo] = id;
    else delete state.assign[repo];
  }

  function toggleList(state, id) {
    const list = state.lists.find((l) => l.id === id);
    if (list) list.collapsed = !list.collapsed;
  }

  function repoName(item) {
    const link = item.querySelector('a[itemprop~="codeRepository"]');
    return link ? link.getAttribute('href').replace(/^\//, '') : '';
  }

  async function load() {
    const stored = await chrome.storage.local.get(KEY);
    return stored[KEY] || emptyState();
  }

  const save = (state) => chrome.storage.local.set({ [KEY]: state });

  function el(doc, tag, attrs = {}, text = '') {
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    node.textContent = text;
    return node;
  }

  function buildAddBar(doc, state, refresh) {
    const form = el(doc, 'form', { class: 'gr-add' });
    const input = el(doc, 'input', {
      type: 'text',
      class: 'gr-input',
      placeholder: 'New list',
      maxlength: String(MAX_NAME),
      'aria-label': 'Name of the new list',
    });
    form.append(input, el(doc, 'button', { type: 'submit', class: 'gr-btn' }, 'Add list'));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (addList(state, input.value)) refresh();
    });
    return form;
  }

  function buildSection(doc, state, list, count, refresh) {
    const section = el(doc, 'section', { class: 'gr-group', 'data-list': list.id });
    const head = el(doc, 'div', { class: 'gr-head' });
    const toggle = el(
      doc,
      'button',
      { type: 'button', class: 'gr-toggle', 'aria-expanded': String(!list.collapsed) },
      (list.collapsed ? '▸ ' : '▾ ') + list.name + ' (' + count + ')',
    );
    toggle.addEventListener('click', () => {
      toggleList(state, list.id);
      refresh();
    });
    const rename = el(doc, 'button', { type: 'button', class: 'gr-btn' }, 'Rename');
    rename.addEventListener('click', () => {
      const next = doc.defaultView.prompt('Rename list', list.name);
      if (next !== null && renameList(state, list.id, next)) refresh();
    });
    const remove = el(doc, 'button', { type: 'button', class: 'gr-btn' }, 'Delete');
    remove.addEventListener('click', () => {
      if (doc.defaultView.confirm('Delete the list "' + list.name + '"? The repos stay on GitHub.')) {
        removeList(state, list.id);
        refresh();
      }
    });
    head.append(toggle, rename, remove);
    const items = el(doc, 'ul', { class: 'gr-items' });
    items.hidden = list.collapsed;
    section.append(head, items);
    return { section, items };
  }

  function fillSelect(doc, select, state, repo) {
    select.replaceChildren(el(doc, 'option', { value: '' }, 'No list'));
    for (const list of state.lists) select.append(el(doc, 'option', { value: list.id }, list.name));
    select.value = state.assign[repo] || '';
  }

  // Idempotent: safe to call again after every change and after every page navigation.
  function mount(doc, state, store) {
    const host = doc.querySelector(LIST_SELECTOR);
    const original = host && host.querySelector('ul[data-filterable-for]');
    if (!original) return false;

    const refresh = () => {
      mount(doc, state, store);
      return store(state);
    };

    let root = host.querySelector('.gr-root');
    if (!root) {
      root = el(doc, 'div', { class: 'gr-root' });
      host.insertBefore(root, host.firstChild);
    }
    const targets = new Map();
    const counts = {};
    const items = [...host.querySelectorAll('li[itemprop="owns"]')];
    items.forEach((item, index) => {
      if (!item.dataset.grIndex) item.dataset.grIndex = String(index + 1);
    });
    items.sort((a, b) => a.dataset.grIndex - b.dataset.grIndex);
    for (const item of items) {
      const id = state.assign[repoName(item)];
      if (state.lists.some((l) => l.id === id)) counts[id] = (counts[id] || 0) + 1;
    }

    const sections = state.lists.map((list) => {
      const built = buildSection(doc, state, list, counts[list.id] || 0, refresh);
      targets.set(list.id, built.items);
      return built.section;
    });
    root.replaceChildren(buildAddBar(doc, state, refresh), ...sections);

    for (const item of items) {
      const repo = repoName(item);
      let select = item.querySelector('.gr-select');
      if (!select) {
        select = el(doc, 'select', { class: 'gr-select', 'aria-label': 'List for this repository' });
        select.addEventListener('change', () => {
          assignRepo(state, repo, select.value);
          refresh();
        });
        item.querySelector('h3').append(select);
      }
      fillSelect(doc, select, state, repo);
      (targets.get(state.assign[repo]) || original).append(item);
    }
    return true;
  }

  async function run(doc) {
    if (!doc.querySelector(LIST_SELECTOR)) return false;
    return mount(doc, await load(), save);
  }

  function start(doc) {
    run(doc);
    // GitHub swaps pages without a reload, so look again after each navigation.
    doc.addEventListener('turbo:load', () => run(doc));
    doc.addEventListener('pjax:end', () => run(doc));
  }

  globalThis.GroupRepos = {
    addList, renameList, removeList, assignRepo, toggleList, repoName, mount, run, start, load, save, emptyState,
  };

  if (typeof chrome !== 'undefined' && chrome.storage) start(document);
})();
