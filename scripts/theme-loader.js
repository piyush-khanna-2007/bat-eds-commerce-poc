/*
 * Theme loader
 *
 * 1. Reads the active theme from page/bulk metadata (<meta name="theme">),
 *    author-controlled — see previous notes on page Metadata blocks and
 *    bulk metadata sheets.
 * 2. Loads that theme's static CSS file (fonts, gradients, base values).
 * 3. Fetches a "theme-variables" sheet for that theme and applies each
 *    row as an inline CSS custom property override on <html> — this is
 *    the flexible, no-deploy layer. Authors add/remove rows in the
 *    sheet and republish; nothing here needs to change.
 *
 * Sheet format expected at /theme-variables/{theme}.json:
 *   property   | value
 *   ------------------------------
 *   color-button-primary-bg | #254aa2
 *   typography-h1-size-desktop | 2.75rem
 *
 * (Same names as the CSS custom properties, minus the leading "--".)
 *
 * Call loadTheme() once, early, from scripts.js — e.g. inside
 * loadEager() before decoratePage().
 */

const THEME_STYLES_BASE = '/styles/themes';
const THEME_VARIABLES_BASE = '/theme-variables';
const DEFAULT_THEME = 'default';

/*
 * Category -> CSS token prefix, for the grouped multi-value row format
 * (mirrors the AEM config's per-Property list-of-"key:value" editor).
 * A row whose "property" cell matches one of these keys is treated as
 * a group: its "value" cell holds one "subkey:value" pair per line,
 * and each line becomes --{prefix}{subkey}.
 *
 * Extend this map as more components (Hero, Accordion, etc.) move to
 * the grouped format. Any row whose property ISN'T listed here falls
 * back to the older flat format (property is already the full token
 * name, value is a single value) — both formats can coexist in the
 * same sheet during migration.
 */
const CATEGORY_PREFIX_MAP = {
  // Button
  'Typography: Batcom Button': 'typography-button-',
  'Layout: Batcom Button': 'layout-button-',
  'Color: Batcom Button': 'color-button-',
  // Global foundations
  'Color: Anchor': 'color-anchor-',
  'Color: Body': 'color-body-',
  'Color: Heading': 'color-heading-',
  'Color: Palette': 'color-palette-',
  'Color: Miscellaneous': 'color-misc-',
  'Typography Weight': 'typography-weight-',
  'Typography: Body': 'typography-body-',
  'Typography: Heading H1': 'typography-h1-',
  'Typography: Heading H2': 'typography-h2-',
  'Typography: Heading H3': 'typography-h3-',
  'Typography: Heading H4': 'typography-h4-',
  'Typography: Heading H5': 'typography-h5-',
  'Typography: Heading H6': 'typography-h6-',
  'Typography: Quote': 'typography-quote-',
  'Typography: Small': 'typography-small-',
  'Typography: xSmall': 'typography-xsmall-',
  'Layout: Content': 'layout-content-',
  'Layout: Spacing': 'layout-spacing-',
  // Per-component
  'Color: Component Accordion': 'color-accordion-',
  'Color: Component Age Gate': 'color-agegate-',
  'Color: Component Back to top button': 'color-backtotop-',
  'Color: Component Breadcrumb': 'color-breadcrumb-',
  'Color: Component Carousel': 'color-carousel-',
  'Color: Component Container': 'color-container-',
  'Color: Component Content Stream': 'color-content-stream-',
  'Color: Component Form': 'color-form-',
  'Color: Component Header': 'color-header-',
  'Color: Component Language Navigation': 'color-language-nav-',
  'Color: Component Link List': 'color-linklist-',
  'Color: Component List': 'color-list-',
  'Color: Component Navigation': 'color-navigation-',
  'Color: Component Product Gallery': 'color-product-gallery-',
  'Color: Component Progressbar': 'color-progressbar-',
  'Color: Component Search': 'color-search-',
  'Color: Component Separator': 'color-separator-',
  'Color: Component Social Media': 'color-social-',
  'Layout: Component Column Control': 'layout-column-control-',
  'Layout: Component Container': 'layout-container-',
  'Layout: Component Navigation': 'layout-navigation-',
  // Note: "Font face: 1", "Font face: 2" etc. are intentionally NOT mapped
  // here — they define @font-face blocks (name/woff2/woff), not simple
  // token overrides, and can't be applied via setProperty(). They stay in
  // the sheet for visibility/documentation, but theme-loader.js skips
  // them (no prefix match -> falls through to the flat-format branch,
  // which then no-ops safely since "Font face: 1" isn't a valid custom
  // property name either way).
};

function getMetadata(name) {
  const meta = document.querySelector(`meta[name="${name}"]`);
  return meta?.content?.trim() || '';
}

function detectTheme() {
  return getMetadata('theme') || DEFAULT_THEME;
}

function loadThemeStylesheet(theme) {
  const href = `${THEME_STYLES_BASE}/${theme}.css`;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

function applyGroupedRow(prefix, value) {
  value.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex === -1) return; // malformed line, skip rather than throw
    const subkey = trimmed.slice(0, separatorIndex).trim();
    const val = trimmed.slice(separatorIndex + 1).trim();
    if (!subkey || !val) return;
    document.documentElement.style.setProperty(`--${prefix}${subkey}`, val);
  });
}

async function applyThemeVariableOverrides(theme) {
  const url = `${THEME_VARIABLES_BASE}/${theme}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return; // sheet doesn't exist for this theme yet — fine, static CSS covers it
    const json = await res.json();
    const rows = json.data || [];
    rows.forEach(({ property, value }) => {
      if (!property || value === undefined || value === '') return;
      const prefix = CATEGORY_PREFIX_MAP[property.trim()];
      if (prefix) {
        applyGroupedRow(prefix, String(value));
      } else {
        // Legacy flat format: property is already the full token name
        document.documentElement.style.setProperty(`--${property.trim()}`, String(value).trim());
      }
    });
  } catch {
    // Network/parse failure — silently fall back to the static theme CSS,
    // don't block page render over an optional override layer.
  }
}

export default function loadTheme() {
  const theme = detectTheme();
  document.documentElement.setAttribute('data-theme', theme);

  if (theme !== DEFAULT_THEME) {
    loadThemeStylesheet(theme);
  }

  // Runs async and applies overrides as soon as they arrive; the static
  // CSS has already provided sane values in the meantime.
  applyThemeVariableOverrides(theme);
}
