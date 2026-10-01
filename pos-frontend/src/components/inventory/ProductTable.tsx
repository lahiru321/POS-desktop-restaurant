"use client";

import Image from "next/image";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Pencil, Trash2, AlertTriangle, LayoutList, Loader2 } from "lucide-react";
import { Product } from "@/types/inventory";
import { formatCurrency, cn } from "@/lib/utils";
import { SortableHeader, SortDirection } from "@/components/ui/SortableHeader";
import { Switch } from "@/components/ui/switch";

interface ProductTableProps {
  data: Product[];
  isLoading: boolean;
  totalPages: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  onEdit?: (product: Product) => void;
  onDelete?: (product: Product) => void;
  onManageInventory?: (product: Product) => void;
  sortKey: string | null;
  sortDirection: SortDirection;
  onSort: (key: string, direction: SortDirection) => void;
  onToggleStatus?: (product: Product) => void;
  togglingIds?: Set<string>;
  /** Selection — when onToggleRow is provided, a checkbox column is rendered. */
  selectedIds?: Set<string>;
  onToggleRow?: (id: string, checked: boolean) => void;
  allSelected?: boolean;
  someSelected?: boolean;
  onTogglePage?: (checked: boolean) => void;
}

export default function ProductTable({
  data,
  isLoading,
  totalPages,
  currentPage,
  onPageChange,
  onEdit,
  onDelete,
  onManageInventory,
  sortKey,
  sortDirection,
  onSort,
  onToggleStatus,
  togglingIds,
  selectedIds,
  onToggleRow,
  allSelected,
  someSelected,
  onTogglePage,
}: ProductTableProps) {
  const selectable = !!onToggleRow;
  if (isLoading) {
    return <div className="py-20 text-center text-muted-foreground">Loading the menu...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent bg-muted/20">
              {selectable && (
                <TableHead className="w-12 pl-4">
                  <Checkbox
                    checked={!!allSelected}
                    indeterminate={!!someSelected && !allSelected}
                    onCheckedChange={(c) => onTogglePage?.(c)}
                    aria-label="Select all products on this page"
                  />
                </TableHead>
              )}
              <SortableHeader
                label="Product"
                sortKey="name"
                currentSort={sortKey}
                currentDirection={sortDirection}
                onSort={onSort}
                className="py-4"
              />
              <TableHead className="text-muted-foreground font-semibold">Category</TableHead>
              <SortableHeader
                label="Price"
                sortKey="basePrice"
                currentSort={sortKey}
                currentDirection={sortDirection}
                onSort={onSort}
                className="text-right"
              />
              <SortableHeader
                label="Stock"
                sortKey="stockQuantity"
                currentSort={sortKey}
                currentDirection={sortDirection}
                onSort={onSort}
                className="text-center"
              />
              <TableHead className="text-muted-foreground font-semibold">Status</TableHead>
              <TableHead className="text-muted-foreground font-semibold text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((product) => {
              const isToggling = togglingIds?.has(product.id) ?? false;
              return (
              <TableRow
                key={product.id}
                data-state={selectedIds?.has(product.id) ? 'selected' : undefined}
                className={cn(
                  'border-border hover:bg-muted/40 data-[state=selected]:bg-primary/5 transition-colors group',
                  !product.isActive && 'bg-background/60'
                )}
              >
                {selectable && (
                  <TableCell className="pl-4">
                    <Checkbox
                      checked={selectedIds?.has(product.id) ?? false}
                      onCheckedChange={(c) => onToggleRow?.(product.id, c)}
                      aria-label={`Select ${product.name}`}
                    />
                  </TableCell>
                )}
                <TableCell className="py-2">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'w-10 h-10 rounded bg-muted relative overflow-hidden flex items-center justify-center text-muted-foreground font-bold border border-border',
                        !product.isActive && 'grayscale'
                      )}
                    >
                      {product.imageUrl ? (
                        <Image src={product.imageUrl} fill className="object-cover" alt={product.name} />
                      ) : (
                        product.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div>
                      <div
                        className={cn(
                          'font-medium',
                          product.isActive ? 'text-foreground' : 'text-muted-foreground line-through decoration-gray-600'
                        )}
                      >
                        {product.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {!product.isActive
                          ? 'Hidden from the till'
                          : product.trackStock
                            ? 'Packaged item'
                            : 'Cooked to order'}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground text-sm bg-muted/50 px-2 py-1 rounded">
                    {product.categoryName || 'Uncategorized'}
                  </span>
                </TableCell>
                <TableCell className="text-right font-medium text-success">
                  {formatCurrency(product.basePrice)}
                </TableCell>
                <TableCell className="text-center">
                  {!product.trackStock ? (
                    <span className="text-muted-foreground" title="Cooked to order: no stock count">—</span>
                  ) : (
                  <div className="flex flex-col items-center">
                    <span className={product.stockQuantity <= product.lowStockThreshold ? 'text-destructive font-bold' : 'text-foreground'}>
                      {product.stockQuantity}
                    </span>
                    {product.stockQuantity <= product.lowStockThreshold && (
                      <span className="text-[10px] text-destructive font-semibold flex items-center gap-0.5">
                        <AlertTriangle size={10} /> LOW
                      </span>
                    )}
                    
                    {/* Branch Breakdown */}
                    {product.stockLevels && product.stockLevels.length > 1 && (
                      <div className="mt-1 pt-1 border-t border-border w-full hidden group-hover:block transition-all duration-200">
                        {product.stockLevels.map((sl) => (
                           <div key={sl.id} className="text-[10px] text-muted-foreground flex justify-between gap-2 px-2">
                             <span>{sl.branchName}:</span>
                             <span className="font-mono">{sl.quantity}</span>
                           </div>
                        ))}
                      </div>
                    )}
                  </div>
                  )}
                </TableCell>
                <TableCell>
                  <div
                    className="flex items-center gap-2"
                    title={
                      product.isActive
                        ? 'On the menu. Toggle to hide it from the till.'
                        : 'Hidden from the till. Toggle to put it back on the menu.'
                    }
                  >
                    <Switch
                      checked={product.isActive}
                      disabled={isToggling || !onToggleStatus}
                      onCheckedChange={() => onToggleStatus?.(product)}
                      aria-label={`${product.isActive ? 'Deactivate' : 'Activate'} ${product.name}`}
                      aria-busy={isToggling}
                      className="data-[state=checked]:bg-success data-[state=unchecked]:bg-muted border-border"
                    />
                    <span
                      className={cn(
                        'text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border',
                        product.isActive
                          ? 'text-success bg-success/10 border-success/30'
                          : 'text-muted-foreground bg-muted border-border'
                      )}
                    >
                      {isToggling && <Loader2 size={11} className="animate-spin" />}
                      {product.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {product.trackStock && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Adjust stock for ${product.name}`}
                        title="Adjust stock"
                        className="h-8 w-8 text-primary hover:text-primary hover:bg-primary/10"
                        onClick={() => onManageInventory?.(product)}
                      >
                        <LayoutList size={14} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${product.name}`}
                      title="Edit"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted"
                      onClick={() => onEdit?.(product)}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${product.name}`}
                      title="Delete"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => onDelete?.(product)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
            {data.length === 0 && (
              <TableRow>
                <TableCell colSpan={selectable ? 7 : 6} className="h-24 text-center text-muted-foreground">
                  No menu items found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 py-4">
          <Button 
            variant="outline" 
            size="sm" 
            disabled={currentPage === 0}
            onClick={() => onPageChange(currentPage - 1)}
            className="border-border bg-card text-muted-foreground hover:text-foreground"
          >
            Previous
          </Button>
          <div className="flex items-center px-4 text-sm text-muted-foreground">
             Page {currentPage + 1} of {totalPages}
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            disabled={currentPage + 1 >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            className="border-border bg-card text-muted-foreground hover:text-foreground"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
