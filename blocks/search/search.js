/*
 * search block
 *
 * Fetches the site's query-index.json and displays the indexed content in a
 * table, filtered by a search query — similar to the "Site Query" admin tool.
 *
 * Query source (in priority order):
 *   1. the ?q= (or ?query=) URL search parameter (deep-linkable)
 *   2. text typed into the block's search input
 *
 * Authoring: the block may optionally provide the index path in its first cell
 * (e.g. a single cell containing "/query-index.json"). Defaults to
 * "/query-index.json" on the current site.
 */

const DEFAULT_INDEX = '/query-index.json';
const QUERY_PARAMS = ['q', 'query', 'search'];

function getQueryFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const key = QUERY_PARAMS.find((p) => params.has(p));
  return key ? params.get(key) : '';
}

function setQueryInUrl(value) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set('q', value);
  else url.searchParams.delete('q');
  QUERY_PARAMS.filter((p) => p !== 'q').forEach((p) => url.searchParams.delete(p));
  window.history.replaceState({}, '', url);
}

async function fetchIndex(indexPath) {
  const resp = await fetch(indexPath);
  if (!resp.ok) throw new Error(`Failed to load index (${resp.status})`);
  const json = await resp.json();
  return {
    columns: json.columns || (json.data?.length ? Object.keys(json.data[0]) : []),
    data: json.data || [],
    total: json.total ?? (json.data ? json.data.length : 0),
  };
}

function matchesQuery(row, query) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(needle));
}

function formatCell(column, value) {
  if (value === undefined || value === null || value === '') return '';
  // lastModified is a unix timestamp (seconds) in the query index
  if (column === 'lastModified' && /^\d+$/.test(String(value))) {
    const date = new Date(Number(value) * 1000);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return String(value);
}

function renderResults(tbody, columns, rows, query) {
  tbody.textContent = '';
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    columns.forEach((col) => {
      const td = document.createElement('td');
      td.dataset.column = col;
      const value = row[col];
      if (col === 'path' && value) {
        const a = document.createElement('a');
        a.href = value;
        a.textContent = value;
        td.append(a);
      } else if (col === 'image' && value) {
        const img = document.createElement('img');
        img.src = value;
        img.alt = row.title || '';
        img.loading = 'lazy';
        td.append(img);
      } else {
        td.textContent = formatCell(col, value);
      }
      tr.append(td);
    });
    tbody.append(tr);
  });
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.className = 'search-empty';
    td.textContent = query ? `No results for “${query}”.` : 'No indexed content found.';
    tr.append(td);
    tbody.append(tr);
  }
}

export default async function decorate(block) {
  // Optional authored index path (first cell), else default.
  const authored = block.textContent.trim();
  const indexPath = authored && authored.startsWith('/') ? authored : DEFAULT_INDEX;

  block.textContent = '';

  // --- Search bar ---
  const form = document.createElement('form');
  form.className = 'search-bar';
  form.setAttribute('role', 'search');

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'search-input';
  input.name = 'q';
  input.placeholder = 'Search indexed content…';
  input.setAttribute('aria-label', 'Search indexed content');
  input.value = getQueryFromUrl();

  const button = document.createElement('button');
  button.type = 'submit';
  button.className = 'search-submit';
  button.textContent = 'Search';

  form.append(input, button);

  const status = document.createElement('p');
  status.className = 'search-status';
  status.setAttribute('aria-live', 'polite');

  // --- Results table ---
  const wrapper = document.createElement('div');
  wrapper.className = 'search-results';
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);
  wrapper.append(table);

  block.append(form, status, wrapper);

  let index;
  try {
    index = await fetchIndex(indexPath);
  } catch (e) {
    status.textContent = `Unable to load the content index: ${e.message}`;
    return;
  }

  // Build header from the index columns.
  const headRow = document.createElement('tr');
  index.columns.forEach((col) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = col;
    headRow.append(th);
  });
  thead.append(headRow);

  const update = (query) => {
    const filtered = index.data.filter((row) => matchesQuery(row, query));
    renderResults(tbody, index.columns, filtered, query);
    const scope = query ? ` matching “${query}”` : '';
    status.textContent = `${filtered.length} of ${index.total} entries${scope}`;
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    setQueryInUrl(input.value.trim());
    update(input.value.trim());
  });

  // Live filtering as the user types.
  input.addEventListener('input', () => {
    setQueryInUrl(input.value.trim());
    update(input.value.trim());
  });

  update(getQueryFromUrl());
}
