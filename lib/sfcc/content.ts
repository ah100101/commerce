import { Menu, Page } from './types';

/**
 * NOTE: Currently, this function returns a hardcoded menu structure for demonstration purposes.
 * In a production application, the engineering team should update to retrieve menu content from
 * a CMS or other data source that is appropriate for the project.
 */
export function getMenu(handle: string): Menu[] {
  return getMenus().filter((menu) => menu.handle === handle)[0]?.links || [];
}

/**
 * NOTE: This function currently returns a hardcoded menu structure for demonstration purposes.
 * This should be replaced in a fetch to a CMS or other data source that is appropriate for the project.
 */
export function getMenus() {
  return [
    {
      handle: 'next-js-frontend-footer-menu',
      links: [
        {
          title: 'Home',
          path: '/'
        },
        {
          title: 'About',
          path: '/'
        },
        {
          title: 'Terms & Conditions',
          path: '/'
        },
        {
          title: 'Shipping & Return Policy',
          path: '/'
        },
        {
          title: 'Privacy Policy',
          path: '/'
        },
        {
          title: 'FAQ',
          path: '/'
        }
      ]
    },
    {
      handle: 'next-js-frontend-header-menu',
      links: [
        {
          title: 'New Arrivals',
          path: '/search/newarrivals'
        },
        {
          title: 'Women',
          path: '/search/womens'
        },
        {
          title: 'Men',
          path: '/search/mens'
        }
      ]
    }
  ];
}

// TODO
export async function getPage(handle: string): Promise<Page> {
  return {
    id: '1',
    title: 'TODO',
    handle: 'TODO',
    body: 'TODO',
    bodySummary: 'TODO',
    seo: undefined,
    createdAt: 'TODO',
    updatedAt: 'TODO'
  };
}

// TODO
export async function getPages(): Promise<Page[]> {
  return [
    await getPage('home'),
    await getPage('about'),
    await getPage('contact'),
    await getPage('faq'),
    await getPage('privacy-policy')
  ];
}
