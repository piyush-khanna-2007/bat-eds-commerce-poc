/**
 * Colour swatch data for product list cards.
 *
 * The product-discovery dropin drops `options` from its product model, so the
 * swatch values are not reachable from the SearchResults slot context even
 * though the fragment requests them. They are fetched separately instead, in one
 * batched `products(skus:)` call per result page.
 */
import { fetchGraphQl } from '@dropins/storefront-product-discovery/api.js';

const PRODUCT_SWATCHES_QUERY = `
  query PRODUCT_SWATCHES($skus: [String]) {
    products(skus: $skus) {
      sku
      ... on ComplexProductView {
        options {
          id
          title
          values {
            __typename
            title
            ... on ProductViewOptionValueSwatch {
              id
              type
              value
              inStock
            }
          }
        }
      }
    }
  }
`;

/**
 * Picks the option whose values are colour-hex swatches.
 * Which option carries them varies by product (`color`, `color_code`, ...), and
 * some complex products only expose plain configuration values with no colour.
 * @param {object} product - Product from the batched swatch query
 * @returns {Array<{ id: string, title: string, value: string, inStock: boolean }>} Swatches
 */
function getColorSwatches(product) {
  const option = product.options?.find((opt) => opt.values?.some(
    (value) => value.__typename === 'ProductViewOptionValueSwatch' && value.type === 'COLOR_HEX',
  ));

  return option?.values
    ?.filter((value) => value.type === 'COLOR_HEX' && value.value)
    .map((value) => ({
      id: value.id,
      title: value.title,
      value: value.value,
      inStock: value.inStock !== false,
    })) ?? [];
}

/**
 * Fetches colour swatches for the given SKUs.
 * @param {string[]} skus - SKUs of the complex products on the current page
 * @returns {Promise<Map<string, Array<object>>>} Swatches keyed by SKU; SKUs
 * without colour swatches are omitted
 */
export default async function fetchColorSwatches(skus) {
  const swatchesBySku = new Map();
  if (!skus.length) return swatchesBySku;

  const { data, errors } = await fetchGraphQl(PRODUCT_SWATCHES_QUERY, {
    method: 'GET',
    variables: { skus },
  });

  if (errors?.length) {
    console.error('Error fetching product swatches', errors);
    return swatchesBySku;
  }

  (data?.products ?? []).forEach((product) => {
    const swatches = getColorSwatches(product);
    if (swatches.length) swatchesBySku.set(product.sku, swatches);
  });

  return swatchesBySku;
}
