/**
 * Fetches a da.live-authored spreadsheet and returns its data rows.
 * Returns [] on any failure so callers can skip missing pages gracefully.
 * @param {string} url
 * @returns {Promise<Object[]>}
 */
async function fetchSheet(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const json = await resp.json();
    return json.data || [];
  } catch {
    return [];
  }
}

/**
 * Assembles flat spreadsheet rows into the nested global-data JSON shape
 * that downstream consumers expect.
 */
function assembleGlobalData(siteName, language, pages, pageDataMap) {
  return {
    siteName,
    languages: [
      {
        language,
        pages: pages.map(({ pageName, wrapperId, hasGlobalWrapperComponent }) => ({
          pageName,
          hasGlobalWrapperComponent: String(hasGlobalWrapperComponent) === 'true',
          globalDataWrapperList: [
            {
              id: wrapperId || 'globalactivationwrap',
              globalDataMap: {
                'global-data': pageDataMap[pageName] || [],
              },
            },
          ],
        })),
      },
    ],
  };
}

/**
 * Loads and decorates the global-data-assembler block.
 *
 * Authored block config (one row per setting):
 * | site-name  | ro              |
 * | language   | ro              |
 * | base-path  | /global-data/ro |
 *
 * On load the block:
 * 1. Reads config from authored rows
 * 2. Fetches {base-path}/pages.json  →  manifest of page names
 * 3. Fetches {base-path}/{pageName}.json for each page in parallel
 * 4. Assembles rows into the nested global-data structure
 * 5. Stores result in window.globalData for other blocks to consume
 * 6. Renders a formatted preview for demo purposes
 *
 * @param {Element} block
 */
export default async function decorate(block) {
  // 1. Parse config rows authored in da.live
  const config = {};
  [...block.children].forEach((row) => {
    const [keyEl, valEl] = [...row.children];
    if (keyEl && valEl) {
      config[keyEl.textContent.trim().toLowerCase()] = valEl.textContent.trim();
    }
  });

  const siteName = config['site-name'] || 'ro';
  const language = config['language'] || 'ro';
  const basePath = config['base-path'] || '/global-data/ro';

  // Show loading state while fetching
  block.innerHTML = '';
  const status = document.createElement('p');
  status.className = 'global-data-assembler-status';
  status.textContent = 'Assembling global data…';
  block.append(status);

  try {
    // 2. Fetch pages manifest
    const pages = await fetchSheet(`${basePath}/pages.json`);
    if (!pages.length) throw new Error(`No pages found at ${basePath}/pages.json`);

    status.textContent = `Fetching data for ${pages.length} page(s)…`;

    // 3. Fetch all page sheets in parallel
    const pageDataMap = {};
    await Promise.all(
      pages.map(async ({ pageName }) => {
        pageDataMap[pageName] = await fetchSheet(`${basePath}/${pageName}.json`);
      }),
    );

    // 4. Assemble nested structure
    const assembled = assembleGlobalData(siteName, language, pages, pageDataMap);

    // 5. Expose for other blocks
    window.globalData = assembled;

    // 6. Render demo output
    block.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'global-data-assembler-output';

    const summary = document.createElement('p');
    summary.className = 'global-data-assembler-summary';
    const totalItems = pages.reduce(
      (acc, { pageName }) => acc + (pageDataMap[pageName]?.length || 0),
      0,
    );
    summary.textContent = `Assembled ${pages.length} page(s), ${totalItems} data item(s) → available as window.globalData`;
    wrapper.append(summary);

    const table = buildSummaryTable(pages, pageDataMap);
    wrapper.append(table);

    const details = document.createElement('details');
    const detailsSummary = document.createElement('summary');
    detailsSummary.textContent = 'View full JSON output';
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(assembled, null, 2);
    details.append(detailsSummary, pre);
    wrapper.append(details);

    block.append(wrapper);
  } catch (err) {
    block.innerHTML = '';
    const error = document.createElement('p');
    error.className = 'global-data-assembler-error';
    error.textContent = `Error: ${err.message}`;
    block.append(error);
  }
}

/**
 * Builds a readable summary table showing pages and their item counts.
 */
function buildSummaryTable(pages, pageDataMap) {
  const table = document.createElement('table');
  table.className = 'global-data-assembler-table';

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>pageName</th><th>items in global-data</th><th>item IDs</th></tr>';
  table.append(thead);

  const tbody = document.createElement('tbody');
  pages.forEach(({ pageName }) => {
    const rows = pageDataMap[pageName] || [];
    const tr = document.createElement('tr');
    const ids = rows.map((r) => r.id).filter(Boolean).join(', ') || '—';
    tr.innerHTML = `<td>${pageName}</td><td>${rows.length}</td><td>${ids}</td>`;
    tbody.append(tr);
  });
  table.append(tbody);

  return table;
}
