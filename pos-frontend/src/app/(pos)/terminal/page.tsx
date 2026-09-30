'use client';

import { Suspense, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryService } from '@/services/inventoryService';
import { branchService, Branch } from '@/services/branchService';
import { taxService } from '@/services/taxService';
import { cashSessionService } from '@/services/cashSessionService';
import { tenantService } from '@/services/tenantService';
import { SaleResponse, salesService, SaleRequest, SaleItemRequest, SalesSummaryResponse } from '@/services/salesService';
import { applyServiceCharge, useCart, useCartTotals, TaxContext, type CartView } from '@/hooks/useCart';
import { useDineInCart } from '@/hooks/useDineInCart';
import { useKitchenPrinting } from '@/hooks/useKitchenPrinting';
import { ShoppingCart, Loader2, Plus, LayoutGrid, Send } from 'lucide-react';
import { unsentLineCount } from '@/lib/kitchenState';
import { useAuthStore } from '@/stores/authStore';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import {
  usePosKeyboard,
  HOTKEY_LEGEND,
  POS_CUSTOM_ITEM_BUTTON_ID,
  type PosRegion,
} from '@/hooks/usePosKeyboard';
import { receiptPrinterService, ReceiptData } from '@/services/receiptPrinterService';
import { Customer } from '@/services/customerService';
import { performLogout } from '@/lib/performLogout';
import { QK } from '@/lib/queryKeys';
import { fc, getApiErrorMessage } from '@/lib/utils';
import { useConfirmDialog } from '@/components/super-admin/ConfirmDialog';
import {
  restaurantOrderService,
  type RepricedLine,
  type RestaurantOrder,
  type SettleRequest,
  type SplitSettleRequest,
  type TakeawayRequest,
} from '@/services/restaurantOrderService';

// POS Components
import { POSHeader } from '@/components/pos/POSHeader';
import { ProductSearch } from '@/components/pos/ProductSearch';
import { ProductGrid } from '@/components/pos/ProductGrid';
import { CategoryBar } from '@/components/pos/CategoryBar';
import { OrderTypeBar, type CounterMode } from '@/components/pos/OrderTypeBar';
import { TabActionsMenu } from '@/components/pos/TabActionsMenu';
import { ToppingPickerDialog } from '@/components/pos/ToppingPickerDialog';
import { toppingService } from '@/services/toppingService';
import { CartItemCard } from '@/components/pos/CartItemCard';
import { ReceiptPrintFailedDialog, type ReceiptPrintFailure } from '@/components/pos/ReceiptPrintFailedDialog';
import { hardwareService } from '@/services/hardwareService';
import { LicenseBanner } from '@/components/LicenseBanner';
import { ManagerPinDialog, type ManagerPinRequest } from '@/components/pos/ManagerPinDialog';
import { CartSummary } from '@/components/pos/CartSummary';
import { TenderOverlay } from '@/components/pos/TenderOverlay';
import { CorrectPaymentModal } from '@/components/pos/CorrectPaymentModal';
import { CorrectSalePickerModal } from '@/components/pos/CorrectSalePickerModal';
import { ReturnModal } from '@/components/pos/ReturnModal';
import { ShortcutsOverlay } from '@/components/pos/ShortcutsOverlay';
import { FloorSheet } from '@/components/pos/FloorSheet';
import { SplitBillDialog, selectedLines, type SplitSelection } from '@/components/pos/SplitBillDialog';
import type { RestaurantTable } from '@/services/tableService';
import { KitchenPrintFailedDialog } from '@/components/pos/KitchenPrintFailedDialog';
import { KitchenTicketsBadge } from '@/components/pos/KitchenTicketsBadge';
import { OrderKitchenTickets } from '@/components/pos/OrderKitchenTickets';
import { formatElapsed } from '@/components/pos/FloorPlan';
import { CustomerSelector } from '@/components/pos/CustomerSelector';
import { Receipt } from '@/components/pos/Receipt';
import { ShiftSummary } from '@/components/pos/ShiftSummary';
import { StartShiftModal } from '@/components/pos/StartShiftModal';
import { EndShiftModal } from '@/components/pos/EndShiftModal';
import { LogoutShiftWarningDialog } from '@/components/pos/LogoutShiftWarningDialog';
import { CustomItemModal } from '@/components/pos/CustomItemModal';
import InventoryAdjustmentModal from '@/components/inventory/InventoryAdjustmentModal';
import { Button } from '@/components/ui/button';
import { Product } from '@/types/inventory';

/** Per machine: whether this till's counter sales default to takeaway. */
const COUNTER_MODE_KEY = 'storex.till.counterMode';

/** The whole active menu in one read; the till filters it locally per keystroke and tab. */
const TILL_MENU_SIZE = 500;

/** "Chicken Kottu - Extra cheese   1,200.00 -> 1,350.00" for a toast line. */
function describeRepricedLine(line: RepricedLine): string {
  const name = line.toppingName ? `${line.itemName} · ${line.toppingName}` : line.itemName;
  return `${name}  ${fc(line.orderedPrice)} → ${fc(line.billedPrice)}`;
}

/**
 * `useSearchParams` makes this route dynamic, so the page body is wrapped in a
 * Suspense boundary rather than the boundary being pushed up into the layout.
 */
