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

async function applyThemeVariableOverrides(theme) {
  const url = `${THEME_VARIABLES_BASE}/${theme}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return; // sheet doesn't exist for this theme yet — fine, static CSS covers it
    const json = await res.json();
    const rows = json.data || [];
    rows.forEach(({ property, value }) => {
      if (!property || value === undefined || value === '') return;
      document.documentElement.style.setProperty(`--${property.trim()}`, String(value).trim());
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
