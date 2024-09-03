import { Checkout, Customer, Product as SalesforceProduct, Search } from 'commerce-sdk';
import { ShopperBaskets } from 'commerce-sdk/dist/checkout/checkout';
import { defaultSort, storeCatalog, TAGS } from 'lib/constants';
import { unstable_cache as cache, revalidateTag } from 'next/cache';
import { headers } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getProductRecommendations as getOCProductRecommendations } from './ocapi';
import { Cart, CartItem, Collection, Image, Product, ProductRecommendations } from './types';

type SortedProductResult = {
  productResult: SalesforceProduct.ShopperProducts.Product;
  index: number;
};

export const getCollections = cache(
  async () => {
    return await getSFCCCollections();
  },
  ['get-collections'],
  {
    tags: [TAGS.collections]
  }
);

export function getCollection(handle: string): Promise<Collection | undefined> {
  return getCollections().then((collections) => collections.find((c) => c.handle === handle));
}

export const getProduct = cache(async (id: string) => getSFCCProduct(id), ['get-product'], {
  tags: [TAGS.products]
});

export const getCollectionProducts = cache(
  async ({
    collection,
    reverse,
    sortKey
  }: {
    collection: string;
    reverse?: boolean;
    sortKey?: string;
  }) => {
    return await searchProducts({ categoryId: collection, sortKey });
  },
  ['get-collection-products'],
  { tags: [TAGS.products, TAGS.collections] }
);

export const getProducts = cache(
  async ({ query, sortKey }: { query?: string; sortKey?: string; reverse?: boolean }) => {
    return await searchProducts({ query, sortKey });
  },
  ['get-products'],
  {
    tags: [TAGS.products]
  }
);

export async function createCart(): Promise<Cart> {
  // get the guest config
  const config = await initializeGuestConfig();

  // initialize the basket config
  const basketClient = new Checkout.ShopperBaskets(config);

  // create an empty ShopperBaskets.Basket
  const createdBasket = await basketClient.createBasket({
    body: {}
  });

  const cartItems = await getCartItems(createdBasket);
  return reshapeBasket(createdBasket, cartItems);
}

export async function getCart(cartId: string | undefined): Promise<Cart | undefined> {
  const config = await initializeGuestConfig();

  if (!cartId) return;

  try {
    const basketClient = new Checkout.ShopperBaskets(config);
    const basket = await basketClient.getBasket({
      parameters: {
        basketId: cartId
      }
    });

    if (!basket?.basketId) return;

    const cartItems = await getCartItems(basket);
    return reshapeBasket(basket, cartItems);
  } catch (e: any) {
    console.log(await e.response.text());
    return;
  }
}

export async function addToCart(
  cartId: string,
  lines: { merchandiseId: string; quantity: number }[]
) {
  const config = await initializeGuestConfig();

  try {
    const basketClient = new Checkout.ShopperBaskets(config);
    const basket = await basketClient.addItemToBasket({
      parameters: {
        basketId: cartId
      },
      body: lines.map((line) => {
        return {
          productId: line.merchandiseId,
          quantity: line.quantity
        };
      })
    });

    if (!basket?.basketId) return;

    const cartItems = await getCartItems(basket);
    return reshapeBasket(basket, cartItems);
  } catch (e: any) {
    console.log(await e.response.text());
    return;
  }
}

export async function removeFromCart(cartId: string, lineIds: string[]): Promise<Cart> {
  // Next Commerce only sends one lineId at a time
  if (lineIds.length !== 1) throw new Error('Invalid number of line items provided');

  const config = await initializeGuestConfig();

  const basketClient = new Checkout.ShopperBaskets(config);

  const basket = await basketClient.removeItemFromBasket({
    parameters: {
      basketId: cartId,
      itemId: lineIds[0]!
    }
  });

  const cartItems = await getCartItems(basket);
  return reshapeBasket(basket, cartItems);
}

export async function updateCart(
  cartId: string,
  lines: { id: string; merchandiseId: string; quantity: number }[]
): Promise<Cart> {
  const config = await initializeGuestConfig();

  const basketClient = new Checkout.ShopperBaskets(config);
  const basket = await basketClient.getBasket({
    parameters: {
      basketId: cartId
    }
  });

  const updatedProductItems = basket.productItems?.map((productItem) => {
    return {
      ...productItem,
      quantity:
        lines.find((line) => line.id === productItem.itemId)?.quantity || productItem.quantity
    };
  });

  const updatedBasket = await basketClient.updateBasket({
    parameters: {
      basketId: cartId
    },
    body: {
      ...basket,
      productItems: updatedProductItems
    }
  });

  const cartItems = await getCartItems(updatedBasket);
  return reshapeBasket(updatedBasket, cartItems);
}

