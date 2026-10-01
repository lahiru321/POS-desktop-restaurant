"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { inventoryService, ProductFilters } from "@/services/inventoryService";
import { useState, useMemo, useCallback, useRef } from "react";
import type { Page } from "@/types/common";
import { Button } from "@/components/ui/button";
import { Plus, X, Upload, Download, Shield, CheckCircle2, Ban } from "lucide-react";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import ProductTable from "@/components/inventory/ProductTable";
import ImportProductsModal from "@/components/inventory/ImportProductsModal";
import InventoryAdjustmentModal from "@/components/inventory/InventoryAdjustmentModal";
import Link from "next/link";
import { Product } from "@/types/inventory";
import { useRouter } from "next/navigation";
import { SortDirection } from "@/components/ui/SortableHeader";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/authStore";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { QK } from "@/lib/queryKeys";
import { useConfirmDialog } from "@/components/super-admin/ConfirmDialog";

export default function ProductsPage() {
  const { user: currentUser } = useAuthStore();
  const maxProducts = currentUser?.maxProducts || 500;
  
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [isActive, setIsActive] = useState<string>("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
  const [productForAdjustment, setProductForAdjustment] = useState<Product | null>(null);

  const queryClient = useQueryClient();
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  // Debounce search input
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    // Reset to page 0 on search
    setPage(0);
    // Simple debounce
    const timeout = setTimeout(() => setDebouncedSearch(value), 300);
    return () => clearTimeout(timeout);
  }, []);

  // Build filters object
  const filters: ProductFilters = useMemo(() => ({
    search: debouncedSearch || undefined,
    categoryId: categoryId || undefined,
    isActive: isActive === '' ? undefined : isActive === 'true',
    sort: sortKey && sortDirection ? `${sortKey},${sortDirection}` : undefined,
  }), [debouncedSearch, categoryId, isActive, sortKey, sortDirection]);

  // Fetch products with filters
  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products', page, filters],
    queryFn: () => inventoryService.getProducts(page, 20, filters),
  });

  const totalElements = productsData?.totalElements || 0;
  const isLimitReached = totalElements >= maxProducts;

  // Categories for the filter dropdown
  const { data: categories } = useQuery({
    queryKey: QK.categories,
    queryFn: () => inventoryService.getCategories(),
  });


  const deleteMutation = useMutation({
    mutationFn: (id: string) => inventoryService.deleteProduct(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success("Menu item deleted");
    },
    onError: (error: unknown) => {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to delete menu item");
    }
  });

  // Per-row pending state so each row shows its own spinner and can't be spam-clicked.
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Track reason for the current mutation so we can skip the undo toast when
  // this toggle was itself triggered by an undo click (avoids nested undos).
  const isUndoRef = useRef(false);

  const bulkStatusMutation = useMutation({
    mutationFn: ({ ids, active }: { ids: string[]; active: boolean }) =>
      inventoryService.bulkSetStatus(ids, active),
    onSuccess: (count, { active }) => {
      toast.success(`${count} item${count === 1 ? '' : 's'} ${active ? 'activated' : 'deactivated'}`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (error: unknown) => {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Bulk update failed');
    },
  });

  const toggleRow = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleStatusMutation = useMutation({
    mutationFn: (id: string) => inventoryService.toggleStatus(id),
    onMutate: async (id) => {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });

      // Cancel in-flight refetches so they don't overwrite the optimistic value.
      await queryClient.cancelQueries({ queryKey: ['products'] });

      // Snapshot every cached products query so we can roll back on error.
      const snapshots = queryClient.getQueriesData<Page<Product>>({ queryKey: ['products'] });

      // Optimistically flip isActive across every cached page/filter variant.
      queryClient.setQueriesData<Page<Product>>({ queryKey: ['products'] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          content: old.content.map((p) => (p.id === id ? { ...p, isActive: !p.isActive } : p)),
        };
      });

      const wasUndo = isUndoRef.current;
      isUndoRef.current = false;
      return { snapshots, wasUndo };
    },
    onError: (error: unknown, _id, context) => {
      // Roll back every snapshot we took.
      context?.snapshots.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      toast.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          'Failed to update status'
      );
    },
    onSuccess: (updated, _id, context) => {
      queryClient.setQueryData(['product', updated.id], updated);

      if (context?.wasUndo) return; // Silent success for undo — the user already knows.

      if (!updated.isActive) {
        // Deactivation is the risky action (hides product from POS).
        // Offer a one-tap undo instead of a modal confirmation.
        toast.success(`${updated.name} deactivated`, {
          description: "It's hidden from the POS terminal until reactivated.",
          action: {
            label: 'Undo',
            onClick: () => {
              isUndoRef.current = true;
              toggleStatusMutation.mutate(updated.id);
            },
          },
        });
      } else {
        toast.success(`${updated.name} is now active`);
      }
    },
    onSettled: (_data, _err, id) => {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const handleEdit = (product: Product) => {
    router.push(`/inventory/products/${product.id}`);
  };

  const handleDelete = async (product: Product) => {
    const ok = await confirm({
      title: `Delete "${product.name}"?`,
      description: 'It comes off the menu. Past sales keep it.',
      confirmLabel: 'Delete item',
      variant: 'destructive',
    });
    if (ok) deleteMutation.mutate(product.id);
  };

  const handleManageInventory = (product: Product) => {
    setProductForAdjustment(product);
    setIsAdjustmentModalOpen(true);
  };

  const handleToggleStatus = (product: Product) => {
    toggleStatusMutation.mutate(product.id);
  };

  const handleSort = (key: string, direction: SortDirection) => {
    setSortKey(direction ? key : null);
    setSortDirection(direction);
    setPage(0);
  };

  const hasActiveFilters = categoryId || isActive !== '';

  const clearFilters = () => {
    setCategoryId("");
    setIsActive("");
    setSearch("");
    setDebouncedSearch("");
    setPage(0);
  };

  // Scan-to-Onboard: Fast product lookup via scanner that redirects to Edit or Create
  useBarcodeScanner({
    onScan: async (barcode) => {
      try {
        const product = await inventoryService.lookupByCode(barcode);
        if (!product.isActive) {
          toast.warning(`Note: ${product.name} is currently INACTIVE. Opening to reactivate.`);
        } else {
          toast.info(`${product.name} is already on the menu. Opening it.`);
        }
        router.push(`/inventory/products/${product.id}`);
      } catch {
        // Check quota before redirecting to creation form
        if (isLimitReached) {
          toast.error("Item limit reached. Cannot add a new barcode.", {
            description: `You have reached your limit of ${maxProducts} menu items.`
          });
          return;
        }
        
        toast.success("New barcode. Opening a new packaged item.");
        router.push(`/inventory/products/new?barcode=${encodeURIComponent(barcode)}`);
      }
    }
  });

  const pageProducts = productsData?.content ?? [];
  const allPageSelected = pageProducts.length > 0 && pageProducts.every((p) => selected.has(p.id));
  const somePageSelected = pageProducts.some((p) => selected.has(p.id));
  const togglePage = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of pageProducts) {
        if (checked) next.add(p.id);
        else next.delete(p.id);
      }
      return next;
    });
  };

  return (
    <div className="p-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {confirmDialog}
      <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Menu Items</h1>
          <p className="text-muted-foreground flex flex-wrap items-center gap-2">
            Manage your menu, prices and kitchen routing.
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider ${isLimitReached ? 'bg-warning/10 text-warning border-warning/20' : 'bg-muted text-muted-foreground border-border'}`}>
               {totalElements} / {maxProducts} items
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button
            variant="outline"
            className="gap-2 border-border"
            onClick={() => inventoryService.exportProducts()}
          >
            <Download size={18} /> Export
          </Button>
          <Button 
            variant="outline" 
            className="gap-2 border-border"
            onClick={() => setIsImportModalOpen(true)}
          >
            <Upload size={18} /> Import
          </Button>
          <div className="flex flex-col items-end gap-1">
             <Link href={isLimitReached ? "#" : "/inventory/products/new"}>
               <Button 
                 disabled={isLimitReached}
                 className="gap-2 bg-primary hover:bg-primary/90"
               >
                 {isLimitReached ? <Shield size={18} className="text-warning" /> : <Plus size={18} />}
                 Add menu item
               </Button>
             </Link>
             {isLimitReached && (
                <span className="text-[10px] text-warning font-bold bg-warning/10 px-2 py-0.5 rounded border border-warning/20">
                  Quota Exceeded
                </span>
             )}
          </div>
        </div>
      </div>

      {/* Search & Filters Bar */}
      <div className="space-y-3">
        <DataTableToolbar
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder="Search the menu by name..."
          resultsCount={{ shown: pageProducts.length, total: totalElements, label: 'items' }}
          filters={
            <>
              <select
                value={categoryId}
                onChange={(e) => { setCategoryId(e.target.value); setPage(0); }}
                aria-label="Filter by category"
                className="h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground focus:border-primary focus:outline-none min-w-[150px]"
              >
                <option value="">All Categories</option>
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              <select
                value={isActive}
                onChange={(e) => { setIsActive(e.target.value); setPage(0); }}
                aria-label="Filter by status"
                className="h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground focus:border-primary focus:outline-none min-w-[120px]"
              >
                <option value="">All Status</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="text-muted-foreground hover:text-foreground gap-1"
                >
                  <X size={14} /> Clear
                </Button>
              )}
            </>
          }
          selectionBar={
            selected.size > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{selected.size} selected</span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={bulkStatusMutation.isPending}
                    onClick={() => bulkStatusMutation.mutate({ ids: Array.from(selected), active: true })}
                    className="gap-2 text-success hover:text-success"
                  >
                    <CheckCircle2 size={14} /> Activate
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={bulkStatusMutation.isPending}
                    onClick={() => bulkStatusMutation.mutate({ ids: Array.from(selected), active: false })}
                    className="gap-2 text-muted-foreground"
                  >
                    <Ban size={14} /> Deactivate
                  </Button>
                </div>
              </div>
            ) : undefined
          }
        />

        {/* Active Filter Tags */}
        {hasActiveFilters && (
          <div className="flex gap-2 flex-wrap">
            {categoryId && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium border border-primary/20">
                Category: {categories?.find(c => c.id === categoryId)?.name}
                <button onClick={() => setCategoryId("")} className="hover:text-foreground"><X size={12} /></button>
              </span>
            )}
            {isActive !== '' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-warning/10 text-warning text-xs font-medium border border-warning/20">
                Status: {isActive === 'true' ? 'Active' : 'Inactive'}
                <button onClick={() => setIsActive("")} className="hover:text-foreground"><X size={12} /></button>
              </span>
            )}
          </div>
        )}
      </div>

      <ProductTable
        data={productsData?.content || []}
        isLoading={isLoading}
        totalPages={productsData?.totalPages || 1}
        currentPage={page}
        onPageChange={setPage}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onManageInventory={handleManageInventory}
        onToggleStatus={handleToggleStatus}
        togglingIds={togglingIds}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={handleSort}
        selectedIds={selected}
        onToggleRow={toggleRow}
        allSelected={allPageSelected}
        someSelected={somePageSelected}
        onTogglePage={togglePage}
      />

      <ImportProductsModal 
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["products"] })}
      />

      <InventoryAdjustmentModal
        product={productForAdjustment}
        isOpen={isAdjustmentModalOpen}
        onClose={() => {
          setIsAdjustmentModalOpen(false);
          setProductForAdjustment(null);
        }}
      />
    </div>
  );
}
