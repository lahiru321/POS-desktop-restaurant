'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import { Package, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Product } from '@/types/inventory';
import { CURRENCY, cn } from '@/lib/utils';

interface ProductGridProps {
  products: Product[];
  isLoading: boolean;
  searchTerm: string;
  onProductClick: (product: Product) => void;
  selectedBranchId?: string;
  cartQuantities?: Record<string, number>;
  /** Keyboard-focused card index (-1 = none). Renders a ring + scrolls into view. */
  focusedIndex?: number;
}

export function ProductGrid({
  products,
  isLoading,
  searchTerm,
  onProductClick,
  selectedBranchId,
  cartQuantities,
  focusedIndex = -1,
}: ProductGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusedIndex < 0) return;
    containerRef.current
      ?.querySelector(`[data-product-index="${focusedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  if (isLoading) {
    return (
      <div className="flex-1 p-4 pt-0 flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex-1 p-4 pt-0 flex flex-col items-center justify-center text-gray-500 gap-3">
        <Package size={48} className="opacity-20" />
        <p>No products found matching &quot;{searchTerm}&quot;</p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 pt-0 overflow-y-auto custom-scrollbar">
      <div ref={containerRef} data-product-grid className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {products.map((product, index) => {
          // Made to order (V59): no stock_levels row, so the server's derived
          // stockQuantity is 0 and the tile would render as permanently out of
          // stock. Such a product has no ceiling and never blocks a sale.
          const untracked = product.trackStock === false;
          const displayStock = selectedBranchId && product.stockLevels
            ? (product.stockLevels.find(sl => sl.branchId === selectedBranchId)?.quantity || 0)
            : product.stockQuantity;
          const cartQty = cartQuantities?.[product.id] ?? 0;
          const outOfStock = !untracked && displayStock <= 0;
          const atLimit = !untracked && !outOfStock && cartQty >= displayStock;

          return (
          <Card
            key={product.id}
            data-product-card=""
            data-product-index={index}
            data-product-name={product.name}
            data-product-sku={product.sku}
            data-price={product.basePrice.toFixed(2)}
            data-disabled={outOfStock || atLimit ? 'true' : 'false'}
            className={cn(
              outOfStock
                ? 'bg-gray-900/50 border-gray-800 opacity-60 cursor-not-allowed'
                : atLimit
                ? 'bg-gray-900 border-warning/40 cursor-not-allowed'
                : 'bg-gray-900 border-gray-800 hover:border-primary/50 hover:bg-gray-800/50 transition-all cursor-pointer group active:scale-[0.98]',
              focusedIndex === index && 'ring-2 ring-primary ring-offset-2 ring-offset-background z-10'
            )}
            onClick={outOfStock || atLimit ? undefined : () => onProductClick(product)}
          >
            <CardContent className="p-0">
              <div className="aspect-square bg-gray-950 relative overflow-hidden flex items-center justify-center">
                {product.imageUrl ? (
                  <Image src={product.imageUrl} fill className="object-cover" alt={product.name} />
                ) : (
                  <Package className="text-gray-800" size={40} />
                )}
                {!outOfStock && !atLimit && (
                  <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 transition-colors" />
                )}
              </div>
              <div className="p-3">
                <h3 className={
                  outOfStock
                    ? 'font-medium text-gray-500 text-sm line-clamp-1'
                    : 'font-medium text-white text-sm line-clamp-1 group-hover:text-primary transition-colors'
                }>
                  {product.name}
                </h3>
                <p className="text-xs text-gray-400 mb-2">{product.sku}</p>
                <div className="flex justify-between items-center">
                  <span className={outOfStock ? 'text-gray-500 font-bold' : 'text-primary font-bold'}>
                    {CURRENCY.symbol} {product.basePrice.toFixed(2)}
                  </span>
                  {untracked ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                      Made to order
                    </span>
                  ) : outOfStock ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">
                      Out of stock
                    </span>
                  ) : atLimit ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning">
                      {cartQty} / {displayStock} max
                    </span>
                  ) : (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        displayStock < 10
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-success/10 text-success'
                      }`}
                    >
                      {displayStock} in stock
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )})}
      </div>
    </div>
  );
}