export async function getProductRecommendations(productId: string): Promise<Product[]> {
  const ocProductRecommendations =
    await getOCProductRecommendations<ProductRecommendations>(productId);

  if (!ocProductRecommendations?.recommendations?.length) return [];

  const clientConfig = await initializeOrganizationConfig();
  const productsClient = new SalesforceProduct.ShopperProducts(clientConfig);

  const recommendedProducts: SortedProductResult[] = [];

  await Promise.all(
    ocProductRecommendations.recommendations.map(async (recommendation, index) => {
      const productResult = await productsClient.getProduct({
        parameters: {
          organizationId: clientConfig.parameters.organizationId,
          siteId: clientConfig.parameters.siteId,
          id: recommendation.recommended_item_id
        }
      });
      recommendedProducts.push({ productResult, index });
    })
  );

  const sortedResults = recommendedProducts
    .sort((a: any, b: any) => a.index - b.index)
    .map((item) => item.productResult);

  return reshapeProducts(sortedResults);
}

export async function revalidate(req: NextRequest): Promise<NextResponse> {
  const collectionWebhooks = ['collections/create', 'collections/delete', 'collections/update'];
  const productWebhooks = ['products/create', 'products/delete', 'products/update'];
  const topic = headers().get('x-sfcc-topic') || 'unknown';
  const secret = req.nextUrl.searchParams.get('secret');
  const isCollectionUpdate = collectionWebhooks.includes(topic);
  const isProductUpdate = productWebhooks.includes(topic);

  if (!secret || secret !== process.env.SFCC_REVALIDATION_SECRET) {
    console.error('Invalid revalidation secret.');
    return NextResponse.json({ status: 200 });
  }

  if (!isCollectionUpdate && !isProductUpdate) {
    // We don't need to revalidate anything for any other topics.
    return NextResponse.json({ status: 200 });
  }

  if (isCollectionUpdate) {
    revalidateTag(TAGS.collections);
  }

  if (isProductUpdate) {
    revalidateTag(TAGS.products);
  }

  return NextResponse.json({ status: 200, revalidated: true, now: Date.now() });
}

async function getGuestUserAuthToken(): Promise<Customer.ShopperLogin.TokenResponse> {
  const config = {
    headers: {},
    parameters: {
      clientId: process.env.SFCC_CLIENT_ID,
      organizationId: process.env.SFCC_ORGANIZATIONID,
      shortCode: process.env.SFCC_SHORTCODE,
      siteId: process.env.SFCC_SITEID
    }
  };
  const base64data = Buffer.from(
    `${process.env.SFCC_CLIENT_ID}:${process.env.SFCC_SECRET}`
  ).toString('base64');
  const headers = { Authorization: `Basic ${base64data}` };
  const loginClient = new Customer.ShopperLogin(config);

  return await loginClient.getAccessToken({
    headers,
    body: { grant_type: 'client_credentials' }
  });
}

async function initializeGuestConfig() {
  const token = await getGuestUserAuthToken();

  if (!token.access_token) {
    throw new Error('Failed to retrieve access token');
  }

  return {
    headers: {
      authorization: `Bearer ${token.access_token}`
    },
    parameters: {
      clientId: process.env.SFCC_CLIENT_ID,
      organizationId: process.env.SFCC_ORGANIZATIONID,
      shortCode: process.env.SFCC_SHORTCODE,
      siteId: process.env.SFCC_SITEID
    }
  };
}

async function initializeOrganizationConfig() {
  const credentials = `${process.env.SFCC_CLIENT_ID}:${process.env.SFCC_SECRET}`;
  const base64data = Buffer.from(credentials).toString('base64');
  const headers = { Authorization: `Basic ${base64data}` };

  const clientConfig = {
    headers,
    parameters: {
      clientId: process.env.SFCC_CLIENT_ID,
      secret: process.env.SFCC_SECRET,
      organizationId: process.env.SFCC_ORGANIZATIONID,
      shortCode: process.env.SFCC_SHORTCODE,
      siteId: process.env.SFCC_SITEID
    }
  };

  const client = new Customer.ShopperLogin(clientConfig);

  const shopperToken = await client.getAccessToken({
    headers,
    body: {
      grant_type: 'client_credentials'
    }
  });

  const configWithAuth = {
    ...clientConfig,
    headers: { authorization: `Bearer ${shopperToken.access_token}` }
  };

  return configWithAuth;
}

