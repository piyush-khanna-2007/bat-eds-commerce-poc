/*
 * Button Block — plain document-table authoring (no Universal Editor)
 *
 * Authors create a table like:
 *
 *   | Button              |                          |
 *   |----------------------|--------------------------|
 *   | Text                 | Get Started              |
 *   | Link                 | https://example.com      |
 *   | Icon                 | (inserted image)         |
 *   | Accessibility Label  | Sign up for the newsletter|
 *   | Open in new tab      | true                     |
 *   | Disabled             | false                    |
 *   | Classes              | secondary, icon-right    |
 *
 * Only "Text" is required — every other row is optional and can be
 * omitted or left blank. Rows can appear in any order since they're
 * matched by their label, not by position.
 */

function isTrue(value) {
  return value.trim().toLowerCase() === 'true';
}

export default function decorate(block) {
  const fields = {};

  [...block.children].forEach((row) => {
    const cells = [...row.children];
    if (cells.length < 2) return;
    const label = cells[0].textContent.trim().toLowerCase();
    const valueCell = cells[1];
    fields[label] = valueCell;
  });

  const text = fields.text?.textContent.trim() || '';
  const linkCell = fields.link;
  const href = linkCell?.querySelector('a')?.getAttribute('href') || linkCell?.textContent.trim() || '';
  const iconEl = fields.icon?.querySelector('img, svg');
  const a11yLabel = fields['accessibility label']?.textContent.trim();
  const openInNewTab = isTrue(fields['open in new tab']?.textContent || '');
  const disabled = isTrue(fields.disabled?.textContent || '');
  const classes = (fields.classes?.textContent || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  const a = document.createElement('a');
  a.className = 'button';
  classes.forEach((c) => a.classList.add(`button-${c}`));
  a.textContent = text;

  if (href && !disabled) {
    a.setAttribute('href', href);
  }
  if (a11yLabel) {
    a.setAttribute('aria-label', a11yLabel);
  }
  if (openInNewTab) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
  if (disabled) {
    a.setAttribute('aria-disabled', 'true');
    a.classList.add('button-disabled');
  }

  if (iconEl) {
    const iconWrap = document.createElement('span');
    iconWrap.className = 'button-icon';
    iconWrap.append(iconEl.cloneNode(true));
    if (classes.includes('icon-right')) {
      a.append(iconWrap);
    } else {
      a.prepend(iconWrap);
    }
  }

  block.textContent = '';
  block.append(a);
}
