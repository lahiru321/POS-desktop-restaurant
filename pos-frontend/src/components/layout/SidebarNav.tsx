'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Package,
  Tags,
  Bookmark,
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
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  requiredFeature?: string;
  /**
   * The second half of the two-level gate. `requiredFeature` only says the API
   * exists — the desktop installer grants every feature to every install, so a
   * retail shop would still see restaurant screens. This hides the item unless
   * the tenant actually runs as a restaurant (`tenants.settings.restaurantMode`).
   */
  requiresRestaurantMode?: boolean;
};

const ALL_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/overview', icon: LayoutDashboard },
  { label: 'Products', href: '/inventory/products', icon: Package, requiredFeature: 'INVENTORY' },
  { label: 'Categories', href: '/inventory/categories', icon: Tags, requiredFeature: 'INVENTORY' },
  { label: 'Brands', href: '/inventory/brands', icon: Bookmark, requiredFeature: 'INVENTORY' },
  { label: 'Tables', href: '/restaurant/tables', icon: LayoutGrid, requiredFeature: 'RESTAURANT', requiresRestaurantMode: true },
  { label: 'Add-ons', href: '/restaurant/toppings', icon: Salad, requiredFeature: 'RESTAURANT', requiresRestaurantMode: true },
  { label: 'Customers', href: '/customers', icon: Users, requiredFeature: 'CUSTOMERS' },
  { label: 'Suppliers', href: '/inventory/suppliers', icon: Building2, requiredFeature: 'INVENTORY' },
  { label: 'Purchase Orders', href: '/inventory/purchase-orders', icon: Truck, requiredFeature: 'PURCHASE_ORDERS' },
  { label: 'Stock Transfers', href: '/inventory/stock-transfers', icon: ArrowRightLeft, requiredFeature: 'STOCK_TRANSFERS' },
  { label: 'Employees', href: '/employees', icon: UserSquare2, requiredFeature: 'EMPLOYEES' },
  { label: 'Reports', href: '/reports', icon: BarChart3, requiredFeature: 'REPORTS' },
  { label: 'Expenses', href: '/finance/expenses', icon: Wallet, requiredFeature: 'EXPENSES' },
  { label: 'Cash Flow', href: '/finance/cash-flow', icon: Activity, requiredFeature: 'FINANCIAL_REPORTS' },
  { label: 'Profit & Loss', href: '/finance/profit-loss', icon: TrendingUp, requiredFeature: 'FINANCIAL_REPORTS' },
  { label: 'Branches', href: '/branches', icon: Store },
  { label: 'My Profile', href: '/profile', icon: UserCircle },
  { label: 'Settings', href: '/settings', icon: Settings },
];

const FINANCE_LABELS = ['Expenses', 'Cash Flow', 'Profit & Loss'];

/** Floor-plan authoring screens. Admin/manager only, matching the backend's
 *  @PreAuthorize on the areas/tables and toppings CRUD. Listed explicitly
 *  because the switch below falls through to `return true` — an item with no
 *  case of its own would be visible to every cashier. */
const RESTAURANT_ADMIN_LABELS = ['Tables', 'Add-ons'];

type SidebarNavProps = {
  /** When true, render icon-only (collapsed) form. */
  collapsed?: boolean;
  /** Called when a link is clicked — useful for closing a mobile drawer. */
  onNavigate?: () => void;
  /** Tenant setting: this business runs as a restaurant. Gate level two — see
   *  `NavItem.requiresRestaurantMode`. Passed down rather than fetched here so
   *  the sidebar stays free of data fetching and the dashboard layout owns the
   *  single `/tenant/info` query. */
  restaurantMode?: boolean;
  className?: string;
};

export function SidebarNav({ collapsed = false, onNavigate, restaurantMode = false, className }: SidebarNavProps) {
  const pathname = usePathname();
  const { user, hasFeature } = useAuthStore();

  const items = ALL_ITEMS.filter((item) => {
    if (item.requiredFeature && !hasFeature(item.requiredFeature)) return false;
    if (item.requiresRestaurantMode && !restaurantMode) return false;

    if (['Overview', 'Employees', 'Settings', 'Reports', 'Branches', ...FINANCE_LABELS].includes(item.label)) {
      return user?.roles?.includes('ADMIN') || user?.roles?.includes('MANAGER');
    }
    if (RESTAURANT_ADMIN_LABELS.includes(item.label)) {
      return user?.roles?.includes('ADMIN') || user?.roles?.includes('MANAGER');
    }
    if (['Suppliers', 'Purchase Orders', 'Stock Transfers'].includes(item.label)) {
      return (
        user?.roles?.includes('ADMIN') ||
        user?.roles?.includes('MANAGER') ||
        user?.roles?.includes('INVENTORY_MANAGER')
      );
    }
    if (item.label === 'Customers') {
      return (
        user?.roles?.includes('ADMIN') ||
        user?.roles?.includes('MANAGER') ||
        user?.roles?.includes('CASHIER')
      );
    }
    return true;
  });

  return (
    <nav
      className={cn(
        'flex-1 space-y-1 overflow-y-auto overflow-x-hidden py-3',
        // Tighter horizontal padding when collapsed so the 44px icon buttons +
        // the vertical scrollbar still fit inside the 64px rail (no horizontal scroll).
        collapsed ? 'px-1.5' : 'px-3',
        className
      )}
      aria-label="Main navigation"
    >
      {items.map((item) => {
        const isActive = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex items-center rounded-xl text-sm transition-all duration-200 group',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              collapsed ? 'justify-center h-11 w-11 mx-auto' : 'gap-3 px-4 py-3',
              isActive
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/10'
            )}
          >
            <item.icon
              size={20}
              className={cn(
                'transition-colors shrink-0',
                isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
              )}
            />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
