'use client';

import { Suspense, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryService } from '@/services/inventoryService';
import { branchService, Branch } from '@/services/branchService';
import { taxService } from '@/services/taxService';
import { cashSessionService } from '@/services/cashSessionService';
import { tenantService } from '@/services/tenantService';
import { SaleResponse, salesService, SaleRequest, SalesSummaryResponse } from '@/services/salesService';
import { useCart, TaxContext, type CartView } from '@/hooks/useCart';
import { useDineInCart } from '@/hooks/useDineInCart';
import { ShoppingCart, Loader2, Plus, LayoutGrid, LogOut } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import {
  usePosKeyboard,
  HOTKEY_LEGEND,
  RESTAURANT_HOTKEY_LEGEND,
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
  type SettleRequest,
} from '@/services/restaurantOrderService';

// POS Components
import { POSHeader } from '@/components/pos/POSHeader';
import { ProductSearch } from '@/components/pos/ProductSearch';
import { ProductGrid } from '@/components/pos/ProductGrid';
import { ToppingPickerDialog } from '@/components/pos/ToppingPickerDialog';
import { toppingService } from '@/services/toppingService';
import { CartItemCard } from '@/components/pos/CartItemCard';
import { CartSummary } from '@/components/pos/CartSummary';
import { TenderOverlay } from '@/components/pos/TenderOverlay';
import { CorrectPaymentModal } from '@/components/pos/CorrectPaymentModal';
import { CorrectSalePickerModal } from '@/components/pos/CorrectSalePickerModal';
import { ReturnModal } from '@/components/pos/ReturnModal';
import { ShortcutsOverlay } from '@/components/pos/ShortcutsOverlay';
import { FloorSheet } from '@/components/pos/FloorSheet';
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
  // Level one of the restaurant gate: does the API even exist for this install?
  const hasRestaurantFeature = useAuthStore((state) => state.hasFeature('RESTAURANT'));
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
  // Restaurant mode
  //
  // Level two of the gate. The desktop installer grants every feature to every
  // install, so the flag alone would grow a Floor button on a hardware shop;
  // `restaurantMode` is the tenant saying it actually runs as a restaurant.
  // BOTH must be true before a single line below changes what a till does, and
  // every restaurant branch in this file is guarded by `restaurantEnabled` or by
  // `dineInActive`, which implies it.
  // ─────────────────────────────────────────────────────────────────────────
  const restaurantEnabled = hasRestaurantFeature && (tenantInfo?.restaurantMode ?? false);

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

  // The same interface, backed by `restaurant_orders` instead of `useState`.
  // Every query inside is `enabled: restaurantEnabled && !!orderId`, so on a
  // retail till this hook issues no requests at all.
  const dineIn = useDineInCart({
    orderId: restaurantEnabled ? dineInOrderId : null,
    enabled: restaurantEnabled,
    taxContext,
    taxInclusive: tenantInfo?.taxInclusive ?? true,
    branchId: selectedBranch?.id,
  });

  /** The one predicate every restaurant branch below keys off. */
  const dineInActive = restaurantEnabled && !!dineInOrderId && !!dineIn.order;

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

  // Data Fetching
  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products', search, 'active', selectedBranch?.id], // Branch-aware key
    queryFn: () => inventoryService.getProducts(0, 50, { isActive: true, search }),
  });

  const products = productsData?.content || [];
  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.sku?.toLowerCase().includes(search.toLowerCase()) ||
    p.barcode?.includes(search)
  );

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
      
      receiptPrinterService.processHardwareCheckoutActions(receiptData);
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

  const handleCheckout = () => {
    if (items.length === 0) return;

    // Dine-in settles the server-side tab instead of posting a cart. Points are
    // not offered on a tab (see `loyaltyEnabled` on the overlay), so none are
    // sent: the sale's customer is the one stamped on the order at open time.
    if (dineInActive && dineInOrderId) {
      settleMutation.mutate({
        paymentMethod,
        cashTendered: (paymentMethod === 'CASH' || paymentMethod === 'SPLIT') && cashTendered > 0
          ? cashTendered
          : undefined,
      });
      return;
    }

    checkoutMutation.mutate({
      customerId: selectedCustomer?.id,
      branchId: selectedBranch?.id,
      paymentMethod,
      cashTendered: (paymentMethod === 'CASH' || paymentMethod === 'SPLIT') && cashTendered > 0
        ? cashTendered
        : undefined,
      pointsToRedeem: selectedCustomer && pointsToRedeem > 0 ? pointsToRedeem : undefined,
      items: items.map(item => ({
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
      }))
    });
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
    receiptPrinterService.processHardwareCheckoutActions(buildReceiptData(lastSale));
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
      receiptPrinterService.processHardwareCheckoutActions(buildReceiptData(result.sale));
    },
    onError: (error: unknown) => {
      // Surfaced, never swallowed. This is where `createSale`'s branch guard
      // arrives ("… does not match your open drawer"), and where an item that
      // went out of stock during the meal arrives too. The overlay stays open so
      // the cashier can act on it.
      toast.error(getApiErrorMessage(error, 'Could not settle this tab'));
    },
  });

  // F8 on a tab. ADMIN/MANAGER server-side; the message from a refused attempt
  // is shown rather than the control being hidden from cashiers here.
  const voidOrderMutation = useMutation({
    mutationFn: (orderId: string) => restaurantOrderService.voidOrder(orderId),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: QK.restaurantOpenOrders });
      queryClient.invalidateQueries({ queryKey: QK.restaurantAreas });
      queryClient.removeQueries({ queryKey: QK.restaurantOrder(order.id) });
      toast.success(`${order.label} voided`);
      selectOrder(null);
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, 'Could not void this tab'));
    },
  });

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
      || !!returnSaleId,
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
      hold: () => {},
      discard: handleDiscard,
      showHelp: () => setHelpOpen(true),
      // Undefined on a retail till, which is what leaves F11 to the browser.
      toggleFloor: restaurantEnabled ? () => setFloorOpen((open) => !open) : undefined,
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
        {/* Restaurant strip. Renders nothing whatsoever unless BOTH the
            RESTAURANT feature and the tenant's restaurantMode are on. */}
        {restaurantEnabled && (
          <div className="flex items-center gap-2 sm:gap-3 border-b border-gray-800 bg-gray-900/40 px-4 py-2 text-sm shrink-0">
            {dineInActive && dineIn.order ? (
              <>
                <span className="shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
                  Dine-in
                </span>
                <span className="truncate font-semibold text-white">{dineIn.order.label}</span>
                {dineIn.order.covers > 0 && (
                  <span className="hidden shrink-0 tabular-nums text-gray-400 sm:inline">
                    {dineIn.order.covers} covers
                  </span>
                )}
                <span className="shrink-0 tabular-nums text-gray-400">
                  {formatElapsed(dineIn.order.openedAt, now)}
                </span>
                {dineIn.isBusy && (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-400" aria-hidden="true" />
                )}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setFloorOpen(true)}
                    className="h-8 gap-2 border-gray-800 bg-gray-950 px-3 text-gray-300 hover:bg-gray-800 hover:text-primary"
                    title="Open the floor (F11)"
                  >
                    <LayoutGrid size={14} /> Floor
                    <kbd className="hidden rounded border border-gray-700 px-1 font-mono text-[10px] text-gray-500 sm:inline">F11</kbd>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => selectOrder(null)}
                    className="h-8 gap-2 border-gray-800 bg-gray-950 px-3 text-gray-300 hover:bg-gray-800"
                    title="Leave this tab open and go back to the till"
                  >
                    <LogOut size={14} /> Leave tab
                  </Button>
                </div>
              </>
            ) : (
              <>
                <span className="truncate text-gray-400">
                  Counter sale &mdash; no table. Open the floor to seat one.
                </span>
                <div className="ml-auto shrink-0">
                  <Button
                    variant="outline"
                    onClick={() => setFloorOpen(true)}
                    className="h-8 gap-2 border-gray-800 bg-gray-950 px-3 text-gray-300 hover:bg-gray-800 hover:text-primary"
                    title="Open the floor (F11)"
                  >
                    <LayoutGrid size={14} /> Floor
                    <kbd className="hidden rounded border border-gray-700 px-1 font-mono text-[10px] text-gray-500 sm:inline">F11</kbd>
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        <ProductSearch search={search} onSearchChange={setSearch} />
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
          {(restaurantEnabled ? RESTAURANT_HOTKEY_LEGEND : HOTKEY_LEGEND).map((h) => (
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
                Scan a barcode or tap a product to start
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
          chargeLabel={dineInActive ? 'SETTLE' : 'CHARGE'}
          // "Hold Sale" has been wired to a no-op since this terminal was
          // written. Hidden now, in both modes — nothing here can hold a sale,
          // and a tab is already parked server-side the moment it exists.
          onHold={() => {}}
          showHold={false}
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
        onClose={() => setTenderOpen(false)}
        paymentMethod={paymentMethod}
        onPaymentMethodChange={(m) => { setPaymentMethod(m); setCashTendered(0); }}
        cashTendered={cashTendered}
        onCashTenderedChange={setCashTendered}
        subtotal={subtotal}
        discountAmount={discountAmount}
        taxAmount={taxAmount}
        taxLabel={taxLabel}
        taxInclusive={taxInclusive}
        total={total}
        isProcessing={dineInActive ? settleMutation.isPending : checkoutMutation.isPending}
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
        restaurantMode={restaurantEnabled}
      />

      {/* The mid-service floor. Mounted inside the terminal, never routed to, so
          switching tables cannot unmount the cart. */}
      {restaurantEnabled && (
        <FloorSheet
          open={floorOpen}
          onOpenChange={setFloorOpen}
          onSelectOrder={(orderId) => selectOrder(orderId)}
        />
      )}

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
          receiptPrinterService.processHardwareCheckoutActions(buildReceiptData(updated));
          toast.success('Corrected receipt sent to printer');
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
