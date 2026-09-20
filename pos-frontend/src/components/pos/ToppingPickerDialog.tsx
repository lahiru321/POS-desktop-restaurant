'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { CURRENCY } from '@/lib/utils';
import type { Product } from '@/types/inventory';
import type { CartItemTopping } from '@/hooks/useCart';
import type { ToppingGroup, Topping } from '@/services/toppingService';

interface ToppingPickerDialogProps {
  open: boolean;
  product: Product | null;
  groups: ToppingGroup[];
  isLoading?: boolean;
  onClose: () => void;
  onAdd: (product: Product, toppings: CartItemTopping[], notes: string) => void;
}

/** Selected topping id -> the price to bill, as a string while being typed. */
type Selection = Record<string, string>;

/**
 * Asks the add-on questions a dish declares, then hands the answers back as cart
 * toppings.
 *
 * <p>A PROMPT topping reveals a price field pre-filled with its suggested price;
 * a FIXED one never does, because the server ignores whatever the client sends
 * for it. min/max selection is enforced here for the cashier's benefit and again
 * on the server, which is the one that counts.
 *
 * <p>Built on the shared Dialog, so `usePosKeyboard` yields the global hotkeys
 * for free while it is open.
 */
export function ToppingPickerDialog({
  open,
  product,
  groups,
  isLoading = false,
  onClose,
  onAdd,
}: ToppingPickerDialogProps) {
  const [selected, setSelected] = useState<Selection>({});
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      setSelected({});
      setNotes('');
    }
  }, [open, product?.id]);

  const toppingsById = useMemo(() => {
    const map = new Map<string, { topping: Topping; group: ToppingGroup }>();
    groups.forEach((group) => group.toppings.forEach((topping) => map.set(topping.id, { topping, group })));
    return map;
  }, [groups]);

  const toggle = (group: ToppingGroup, topping: Topping) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[topping.id] !== undefined) {
        delete next[topping.id];
        return next;
      }
      // SINGLE is a radio: picking one clears the rest of its group.
      if (group.selectionMode === 'SINGLE') {
        group.toppings.forEach((sibling) => delete next[sibling.id]);
      }
      next[topping.id] = String(topping.defaultPrice ?? 0);
      return next;
    });
  };

  const setPrice = (toppingId: string, value: string) =>
    setSelected((prev) => ({ ...prev, [toppingId]: value }));

  const countIn = (group: ToppingGroup) =>
    group.toppings.filter((t) => selected[t.id] !== undefined).length;

  const addonsPerUnit = useMemo(
    () =>
      Object.entries(selected).reduce((sum, [toppingId, raw]) => {
        const entry = toppingsById.get(toppingId);
        if (!entry) return sum;
        const price = entry.topping.priceMode === 'PROMPT'
          ? parseFloat(raw)
          : entry.topping.defaultPrice;
        return sum + (Number.isFinite(price) ? price : 0);
      }, 0),
    [selected, toppingsById],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;

    for (const group of groups) {
      const count = countIn(group);
      if (group.minSelect > 0 && count < group.minSelect) {
        toast.error(`Choose at least ${group.minSelect} from ${group.name}`);
        return;
      }
      if (group.maxSelect != null && count > group.maxSelect) {
        toast.error(`Choose at most ${group.maxSelect} from ${group.name}`);
        return;
      }
    }

    const toppings: CartItemTopping[] = [];
    for (const [toppingId, raw] of Object.entries(selected)) {
      const entry = toppingsById.get(toppingId);
      if (!entry) continue;
      const { topping } = entry;

      let unitPrice = topping.defaultPrice;
      if (topping.priceMode === 'PROMPT') {
        const typed = parseFloat(raw);
        if (!Number.isFinite(typed) || typed < 0) {
          toast.error(`Enter a price for ${topping.name}`);
          return;
        }
        if (topping.maxPrice != null && typed > topping.maxPrice) {
          toast.error(`${topping.name} cannot exceed ${CURRENCY.symbol} ${topping.maxPrice.toFixed(2)}`);
          return;
        }
        unitPrice = typed;
      }

      toppings.push({
        toppingId,
        name: topping.name,
        quantity: 1,
        unitPrice,
        priceMode: topping.priceMode,
      });
    }

    onAdd(product, toppings, notes);
    onClose();
  };

  const lineTotal = (product?.basePrice ?? 0) + addonsPerUnit;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dark sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product?.name ?? 'Add-ons'}</DialogTitle>
          <DialogDescription>
            Choose any extras, then add the item to the sale.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {isLoading && (
            <p className="text-sm text-muted-foreground">Loading add-ons…</p>
          )}

          {!isLoading && groups.length === 0 && (
            <p className="text-sm text-muted-foreground">
              This item has no add-ons configured.
            </p>
          )}

          {groups.map((group) => {
            const count = countIn(group);
            return (
              <section key={group.id} className="space-y-2">
                <header className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold">{group.name}</h3>
                  <span className="text-[11px] text-muted-foreground">
                    {group.minSelect > 0 ? `Choose at least ${group.minSelect}` : 'Optional'}
                    {group.maxSelect != null ? ` · max ${group.maxSelect}` : ''}
                    {group.maxSelect != null && count > group.maxSelect ? ' · too many' : ''}
                  </span>
                </header>

                <div className="space-y-1.5">
                  {group.toppings.map((topping) => {
                    const isSelected = selected[topping.id] !== undefined;
                    return (
                      <div key={topping.id} className="rounded-lg border border-border">
                        <button
                          type="button"
                          data-topping-option={topping.id}
                          aria-pressed={isSelected}
                          onClick={() => toggle(group, topping)}
                          className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left min-h-touch ${
                            isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/40'
                          }`}
                        >
                          <span className="flex items-center gap-2 text-sm">
                            <span
                              className={`inline-block h-4 w-4 shrink-0 border ${
                                group.selectionMode === 'SINGLE' ? 'rounded-full' : 'rounded'
                              } ${isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/50'}`}
                            />
                            {topping.name}
                          </span>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {topping.priceMode === 'PROMPT'
                              ? 'Price at order'
                              : `+ ${CURRENCY.symbol} ${topping.defaultPrice.toFixed(2)}`}
                          </span>
                        </button>

                        {isSelected && topping.priceMode === 'PROMPT' && (
                          <div className="flex items-center gap-2 border-t border-border px-3 py-2">
                            <label
                              htmlFor={`topping-price-${topping.id}`}
                              className="text-[11px] text-muted-foreground"
                            >
                              Price
                            </label>
                            <Input
                              id={`topping-price-${topping.id}`}
                              type="number"
                              step="0.01"
                              min="0"
                              max={topping.maxPrice ?? undefined}
                              value={selected[topping.id]}
                              onChange={(e) => setPrice(topping.id, e.target.value)}
                              className="h-8 w-28 bg-background"
                            />
                            {topping.maxPrice != null && (
                              <span className="text-[11px] text-muted-foreground">
                                Max {CURRENCY.symbol} {topping.maxPrice.toFixed(2)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <div className="space-y-1.5">
            <label htmlFor="topping-notes" className="text-sm font-semibold">
              Notes for the kitchen
            </label>
            <Input
              id="topping-notes"
              value={notes}
              maxLength={255}
              placeholder="no chilli, well done…"
              onChange={(e) => setNotes(e.target.value)}
              className="bg-background"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="min-h-touch">
              Add — {CURRENCY.symbol} {lineTotal.toFixed(2)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
