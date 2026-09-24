/**
 * Variant data for product list cards.
 *
 * Catalog Service has no equivalent of AEM's inline `variants { product { ... } }`
 * on the list query — `variants` only exists as a root query taking a single sku
 * (see `swatches.js` for the same constraint on colour data). Each complex
 * product's variants are fetched lazily, on first swatch interaction, and cached.
 */
import { fetchGraphQl } from '@dropins/storefront-product-discovery/api.js';

const PRODUCT_VARIANTS_QUERY = `
  query PRODUCT_VARIANTS($sku: String!) {
    variants(sku: $sku, pageSize: 10) {
      variants {
        selections
        product {
          sku
          name
          inStock
          images(roles: ["image"]) { url label }
          ... on SimpleProductView {
            price { final { amount { value currency } } }
          }
        }
      }
    }
  }
`;

const variantsBySku = new Map();

/**
 * Fetches the variants of a complex product.
 * @param {string} sku - SKU of the parent complex product
 * @returns {Promise<{ list: Array<{ selections: string[], product: object }>,
 * byId: Map<string, object> }>} Variants in query order, and product data
 * keyed by selection (swatch/option-value) id
 */
export default async function fetchVariants(sku) {
  if (variantsBySku.has(sku)) return variantsBySku.get(sku);

  const list = [];
  const byId = new Map();
  const result = { list, byId };
  variantsBySku.set(sku, result);

  const { data, errors } = await fetchGraphQl(PRODUCT_VARIANTS_QUERY, {
    method: 'GET',
    variables: { sku },
  });

  if (errors?.length) {
    console.error('Error fetching product variants', errors);
    return result;
  }

  (data?.variants?.variants ?? []).forEach((variant) => {
    list.push(variant);
    variant.selections.forEach((id) => byId.set(id, variant.product));
  });

  return result;
}
