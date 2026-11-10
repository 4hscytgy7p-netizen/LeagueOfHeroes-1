import { normalizeItemSearch } from '../utils/itemSearch';
import { craftingTools, rarityLabels, tableLabels, renderMagicItemDetails, type CatalogItem } from '../utils/magicItemPresentation';

export async function initializeMagicItems() {
  let root = document.querySelector<HTMLElement>('#magic-catalog');
  if (!root || root.dataset.initialized) return;
  if (root.dataset.lazyCatalog) {
    root.dataset.initialized = 'loading';
    const backLink = root.querySelector<HTMLAnchorElement>('#back-to-results');
    if (backLink) backLink.href = `/magic-items${location.search}`;
    try {
      const response = await fetch('/magic-items');
      if (!response.ok) throw new Error('Catalog unavailable');
      const document = new DOMParser().parseFromString(await response.text(), 'text/html');
      const catalog = document.querySelector<HTMLElement>('#magic-catalog');
      if (!catalog || catalog.dataset.lazyCatalog) throw new Error('Catalog missing');
      catalog.dataset.view = 'detail';
      root.replaceWith(catalog);
      root = catalog;
    } catch {
      const loading = root.querySelector<HTMLElement>('.catalog-loading');
      if (loading) {
        loading.setAttribute('aria-busy', 'false');
        loading.querySelector('p')!.textContent = 'Не удалось загрузить список. Перейдите в каталог, чтобы повторить попытку.';
      }
      return;
    }
  }
  root.dataset.initialized = 'true';
  const find = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const search = find<HTMLInputElement>('#item-search');
  const dialog = find<HTMLDialogElement>('#filter-popup');
  const filterButton = find<HTMLButtonElement>('#filter-button');
  const randomButton = find<HTMLButtonElement>('#random-item-btn');
  const details = find('#item-details');
  const detailsBody = find('#item-details-body');
  const mobile = window.matchMedia('(max-width: 900px)');
  const items: CatalogItem[] = JSON.parse(find('#items-data').dataset.items || '[]');
  const byId = new Map(items.map(item => [item.id, item]));
  const rows = [...root.querySelectorAll<HTMLTableRowElement>('.item-row')];
  const checkboxes = [...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  const keys = ['rarity', 'type', 'source', 'attunement', 'craftingTools', 'table'] as const;
  const sortKeys = ['name', 'type', 'weight', 'attunement', 'rarity', 'source'];
  let sort = { column: 'name', direction: 'asc' };
  let selectedId: string | null = null;
  let visibleItems: CatalogItem[] = [];
  let listScrollY = 0;
  let lastListItem: string | null = null;
  let previousOverflow = '';
  let tooltip: (InstanceType<NonNullable<Window['ItemTooltip']>> & { annotateItemAnchors?: (container: HTMLElement) => void }) | undefined;
  let randomHistory: string[] = [];

  const readStorage = (key: string) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  };
  const writeStorage = (key: string, value: unknown) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Browsing still works without storage. */ }
  };
  const getFilters = () => Object.fromEntries(keys.map(key => [key, checkboxes.filter(cb => cb.name === key && cb.checked).map(cb => cb.value)])) as Record<typeof keys[number], string[]>;
  const currentItemFromPath = () => {
    const id = decodeURIComponent(location.pathname.split('/')[2] || '');
    return byId.has(id) ? id : null;
  };

  function paramsForState() {
    const params = new URLSearchParams();
    for (const [key, values] of Object.entries(getFilters())) if (values.length) params.set(key, values.join(','));
    if (search.value.trim()) params.set('search', search.value.trim());
    if (sort.column !== 'name' || sort.direction !== 'asc') {
      params.set('sort', sort.column);
      params.set('direction', sort.direction);
    }
    return params;
  }
  function stateURL(itemId = selectedId) {
    const query = paramsForState().toString();
    return `/magic-items${itemId ? `/${itemId}` : ''}${query ? `?${query}` : ''}`;
  }
  function replaceURL() {
    history.replaceState({ ...history.state, magicItems: true, itemId: selectedId, listScrollY, lastListItem }, '', stateURL());
  }
  function updateLinks() {
    for (const row of rows) row.querySelector<HTMLAnchorElement>('a')!.href = stateURL(row.dataset.itemId!);
    find<HTMLAnchorElement>('#open-item-page').href = stateURL();
    for (const link of root.querySelectorAll<HTMLAnchorElement>('#random-item-history a')) {
      link.href = stateURL(decodeURIComponent(new URL(link.href).pathname.split('/')[2]));
    }
  }

  function restoreConditions(allowSaved: boolean) {
    const params = new URLSearchParams(location.search);
    const explicit = [...keys, 'search', 'sort', 'direction'].some(key => params.has(key));
    const saved = allowSaved && !explicit ? readStorage('magicItemFilters') : null;
    for (const cb of checkboxes) {
      const values: unknown = explicit ? (params.get(cb.name)?.split(',') || []) : saved?.[cb.name];
      cb.checked = Array.isArray(values) && values.includes(cb.value);
    }
    search.value = params.get('search') || '';
    sort = { column: sortKeys.includes(params.get('sort') || '') ? params.get('sort')! : 'name', direction: params.get('direction') === 'desc' ? 'desc' : 'asc' };
  }

  function renderChips() {
    const container = find('#active-filters');
    container.replaceChildren();
    const addChip = (label: string, remove: () => void) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'filter-chip';
      button.textContent = `${label} ×`;
      button.setAttribute('aria-label', `Убрать условие: ${label}`);
      button.addEventListener('click', () => { remove(); applyFilters(); });
      container.append(button);
    };
    if (search.value.trim()) addChip(`Поиск: ${search.value.trim()}`, () => { search.value = ''; });
    for (const cb of checkboxes.filter(cb => cb.checked)) {
      const labels = { rarity: 'Редкость', type: 'Тип', source: 'Источник', attunement: 'Настройка', craftingTools: 'Изготовление', table: 'Таблица' };
      const value = cb.name === 'rarity' ? rarityLabels[cb.value] : cb.name === 'table' ? tableLabels[cb.value] : cb.name === 'craftingTools' ? craftingTools[Number(cb.value)] : cb.name === 'attunement' ? (cb.value === 'true' ? 'Требует настройки' : 'Без настройки') : cb.value;
      addChip(`${labels[cb.name]}: ${value}`, () => { cb.checked = false; });
    }
    container.hidden = !container.childElementCount;
    if (!container.hidden) {
      const reset = document.createElement('button');
      reset.type = 'button'; reset.textContent = 'Сбросить всё';
      reset.addEventListener('click', resetAll);
      container.append(reset);
    }
  }

  function applyFilters(syncURL = true) {
    const filters = getFilters();
    const words = normalizeItemSearch(search.value).split(' ').filter(Boolean);
    const accepts = (key: typeof keys[number], value: string) => !filters[key].length || filters[key].includes(value);
    visibleItems = items.filter(item => {
      const name = normalizeItemSearch(`${item.name} ${item.nameEn}`);
      const tables = Array.isArray(item.table) ? item.table : item.table ? [item.table] : [];
      return words.every(word => name.includes(word)) && accepts('rarity', item.rarity)
        && accepts('type', item.type.split(',')[0].trim()) && accepts('source', item.source.book)
        && accepts('attunement', String(item.attunement))
        && (!filters.craftingTools.length || item.craftingTools.some(tool => filters.craftingTools.includes(String(tool))))
        && (!filters.table.length || tables.some(table => filters.table.includes(table)));
    });
    const visibleIds = new Set(visibleItems.map(item => item.id));
    for (const row of rows) row.hidden = !visibleIds.has(row.dataset.itemId!);
    const count = visibleItems.length;
    find('#items-counter').textContent = `Найдено предметов: ${count} из ${items.length}`;
    find('#show-filter-results').textContent = `Показать предметы: ${count}`;
    find('#empty-results').hidden = count > 0;
    find('.items-table').hidden = count === 0;
    find('#empty-results-message').textContent = search.value.trim() ? `По запросу «${search.value.trim()}» с текущими фильтрами нет совпадений.` : 'С текущими фильтрами нет совпадений. Попробуйте снять часть условий.';
    find<HTMLButtonElement>('[data-clear-search]').hidden = !search.value;
    find('#clear-search').hidden = !search.value;
    randomButton.disabled = count === 0;
    randomButton.title = count ? 'Случайный предмет из текущих результатов' : 'Нет предметов для случайного выбора. Измените поиск или фильтры.';
    const activeCount = checkboxes.filter(cb => cb.checked).length;
    find('#filter-count').textContent = String(activeCount);
    find('#filter-count').hidden = !activeCount;
    const additionalCount = filters.table.length + filters.craftingTools.length;
    find('#additional-filter-count').textContent = additionalCount ? `(${additionalCount})` : '';
    renderChips();
    writeStorage('magicItemFilters', filters);
    if (syncURL) replaceURL();
    updateLinks();
  }

  function sortRows() {
    const weight = (item: CatalogItem) => {
      const value = item.weight.replace(',', '.').match(/\d+(?:\.\d+)?/);
      return value ? Number(value[0]) : null;
    };
    const ordered = [...rows].sort((a, b) => {
      const left = byId.get(a.dataset.itemId!)!;
      const right = byId.get(b.dataset.itemId!)!;
      let result = 0;
      if (sort.column === 'weight') {
        const av = weight(left), bv = weight(right);
        if (av === null || bv === null) return av === bv ? left.name.localeCompare(right.name, 'ru') : av === null ? 1 : -1;
        result = av - bv;
      } else if (sort.column === 'rarity') result = Object.keys(rarityLabels).indexOf(left.rarity) - Object.keys(rarityLabels).indexOf(right.rarity);
      else if (sort.column === 'attunement') result = Number(left.attunement) - Number(right.attunement);
      else {
        const value = (item: CatalogItem) => sort.column === 'source' ? item.source.book : sort.column === 'type' ? item.type.split(',')[0] : item.name;
        result = value(left).localeCompare(value(right), 'ru', { numeric: true });
      }
      return (result || left.name.localeCompare(right.name, 'ru')) * (sort.direction === 'asc' ? 1 : -1);
    });
    find('tbody').append(...ordered);
    for (const button of root.querySelectorAll<HTMLElement>('.sort-button')) {
      const active = button.dataset.sort === sort.column;
      button.closest('th')!.setAttribute('aria-sort', active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
      button.querySelector('.sort-icon')!.textContent = active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕';
    }
    find<HTMLSelectElement>('#mobile-sort').value = `${sort.column}:${sort.direction}`;
  }

  function renderSelection(itemId: string | null, focus = false) {
    selectedId = itemId;
    const item = itemId ? byId.get(itemId) : null;
    root.dataset.view = item ? 'detail' : 'list';
    detailsBody.innerHTML = item ? renderMagicItemDetails(item) : '<div class="item-placeholder"><h2>Выберите предмет</h2><p>Откройте запись в списке, чтобы прочитать свойства, требования настройки и сведения об изготовлении.</p></div>';
    find('.item-detail-actions').hidden = !item;
    find('#copy-link-status').textContent = '';
    for (const row of rows) {
      const active = row.dataset.itemId === itemId;
      row.classList.toggle('active', active);
      const link = row.querySelector('a')!;
      if (active) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current');
    }
    document.title = item ? `${item.name} — Магические предметы` : 'Магические предметы';
    details.scrollTop = 0;
    tooltip?.annotateItemAnchors?.(detailsBody);
    updateLinks();
    if (focus && item) {
      if (mobile.matches) window.scrollTo(0, 0);
      find('#selected-item-title').focus({ preventScroll: true });
    }
  }

  function selectItem(id: string) {
    if (!byId.has(id)) return;
    if (!selectedId || !mobile.matches) listScrollY = window.scrollY;
    lastListItem = id;
    replaceURL();
    if (id === selectedId) { renderSelection(id, true); return; }
    const returnToList = !selectedId;
    renderSelection(id, true);
    history.pushState({ magicItems: true, itemId: id, listScrollY, lastListItem, returnToList }, '', stateURL());
  }
  function restoreListFocus() {
    requestAnimationFrame(() => {
      const row = rows.find(row => row.dataset.itemId === lastListItem && !row.hidden);
      (row?.querySelector<HTMLAnchorElement>('a') || search).focus({ preventScroll: true });
      window.scrollTo(0, listScrollY);
    });
  }
  find('#back-to-results').addEventListener('click', event => {
    event.preventDefault();
    if (history.state?.returnToList) { history.back(); return; }
    renderSelection(null);
    replaceURL();
    restoreListFocus();
  });
  window.addEventListener('popstate', () => {
    listScrollY = history.state?.listScrollY || 0;
    lastListItem = history.state?.lastListItem || null;
    restoreConditions(false);
    renderSelection(currentItemFromPath(), true);
    sortRows();
    applyFilters(false);
    if (!selectedId) restoreListFocus();
  });
  root.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
    if (anchor) {
      const url = new URL(anchor.href, location.href);
      const id = decodeURIComponent(url.pathname.split('/')[2] || '');
      if (url.origin === location.origin && url.pathname.startsWith('/magic-items/') && byId.has(id)
          && !anchor.target && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
        event.preventDefault(); selectItem(id);
      }
      return;
    }
    const row = event.target.closest<HTMLElement>('.item-row');
    if (row && !event.target.closest('button, input, select')) selectItem(row.dataset.itemId!);
  });
  search.addEventListener('input', () => applyFilters());
  const clearSearch = () => { search.value = ''; applyFilters(); search.focus(); };
  find('#clear-search').addEventListener('click', clearSearch);
  find('[data-clear-search]').addEventListener('click', clearSearch);
  function resetFilters() {
    checkboxes.forEach(cb => { cb.checked = false; });
    applyFilters();
  }
  function resetAll() { search.value = ''; resetFilters(); }
  root.querySelectorAll('[data-reset-filters]').forEach(button => button.addEventListener('click', resetFilters));
  root.querySelectorAll('[data-reset-all]').forEach(button => button.addEventListener('click', resetAll));
  dialog.addEventListener('change', event => { if (event.target instanceof HTMLInputElement && event.target.type === 'checkbox') applyFilters(); });
  filterButton.addEventListener('click', () => {
    previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    filterButton.setAttribute('aria-expanded', 'true');
  });
  const closeFilters = () => dialog.close();
  find('#close-filters').addEventListener('click', closeFilters);
  find('#show-filter-results').addEventListener('click', closeFilters);
  dialog.addEventListener('click', event => { if (event.target === dialog) closeFilters(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFilters();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll<HTMLElement>('button, input, select, summary, a[href], [tabindex="0"]')]
      .filter(element => element.getClientRects().length && !element.matches(':disabled'));
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  dialog.addEventListener('close', () => {
    document.body.style.overflow = previousOverflow;
    filterButton.setAttribute('aria-expanded', 'false');
    filterButton.focus({ preventScroll: true });
  });
  for (const input of dialog.querySelectorAll<HTMLInputElement>('[data-option-search]')) input.addEventListener('input', () => {
    const options = find(`#${input.dataset.optionSearch}`);
    const term = normalizeItemSearch(input.value);
    let count = 0;
    for (const label of options.querySelectorAll<HTMLElement>('label')) {
      label.hidden = !normalizeItemSearch(label.dataset.searchText || label.textContent || '').includes(term);
      if (!label.hidden) count++;
    }
    find(`[data-options-empty="${input.dataset.optionSearch}"]`).hidden = count > 0;
  });
  for (const button of root.querySelectorAll<HTMLElement>('.sort-button')) button.addEventListener('click', () => {
    const column = button.dataset.sort!;
    sort = { column, direction: sort.column === column && sort.direction === 'asc' ? 'desc' : 'asc' };
    sortRows(); replaceURL(); updateLinks();
  });
  find<HTMLSelectElement>('#mobile-sort').addEventListener('change', event => {
    const [column, direction] = (event.target as HTMLSelectElement).value.split(':');
    sort = { column, direction }; sortRows(); replaceURL(); updateLinks();
  });

  function renderHistory() {
    const list = find('#random-item-history');
    list.replaceChildren();
    for (const id of randomHistory) {
      const li = document.createElement('li'), link = document.createElement('a');
      link.href = stateURL(id); link.textContent = byId.get(id)!.name;
      li.append(link); list.append(li);
    }
    find('#random-history-count').textContent = `(${randomHistory.length})`;
    find('#random-item-history-empty').hidden = !!randomHistory.length;
  }
  const savedHistory = readStorage('magicItemRandomHistory');
  if (Array.isArray(savedHistory)) randomHistory = savedHistory.filter(id => typeof id === 'string' && byId.has(id)).slice(0, 5);
  randomButton.addEventListener('click', () => {
    if (!visibleItems.length) return;
    const item = visibleItems[Math.floor(Math.random() * visibleItems.length)];
    randomHistory.unshift(item.id); randomHistory = randomHistory.slice(0, 5);
    writeStorage('magicItemRandomHistory', randomHistory);
    renderHistory(); selectItem(item.id);
  });
  find('#copy-item-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(new URL(stateURL(), location.origin).href);
      find('#copy-link-status').textContent = 'Ссылка скопирована';
    } catch { find('#copy-link-status').textContent = 'Не удалось скопировать. Скопируйте ссылку из адресной строки браузера.'; }
  });

  restoreConditions(true);
  listScrollY = history.state?.listScrollY || 0;
  lastListItem = history.state?.lastListItem || null;
  renderSelection(currentItemFromPath());
  sortRows(); applyFilters(); renderHistory();
  mobile.addEventListener('change', () => { if (selectedId && mobile.matches) window.scrollTo(0, 0); });
  const initTooltip = () => {
    if (!window.ItemTooltip) return;
    const element = document.createElement('div'); element.id = 'item-tooltip'; element.hidden = false;
    element.style.cssText = 'display:none;position:fixed;z-index:1500'; document.body.append(element);
    tooltip = new window.ItemTooltip(); tooltip.init(element);
  };
  if (window.ItemTooltip) initTooltip();
  else {
    const script = document.createElement('script'); script.src = '/js/itemTooltip.js'; script.async = true;
    script.addEventListener('load', initTooltip); document.head.append(script);
  }
}
