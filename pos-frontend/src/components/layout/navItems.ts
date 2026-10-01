import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  UtensilsCrossed,
  Tags,
  Users,
  UserSquare2,
  BarChart3,
  Settings,
  Store,
  Building2,
  Truck,
  ArrowRightLeft,
  Wallet,
  TrendingUp,
  Activity,
  UserCircle,
  LayoutGrid,
  Salad,
  type LucideIcon,
} from 'lucide-react';
import { QK } from '@/lib/queryKeys';
import { branchService } from '@/services/branchService';
import { useAuthStore } from '@/stores/authStore';

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Who may see it. Absent = every signed-in role. Mirrors the backend's
   *  @PreAuthorize on the screen's API, so a hidden link is never the only guard. */
  roles?: readonly string[];
  requiredFeature?: string;
  /** Only worth showing when the tenant has more than one branch. */
  multiBranchOnly?: boolean;
  /** Extra words the command palette matches on. */
  keywords?: string;
};

const MANAGERS = ['ADMIN', 'MANAGER'] as const;
const STOCK = ['ADMIN', 'MANAGER', 'INVENTORY_MANAGER'] as const;

/**
 * The dashboard's pages, in sidebar order — the one list both the sidebar and
 * the command palette read, so the two can no longer drift apart.
 *
 * Visibility is the `roles` field, never the label: the labels are restaurant
 * wording ("Menu Items") and free to change without changing who sees what.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/overview', icon: LayoutDashboard, roles: MANAGERS, keywords: 'dashboard' },
  {
    label: 'Menu Items',
    href: '/inventory/products',
    icon: UtensilsCrossed,
    requiredFeature: 'INVENTORY',
    keywords: 'products dishes food drinks menu',
  },
  {
    label: 'Menu Categories',
    href: '/inventory/categories',
    icon: Tags,
    requiredFeature: 'INVENTORY',
    keywords: 'categories sections',
  },
  { label: 'Tables', href: '/restaurant/tables', icon: LayoutGrid, roles: MANAGERS, keywords: 'floor areas' },
  { label: 'Add-ons', href: '/restaurant/toppings', icon: Salad, roles: MANAGERS, keywords: 'toppings extras modifiers' },
  {
    label: 'Customers',
    href: '/customers',
    icon: Users,
    roles: ['ADMIN', 'MANAGER', 'CASHIER'],
    requiredFeature: 'CUSTOMERS',
    keywords: 'loyalty',
  },
  { label: 'Suppliers', href: '/inventory/suppliers', icon: Building2, roles: STOCK, requiredFeature: 'INVENTORY' },
  {
    label: 'Purchase Orders',
    href: '/inventory/purchase-orders',
    icon: Truck,
    roles: STOCK,
    requiredFeature: 'PURCHASE_ORDERS',
    keywords: 'po buying',
  },
  {
    label: 'Stock Transfers',
    href: '/inventory/stock-transfers',
    icon: ArrowRightLeft,
    roles: STOCK,
    requiredFeature: 'STOCK_TRANSFERS',
    multiBranchOnly: true,
  },
  { label: 'Employees', href: '/employees', icon: UserSquare2, roles: MANAGERS, requiredFeature: 'EMPLOYEES', keywords: 'staff' },
  { label: 'Reports', href: '/reports', icon: BarChart3, roles: MANAGERS, requiredFeature: 'REPORTS' },
  { label: 'Expenses', href: '/finance/expenses', icon: Wallet, roles: MANAGERS, requiredFeature: 'EXPENSES' },
  { label: 'Cash Flow', href: '/finance/cash-flow', icon: Activity, roles: MANAGERS, requiredFeature: 'FINANCIAL_REPORTS' },
  {
    label: 'Profit & Loss',
    href: '/finance/profit-loss',
    icon: TrendingUp,
    roles: MANAGERS,
    requiredFeature: 'FINANCIAL_REPORTS',
    keywords: 'p&l',
  },
  { label: 'Branches', href: '/branches', icon: Store, roles: MANAGERS, keywords: 'outlets' },
  { label: 'My Profile', href: '/profile', icon: UserCircle, keywords: 'account password' },
  { label: 'Settings', href: '/settings', icon: Settings, roles: MANAGERS },
];

/** Roles that may list every branch (GET /branches), so may ask how many there are. */
export const BRANCH_LISTING_ROLES = STOCK;

export function visibleNavItems(opts: {
  roles: readonly string[] | undefined;
  hasFeature: (feature: string) => boolean;
  /** Unknown while loading: multi-branch-only items stay hidden until it is known. */
  branchCount: number | undefined;
}): NavItem[] {
  const roles = opts.roles ?? [];
  return NAV_ITEMS.filter((item) => {
    if (item.requiredFeature && !opts.hasFeature(item.requiredFeature)) return false;
    if (item.roles && !item.roles.some((r) => roles.includes(r))) return false;
    if (item.multiBranchOnly && !(opts.branchCount !== undefined && opts.branchCount > 1)) return false;
    return true;
  });
}

/** The pages the signed-in user may see, for the sidebar and the command palette. */
export function useNavItems(): NavItem[] {
  const { user, hasFeature } = useAuthStore();
  const roles = user?.roles;
  const canListBranches = !!roles?.some((r) => (BRANCH_LISTING_ROLES as readonly string[]).includes(r));
  const { data: branches } = useQuery({
    queryKey: QK.branches,
    queryFn: branchService.getAllBranches,
    enabled: canListBranches,
    staleTime: 5 * 60 * 1000,
  });
  return visibleNavItems({ roles, hasFeature, branchCount: branches?.length });
}
