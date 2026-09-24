# Product List Page Block

## Overview

The Product List Page block powers search and category listing pages using the storefront-product-discovery dropin. It renders faceted search results with sort, filters, pagination, product cards (with add-to-cart), and keeps the URL in sync with search state. The block supports two modes: **search page** (full-text search with optional filters) and **category page** (products in a category, optionally filtered).

## Configuration Options

Block configuration is read via `readBlockConfig(block)`.

| Option   | Effect |
|----------|--------|
| `urlpath` | When set, the block runs in **category page** mode: it filters by `categoryPath` and shows all products in that category. When absent, the block runs in **search page** mode and uses the `q` URL parameter as the search phrase. The value is also stored on the block as `data-urlpath` for use by other blocks (e.g. enrichment). |
| `pageSize` | Number of products per page. Defaults to `9` if not set or invalid. |

## Integration

### URL Parameters

Search state is read from and written to the URL by this project (see `search-url.js`). The dropin does not parse the URL.

| Parameter | Description |
|-----------|-------------|
| `q`       | Search phrase (search page only). |
| `page`    | Current page number (1-based). |
| `sort`    | Sort spec: comma-separated `attribute_DIRECTION` (e.g. `price_ASC,name_DESC`). |
| `filter`  | Filters: pipe-separated segments. Each segment is `attribute:value`; multiple values for the same attribute use multiple segments (e.g. `categories:val1\|categories:val2`). Supports `in` (single/multi-value) and numeric `range` (e.g. `price:0-100`). |

On load, the block normalizes the URL (e.g. filter format) with `replaceState`. After each search result, it updates the URL with `pushState` so the address bar reflects the current request.

### Events

#### Event Listeners

- `events.on('search/result', callback, { eager: true })` – Runs before the block re-renders. Updates empty-state class, result count text, and the facets button’s filter count.
- `events.on('search/result', callback, { eager: false })` – Runs after the block is rendered. Writes the search request (phrase, page, sort, filter) to the URL and calls `history.pushState`.

The block does not emit events; it calls the dropin’s `search()` API and reacts to `search/result`.

### Local Storage

This block does not use localStorage.

## Behavior Patterns

### Page Modes

- **Category page** (`config.urlpath` set): Initial search uses an empty phrase, `categoryPath` filter, visibility filter, and any sort/filter from the URL. Products are scoped to the category.
- **Search page** (no `urlpath`): Initial search uses `q` as the phrase, visibility filter, and sort/filter from the URL.

A visibility filter `{ attribute: 'visibility', in: ['Search', 'Catalog, Search'] }` is always added to the request; it is not persisted in the URL but is included when syncing the URL after each result.

### User Interaction Flows

1. **Initial load**: Block reads URL via `getSearchStateFromUrl`, normalizes the URL, then calls `search()` with phrase, page, sort, and filter (including visibility and, on category pages, categoryPath).
2. **Sort change**: User changes sort via SortBy; dropin calls `search()` with updated sort; block receives `search/result` and updates the URL.
3. **Filter change**: User toggles facets; dropin calls `search()` with updated filter; block updates result count and URL.
4. **Pagination**: User changes page; dropin calls `search()` with new page; block scrolls to top and URL is updated.
5. **Add to cart**: Product cards include an add-to-cart action handled by the cart dropin. For simple products, the add-to-cart button is disabled when `product.inStock` is falsy. Complex products always link to the PDP where stock is validated by the PDP drop-in.

### Product Card Anatomy

The card is the dropin `ProductItemCard`, customised through the `SearchResults` slots. Only fields that Catalog Service returns are rendered.

| Region | Slot | Source |
|--------|------|--------|
| Image (1:1, links to PDP) | `ProductImage` | `product.images[0]`; products with no image get a `.plp-card__image-placeholder` block |
| Name and colour swatches | `ProductName` | `product.name`; swatches from `swatches.js` |
| Price | dropin default | `product.price` / `product.priceRange` |
| Add to cart and stock status | `ProductActions` | `cartApi.addProductsToCart`, `product.inStock` |

Not rendered, because Catalog Service has no equivalent data: rating summary and review count, promo/new badges, quantity stepper, and intensity/strength indicators.

### Colour Swatches

Colours are a configurable-product feature: on a complex product the parent's `color` attribute is empty and the values live on its variants, and simple products have no variants to switch between.

The swatch values are fetched by `swatches.js` in one batched `products(skus:)` call per result page, because the product-discovery dropin drops `options` from its product model — the field is requested by its fragment but absent from the slot context, so extending the fragment does not help.

`swatches.js` picks the option whose values are `ProductViewOptionValueSwatch` with `type: COLOR_HEX` and uses `value` as the dot colour. Which option carries them varies by product (`color`, `color_code`, ...), and complex products whose values are plain `ProductViewOptionValueConfiguration` have no hex and render no dots. Out-of-stock values are dimmed.

Results are cached per SKU and re-read by the `ProductName` slot, since the dropin rebuilds slot content on every re-render.

### Styling

The block renders 1/2/4 columns to match the AEM grid PLP. The dropin ships its own 1/2/3/4 steps as container queries on the grid, but the grid is narrowed by the facets rail so its thresholds do not line up with the viewport; the block uses media queries, which win on specificity.

Card-level values are block-scoped custom properties (`--plp-*`) declared on `.block.product-list-page`.

Dropin CSS ships as a string inside the dropin JS bundles and is injected as a `<style>` placed before the first stylesheet link, so project CSS wins on equal specificity without `!important`. The dropin CSS is authored against design tokens, so the shared button tokens (`--color-brand-500`, `--color-button-hover`, `--color-button-active`, `--shape-border-radius-3`, `--type-button-*-font`) are pointed at the brand tokens in `styles/styles.css` to re-theme every dropin from one place.

Complex products render the add-to-cart action as an `<a>` to the PDP rather than a `<button>`, so both element types need styling, and the anchor needs `box-sizing: border-box` to keep `width: 100%` inside the card.

### Error Handling

- **Search API errors**: Initial `search()` calls are wrapped in `.catch()`; errors are logged with `console.error('Error searching for products', e)`. The block does not show an inline error UI; the dropin may show its own state.
- **Missing payload**: Result count and filter-count updates guard with `payload.result?.totalCount`, `payload.request?.phrase`, and `payload.request.filter.length` where appropriate.
