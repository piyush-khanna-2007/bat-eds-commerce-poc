// Product Discovery Dropins
import SearchResults from '@dropins/storefront-product-discovery/containers/SearchResults.js';
import Facets from '@dropins/storefront-product-discovery/containers/Facets.js';
import SortBy from '@dropins/storefront-product-discovery/containers/SortBy.js';
import Pagination from '@dropins/storefront-product-discovery/containers/Pagination.js';
import { render as provider } from '@dropins/storefront-product-discovery/render.js';
import {
  Button, Icon, Incrementer, Price, provider as UI,
} from '@dropins/tools/components.js';
import { search } from '@dropins/storefront-product-discovery/api.js';
// Cart Dropin
import * as cartApi from '@dropins/storefront-cart/api.js';
import { tryRenderAemAssetsImage } from '@dropins/tools/lib/aem/assets.js';
// Event Bus
import { events } from '@dropins/tools/event-bus.js';
// AEM
import { readBlockConfig } from '../../scripts/aem.js';
import { fetchPlaceholders, getProductLink } from '../../scripts/commerce.js';
import { getSearchStateFromUrl, applySearchStateToUrl } from './search-url.js';
import fetchColorSwatches from './swatches.js';
import fetchVariants from './variants.js';

// Initializers
import '../../scripts/initializers/search.js';

// Square cards: the dropin defaults to 400x450, and the card CSS enforces aspect-ratio 1.
const IMAGE_WIDTH = 400;
const IMAGE_HEIGHT = 400;
// Catalog Service has no `available_quantity`, so there is no real ceiling to
// clamp the incrementer to; AEM falls back to the same arbitrary large number
// when a product is in stock.
const MAX_QUANTITY = 10000000;

