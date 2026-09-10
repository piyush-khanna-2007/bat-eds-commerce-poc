import { createOptimizedPicture } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/ue-utils.js';

/**
 * Cards block with variants (added via the block name / classlist):
 *  - default : bordered card grid (boilerplate)
 *  - promo   : full-bleed banner image with overlaid heading + CTA
 *  - product : horizontally scrollable product carousel with prev/next controls
 *  - blog    : borderless 3-up article cards (image + title)
 *
 * All variants share the same decorated DOM (ul > li with
 * .cards-card-image / .cards-card-body); the visual differences live in
 * cards.css, keyed off the variant class on the block.
 */
export default function decorate(block) {
  /* change to ul, li */
  const ul = document.createElement('ul');
  [...block.children].forEach((row) => {
    const li = document.createElement('li');
    moveInstrumentation(row, li);
    while (row.firstElementChild) li.append(row.firstElementChild);
    [...li.children].forEach((div) => {
      if (div.children.length === 1 && div.querySelector('picture')) div.className = 'cards-card-image';
      else div.className = 'cards-card-body';
    });
    ul.append(li);
  });
  ul.querySelectorAll('picture > img').forEach((img) => {
    const optimizedPic = createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]);
    moveInstrumentation(img, optimizedPic.querySelector('img'));
    img.closest('picture').replaceWith(optimizedPic);
  });
  block.textContent = '';

  // Product variant: wrap the list in a horizontally scrollable carousel
  // with prev/next controls, mirroring the source product-list carousel.
  if (block.classList.contains('product')) {
    const carousel = document.createElement('div');
    carousel.className = 'cards-carousel';

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'cards-nav cards-prev';
    prev.setAttribute('aria-label', 'Scroll left');

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'cards-nav cards-next';
    next.setAttribute('aria-label', 'Scroll right');

    const scrollByCards = (dir) => {
      const firstCard = ul.querySelector('li');
      const step = firstCard ? firstCard.getBoundingClientRect().width + 24 : ul.clientWidth * 0.8;
      ul.scrollBy({ left: dir * step * 2, behavior: 'smooth' });
    };

    prev.addEventListener('click', () => scrollByCards(-1));
    next.addEventListener('click', () => scrollByCards(1));

    const updateNav = () => {
      const maxScroll = ul.scrollWidth - ul.clientWidth - 1;
      prev.disabled = ul.scrollLeft <= 0;
      next.disabled = ul.scrollLeft >= maxScroll;
    };
    ul.addEventListener('scroll', updateNav, { passive: true });
    window.addEventListener('resize', updateNav);

    carousel.append(prev, ul, next);
    block.append(carousel);

    // set initial nav state after layout settles
    requestAnimationFrame(updateNav);
    return;
  }

  block.append(ul);
}
