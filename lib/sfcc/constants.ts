export type SortFilterItem = {
  title: string;
  slug: string | null;
  sortKey:
    | 'best-matches'
    | 'price-low-to-high'
    | 'price-high-to-low'
    | 'product-name-ascending'
    | 'product-name-descending';
  reverse: boolean;
};

export const storeCatalog = {
  ids: 'mens,womens,newarrivals,top-seller'
};

export const defaultSort: SortFilterItem = {
  title: 'Best Matches',
  slug: 'best-matches',
  sortKey: 'best-matches',
  reverse: false
};