export default async function decorate(block) {
  const labels = await fetchPlaceholders();

  const config = readBlockConfig(block);
  const pageSize = parseInt(config.pagesize, 10) || 9;

  const fragment = document.createRange().createContextualFragment(`
    <div class="search__wrapper">
      <div class="search__result-info"></div>
      <div class="search__view-facets"></div>
      <div class="search__facets"></div>
      <div class="search__product-sort"></div>
      <div class="search__product-list"></div>
      <div class="search__pagination"></div>
    </div>
  `);

  const $resultInfo = fragment.querySelector('.search__result-info');
  const $viewFacets = fragment.querySelector('.search__view-facets');
  const $facets = fragment.querySelector('.search__facets');
  const $productSort = fragment.querySelector('.search__product-sort');
  const $productList = fragment.querySelector('.search__product-list');
  const $pagination = fragment.querySelector('.search__pagination');

  block.innerHTML = '';
  block.appendChild(fragment);

  // Add url path back to the block for enrichment, incase enrichment block is
  // executed after the plp block and block config is not available
  if (config.urlpath) {
    block.dataset.urlpath = config.urlpath;
  }

  const searchState = getSearchStateFromUrl(new URL(window.location.href));

  // Default visibility filter for all of our requests
  const visibilityFilter = { attribute: 'visibility', in: ['Search', 'Catalog, Search'] };
  const userFilters = searchState.filter.filter((f) => f.attribute !== 'visibility');

  // Normalize URL (e.g. pipe-separated filter values)
  const normalizedUrl = new URL(window.location.href);
  applySearchStateToUrl(normalizedUrl, searchState);
  window.history.replaceState({}, '', normalizedUrl.toString());

  // Request search based on the page type on block load. Not awaited: the
  // SearchResults container below needs to mount before the response lands,
  // or its loading skeleton never has a chance to render (the container only
  // shows it while a request is in flight). search/result listeners below are
  // eager, so they still pick up this result whenever it arrives.
  if (config.urlpath) {
    // If it's a category page...
    search({
      phrase: '', // search all products in the category
      currentPage: searchState.currentPage,
      pageSize,
      sort: searchState?.sort?.length ? searchState.sort : [{ attribute: 'position', direction: 'DESC' }],
      filter: [
        { attribute: 'categoryPath', eq: config.urlpath }, // Add category filter
        // Always add visibility filter to the request
        visibilityFilter,
        ...userFilters,
      ],
    }).catch(() => {
      console.error('Error searching for products');
    });
  } else {
    // Search page: dropin uses only the request (no URL parsing).
    search({
      phrase: searchState.phrase,
      currentPage: searchState.currentPage,
      pageSize,
      sort: searchState.sort,
      // Always add visibility filter to the request
      filter: [visibilityFilter, ...userFilters],
    }).catch((e) => {
      console.error('Error searching for products', e);
    });
  }

  // Per-card mutable state (swatches, image/price/CTA/stock elements) lives
  // here, keyed by the parent product's SKU. Populated as the ProductName/
  // Image/Actions slots run, and updated in place when a swatch resolves or
  // is clicked. SearchResults gives no other way to persist state per card.
  const cardState = new Map();
  const getCardState = (sku) => cardState.get(sku) ?? {};
  const setCardState = (sku, patch) => cardState.set(sku, { ...getCardState(sku), ...patch });

  // Some SimpleProductView products still carry a required custom option
  // (e.g. purchase_type) via ac_customizable_options; Magento rejects a
  // direct add-to-cart for these with "required option(s) weren't entered",
  // so they need the PDP just like a ComplexProductView does.
  const hasRequiredCustomOption = (product) => {
    const customOptions = product.attributes?.find((attr) => attr.name === 'ac_customizable_options');
    return customOptions?.value?.selectable?.some((option) => option.required === '1') ?? false;
  };

  const requiresPdpConfiguration = (product) => product.typename === 'ComplexProductView'
    || product.attributes?.some((attr) => attr.name === 'ac_giftcard')
    || hasRequiredCustomOption(product);

  // ComplexProductView's quantity input starts disabled but becomes usable
  // once a swatch resolves a variant. Gift cards and required-custom-option
  // products have no such resolution path on this page, so — matching AEM's
  // buy-button removal for the same case — no quantity input is rendered at
  // all rather than leaving a permanently disabled one.
  const canResolveOnCard = (product) => product.typename === 'ComplexProductView';

  const setStockStatus = (statusEl, inStock) => {
    statusEl.classList.toggle('plp-card__stock--in', inStock);
    statusEl.classList.toggle('plp-card__stock--out', !inStock);
    statusEl.textContent = inStock
      ? labels.Global?.InStock ?? 'In stock'
      : labels.Global?.OutOfStock ?? 'Currently unavailable';
  };

  const getStockStatus = (product) => {
    const status = document.createElement('p');
    status.className = 'plp-card__stock';
    setStockStatus(status, product.inStock);
    return status;
  };

  // AEM hides the quantity/buy row entirely for an out-of-stock product
  // (only the status text remains) rather than just disabling it.
  const setBuyRowVisible = (buyRowEl, visible) => {
    buyRowEl.classList.toggle('plp-card__buy-row--hidden', !visible);
  };

  /**
   * Mounts a hidden checkmark icon over an add-to-cart button wrapper, shown
   * via CSS only while the wrapper has the `--success` class. Rendered as its
   * own element rather than swapped into the button's `icon` prop, since
   * replacing that prop was re-rendering the button at a smaller size.
   * Appended inside the real `.dropin-button` (not its outer wrapper div),
   * since that's the element `position: relative` is applied to.
   * @param {HTMLElement} buttonWrapperEl - Wrapper div the button is rendered into
   */
  const mountSuccessIcon = async (buttonWrapperEl) => {
    const successIconEl = document.createElement('div');
    successIconEl.className = 'plp-card__add-to-cart-success-icon';
    await UI.render(Icon, { source: 'CheckWithCircle' })(successIconEl);
    buttonWrapperEl.querySelector('.dropin-button')?.appendChild(successIconEl);
  };

  /**
   * Adds a product to the cart with the same loading/success feedback as the
   * AEM PLP's buy button: the label stays put but blurs, the icon is hidden
   * behind a spinner overlay while the request is in flight, then swaps to a
   * checkmark and holds briefly on success (AEM holds for ~1s) before
   * resetting. An aria-live region additionally announces progress for
   * screen readers, which the AEM version's purely visual treatment does not;
   * a failure is logged rather than left silent (a dedicated error
   * notification is out of scope for the PLP).
   * @param {HTMLElement} buttonWrapperEl - Wrapper div the button is rendered into
   * @param {object} buttonHandle - Render handle of the button being clicked
   * @param {HTMLElement} statusEl - aria-live element to announce progress
   * @param {string} sku - SKU to add to the cart
   * @param {number} quantity - Quantity to add
   */
  const addToCartWithFeedback = async (buttonWrapperEl, buttonHandle, statusEl, sku, quantity) => {
    try {
      buttonWrapperEl.classList.add('plp-card__add-to-cart--loading');
      buttonHandle.setProps((prev) => ({ ...prev, disabled: true }));
      statusEl.textContent = labels.Global?.AddingToCart ?? 'Adding to Cart';
      await cartApi.addProductsToCart([{ sku, quantity }]);
      buttonWrapperEl.classList.replace('plp-card__add-to-cart--loading', 'plp-card__add-to-cart--success');
      statusEl.textContent = labels.Global?.AddedToCart ?? 'Added to cart';
      await new Promise((resolve) => { setTimeout(resolve, 1000); });
    } catch (error) {
      console.error('Error adding product to cart', error);
    } finally {
      buttonWrapperEl.classList.remove('plp-card__add-to-cart--loading', 'plp-card__add-to-cart--success');
      buttonHandle.setProps((prev) => ({ ...prev, disabled: false }));
      statusEl.textContent = '';
    }
  };

  /**
   * Renders the add-to-cart action for a product's initial (parent) state.
   * Complex products link to the PDP instead of adding to cart directly,
   * since they render with no colour selected. Once a swatch resolves the
   * add-to-cart button is swapped out entirely, since the interaction and
   * accessible label both need to change (see updateCardVariant).
   * @param {object} product - Product from the search result
   * @param {HTMLElement} statusEl - aria-live element to announce progress
   * @returns {Promise<HTMLElement>} Add-to-cart action element
   */
  const getAddToCartButton = async (product, statusEl) => {
    const productName = product.name || product.sku;
    const addToCartLabel = `${labels.Global?.AddProductToCart} ${productName}`;

    if (requiresPdpConfiguration(product)) {
      const button = document.createElement('div');
      UI.render(Button, {
        'aria-label': addToCartLabel,
        children: labels.Global?.AddProductToCart,
        // icon: Icon({ source: 'Cart' }),
        href: getProductLink(product.urlKey, product.sku),
        variant: 'primary',
        disabled: !product.inStock,
      })(button);
      return button;
    }
    const button = document.createElement('div');
    const buttonHandle = await UI.render(Button, {
      'aria-label': addToCartLabel,
      children: labels.Global?.AddProductToCart,
      // icon: Icon({ source: 'Cart' }),
      onClick: () => {
        const { quantity } = getCardState(product.sku);
        addToCartWithFeedback(button, buttonHandle, statusEl, product.sku, quantity ?? 1);
      },
      variant: 'primary',
      disabled: !product.inStock,
    })(button);
    await mountSuccessIcon(button);
    return button;
  };

  /**
   * Renders the quantity stepper for a card. Disabled until a product can be
   * added to cart directly: complex products start out linking to the PDP
   * (see getAddToCartButton), so quantity has no effect until a swatch
   * resolves a variant.
   * @param {object} product - Product from the search result
   * @returns {Promise<{ el: HTMLElement, handle: object }>} Mounted element and its render handle
   */
  const renderQuantity = async (product) => {
    const quantityEl = document.createElement('div');
    const handle = await UI.render(Incrementer, {
      'aria-label': labels.Global?.Quantity ?? 'Quantity',
      value: '1',
      min: 1,
      max: MAX_QUANTITY,
      disabled: requiresPdpConfiguration(product) || !product.inStock,
      onValue: (value) => setCardState(product.sku, { quantity: value }),
    })(quantityEl);
    quantityEl.className = 'plp-card__quantity';
    return { el: quantityEl, handle };
  };

  /**
   * Applies a resolved variant's data to a card: image, price, stock status,
   * and add-to-cart target. Swaps the add-to-cart button rather than mutating
   * it, since a variant can always be added directly (unlike the unconfigured
   * parent, which may need to link to the PDP).
   * @param {string} parentSku - SKU of the card's parent complex product
   * @param {object} variant - Variant product data from `variants.js`
   */
  const updateCardVariant = async (parentSku, variant) => {
    const state = getCardState(parentSku);
    if (!state.actionsEl) return;

    const imageEl = state.imageWrapper?.querySelector('img');
    if (imageEl && variant.images?.[0]?.url) {
      // srcset takes precedence over src; clear it or the browser keeps the old variant's image.
      imageEl.removeAttribute('srcset');
      imageEl.src = variant.images[0].url;
      imageEl.alt = variant.images[0].label || variant.name || variant.sku;
    }

    const amount = variant.price?.final?.amount;
    if (amount) {
      state.priceHandle.setProps((prev) => (
        { ...prev, amount: amount.value, currency: amount.currency }
      ));
    }

    setStockStatus(state.stockEl, variant.inStock);
    setBuyRowVisible(state.buyRowEl, variant.inStock);

    // A newly resolved variant starts a fresh quantity, same as switching
    // colour on the AEM PLP resets its quantity stepper.
    setCardState(parentSku, { quantity: 1 });
    state.quantityHandle?.setProps((prev) => ({ ...prev, value: '1', disabled: !variant.inStock }));

    const addToCartLabel = `${labels.Global?.AddProductToCart} ${variant.name || variant.sku}`;
    const button = document.createElement('div');
    const buttonHandle = await UI.render(Button, {
      'aria-label': addToCartLabel,
      children: labels.Global?.AddProductToCart,
      // icon: Icon({ source: 'Cart' }),
      onClick: () => {
        const { quantity } = getCardState(parentSku);
        const status = state.addToCartStatusEl;
        addToCartWithFeedback(button, buttonHandle, status, variant.sku, quantity ?? 1);
      },
      variant: 'primary',
      disabled: !variant.inStock,
    })(button);
    await mountSuccessIcon(button);
    button.className = 'plp-card__add-to-cart';

    // Replace only the add-to-cart button; the quantity stepper is reused.
    state.buyRowEl.querySelector('.plp-card__add-to-cart')?.remove();
    state.buyRowEl.appendChild(button);
  };

  /**
   * Marks a swatch button as selected within its list; the AEM PLP applies
   * the same single-active-button pattern for its own variant buttons.
   * @param {HTMLElement} swatchList - The swatch button list
   * @param {HTMLButtonElement} selectedButton - The button to mark selected
   */
  const setSelectedSwatch = (swatchList, selectedButton) => {
    [...swatchList.querySelectorAll('.plp-card__color')]
      .forEach((el) => el.classList.toggle('plp-card__color--selected', el === selectedButton));
  };

  /**
   * Selects a colour swatch on click: fetches (and caches) the parent's
   * variants, then applies the matching one to the card.
   * @param {string} parentSku - SKU of the card's parent complex product
   * @param {string} swatchId - Option-value id of the swatch to select
   * @param {HTMLElement} swatchList - The swatch button list, for the selected state
   * @param {HTMLButtonElement} swatchButton - The swatch button to select
   */
  const selectSwatch = async (parentSku, swatchId, swatchList, swatchButton) => {
    setSelectedSwatch(swatchList, swatchButton);

    const { byId } = await fetchVariants(parentSku);
    const variant = byId.get(swatchId);
    if (!variant) return;

    updateCardVariant(parentSku, variant);
  };

  /**
   * Renders colour swatches as buttons; clicking one swaps the card to that variant.
   * Only complex products have colours: on a configurable product the parent's
   * `color` attribute is empty and the values live on its variants.
   * @param {string} parentSku - SKU of the card's parent complex product
   * @param {Array<{ id: string, title: string, value: string, inStock: boolean }>} swatches -
   * Colour swatches
   * @returns {{ list: HTMLUListElement, buttonsById: Map<string, HTMLButtonElement> }}
   * Swatch button list and a lookup of button by swatch id
   */
  const renderColorSwatches = (parentSku, swatches) => {
    const list = document.createElement('ul');
    list.className = 'plp-card__colors';
    const buttonsById = new Map();

    swatches.forEach((swatch) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'plp-card__color';
      button.classList.toggle('plp-card__color--out-of-stock', !swatch.inStock);
      button.style.setProperty('--plp-swatch-color', swatch.value);
      button.title = swatch.title;
      button.setAttribute('aria-label', swatch.title);
      button.addEventListener('click', () => selectSwatch(parentSku, swatch.id, list, button));
      item.appendChild(button);
      list.appendChild(item);
      buttonsById.set(swatch.id, button);
    });

    return { list, buttonsById };
  };

  /**
   * Renders and appends a card's colour swatch buttons, and remembers them so
   * the auto-activation pass below can mark the right one selected. Purely
   * visual: whether a product has renderable swatches is unrelated to whether
   * it can be activated (see activateFirstInStockVariant).
   * @param {string} parentSku - SKU of the card's parent complex product
   * @param {Array<{ id: string, title: string, value: string, inStock: boolean }>} swatches -
   * Colour swatches
   * @param {HTMLElement} containerEl - Element to append the swatch list into
   */
  const mountSwatchButtons = (parentSku, swatches, containerEl) => {
    const { list, buttonsById } = renderColorSwatches(parentSku, swatches);
    containerEl.appendChild(list);
    setCardState(parentSku, { swatchList: list, swatchButtonsById: buttonsById });
  };

  /**
   * Activates a complex product's first in-stock variant, whether or not it
   * has a renderable colour swatch. AEM's own PLP resolves the first in-stock
   * variant unconditionally — its activation logic never checks swatch data
   * quality, only availability — so a product like one with a single
   * in-stock variant and no usable swatch colour is still fully purchasable.
   *
   * "First" is decided by the swatch display order (`swatches`, left-to-right
   * as rendered), not by `variants()`'s own response order: the two Catalog
   * Service resolvers do not agree on ordering — verified reversed for every
   * complex product checked — so `variants()` is only used to look up a
   * given swatch's product data, never to decide which swatch is first.
   * @param {string} parentSku - SKU of the card's parent complex product
   */
  const activateFirstInStockVariant = async (parentSku) => {
    const { byId, list } = await fetchVariants(parentSku);
    const { swatches, swatchList, swatchButtonsById } = getCardState(parentSku);

    let selection;
    if (swatches?.length) {
      const firstInStockSwatch = swatches.find((swatch) => swatch.inStock);
      if (!firstInStockSwatch) return;
      selection = { id: firstInStockSwatch.id, product: byId.get(firstInStockSwatch.id) };
    } else {
      // No swatch display order to honour: fall back to variants() as-is.
      const firstInStockVariant = list.find((variant) => variant.product.inStock);
      if (!firstInStockVariant) return;
      selection = { id: firstInStockVariant.selections[0], product: firstInStockVariant.product };
    }
    if (!selection.product) return;

    if (swatchButtonsById?.has(selection.id)) {
      setSelectedSwatch(swatchList, swatchButtonsById.get(selection.id));
    }

    updateCardVariant(parentSku, selection.product);
  };

  await Promise.all([
    // Sort By
    provider.render(SortBy, {})($productSort),

    // Pagination
    provider.render(Pagination, {
      onPageChange: () => {
        // scroll to the top of the page
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    })($pagination),

    // View Facets Button
    UI.render(Button, {
      children: labels.Global?.Filters,
      icon: Icon({ source: 'Burger' }),
      variant: 'secondary',
      onClick: () => {
        $facets.classList.toggle('search__facets--visible');
      },
    })($viewFacets),

    // Facets
    provider.render(Facets, {})($facets),
    // Product List
    provider.render(SearchResults, {
      routeProduct: (product) => getProductLink(product.urlKey, product.sku),
      imageWidth: IMAGE_WIDTH,
      imageHeight: IMAGE_HEIGHT,
      skeletonCount: pageSize,
      slots: {
        ProductImage: (ctx) => {
          const { product, defaultImageProps } = ctx;
          const anchorWrapper = document.createElement('a');
          anchorWrapper.href = getProductLink(product.urlKey, product.sku);
          anchorWrapper.setAttribute('aria-label', product.name || product.sku);

          if (!product.images?.length) {
            anchorWrapper.classList.add('plp-card__image-placeholder');
            ctx.replaceWith(anchorWrapper);
            return;
          }

          tryRenderAemAssetsImage(ctx, {
            alias: product.sku,
            imageProps: defaultImageProps,
            wrapper: anchorWrapper,
            params: {
              width: defaultImageProps.width,
              height: defaultImageProps.height,
            },
          });

          // Swatch clicks swap this <img>'s src directly; simpler than re-running
          // the responsive-image pipeline for a single variant image URL.
          // tryRenderAemAssetsImage renders it asynchronously, so the <img> is
          // looked up lazily rather than queried right after this call.
          setCardState(product.sku, { imageWrapper: anchorWrapper });
        },
        // Colours ride along here because SearchResults never passes the card's
        // `swatches` prop, so there is no swatch slot to render into. The dots
        // are filled in once the batched swatch request resolves.
        ProductName: (ctx) => {
          const { product } = ctx;
          const wrapper = document.createElement('div');
          wrapper.className = 'plp-card__info';
          wrapper.dataset.sku = product.sku;

          const link = document.createElement('a');
          link.className = 'plp-card__name';
          link.href = getProductLink(product.urlKey, product.sku);
          link.textContent = product.name || product.sku;
          wrapper.appendChild(link);

          const { swatches } = getCardState(product.sku);
          if (swatches?.length) mountSwatchButtons(product.sku, swatches, wrapper);

          setCardState(product.sku, { infoEl: wrapper });
          ctx.replaceWith(wrapper);
        },
        // Rendered through the dropin Price component (rather than left as the
        // default) so a swatch click can update it in place via setProps.
        // UI.render(...)(el) resolves to the mounted handle asynchronously.
        ProductPrice: async (ctx) => {
          const { product } = ctx;
          const amount = product.price?.final?.amount ?? product.priceRange?.minimum?.final?.amount;
          const priceEl = document.createElement('span');
          const priceHandle = await UI.render(Price, {
            amount: amount?.value,
            currency: amount?.currency,
          })(priceEl);
          setCardState(product.sku, { priceHandle });
          ctx.replaceWith(priceEl);
        },
        // UI.render(...)(el) resolves to the mounted handle asynchronously.
        ProductActions: async (ctx) => {
          const { product } = ctx;
          const actionsWrapper = document.createElement('div');
          actionsWrapper.className = 'plp-card__actions';

          const buyRowEl = document.createElement('div');
          buyRowEl.className = 'plp-card__buy-row';

          // Visually hidden; announces add-to-cart progress for screen reader
          // users, since the button's own label/disabled changes are not.
          const addToCartStatusEl = document.createElement('p');
          addToCartStatusEl.className = 'plp-card__add-to-cart-status';
          addToCartStatusEl.setAttribute('role', 'status');
          addToCartStatusEl.setAttribute('aria-live', 'polite');

          const needsQuantity = !requiresPdpConfiguration(product) || canResolveOnCard(product);
          const quantityResult = needsQuantity ? await renderQuantity(product) : null;
          const addToCartBtn = await getAddToCartButton(product, addToCartStatusEl);
          addToCartBtn.className = 'plp-card__add-to-cart';
          const stockEl = getStockStatus(product);

          if (quantityResult) buyRowEl.appendChild(quantityResult.el);
          buyRowEl.appendChild(addToCartBtn);
          setBuyRowVisible(buyRowEl, product.inStock);

          actionsWrapper.appendChild(buyRowEl);
          actionsWrapper.appendChild(stockEl);
          actionsWrapper.appendChild(addToCartStatusEl);
          setCardState(product.sku, {
            actionsEl: actionsWrapper,
            buyRowEl,
            stockEl,
            quantityEl: quantityResult?.el,
            quantityHandle: quantityResult?.handle,
            quantity: 1,
            addToCartStatusEl,
          });
          ctx.replaceWith(actionsWrapper);

          // Revisiting a page (e.g. via pagination) re-runs this slot against
          // swatches already resolved from a prior visit; the search/result
          // handler below only activates on first resolution, so re-trigger it
          // here against this fresh element instead of the stale one it saw.
          if (getCardState(product.sku).swatches) activateFirstInStockVariant(product.sku);
        },
      },
    })($productList),
  ]);

  // Listen for search results (event is fired before the block is rendered; eager: true)
  events.on('search/result', (payload) => {
    const totalCount = payload.result?.totalCount || 0;

    block.classList.toggle('product-list-page--empty', totalCount === 0);

    // Results Info
    $resultInfo.innerHTML = payload.request?.phrase
      ? `${totalCount} results found for <strong>"${payload.request.phrase}"</strong>.`
      : `${totalCount} results found.`;

    // Update the view facets button with the number of filters
    if (payload.request.filter.length > 0) {
      $viewFacets.querySelector('button').setAttribute('data-count', payload.request.filter.length);
    } else {
      $viewFacets.querySelector('button').removeAttribute('data-count');
    }
  }, { eager: true });

  // Listen for search results (event is fired after the block is rendered; eager: false)
  // URL is owned by this project; update it when search state changes.
  events.on('search/result', (payload) => {
    const url = new URL(window.location.href);
    applySearchStateToUrl(url, payload.request);
    window.history.pushState({}, '', url.toString());
  }, { eager: false });

  // Colour swatches and variant activation. Eager so the initial result
  // (already fired by the search() above) is replayed; awaiting the fetches
  // lets the card re-render land first.
  events.on('search/result', async (payload) => {
    const complexSkus = (payload.result?.items ?? [])
      .filter((product) => product.typename === 'ComplexProductView')
      .map((product) => product.sku);

    const unresolved = complexSkus.filter((sku) => !getCardState(sku).swatches);
    const swatchesBySku = await fetchColorSwatches(unresolved);
    // Only unresolved SKUs need a `swatches` entry written (possibly empty) so
    // they aren't re-fetched later; already-cached ones must be left alone, or
    // revisiting a page (e.g. via pagination) would wipe their swatches back out.
    unresolved.forEach((sku) => setCardState(sku, { swatches: swatchesBySku.get(sku) ?? [] }));

    complexSkus.forEach((sku) => {
      const { infoEl, swatches } = getCardState(sku);
      if (infoEl && swatches.length && !infoEl.querySelector('.plp-card__colors')) {
        mountSwatchButtons(sku, swatches, infoEl);
      }
    });

    await Promise.all(complexSkus.map((sku) => activateFirstInStockVariant(sku)));
  }, { eager: true });
}
