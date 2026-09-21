/**
 * Centralised React Query key constants.
 * Using these prevents typo-induced cache misses when the same logical data
 * is fetched from multiple components.
 */
export const QK = {
  branches: ['branches'] as const,
  tenantInfo: ['tenant-info'] as const,
  taxRatesActive: ['tax-rates-active'] as const,
  cashSessionActive: ['cash-session-active'] as const,
  currentSessionSales: ['current-session-sales'] as const,
  categories: ['categories'] as const,
  toppingGroups: ['topping-groups'] as const,
  productsWithToppings: ['products-with-toppings'] as const,
  productToppingGroups: (productId: string) => ['product-topping-groups', productId] as const,
  restaurantAreas: ['restaurant-areas'] as const,
  restaurantTables: (areaId?: string) => ['restaurant-tables', areaId ?? 'all'] as const,
  restaurantOpenOrders: ['restaurant-open-orders'] as const,
  restaurantOrder: (orderId: string) => ['restaurant-order', orderId] as const,
  /** One catalogue read behind a dine-in tab: resolves each ordered line's tax
   *  category and its current menu price. Restaurant mode only. */
  restaurantMenuSnapshot: ['restaurant-menu-snapshot'] as const,
  brands: ['brands'] as const,
  expenses: ['expenses'] as const,
  expenseCategories: ['expense-categories'] as const,
  financePnl: ['finance', 'profit-loss'] as const,
  financeCashFlow: ['finance', 'cash-flow'] as const,
  superAdmin: {
    me: ['super-admin', 'me'] as const,
  },
} as const;
