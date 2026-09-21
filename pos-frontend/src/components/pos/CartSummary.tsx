'use client';

import { ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CURRENCY } from '@/lib/utils';

interface CartSummaryProps {
  subtotal: number;
  discountAmount?: number;
  taxAmount: number;
  taxLabel?: string;
  /** When true, tax is shown as included in the total rather than added on top. */
  taxInclusive?: boolean;
  total: number;
  itemCount: number;
  /** Open the tender overlay. */
  onCharge: () => void;
  /**
   * Verb on the big CTA. 'CHARGE' on a retail sale; a dine-in tab says 'SETTLE',
   * because the money was never on the counter until now.
   */
  chargeLabel?: string;
  onHold: () => void;
  /**
   * Whether to render "Hold Sale" at all.
   *
   * It has been wired to `onHold={() => {}}` since the terminal was written — a
   * live control that does nothing. Defaulting to false removes it rather than
   * leaving it there: nothing in this build can hold a sale, and a button that
   * lies is worse than a button that is absent. Restaurant mode does not need it
   * either — a dine-in tab is already parked, server-side, the moment it exists.
   */
  showHold?: boolean;
  onDiscard: () => void;
  /** Verb on the secondary destructive control. */
  discardLabel?: string;
}

/**
 * Sticky cart footer: totals + a single big "Charge" CTA. Payment method, cash
 * entry and the number pad live in the TenderOverlay, not here — so the cart
 * items stay visible while ringing up.
 */
export function CartSummary({
  subtotal,
  discountAmount = 0,
  taxAmount,
  taxLabel = 'Tax',
  taxInclusive = false,
  total,
  itemCount,
  onCharge,
  chargeLabel = 'CHARGE',
  onHold,
  showHold = false,
  onDiscard,
  discardLabel = 'Discard',
}: CartSummaryProps) {
  const empty = itemCount === 0;

  return (
    <div className="bg-card/60 border-t border-border p-4 sm:p-5 space-y-3 shrink-0">
      <div className="space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="text-foreground/90 font-medium tabular-nums">{CURRENCY.symbol} {subtotal.toFixed(2)}</span>
        </div>
        {discountAmount > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-destructive">Discount</span>
            <span className="text-destructive font-medium tabular-nums">- {CURRENCY.symbol} {discountAmount.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{taxInclusive ? `Incl. ${taxLabel}` : taxLabel}</span>
          <span className="text-foreground/90 font-medium tabular-nums">{CURRENCY.symbol} {taxAmount.toFixed(2)}</span>
        </div>
        <div className="flex justify-between items-baseline text-2xl font-black pt-2 border-t border-border">
          <span className="text-foreground">TOTAL</span>
          <span className="text-primary tabular-nums">{CURRENCY.symbol} {total.toFixed(2)}</span>
        </div>
      </div>

      <Button
        onClick={onCharge}
        disabled={empty}
        aria-label={`${chargeLabel} ${CURRENCY.symbol} ${total.toFixed(2)}`}
        className="w-full h-16 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-lg rounded-2xl shadow-xl shadow-primary/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span className="flex items-center gap-2">
          <ShoppingCart size={20} aria-hidden="true" />
          {chargeLabel} {CURRENCY.symbol} {total.toFixed(2)}
        </span>
      </Button>

      <div className="flex gap-2">
        {showHold && (
          <Button variant="outline" className="flex-1 min-h-touch rounded-xl" onClick={onHold} disabled={empty}>
            Hold Sale
          </Button>
        )}
        <Button
          variant="outline"
          className="flex-1 min-h-touch rounded-xl border-destructive/30 text-red-400 hover:bg-destructive/10 hover:text-red-300"
          onClick={onDiscard}
          disabled={empty}
        >
          {discardLabel}
        </Button>
      </div>
    </div>
  );
}