async function getSFCCCollections(): Promise<Collection[]> {
  const config = await initializeOrganizationConfig();
  const productsClient = new SalesforceProduct.ShopperProducts(config);

  const result = await productsClient.getCategories({
    parameters: {
      ids: storeCatalog.ids
    }
  });

  return reshapeCategories(result.data || []);
}

async function getSFCCProduct(id: string) {
  const config = await initializeOrganizationConfig();
  const productsClient = new SalesforceProduct.ShopperProducts(config);

  const product = await productsClient.getProduct({
    parameters: {
      organizationId: config.parameters.organizationId,
      siteId: config.parameters.siteId,
      id
    }
  });

  return reshapeProduct(product);
}

async function searchProducts({
  query,
  categoryId,
  sortKey = defaultSort.sortKey
}: {
  query?: string;
  categoryId?: string;
  sortKey?: string;
}) {
  const config = await initializeOrganizationConfig();

  const searchClient = new Search.ShopperSearch(config);
  const searchResults = await searchClient.productSearch({
    parameters: {
      q: query || '',
      refine: categoryId ? [`cgid=${categoryId}`] : [],
      sort: sortKey,
      limit: 100
    }
  });

  const results: SortedProductResult[] = [];

  const productsClient = new SalesforceProduct.ShopperProducts(config);
  await Promise.all(
    searchResults.hits.map(async (product, index: number) => {
      const productResult = await productsClient.getProduct({
        parameters: {
          organizationId: config.parameters.organizationId,
          siteId: config.parameters.siteId,
          id: product.productId
        }
      });
      results.push({ productResult, index });
    })
  );

  const sortedResults = results
    .sort((a: any, b: any) => a.index - b.index)
    .map((item) => item.productResult);

  return reshapeProducts(sortedResults);
}

async function getCartItems(createdBasket: ShopperBaskets.Basket): Promise<CartItem[]> {
  const cartItems: CartItem[] = [];

  if (createdBasket.productItems) {
    const productsInCart: Product[] = [];

    // Fetch all matching products for items in the cart
    await Promise.all(
      createdBasket.productItems
        .filter((l: ShopperBaskets.ProductItem) => l.productId)
        .map(async (l: ShopperBaskets.ProductItem) => {
          const product = await getProduct(l.productId!);
          productsInCart.push(product);
        })
    );

    // Reshape the sfcc items and push them onto the cartItems
    createdBasket.productItems.map((productItem: ShopperBaskets.ProductItem) => {
      cartItems.push(
        reshapeProductItem(
          productItem,
          createdBasket.currency || 'USD',
          productsInCart.find((p) => p.id === productItem.productId)!
        )
      );
    });
  }

  return cartItems;
}

function reshapeCategory(
  category: SalesforceProduct.ShopperProducts.Category
): Collection | undefined {
  if (!category) {
    return undefined;
  }

  return {
    handle: category.id,
    title: category.name || '',
    description: category.description || '',
    seo: {
      title: category.pageTitle || '',
      description: category.description || ''
    },
    updatedAt: '',
    path: `/search/${category.id}`
  };
}

function reshapeCategories(categories: SalesforceProduct.ShopperProducts.Category[]): Collection[] {
  const reshapedCategories = [];
  for (const category of categories) {
    if (category) {
      const reshapedCategory = reshapeCategory(category);
      if (reshapedCategory) {
        reshapedCategories.push(reshapedCategory);
      }
    }
  }
  return reshapedCategories;
}

