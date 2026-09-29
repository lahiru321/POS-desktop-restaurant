'use client';

import { useEffect, useState } from 'react';
import { Minus, Plus, Split } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { fc } from '@/lib/utils';
import { useCartTotals, type CartItem, type TaxContext } from '@/hooks/useCart';

/** lineId → how many units of it this payer is paying for. */
export type SplitSelection = Record<string, number>;

/**
 * Picks what one payer is paying for out of an open tab, the part of a split
 * bill that happens before the tender overlay.
 *
 * Whole units only: a dish is eaten by one person. The whole tab cannot be
 * chosen — that is an ordinary settle, and the server refuses it as a split.
 */
export function selectedLines(items: CartItem[], selection: SplitSelection): CartItem[] {
  return items.flatMap((item) => {
    const qty = selection[item.lineId] ?? 0;
    if (qty <= 0) return [];
    // The line discount follows the units in proportion, as it does server-side.
    const discountAmount = item.cartQuantity > 0 ? (item.discountAmount * qty) / item.cartQuantity : 0;
    return [{ ...item, cartQuantity: qty, discountAmount }];
  });
}

export function SplitBillDialog({
  open,
  items,
  taxContext,
  taxInclusive,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** The tab's billable lines, as the cart shows them. */
  items: CartItem[];
  taxContext: TaxContext | null;
  taxInclusive: boolean;
  onCancel: () => void;
  onConfirm: (selection: SplitSelection) => void;
}) {
  const [selection, setSelection] = useState<SplitSelection>({});

  useEffect(() => {
    if (open) setSelection({});
  }, [open]);

  const chosen = selectedLines(items, selection);
  const { total } = useCartTotals(chosen, taxContext, taxInclusive);
  const unitsChosen = chosen.reduce((sum, i) => sum + i.cartQuantity, 0);
  const unitsOnTab = items.reduce((sum, i) => sum + Math.floor(i.cartQuantity), 0);
  const wholeTab = unitsChosen > 0 && unitsChosen >= unitsOnTab;

  const step = (item: CartItem, delta: number) =>
    setSelection((current) => {
      const max = Math.floor(item.cartQuantity);
      const next = Math.min(max, Math.max(0, (current[item.lineId] ?? 0) + delta));
      return { ...current, [item.lineId]: next };
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="dark sm:max-w-lg bg-card border-border text-foreground sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Split className="h-5 w-5 text-primary" aria-hidden="true" /> Split the bill
          </DialogTitle>
          <DialogDescription>
            Pick what this person is paying for. It is paid now as its own bill; everything else
            stays on the table.
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto">
          {items.map((item) => {
            const qty = selection[item.lineId] ?? 0;
            const max = Math.floor(item.cartQuantity);
            return (
              <li key={item.lineId} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  {item.toppings && item.toppings.length > 0 && (
                    <p className="truncate text-xs text-muted-foreground">
                      + {item.toppings.map((t) => t.name).join(', ')}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{max} on the tab</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-9 w-9"
                    onClick={() => step(item, -1)}
                    disabled={qty === 0}
                    aria-label={`One fewer ${item.name}`}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="w-8 text-center font-semibold tabular-nums" aria-label={`${item.name} to pay for`}>
                    {qty}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-9 w-9"
                    onClick={() => step(item, 1)}
                    disabled={qty >= max}
                    aria-label={`One more ${item.name}`}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>

        {wholeTab && (
          <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
            That is everything on the tab — settle it normally instead.
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            className="min-h-touch"
            disabled={unitsChosen === 0 || wholeTab}
            onClick={() => onConfirm(selection)}
          >
            Pay for these — {fc(total)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
