import { TAGS } from 'lib/constants';
import { ensureStartsWith } from 'lib/utils';
import { isSFCCError } from './type-guards';
import { Product, ProductRecommendations } from './types';

const domain = process.env.SFCC_SANDBOX_DOMAIN
  ? ensureStartsWith(process.env.SFCC_SANDBOX_DOMAIN, 'https://')
  : '';

type ExtractVariables<T> = T extends { variables: object } ? T['variables'] : never;

export async function getProductRecommendations(productId: string): Promise<Product[]> {
  const productRecommendationsEndpoint = `/products/${productId}/recommendations`;

  const res = await sfOpenCommerceFetch<ProductRecommendations>({
    method: 'GET',
    endpoint: productRecommendationsEndpoint,
    tags: [TAGS.products]
  });

  return [];
  // const recommendedProducts: SortedProductResult[] = [];

  // const clientConfig = await initializeOrganizationConfig();
  // const productsClient = new SalesForceProduct.ShopperProducts(clientConfig);

  // if (!res.body?.recommendations) return [];

  // await Promise.all(
  //   res.body.recommendations.map(async (recommendation, index) => {
  //     const productResult = await productsClient.getProduct({
  //       parameters: {
  //         organizationId: clientConfig.parameters.organizationId,
  //         siteId: clientConfig.parameters.siteId,
  //         id: recommendation.recommended_item_id
  //       }
  //     });
  //     recommendedProducts.push({ productResult, index });
  //   })
  // );

  // const sortedResults = recommendedProducts
  //   .sort((a: any, b: any) => a.index - b.index)
  //   .map((item) => item.productResult);

  // return reshapeProducts(sortedResults);
}

async function sfOpenCommerceFetch<T>({
  method,
  endpoint = '',
  cache = 'force-cache',
  headers,
  tags,
  variables,
  api
}: {
  method: 'POST' | 'GET';
  endpoint?: string;
  cache?: RequestCache;
  headers?: HeadersInit;
  tags?: string[];
  variables?: ExtractVariables<T>;
  api?: 'shop' | 'data';
}): Promise<{ status: number; body: T } | never> {
  const apiEndpoint = `${domain}${api === 'data' ? process.env.SFCC_OPENCOMMERCE_DATA_API_ENDPOINT : process.env.SFCC_OPENCOMMERCE_SHOP_API_ENDPOINT}${endpoint}?client_id=${process.env.SFDC_CLIENT_ID}`;
  try {
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      cache,
      ...(tags && { next: { tags } })
    };

    if (method === 'POST' && variables) {
      fetchOptions.body = JSON.stringify({ variables });
    }

    const res = await fetch(apiEndpoint, fetchOptions);

    const body = await res.json();

    if (body.errors) {
      throw body.errors[0];
    }

    return {
      status: res.status,
      body
    };
  } catch (e) {
    if (isSFCCError(e)) {
      throw {
        version: e._v || 'unknown',
        fault: e?.fault || {},
        endpoint
      };
    }

    throw {
      error: e
    };
  }
}