function reshapeProduct(product: SalesforceProduct.ShopperProducts.Product): Product {
  if (!product.name) {
    throw new Error('Product name is not set');
  }

  const images = reshapeImages(product.imageGroups);

  if (!images[0]) {
    throw new Error('Product image is not set');
  }

  const flattenedPrices =
    product.variants
      ?.filter((variant) => variant.price !== undefined)
      .reduce((acc: number[], variant) => [...acc, variant.price!], [])
      .sort((a, b) => a - b) || [];

  return {
    id: product.id,
    handle: product.id,
    title: product.name,
    description: product.shortDescription || '',
    descriptionHtml: product.longDescription || '',
    tags: product['c_product-tags'] || [],
    featuredImage: images[0],
    // TODO: check dates for whether it is available
    availableForSale: true,
    priceRange: {
      maxVariantPrice: {
        // TODO: verify whether there is another property for this
        amount: flattenedPrices[flattenedPrices.length - 1]?.toString() || '0',
        currencyCode: product.currency || 'USD'
      },
      minVariantPrice: {
        amount: flattenedPrices[0]?.toString() || '0',
        currencyCode: product.currency || 'USD'
      }
    },
    images: images,
    options:
      product.variationAttributes?.map((attribute) => {
        return {
          id: attribute.id,
          name: attribute.name!,
          // TODO: might be a better way to do this, we are providing the name as the value
          values: attribute.values?.filter((v) => v.value !== undefined)?.map((v) => v.name!) || []
        };
      }) || [],
    seo: {
      title: product.pageTitle || '',
      description: product.pageDescription || ''
    },
    variants: reshapeVariants(product.variants || [], product),
    updatedAt: product['c_updated-date']
  };
}

function reshapeProducts(products: SalesforceProduct.ShopperProducts.Product[]): Product[] {
  const reshapedProducts = [];
  for (const product of products) {
    if (product) {
      const reshapedProduct = reshapeProduct(product);
      if (reshapedProduct) {
        reshapedProducts.push(reshapedProduct);
      }
    }
  }
  return reshapedProducts;
}

function reshapeImages(
  imageGroups: SalesforceProduct.ShopperProducts.ImageGroup[] | undefined
): Image[] {
  if (!imageGroups) return [];

  const largeGroup = imageGroups.filter((g) => g.viewType === 'large');

  const images = [...largeGroup].map((group) => group.images).flat();

  return images.map((image) => {
    return {
      altText: image.alt!,
      url: image.link,
      // TODO: add field for size
      width: image.width || 800,
      height: image.height || 800
    };
  });
}

function reshapeVariants(
  variants: SalesforceProduct.ShopperProducts.Variant[],
  product: SalesforceProduct.ShopperProducts.Product
) {
  return variants.map((variant) => reshapeVariant(variant, product));
}

function reshapeVariant(
  variant: SalesforceProduct.ShopperProducts.Variant,
  product: SalesforceProduct.ShopperProducts.Product
) {
  return {
    id: variant.productId,
    title: product.name || '',
    availableForSale: variant.orderable || false,
    selectedOptions:
      Object.entries(variant.variationValues || {}).map(([key, value]) => ({
        // TODO: we use the name here instead of the key because the frontend only uses names
        name: product.variationAttributes?.find((attr) => attr.id === key)?.name || key,
        // TODO: might be a cleaner way to do this, we need to look up the name on the list of values from the variationAttributes
        value:
          product.variationAttributes
            ?.find((attr) => attr.id === key)
            ?.values?.find((v) => v.value === value)?.name || ''
      })) || [],
    price: {
      amount: variant.price?.toString() || '0',
      currencyCode: product.currency || 'USD'
    }
  };
}

function reshapeProductItem(
  item: Checkout.ShopperBaskets.ProductItem,
  currency: string,
  matchingProduct: Product
): CartItem {
  return {
    id: item.itemId || '',
    quantity: item.quantity || 0,
    cost: {
      totalAmount: {
        amount: item.price?.toString() || '0',
        currencyCode: currency
      }
    },
    merchandise: {
      id: item.productId || '',
      title: item.productName || '',
      selectedOptions:
        item.optionItems?.map((o) => {
          return {
            name: o.optionId!,
            value: o.optionValueId!
          };
        }) || [],
      product: matchingProduct
    }
  };
}

function reshapeBasket(basket: ShopperBaskets.Basket, cartItems: CartItem[]): Cart {
  return {
    id: basket.basketId!,
    checkoutUrl: '/checkout',
    cost: {
      subtotalAmount: {
        amount: basket.productTotal?.toString() || '0',
        currencyCode: basket.currency || 'USD'
      },
      totalAmount: {
        amount: basket.orderTotal?.toString() || '0',
        currencyCode: basket.currency || 'USD'
      },
      totalTaxAmount: {
        amount: basket.taxTotal?.toString() || '0',
        currencyCode: basket.currency || 'USD'
      }
    },
    totalQuantity: cartItems?.reduce((acc, item) => acc + (item?.quantity ?? 0), 0) || 0,
    lines: cartItems
  };
}