export default function TerminalPage() {
  return (
    <Suspense
      fallback={
        <div className="dark h-screen flex items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      }
    >
      <Terminal />
    </Suspense>
  );
}

function Terminal() {
  // State
  const [search, setSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'ONLINE' | 'SPLIT' | 'CREDIT'>('CASH');
  const [tenderOpen, setTenderOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [cashTendered, setCashTendered] = useState(0);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  // A counter sale either stays at the counter (a bottle of water) or goes to
  // the kitchen once paid (takeaway). The cashier decides per sale; the choice
  // sticks until changed, because a takeaway rush is many takeaways in a row —
  // and it is remembered on this machine, since a takeaway counter stays one.
  const [counterMode, setCounterModeState] = useState<CounterMode>('COUNTER');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COUNTER_MODE_KEY);
      if (saved === 'COUNTER' || saved === 'TAKEAWAY') setCounterModeState(saved);
    } catch {
      // Storage blocked: the default is fine.
    }
  }, []);
  const setCounterMode = useCallback((mode: CounterMode) => {
    setCounterModeState(mode);
    try {
      window.localStorage.setItem(COUNTER_MODE_KEY, mode);
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
  }, []);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [lastSale, setLastSale] = useState<SaleResponse | null>(null);
  // F7 → picker lists this shift's sales; choosing one sets correctSale, which
  // opens the correction modal for that specific sale (not just the last one).
  const [correctPickerOpen, setCorrectPickerOpen] = useState(false);
  const [correctSale, setCorrectSale] = useState<SaleResponse | null>(null);
  const [returnSaleId, setReturnSaleId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SalesSummaryResponse | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  // Admin-facing End Shift flow (staff reach it via the header TimeClockWidget).
  const [endShiftOpen, setEndShiftOpen] = useState(false);
  // Warn before logging out with an open drawer instead of silently auto-closing.
  const [logoutWarnOpen, setLogoutWarnOpen] = useState(false);
  // Drives the "Fix stock" recovery action on checkout-time OOS errors.
  const [stockFixProduct, setStockFixProduct] = useState<Product | null>(null);
  // Loyalty points the cashier has chosen to redeem on the current sale.
  const [pointsToRedeem, setPointsToRedeem] = useState(0);

  // Auth & Navigation
  const { user, loginMethod } = useAuthStore();
  const storeCreditEnabled = useAuthStore((state) => state.hasFeature('STORE_CREDIT'));
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  // Role gate — INVENTORY_MANAGER (or anyone without a sales-capable role) has no
  // business at the POS terminal. Bounce them to the dashboard.
  useEffect(() => {
    if (!user) return;
    const roles = user.roles || [];
    const canSell =
      roles.includes('ADMIN') ||
      roles.includes('MANAGER') ||
      roles.includes('CASHIER');
    if (!canSell) {
      router.replace('/overview');
    }
  }, [user, router]);

  // Cash session gate — terminal is unusable without an open drawer. Always
  // re-check on mount (staleTime 0 + refetchOnMount) so arriving at the terminal
  // never shows a stale cached session — otherwise the global 30s staleTime could
  // skip the Start Shift prompt until a manual refresh.
  const { data: activeSession, isLoading: sessionLoading } = useQuery({
    queryKey: QK.cashSessionActive,
    queryFn: () => cashSessionService.getActive(),
    enabled: !!user && (user.roles || []).some(r => r === 'ADMIN' || r === 'MANAGER' || r === 'CASHIER'),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Data Fetching — only the branches this user may operate at (filtered server-side
  // when branch restrictions are on). Distinct cache key from the full branch list.
  const { data: branchesData } = useQuery({
    queryKey: ['branches', 'me'],
    queryFn: () => branchService.getMyBranches(),
  });

  const branches = (branchesData || []).filter(b => b.isActive);

  // Fetch business info for the receipt header (name / address / phone).
  const { data: tenantInfo } = useQuery({
    queryKey: QK.tenantInfo,
    queryFn: () => tenantService.getInfo(),
    staleTime: 5 * 60 * 1000,
  });

  // Fetch tax rates and categories for dynamic tax calculation
  const { data: activeTaxRates } = useQuery({
    queryKey: QK.taxRatesActive,
    queryFn: () => taxService.getActiveTaxRates(),
  });

  const { data: categories } = useQuery({
    queryKey: QK.categories,
    queryFn: () => inventoryService.getCategories(),
  });

  // Build the tax context for per-item tax resolution
  const taxContext: TaxContext | null = useMemo(() => {
    if (!activeTaxRates) return null;
    return {
      taxRates: activeTaxRates,
      categories: categories || [],
    };
  }, [activeTaxRates, categories]);

  // The active drawer pins the branch for the whole shift — lock the terminal to the
  // session's branch (a sale rung at a different branch is rejected server-side).
  useEffect(() => {
    if (!activeSession || branches.length === 0) return;
    const sessionBranch = branches.find(b => b.id === activeSession.branchId);
    setSelectedBranch(sessionBranch || branches.find(b => b.isDefault) || branches[0]);
  }, [branches, activeSession]);

  // ─────────────────────────────────────────────────────────────────────────
  // Dine-in
  //
  // This product is restaurant-only, so the floor and tabs are always available.
  // A till with no tab open is a counter sale on the plain retail cart; every
  // dine-in branch in this file is guarded by `dineInActive`.
  // ─────────────────────────────────────────────────────────────────────────

  // The tab this terminal is working on, if any. Seeded from `?orderId` so a
  // reload — or a hand-off from /floor — comes back to the same tab, which is
  // the real improvement over an ephemeral cart: the order lives server-side.
  // Held in state thereafter so FloorSheet can switch tables without a
  // navigation, which would unmount the terminal and take any retail cart with
  // it.
  const initialOrderId = useSearchParams().get('orderId');
  const [dineInOrderId, setDineInOrderId] = useState<string | null>(initialOrderId);
  const [floorOpen, setFloorOpen] = useState(false);

  const selectOrder = useCallback((orderId: string | null) => {
    setDineInOrderId(orderId);
    // `history.replaceState` rather than `router.replace`: the URL has to survive
    // a reload, but re-rendering the route to achieve that would risk the
    // `useState` cart sitting behind the tab.
    window.history.replaceState(null, '', orderId ? `/terminal?orderId=${orderId}` : '/terminal');
  }, []);

  // Cart — branch-aware so add/update reads the right stockLevels row.
  const retailCart = useCart(taxContext, selectedBranch?.id, tenantInfo?.taxInclusive ?? true);

  // Kitchen printing. Every ticket the server hands back — a fired round, or a
  // void of something already cooking — goes through here: print, acknowledge,
  // and on failure a blocking dialog nobody can click past.
  const kitchen = useKitchenPrinting();

  // The same interface, backed by `restaurant_orders` instead of `useState`.
  // Every query inside is `enabled: !!orderId`, so a counter sale with no tab
  // open issues no requests at all.
  // The manager PIN pad, as a promise: useDineInCart awaits it before a void
  // the kitchen already has, when the tenant asks for one.
  const [pinRequest, setPinRequest] = useState<
    (ManagerPinRequest & { resolve: (pin: string | null) => void }) | null
  >(null);
  const requestManagerPin = useCallback(
    (req: ManagerPinRequest) => new Promise<string | null>((resolve) => setPinRequest({ ...req, resolve })),
    [],
  );
  const isManager = !!user?.roles?.some((r) => r === 'ADMIN' || r === 'MANAGER');

  const dineIn = useDineInCart({
    orderId: dineInOrderId,
    voidNeedsPin: !!tenantInfo?.restaurantVoidRequiresPin && !isManager,
    requestManagerPin,
    taxContext,
    taxInclusive: tenantInfo?.taxInclusive ?? true,
    branchId: selectedBranch?.id,
    onKitchenTickets: (tickets) => void kitchen.dispatchTickets(tickets),
  });

  /** The one predicate every restaurant branch below keys off. */
  const dineInActive = !!dineInOrderId && !!dineIn.order;

  // With `dineInActive` false this is `retailCart`, object for object, so the
  // whole terminal below is on exactly the code path it has always been on.
  const view: CartView = dineInActive ? dineIn : retailCart;
  const {
    items,
    addToCart,
    addCustomItem,
    updateQuantity,
    removeFromCart,
    setItemDiscount,
    clearCart,
    subtotal,
    discountAmount,
    taxAmount,
    taxLabel,
    taxInclusive,
    total,
    itemCount,
  } = view;

  // Split bill: what the payer at the till is paying for, or null for the whole
  // tab. While set, the tender overlay charges just these lines.
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitSelection, setSplitSelection] = useState<SplitSelection | null>(null);
  const splitTotals = useCartTotals(
    splitSelection ? selectedLines(items, splitSelection) : [],
    taxContext,
    taxInclusive,
  );
  const baseTender = splitSelection
    ? splitTotals
    : { subtotal, discountAmount, taxAmount, taxLabel, taxInclusive, total, itemCount };

  // Dine-in bills carry the service charge — the tenant's rate, computed here
  // exactly as the server will bill it so the tender total and the sale agree.
  // The cashier can take it off this one bill; the choice resets per bill.
  const [waiveServiceCharge, setWaiveServiceCharge] = useState(false);
  const serviceChargeApplies = dineInActive && dineIn.order?.orderType === 'DINE_IN';
  const serviceChargeRate = tenantInfo?.serviceChargeRate ?? 10;
  const tender = applyServiceCharge(
    baseTender,
    serviceChargeApplies && !waiveServiceCharge ? serviceChargeRate : 0,
    taxContext,
  );
  useEffect(() => {
    setWaiveServiceCharge(false);
  }, [dineInOrderId]);

  // A tab settled or voided on another till is not a cart. Drop back to retail
  // rather than letting anyone ring into a closed order.
  useEffect(() => {
    if (!dineIn.isClosed) return;
    toast.info('That tab is no longer open.');
    selectOrder(null);
  }, [dineIn.isClosed, selectOrder]);

  // Elapsed minutes have to keep moving between the order's own polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!dineInActive) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [dineInActive]);

  // Per-product cart quantities — fed to ProductGrid so it can show "at limit"
  // when a tile's cart count equals the branch stock.
  //
  // Summed across LINES, not assigned per line: the same product can now appear
  // several times with different toppings, and stock is a product-level ceiling.
  // Assigning would report only the last line and undercount the limit.
  const cartQuantities = useMemo(
    () => items.reduce<Record<string, number>>((acc, item) => {
      acc[item.id] = (acc[item.id] ?? 0) + item.cartQuantity;
      return acc;
    }, {}),
    [items]
  );

  // The whole active menu, read once and filtered here: a menu is a few hundred
  // items at most, and tapping a category must not wait on the network. Keyed
  // under 'products' so every post-sale invalidation refreshes stock on it.
  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products', 'till-menu', selectedBranch?.id],
    queryFn: () => inventoryService.getProducts(0, TILL_MENU_SIZE, { isActive: true }),
  });
  const products = useMemo(() => productsData?.content ?? [], [productsData]);

  // Menu tabs: only categories something on the menu is in, in the category
  // list's order. Typing a search looks across every tab.
  const [menuCategoryId, setMenuCategoryId] = useState<string | null>(null);
  const menuCategories = useMemo(() => {
    const used = new Set(products.map((p) => p.categoryId).filter(Boolean));
    return (categories ?? []).filter((c) => used.has(c.id));
  }, [products, categories]);
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (value) setMenuCategoryId(null);
  }, []);

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term) {
      return products.filter(p =>
        p.name.toLowerCase().includes(term) ||
        p.sku?.toLowerCase().includes(term) ||
        p.barcode?.includes(search.trim())
      );
    }
    return menuCategoryId ? products.filter((p) => p.categoryId === menuCategoryId) : products;
  }, [products, search, menuCategoryId]);

  // Keyboard focus model: which region is active and which tile / cart line is
  // focused. Indices are kept in range as the lists change.
  const [activeRegion, setActiveRegion] = useState<PosRegion>('grid');
  const [gridIndex, setGridIndex] = useState(0);
  const [cartIndex, setCartIndex] = useState(0);

  // Reset any pending point redemption when the attached customer changes (or is
  // cleared) — points belong to a specific customer.
  useEffect(() => {
    setPointsToRedeem(0);
  }, [selectedCustomer?.id]);

  // Store credit for the attached customer. CREDIT is only offered when the
  // feature is on, a customer is attached, and they have a credit limit set.
  const creditLimit = selectedCustomer?.creditLimit ?? 0;
  const creditBalance = selectedCustomer?.creditBalance ?? 0;
  const availableCredit = Math.max(0, creditLimit - creditBalance);
  const creditEligible = storeCreditEnabled && !!selectedCustomer && creditLimit > 0;

  // If credit stops being an option (customer cleared / switched), fall back to cash.
  useEffect(() => {
    if (!creditEligible && paymentMethod === 'CREDIT') {
      setPaymentMethod('CASH');
      setCashTendered(0);
    }
  }, [creditEligible, paymentMethod]);

  useEffect(() => {
    setGridIndex((i) => Math.min(i, Math.max(0, filteredProducts.length - 1)));
  }, [filteredProducts.length]);
  useEffect(() => {
    if (items.length === 0) setActiveRegion('grid');
    setCartIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  // Custom / open line item (for products not in the catalog).
  const [customItemOpen, setCustomItemOpen] = useState(false);

  // The dish awaiting add-on choices. Null when the picker is closed.
  const [toppingProduct, setToppingProduct] = useState<Product | null>(null);

  // Which products have add-ons at all. One cached call; an empty result means
  // this tenant has no toppings configured and every tile behaves exactly as it
  // did before, with no dialog and no extra request.
  const { data: productsWithToppings } = useQuery({
    queryKey: QK.productsWithToppings,
    queryFn: toppingService.getProductIdsWithToppings,
    staleTime: 5 * 60 * 1000,
    enabled: !!user && (user.roles || []).some(r => r === 'ADMIN' || r === 'MANAGER' || r === 'CASHIER'),
  });
  const toppingProductIds = useMemo(
    () => new Set(productsWithToppings ?? []),
    [productsWithToppings],
  );

  // Only fetched once the picker is actually open for a dish.
  const { data: toppingGroups, isFetching: toppingGroupsLoading } = useQuery({
    queryKey: QK.productToppingGroups(toppingProduct?.id ?? ''),
    queryFn: () => toppingService.getGroupsForProduct(toppingProduct!.id),
    enabled: !!toppingProduct,
    staleTime: 5 * 60 * 1000,
  });

  const handleProductClick = useCallback((product: Product) => {
    // A dish with no add-ons goes straight into the cart — the picker must never
    // stand between a cashier and a plain item.
    if (!toppingProductIds.has(product.id)) {
      addToCart(product);
      return;
    }
    setToppingProduct(product);
  }, [toppingProductIds, addToCart]);

  // Duplicate scan protection — prevents double-fire within 500ms
  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });

  // Global Barcode Scanner — Server-Side Lookup
  useBarcodeScanner({
    onScan: async (barcode) => {
      // Guard: ignore duplicate scans within 500ms (scanner double-fire)
      const now = Date.now();
      if (lastScanRef.current.code === barcode && now - lastScanRef.current.time < 500) {
        return;
      }
      lastScanRef.current = { code: barcode, time: now };

      try {
        const product = await inventoryService.lookupByCode(barcode, true);
        addToCart(product);
        toast.success(`Scanned: ${product.name}`);
      } catch (err: unknown) {
        const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || `Barcode not found: ${barcode}`;
        toast.error(message, {
          action: {
            label: 'Add custom item',
            onClick: () => setCustomItemOpen(true),
          },
        });
      }
    }
  });

  // Builds the thermal-printer payload for a completed sale. Pulls the real
  // gross tendered / change off the sale (persisted on the server) so reprints —
  // and receipts reprinted after a payment correction — show the correct
  // Cash/Change lines instead of defaulting to an exact tender.
  // A receipt that did not print, waiting for Retry or Skip. Never silent: the
  // customer has no receipt and, on a cash sale, the drawer did not open.
  const [receiptFailure, setReceiptFailure] = useState<(ReceiptPrintFailure & { data: ReceiptData }) | null>(null);
  const [receiptRetrying, setReceiptRetrying] = useState(false);

  /** Prints a receipt and puts any failure in front of the cashier. */
  const printReceipt = async (data: ReceiptData, successMessage?: string) => {
    const result = await receiptPrinterService.processHardwareCheckoutActions(data);
    if (result.ok) {
      setReceiptFailure(null);
      if (successMessage) toast.success(successMessage);
      return;
    }
    if (result.notConfigured) {
      // A till with no receipt printer is a real setup: a hint, not a dialog.
      toast.info('Receipt not printed', { description: result.error });
      return;
    }
    setReceiptFailure({
      data,
      label: data.transactionId,
      opensDrawer: data.paymentMethod?.toUpperCase() === 'CASH' && hardwareService.getConfig().cashDrawerKick,
      error: result.error,
    });
  };

  const retryReceipt = async () => {
    if (!receiptFailure) return;
    setReceiptRetrying(true);
    try {
      await printReceipt(receiptFailure.data, 'Receipt printed');
    } finally {
      setReceiptRetrying(false);
    }
  };

  const buildReceiptData = (sale: SaleResponse): ReceiptData => ({
    tenantName: tenantInfo?.name || 'StoreX',
    logoUrl: tenantInfo?.logoUrl ?? undefined,
    tenantAddressLine1: tenantInfo?.addressLine1 ?? undefined,
    tenantAddressLine2: tenantInfo?.addressLine2 ?? undefined,
    tenantPhone: tenantInfo?.phone ?? undefined,
    branchName: selectedBranch?.name || 'Main Branch',
    showBranch: branches.length > 1,
    cashierName: `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim(),
    transactionId: sale.invoiceNumber,
    createdAt: sale.createdAt ? new Date(sale.createdAt) : new Date(),
    items: (sale.items ?? []).map((it) => ({
      name: it.productName,
      quantity: Number(it.quantity),
      price: Number(it.unitPrice),
      total: Number(it.totalAmount),
    })),
    subtotal: Number(sale.totalAmount),
    tax: Number(sale.taxAmount),
    taxLabel,
    discount: Number(sale.discountAmount),
    taxInclusive: sale.taxInclusive ?? false,
    total: Number(sale.netAmount),
    paymentMethod: sale.paymentMethod as 'CASH' | 'CARD' | 'ONLINE',
    tendered: Number(sale.amountTendered ?? sale.netAmount),
    change: Number(sale.changeDue ?? 0),
    receiptFooter: tenantInfo?.receiptFooter ?? undefined,
  });

  // Checkout Mutation
  const checkoutMutation = useMutation({
    mutationFn: (data: SaleRequest) => salesService.createSale(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      // A cash sale changes the drawer's expected balance — refresh the active
      // session so the header widget and End Shift modal reconcile against the
      // up-to-date cash-received total instead of the pre-sale snapshot.
      queryClient.invalidateQueries({ queryKey: QK.cashSessionActive });
      toast.success(`Sale Processed: ${data.invoiceNumber}`);
      setTenderOpen(false);
      setLastSale(data);
      setSelectedCustomer(null);
      setCashTendered(0);
      setPointsToRedeem(0);
      clearCart(); // Also clear the cart on success
      
      // Fire Hardare integrations (Cash Drawer Kick + Thermal Receipt)
      const receiptData: ReceiptData = {
        tenantName: tenantInfo?.name || "StoreX",
        logoUrl: tenantInfo?.logoUrl ?? undefined,
        tenantAddressLine1: tenantInfo?.addressLine1 ?? undefined,
        tenantAddressLine2: tenantInfo?.addressLine2 ?? undefined,
        tenantPhone: tenantInfo?.phone ?? undefined,
        branchName: selectedBranch?.name || "Main Branch",
        showBranch: branches.length > 1,
        cashierName: `${user?.firstName} ${user?.lastName}`,
        transactionId: data.invoiceNumber,
        createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
        // Flattened dish-then-add-ons, matching the order and the per-row
        // amounts the backend writes to sale_items, so the printed receipt and
        // the stored sale agree line for line.
        items: items.flatMap(item => [
          {
            name: item.name,
            quantity: item.cartQuantity,
            price: item.basePrice,
            total: item.basePrice * item.cartQuantity,
            notes: item.notes,
          },
          ...(item.toppings ?? []).map(topping => ({
            name: topping.name,
            quantity: topping.quantity * item.cartQuantity,
            price: topping.unitPrice,
            total: topping.unitPrice * topping.quantity * item.cartQuantity,
            isAddon: true,
          })),
        ]),
        subtotal: subtotal,
        tax: taxAmount,
        taxLabel: taxLabel,
        discount: discountAmount,
        // Use the server-computed net (already reduced by any redeemed points) as
        // the receipt total so cash/change/points lines reconcile.
        loyaltyDiscount: data.loyaltyDiscountAmount ?? 0,
        taxInclusive: data.taxInclusive ?? taxInclusive,
        total: data.netAmount,
        paymentMethod: paymentMethod,
        tendered: cashTendered > 0 ? cashTendered : data.netAmount,
        change: cashTendered > data.netAmount ? cashTendered - data.netAmount : 0,
        receiptFooter: tenantInfo?.receiptFooter ?? undefined,
        pointsEarned: data.earnedPoints ?? undefined,
        pointsRedeemed: data.pointsRedeemed ?? undefined,
        pointsBalance: data.loyaltyBalance ?? undefined,
      };
      
      void printReceipt(receiptData);
      clearCart();
    },
    onError: (error: unknown) => {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message
        || "Failed to process sale";

      // Insufficient-stock errors get a recovery shortcut for managers/admins so
      // they can reconcile branch stock without leaving the terminal.
      const isStockError = /insufficient stock for product:\s*(.+?)(?:\s+in the selected branch)?$/i.exec(message);
      const roles = user?.roles || [];
      const canFixStock = roles.includes('ADMIN') || roles.includes('MANAGER');

      if (isStockError && canFixStock) {
        const productName = isStockError[1].trim();
        const cartProduct = items.find(i => i.name === productName);
        if (cartProduct) {
          toast.error(message, {
            action: {
              label: 'Fix stock',
              onClick: () => setStockFixProduct(cartProduct),
            },
          });
          return;
        }
      }

      toast.error(message);
    }
  });

  // Handlers
  // F9 / Charge → open the tender overlay (the overlay's Complete fires the sale).
  const openTender = () => {
    if (items.length === 0) return;
    setTenderOpen(true);
  };

  // One shape for every way a counter cart leaves the till — a sale, a paid
  // takeaway, a parked order — so the three can never disagree about a line.
  const cartLines = (): SaleItemRequest[] =>
    items.map(item => ({
      productId: item.isCustom ? null : item.id,
      itemName: item.isCustom ? item.name : undefined,
      quantity: item.cartQuantity,
      unitPrice: item.basePrice,
      discountAmount: item.discountAmount,
      notes: item.notes,
      // The server re-resolves every price from the topping definition; a
      // FIXED topping's unitPrice here is ignored entirely.
      toppings: item.toppings?.map(t => ({
        toppingId: t.toppingId,
        quantity: t.quantity,
        unitPrice: t.priceMode === 'PROMPT' ? t.unitPrice : undefined,
      })),
    }));

  const handleCheckout = () => {
    if (items.length === 0) return;

    // Dine-in settles the server-side tab instead of posting a cart. Points are
    // not offered on a tab (see `loyaltyEnabled` on the overlay), so none are
    // sent: the sale's customer is the one stamped on the order at open time.
    if (dineInActive && dineInOrderId && splitSelection) {
      splitMutation.mutate({
        orderId: dineInOrderId,
        data: {
          lines: Object.entries(splitSelection)
            .filter(([, quantity]) => quantity > 0)
            .map(([itemId, quantity]) => ({ itemId, quantity })),
          paymentMethod,
          cashTendered: (paymentMethod === 'CASH' || paymentMethod === 'SPLIT') && cashTendered > 0
            ? cashTendered
            : undefined,
          waiveServiceCharge,
        },
      });
      return;
    }

    if (dineInActive && dineInOrderId) {
      settleMutation.mutate({
        waiveServiceCharge,
        paymentMethod,
        cashTendered: (paymentMethod === 'CASH' || paymentMethod === 'SPLIT') && cashTendered > 0
          ? cashTendered
          : undefined,
      });
      return;
    }

    const payment = {
      customerId: selectedCustomer?.id,
      branchId: selectedBranch?.id,
      paymentMethod,
      cashTendered: (paymentMethod === 'CASH' || paymentMethod === 'SPLIT') && cashTendered > 0
        ? cashTendered
        : undefined,
      pointsToRedeem: selectedCustomer && pointsToRedeem > 0 ? pointsToRedeem : undefined,
    };

    // Takeaway: order, payment and kitchen ticket in one server transaction. A
    // refused payment leaves no order behind and sends nothing to the kitchen.
    if (counterMode === 'TAKEAWAY') {
      takeawayMutation.mutate({ ...payment, items: cartLines() });
      return;
    }

    checkoutMutation.mutate({ ...payment, items: cartLines() });
  };

  const doLogout = async () => {
    // Wipe cached queries so the next user to log in on this terminal can't see
    // the previous user's cash session / data flash before refetch.
    queryClient.clear();
    await performLogout();
    router.push('/login');
  };

  const handleLogout = async () => {
    // Don't let someone walk away from an uncounted drawer without a heads-up —
    // logging out auto-closes the shift server-side, but we warn first so they
    // can reconcile instead of losing the count silently.
    if (activeSession) {
      setLogoutWarnOpen(true);
      return;
    }
    await doLogout();
  };

  // Ending the drawer shift ends the user's till session: clear the now-closed
  // session from cache and send them back to the login screen. Shared by the
  // admin (header button) and staff (TimeClockWidget) End Shift paths so every
  // role behaves identically.
  const handleShiftEnded = async () => {
    queryClient.setQueryData(QK.cashSessionActive, null);
    await doLogout();
  };

  // Expected cash in the open drawer, for the logout warning copy.
  const drawerExpected =
    (activeSession?.openingBalance ?? 0) +
    (activeSession?.cashSalesTotal ?? 0) +
    (activeSession?.cashRepaymentsTotal ?? 0) -
    (activeSession?.cashRefundsTotal ?? 0);

  const handleFetchSummary = async () => {
    try {
      const data = await salesService.getDailySummary();
      setSummary(data);
      setShowSummary(true);
    } catch {
      toast.error("Failed to load shift summary");
    }
  };

  const handleDiscard = async () => {
    // On a tab, "discard" is a write-off of a persisted order, not a cleared
    // cart — so it says exactly that and goes to the void endpoint.
    if (dineInActive && dineIn.order) {
      const order = dineIn.order;
      const ok = await confirm({
        title: `Void ${order.label}?`,
        description:
          'Everything on this tab is written off and the table is freed. Nobody is charged. Managers and admins only.',
        confirmLabel: 'Void the tab',
        variant: 'destructive',
      });
      if (ok) voidOrderMutation.mutate(order.id);
      return;
    }

    if (items.length === 0) return;
    const ok = await confirm({
      title: 'Discard current sale?',
      description: `This will clear all ${items.length} item${items.length === 1 ? '' : 's'} from the cart. The customer has not been charged.`,
      confirmLabel: 'Discard sale',
      variant: 'destructive',
    });
    if (ok) clearCart();
  };

  // F4 — cycle through CASH → CARD → ONLINE → SPLIT → CASH.
  const cyclePaymentMethod = () => {
    setPaymentMethod((prev) => {
      const next = prev === 'CASH' ? 'CARD' : prev === 'CARD' ? 'ONLINE' : prev === 'ONLINE' ? 'SPLIT' : 'CASH';
      setCashTendered(0);
      return next;
    });
  };

  // F7 — open the "correct a sale" picker listing this shift's sales. Choosing
  // one opens the correction modal for that sale; cashiers self-serve recent
  // sales, older ones prompt for a manager PIN (enforced server-side).
  const handleCorrectLastPayment = () => {
    setCorrectPickerOpen(true);
  };

  // F12 — re-print the most recent completed sale.
  const handlePrintLastReceipt = () => {
    if (!lastSale) {
      toast.info('No recent sale to reprint');
      return;
    }
    void printReceipt(buildReceiptData(lastSale));
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Settle — dine-in only
  //
  // The till sends nothing but how the tab is being paid.
  // `RestaurantOrderService.settle` rebuilds the SaleRequest from the order and
  // calls `SaleService.createSale` UNMODIFIED, which is exactly why the sale
  // lands on the drawer of whoever is standing here — a tab opened by one server
  // at 19:00 and paid to another at 21:00 reconciles on the payer's Z-report.
  // ─────────────────────────────────────────────────────────────────────────
  const settleMutation = useMutation({
    mutationFn: (data: SettleRequest) => restaurantOrderService.settle(dineInOrderId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: QK.cashSessionActive });
      queryClient.invalidateQueries({ queryKey: QK.restaurantOpenOrders });
      queryClient.invalidateQueries({ queryKey: QK.restaurantAreas });
      if (dineInOrderId) queryClient.removeQueries({ queryKey: QK.restaurantOrder(dineInOrderId) });

      toast.success(`${result.label} paid — ${result.sale.invoiceNumber}`);

      // The pre-settle banner was a preview computed off the catalogue; this is
      // the server's own list of what it actually billed. Say so rather than
      // letting the cashier find it on the customer's receipt.
      if (result.repricedLines.length > 0) {
        toast.warning('Menu prices had moved since these were ordered', {
          description: result.repricedLines.map(describeRepricedLine).join(' · '),
          duration: 12000,
        });
      }

      setTenderOpen(false);
      setLastSale(result.sale);
      setCashTendered(0);
      setPointsToRedeem(0);
      selectOrder(null);
      void printReceipt(buildReceiptData(result.sale));
      // A parked takeaway fires on payment; a dine-in settle never does.
      if (result.tickets.length > 0) void kitchen.dispatchTickets(result.tickets);
    },
    onError: (error: unknown) => {
      // Surfaced, never swallowed. This is where `createSale`'s branch guard
      // arrives ("… does not match your open drawer"), and where an item that
      // went out of stock during the meal arrives too. The overlay stays open so
      // the cashier can act on it.
      toast.error(getApiErrorMessage(error, 'Could not settle this tab'));
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Takeaway and Park — counter sales that involve the kitchen
  // ─────────────────────────────────────────────────────────────────────────
  const takeawayMutation = useMutation({
    mutationFn: (data: TakeawayRequest) => restaurantOrderService.takeaway(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: QK.cashSessionActive });
      toast.success(`${result.label} paid — ${result.sale.invoiceNumber}`);
      setTenderOpen(false);
      setLastSale(result.sale);
      setSelectedCustomer(null);
      setCashTendered(0);
      setPointsToRedeem(0);
      retailCart.clearCart();
      void printReceipt(buildReceiptData(result.sale));
      void kitchen.dispatchTickets(result.tickets);
    },
    onError: (error: unknown) => {
      // Nothing was saved: the server rolls the order back with the payment.
      toast.error(getApiErrorMessage(error, 'Could not take this takeaway'));
    },
  });

  // F5 / Park at the counter: the cart becomes an unpaid takeaway order, the
  // till is free for the next customer, and the order waits on the floor's
  // Takeaway tab. Nothing is sent to the kitchen until it is paid for.
  const parkMutation = useMutation({
    mutationFn: () =>
      restaurantOrderService.openOrder({
        orderType: 'TAKEAWAY',
        customerId: selectedCustomer?.id ?? null,
        branchId: selectedBranch?.id ?? null,
        items: cartLines(),
      }),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: QK.restaurantOpenOrders });
      retailCart.clearCart();
      setSelectedCustomer(null);
      setPointsToRedeem(0);
      toast.success(`Parked as ${order.label}`, {
        description: 'Pick it up from the floor (F11) → Takeaway.',
      });
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, 'Could not park this sale'));
    },
  });

  const parkSale = () => {
    if (dineInActive || items.length === 0 || parkMutation.isPending) return;
    parkMutation.mutate();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Move / merge — the party changes tables, or joins another party
  // ─────────────────────────────────────────────────────────────────────────
  const [moveOpen, setMoveOpen] = useState(false);

  const moveMutation = useMutation({
    mutationFn: ({ orderId, tableId }: { orderId: string; tableId: string }) =>
      restaurantOrderService.move(orderId, tableId),
    onSuccess: ({ order, tickets }) => {
      queryClient.setQueryData(QK.restaurantOrder(order.id), order);
      queryClient.invalidateQueries({ queryKey: QK.restaurantOpenOrders });
      queryClient.invalidateQueries({ queryKey: QK.restaurantAreas });
      toast.success(`${order.label} — moved`);
      // If the kitchen already has food for this tab, the runner needs telling.
      if (tickets.length > 0) void kitchen.dispatchTickets(tickets);
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, 'Could not move this tab'));
    },
  });

  const mergeMutation = useMutation({
    mutationFn: ({ targetId, sourceId }: { targetId: string; sourceId: string }) =>
      restaurantOrderService.merge(targetId, sourceId),
    onSuccess: ({ order, tickets }, { sourceId }) => {
      queryClient.removeQueries({ queryKey: QK.restaurantOrder(sourceId) });
      queryClient.setQueryData(QK.restaurantOrder(order.id), order);
      queryClient.invalidateQueries({ queryKey: QK.restaurantOpenOrders });
      queryClient.invalidateQueries({ queryKey: QK.restaurantAreas });
      toast.success(`Merged into ${order.label}`);
      // The till follows the bill: the tab it was on no longer exists.
      selectOrder(order.id);
      if (tickets.length > 0) void kitchen.dispatchTickets(tickets);
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, 'Could not merge these tabs'));
    },
  });

  const handlePickTable = async (table: RestaurantTable, occupiedBy: RestaurantOrder | undefined) => {
    const current = dineIn.order;
    if (!current) return;
    if (!occupiedBy) {
      moveMutation.mutate({ orderId: current.id, tableId: table.id });
      return;
    }
    const ok = await confirm({
      title: `Merge into ${occupiedBy.label}?`,
      description: `Everything on ${current.label} joins ${table.name}'s tab and becomes one bill. ${
        current.tableName ?? 'This table'
      } is freed. Nothing is sent to the kitchen twice.`,
      confirmLabel: 'Merge tabs',
    });
    if (ok) mergeMutation.mutate({ targetId: occupiedBy.id, sourceId: current.id });
  };

  // Part of a tab, paid now as its own bill; the tab stays open on its table.
  const splitMutation = useMutation({
    mutationFn: ({ orderId, data }: { orderId: string; data: SplitSettleRequest }) =>
      restaurantOrderService.splitSettle(orderId, data),
    onSuccess: (result, { orderId }) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: QK.cashSessionActive });
      queryClient.invalidateQueries({ queryKey: QK.restaurantOpenOrders });
      queryClient.invalidateQueries({ queryKey: QK.restaurantOrder(orderId) });
      toast.success(`${result.label} paid — ${result.sale.invoiceNumber}`, {
        description: 'The rest of the tab is still open.',
      });
      setTenderOpen(false);
      setSplitSelection(null);
      setLastSale(result.sale);
      setCashTendered(0);
      setPointsToRedeem(0);
      void printReceipt(buildReceiptData(result.sale));
    },
    onError: (error: unknown) => {
      // Nothing moved: the split and the payment are one transaction.
      toast.error(getApiErrorMessage(error, 'Could not take this part of the bill'));
    },
  });

  // F8 on a tab. ADMIN/MANAGER server-side; the message from a refused attempt
  // is shown rather than the control being hidden from cashiers here.
  const voidOrderMutation = useMutation({
    mutationFn: (orderId: string) => restaurantOrderService.voidOrder(orderId),
    onSuccess: ({ order, tickets }) => {
      queryClient.invalidateQueries({ queryKey: QK.restaurantOpenOrders });
      queryClient.invalidateQueries({ queryKey: QK.restaurantAreas });
      queryClient.removeQueries({ queryKey: QK.restaurantOrder(order.id) });
      toast.success(`${order.label} voided`);
      selectOrder(null);
      // Anything the kitchen was already cooking comes back as a VOID ticket.
      if (tickets.length > 0) void kitchen.dispatchTickets(tickets);
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, 'Could not void this tab'));
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Send to kitchen — F5 on a tab
  //
  // The server works out the delta (everything not yet fired), saves the ticket
  // PENDING and advances what the kitchen has been told, all under a row lock —
  // so two tills pressing Send on one table queue rather than double-print.
  // Printing happens here, after, and every outcome is acknowledged.
  // ─────────────────────────────────────────────────────────────────────────
  const unsentCount = unsentLineCount(dineInActive ? dineIn.order : undefined);

  const fireMutation = useMutation({
    mutationFn: (orderId: string) => restaurantOrderService.fire(orderId),
    onSuccess: ({ order, tickets }) => {
      queryClient.setQueryData(QK.restaurantOrder(order.id), order);
      queryClient.invalidateQueries({ queryKey: QK.restaurantOpenOrders });
      void kitchen.dispatchTickets(tickets);
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, 'Could not send this to the kitchen'));
    },
  });

  // Tap a dish, hit F5: the dish is still saving when the key lands. Dropping
  // the press would leave the cashier believing the kitchen has it, so it is
  // queued instead and fires the moment the tab settles.
  const [sendQueued, setSendQueued] = useState(false);

  const sendToKitchen = () => {
    if (!dineInActive || !dineIn.order || fireMutation.isPending) return;
    if (dineIn.isBusy) {
      setSendQueued(true);
      return;
    }
    if (unsentCount === 0) {
      toast.info('Nothing new to send to the kitchen');
      return;
    }
    fireMutation.mutate(dineIn.order.id);
  };

  useEffect(() => {
    if (!sendQueued || dineIn.isBusy) return;
    setSendQueued(false);
    // Only if the tab is still the one it was queued on and has something new.
    if (dineInActive && dineIn.order && unsentCount > 0 && !fireMutation.isPending) {
      fireMutation.mutate(dineIn.order.id);
    }
  }, [sendQueued, dineIn.isBusy, dineInActive, dineIn.order, unsentCount, fireMutation]);

  // Leaving the tab drops a queued send rather than firing it at another table.
  useEffect(() => {
    setSendQueued(false);
  }, [dineInOrderId]);

  usePosKeyboard({
    // Disabled while a blocking surface owns the keyboard: the tender overlay
    // handles its own keys; Stock Fix / Shift Summary / Shortcuts / Correct /
    // Return are modals.
    disabled:
      tenderOpen
      || helpOpen
      || !!stockFixProduct
      || showSummary
      || correctPickerOpen
      || !!correctSale
      || !!returnSaleId
      || !!kitchen.current
      || !!pinRequest
      || !!receiptFailure,
    activeRegion,
    setActiveRegion,
    productCount: filteredProducts.length,
    setGridIndex,
    cartCount: items.length,
    setCartIndex,
    actions: {
      addFocusedProduct: () => {
        const p = filteredProducts[gridIndex];
        if (p) addToCart(p);
      },
      incFocusedCart: () => {
        const it = items[cartIndex];
        if (it) updateQuantity(it.lineId, it.cartQuantity + 1);
      },
      decFocusedCart: () => {
        const it = items[cartIndex];
        if (it) updateQuantity(it.lineId, it.cartQuantity - 1);
      },
      removeFocusedCart: () => {
        const it = items[cartIndex];
        if (it) removeFromCart(it.lineId);
      },
      discountFocusedCart: () => {
        (document.querySelector(`[data-cart-index="${cartIndex}"] [data-discount-trigger]`) as HTMLButtonElement | null)?.click();
      },
      charge: openTender,
      cyclePayment: cyclePaymentMethod,
      printLastReceipt: handlePrintLastReceipt,
      correctLastPayment: handleCorrectLastPayment,
      // On a tab, F5 sends the new items to the kitchen; at the counter it parks.
      hold: dineInActive ? sendToKitchen : parkSale,
      discard: handleDiscard,
      showHelp: () => setHelpOpen(true),
      toggleFloor: () => setFloorOpen((open) => !open),
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // What the cashier must see BEFORE committing a settle
  //
  // Both of these are dine-in only and are `undefined` on a retail sale, so the
  // tender overlay renders nothing extra at a retail till.
  // ─────────────────────────────────────────────────────────────────────────

  // `createSale` re-reads `product.getBasePrice()` for every catalogue line, so
  // a menu price changed mid-meal re-prices the open tab at settle. That is
  // correct server-authoritative behaviour and is NOT worked around here — the
  // difference is shown while the sale can still be stopped.
  const repriced = dineInActive ? dineIn.repricedPreview : [];

  // `createSale` also rejects a sale whose branch differs from the payer's open
  // drawer. Stating it up front beats a refusal after the customer has handed
  // over a card.
  const dineInBranchMismatch =
    dineInActive &&
    !!dineIn.order?.branchId &&
    !!activeSession?.branchId &&
    dineIn.order.branchId !== activeSession.branchId;

  const tenderWarning = dineInActive ? (
    <>
      {serviceChargeApplies && serviceChargeRate > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 p-3 text-sm">
          <div className="min-w-0">
            <p className="font-semibold">
              {waiveServiceCharge
                ? 'Service charge removed'
                : `Service charge ${serviceChargeRate}%${tender.serviceCharge ? ` — ${fc(tender.serviceCharge.lineAmount)}` : ''}`}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {waiveServiceCharge
                ? 'Not on this bill. The removal is recorded on the sale.'
                : 'Included in the total above, with its VAT.'}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setWaiveServiceCharge((w) => !w)}
          >
            {waiveServiceCharge ? 'Add back' : 'Remove'}
          </Button>
        </div>
      )}
      {splitSelection && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
          <p className="font-semibold text-primary">Paying for part of the tab</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            These lines become their own bill; everything else stays open on the table.
          </p>
        </div>
      )}
      {unsentCount > 0 && dineIn.order?.orderType === 'DINE_IN' && (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm">
          <p className="font-semibold text-warning">
            {unsentCount} line{unsentCount === 1 ? ' was' : 's were'} never sent to the kitchen
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Settling does not print a kitchen ticket. If the guest is still waiting on these,
            go back and press F5 first.
          </p>
        </div>
      )}

      {repriced.length > 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm">
          <p className="font-semibold text-warning">
            Menu prices have moved since this tab was opened
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The bill is rung at today&apos;s prices. The server re-reads the catalogue at
            settle and that cannot be overridden from here.
          </p>
          <ul className="mt-2 space-y-0.5">
            {repriced.map((line) => (
              <li
                key={`${line.itemName}-${line.toppingName ?? ''}`}
                className="flex justify-between gap-3 tabular-nums text-foreground/90"
              >
                <span className="truncate">
                  {line.toppingName ? `${line.itemName} · ${line.toppingName}` : line.itemName}
                </span>
                <span className="shrink-0">
                  {fc(line.orderedPrice)} &rarr; {fc(line.billedPrice)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {dineInBranchMismatch && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-semibold text-destructive">This tab belongs to another branch</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A sale has to match the branch of the drawer it lands in, so settling it here
            will be refused. Settle it at the branch the tab was opened on.
          </p>
        </div>
      )}
    </>
  ) : undefined;

  // Render
  if (sessionLoading) {
    return (
      <div className="dark h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
          <p className="text-sm">Loading cash drawer...</p>
        </div>
      </div>
    );
  }

  if (!activeSession) {
    return (
      <div className="dark h-screen flex items-center justify-center bg-background">
        <StartShiftModal
          open
          onCancel={() => {
            // A PIN login is an at-the-register session with no dashboard access —
            // cancelling the shift must drop back to the login screen, not hand the
            // user the dashboard. A full email/password login already has a dashboard
            // session, so cancelling just returns there.
            if (loginMethod === 'PIN') {
              void doLogout();
            } else {
              router.push('/overview');
            }
          }}
        />
      </div>
    );
  }

  return (
    <>
      {confirmDialog}
      <ManagerPinDialog
        request={pinRequest}
        onSubmit={(pin) => {
          pinRequest?.resolve(pin);
          setPinRequest(null);
        }}
        onCancel={() => {
          pinRequest?.resolve(null);
          setPinRequest(null);
        }}
      />
      <ReceiptPrintFailedDialog
        failure={receiptFailure}
        busy={receiptRetrying}
        onRetry={() => void retryReceipt()}
        onSkip={() => setReceiptFailure(null)}
      />
      <KitchenPrintFailedDialog
        failure={kitchen.current}
        remaining={kitchen.remaining}
        busy={kitchen.busy}
        onRetry={kitchen.retry}
        onPrintAtCounter={kitchen.printAtCounter}
        onMarkHandled={kitchen.markHandled}
      />
      <div className="dark h-screen flex flex-col lg:grid lg:grid-cols-[1fr_22rem] xl:grid-cols-[1fr_26rem] bg-background text-foreground overflow-hidden font-sans print:hidden">
      <div className="flex flex-col min-w-0 min-h-0 overflow-hidden">
        <POSHeader
          userName={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`}
          userRole={user?.roles?.[0] ?? ''}
          branchName={selectedBranch?.name ?? null}
          onShiftSummary={handleFetchSummary}
          onEndShift={() => setEndShiftOpen(true)}
          onShiftEnded={handleShiftEnded}
          onLogout={handleLogout}
          // Only a full email/password session can return to the dashboard. A PIN
          // (at-the-register) login has no dashboard access, so the button hides.
          onBackToDashboard={loginMethod === 'PASSWORD' ? () => router.push('/overview') : undefined}
        />
        <LicenseBanner className="shrink-0" />
        {/* Restaurant strip: the open tab with Send, or the order-type choice.
            Big enough to hit without looking; occasional actions live in More. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-800 bg-gray-900/40 px-4 py-3 shrink-0">
          {dineInActive && dineIn.order ? (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="shrink-0 rounded-md bg-amber-500/15 px-2 py-1 text-xs font-bold uppercase tracking-wider text-amber-300">
                  {dineIn.order.orderType === 'TAKEAWAY' ? 'Takeaway' : 'Dine-in'}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold leading-tight text-white" title={dineIn.order.label}>
                    {dineIn.order.label}
                  </p>
                  <p className="text-xs tabular-nums text-gray-400">
                    {dineIn.order.covers > 0 && `${dineIn.order.covers} guests · `}
                    {formatElapsed(dineIn.order.openedAt, now)}
                  </p>
                </div>
                {dineIn.isBusy && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden="true" />
                )}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <KitchenTicketsBadge onReview={kitchen.review} />
                <OrderKitchenTickets orderId={dineIn.order.id} onReprint={kitchen.reprint} />
                <TabActionsMenu
                  disabled={dineIn.isBusy || moveMutation.isPending || mergeMutation.isPending || splitMutation.isPending}
                  onSplit={
                    items.reduce((sum, i) => sum + Math.floor(i.cartQuantity), 0) > 1
                      ? () => setSplitOpen(true)
                      : undefined
                  }
                  onMove={dineIn.order.orderType === 'DINE_IN' ? () => setMoveOpen(true) : undefined}
                  onLeave={() => selectOrder(null)}
                />
                <Button
                  variant="outline"
                  onClick={() => setFloorOpen(true)}
                  className="h-11 gap-2 border-gray-800 bg-gray-950 px-3 text-gray-300 hover:bg-gray-800 hover:text-primary"
                  title="Open the floor (F11)"
                >
                  <LayoutGrid size={18} /> Floor
                </Button>
                <Button
                  onClick={sendToKitchen}
                  disabled={unsentCount === 0 || fireMutation.isPending || dineIn.isBusy}
                  className="h-11 gap-2 px-5 text-base font-bold"
                  title="Send the new items to the kitchen (F5)"
                >
                  {fireMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                  Send to kitchen{unsentCount > 0 ? ` (${unsentCount})` : ''}
                  <kbd className="hidden rounded border border-primary-foreground/30 px-1 font-mono text-[10px] sm:inline">F5</kbd>
                </Button>
              </div>
            </>
          ) : (
            <>
              <OrderTypeBar
                counterMode={counterMode}
                onCounterModeChange={setCounterMode}
                onDineIn={() => setFloorOpen(true)}
              />
              <KitchenTicketsBadge onReview={kitchen.review} />
            </>
          )}
        </div>

        <ProductSearch search={search} onSearchChange={handleSearchChange} />
        <CategoryBar categories={menuCategories} selectedId={menuCategoryId} onSelect={setMenuCategoryId} />
        <div className="px-4 -mt-2 pb-2 bg-black shrink-0">
          <button
            type="button"
            id={POS_CUSTOM_ITEM_BUTTON_ID}
            onClick={() => setCustomItemOpen(true)}
            className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-primary transition-colors"
          >
            <Plus size={16} /> Add custom item <span className="text-xs text-gray-600">(F10)</span>
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          <ProductGrid
            products={filteredProducts}
            isLoading={isLoading}
            searchTerm={search}
            onProductClick={handleProductClick}
            selectedBranchId={selectedBranch?.id}
            cartQuantities={cartQuantities}
            focusedIndex={activeRegion === 'grid' ? gridIndex : -1}
          />
        </div>

        <div className="border-t border-border bg-card/70 px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground print:hidden shrink-0">
          {HOTKEY_LEGEND.map((h) => (
            <div key={h.key} className="flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-foreground font-mono text-xs">
                {h.key}
              </kbd>
              <span>{h.label}</span>
            </div>
          ))}
        </div>
      </div>

      <aside
        aria-label="Current sale"
        className="bg-card/40 backdrop-blur-xl border-t lg:border-t-0 lg:border-l border-border flex flex-col shadow-2xl min-h-0 overflow-hidden"
      >
        <div className="h-14 border-b border-border flex items-center px-4 sm:px-6 shrink-0">
          <ShoppingCart className="text-primary mr-2" size={20} aria-hidden="true" />
          <h2 className="font-bold text-lg text-foreground">
            {dineInActive ? 'Open Tab' : 'Current Sale'}
          </h2>
          <div
            className="ml-auto bg-primary/20 text-primary px-2 py-1 rounded text-xs font-bold tabular-nums"
            aria-live="polite"
          >
            {itemCount} {itemCount === 1 ? 'ITEM' : 'ITEMS'}
          </div>
        </div>

        {/* A tab's customer is stamped on the order when the table is seated and
            there is no Phase 2 endpoint to change it, so attaching one here would
            do nothing at settle. Hidden rather than left as a control that lies. */}
        {!dineInActive && (
          <div className="px-4 py-3 border-b border-border/60 shrink-0">
            <CustomerSelector selectedCustomer={selectedCustomer} onSelect={setSelectedCustomer} />
          </div>
        )}

        <div
          className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2.5 min-h-0"
          tabIndex={0}
          role="region"
          aria-label="Cart items"
        >
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground italic gap-2 py-12">
              <ShoppingCart size={40} className="opacity-30" aria-hidden="true" />
              <p className="text-sm">{dineInActive ? 'Nothing on this tab yet' : 'Cart is empty'}</p>
              <p className="text-xs text-muted-foreground/80 not-italic">
                Tap an item on the menu to start
              </p>
            </div>
          ) : (
            items.map((item, index) => (
              <CartItemCard
                key={item.lineId}
                item={item}
                index={index}
                isFocused={activeRegion === 'cart' && index === cartIndex}
                onUpdateQuantity={updateQuantity}
                onRemove={removeFromCart}
                onSetDiscount={setItemDiscount}
                // No endpoint stores a discount on an order line, so the control
                // is absent on a tab rather than silently dropping the number.
                showDiscount={!dineInActive}
              />
            ))
          )}
        </div>

        <CartSummary
          subtotal={subtotal}
          discountAmount={discountAmount}
          taxAmount={taxAmount}
          taxLabel={taxLabel}
          taxInclusive={taxInclusive}
          total={total}
          itemCount={itemCount}
          onCharge={openTender}
          chargeLabel={dineInActive ? 'SETTLE' : counterMode === 'TAKEAWAY' ? 'CHARGE & SEND' : 'CHARGE'}
          // Park turns a counter cart into an unpaid takeaway order waiting on the
          // floor. Absent on a tab, which is already held server-side.
          onHold={parkSale}
          showHold={!dineInActive}
          holdLabel={parkMutation.isPending ? 'Parking…' : 'Park'}
          onDiscard={handleDiscard}
          discardLabel={dineInActive ? 'Void tab' : 'Discard'}
        />
      </aside>

      {showSummary && (
        <ShiftSummary summary={summary} session={activeSession} onClose={() => setShowSummary(false)} />
      )}

      </div>

      <TenderOverlay
        open={tenderOpen}
        onClose={() => { setTenderOpen(false); setSplitSelection(null); }}
        paymentMethod={paymentMethod}
        onPaymentMethodChange={(m) => { setPaymentMethod(m); setCashTendered(0); }}
        cashTendered={cashTendered}
        onCashTenderedChange={setCashTendered}
        subtotal={tender.subtotal}
        discountAmount={tender.discountAmount}
        taxAmount={tender.taxAmount}
        taxLabel={tender.taxLabel}
        taxInclusive={tender.taxInclusive}
        total={tender.total}
        isProcessing={
          dineInActive
            ? settleMutation.isPending || splitMutation.isPending
            : counterMode === 'TAKEAWAY'
              ? takeawayMutation.isPending
              : checkoutMutation.isPending
        }
        onComplete={handleCheckout}
        loyaltyEnabled={!dineInActive && !!tenantInfo?.loyaltyEnabled && !!selectedCustomer}
        customerPoints={selectedCustomer?.loyaltyPoints ?? 0}
        pointValue={tenantInfo?.loyaltyPointValue ?? 0}
        pointsToRedeem={pointsToRedeem}
        onPointsToRedeemChange={setPointsToRedeem}
        creditEnabled={!dineInActive && creditEligible}
        availableCredit={availableCredit}
        creditBalance={creditBalance}
        // Undefined on the retail path, so the overlay renders exactly what it
        // always has.
        warning={tenderWarning}
      />

      <ShortcutsOverlay
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
      />

      {/* The mid-service floor. Mounted inside the terminal, never routed to, so
          switching tables cannot unmount the cart. */}
      <SplitBillDialog
        open={splitOpen}
        items={items}
        taxContext={taxContext}
        taxInclusive={taxInclusive}
        onCancel={() => setSplitOpen(false)}
        onConfirm={(selection) => {
          setSplitOpen(false);
          setSplitSelection(selection);
          setTenderOpen(true);
        }}
      />
      {dineInActive && dineIn.order && (
        <FloorSheet
          open={moveOpen}
          onOpenChange={setMoveOpen}
          onSelectOrder={() => undefined}
          moving={{ order: dineIn.order, onPickTable: handlePickTable }}
        />
      )}
      <FloorSheet
        open={floorOpen}
        onOpenChange={setFloorOpen}
        onSelectOrder={(orderId) => selectOrder(orderId)}
      />

      <EndShiftModal
        open={endShiftOpen}
        onClose={() => setEndShiftOpen(false)}
        onEnded={handleShiftEnded}
      />

      <LogoutShiftWarningDialog
        open={logoutWarnOpen}
        expectedAmount={drawerExpected}
        onCancel={() => setLogoutWarnOpen(false)}
        onEndShift={() => {
          setLogoutWarnOpen(false);
          setEndShiftOpen(true);
        }}
        onLogoutAnyway={() => {
          setLogoutWarnOpen(false);
          void doLogout();
        }}
      />

      <CorrectSalePickerModal
        open={correctPickerOpen}
        onClose={() => setCorrectPickerOpen(false)}
        onPick={(sale) => {
          setCorrectPickerOpen(false);
          setCorrectSale(sale);
        }}
      />

      <CorrectPaymentModal
        open={!!correctSale}
        sale={correctSale}
        onClose={() => setCorrectSale(null)}
        onCorrected={(updated) => {
          // Keep lastSale in sync only when it's the one that changed.
          setLastSale((prev) => (prev && prev.id === updated.id ? updated : prev));
          // Cash-tender / method changes shift the drawer's expected balance, so
          // refresh the active session and the picker list in lockstep.
          queryClient.invalidateQueries({ queryKey: QK.cashSessionActive });
          queryClient.invalidateQueries({ queryKey: QK.currentSessionSales });
          // Hand the customer a corrected receipt reflecting the new tender/method.
          void printReceipt(buildReceiptData(updated), 'Corrected receipt printed');
        }}
        onRequestReturn={(s) => setReturnSaleId(s.id)}
      />

      <ReturnModal saleId={returnSaleId} onClose={() => setReturnSaleId(null)} />

      <ToppingPickerDialog
        open={!!toppingProduct}
        product={toppingProduct}
        groups={toppingGroups ?? []}
        isLoading={toppingGroupsLoading}
        onClose={() => setToppingProduct(null)}
        onAdd={(product, toppings, notes) => addToCart(product, toppings, notes)}
      />

      <CustomItemModal
        open={customItemOpen}
        onClose={() => setCustomItemOpen(false)}
        onAdd={(name, price, qty) => addCustomItem(name, price, qty)}
      />

      {/* Stock Fix modal — opened from the checkout error toast's action */}
      {stockFixProduct && (
        <InventoryAdjustmentModal
          product={stockFixProduct}
          isOpen={!!stockFixProduct}
          onClose={() => {
            setStockFixProduct(null);
            queryClient.invalidateQueries({ queryKey: ['products'] });
          }}
          defaultBranchId={selectedBranch?.id}
          defaultType="RECONCILIATION"
        />
      )}

      {/* Hidden Receipt for Printing */}
      {lastSale && (
        <div className="hidden print:block print:absolute print:left-0 print:top-0 print:w-full print:bg-white print:text-black z-[9999]">
          <Receipt
            sale={lastSale}
            tenant={{
              name: tenantInfo?.name || 'StoreX',
              addressLine1: tenantInfo?.addressLine1 ?? undefined,
              addressLine2: tenantInfo?.addressLine2 ?? undefined,
              phone: tenantInfo?.phone ?? undefined,
            }}
            logoUrl={tenantInfo?.logoUrl ?? undefined}
            branch={selectedBranch}
            showBranch={branches.length > 1}
            taxLabel={taxLabel}
          />
        </div>
      )}
    </>
  );
}
