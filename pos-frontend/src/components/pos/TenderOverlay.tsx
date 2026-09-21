'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { CreditCard, Banknote, QrCode, SplitSquareHorizontal, Loader2, CheckCircle2, Star, Wallet } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { NumberPad } from '@/components/ui/number-pad';
import { QuickTenderButtons } from '@/components/ui/quick-tender-buttons';
import { CURRENCY, cn } from '@/lib/utils';

export type PaymentMethod = 'CASH' | 'CARD' | 'ONLINE' | 'SPLIT' | 'CREDIT';

interface TenderOverlayProps {
  open: boolean;
  onClose: () => void;
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  cashTendered: number;
  onCashTenderedChange: (amount: number) => void;
  subtotal: number;
  discountAmount?: number;
  taxAmount: number;
  taxLabel?: string;
  /** When true, tax is shown as included in the total rather than added on top. */
  taxInclusive?: boolean;
  total: number;
  isProcessing: boolean;
  /** Fire the sale. Parent owns the mutation + closes the overlay on success. */
  onComplete: () => void;
  /** Loyalty redemption — the control only renders when the program is on and the
   *  attached customer has points worth redeeming. */
  loyaltyEnabled?: boolean;
  customerPoints?: number;
  /** Cash value of one point (e.g. 0.10). */
  pointValue?: number;
  pointsToRedeem?: number;
  onPointsToRedeemChange?: (points: number) => void;
  /** Store credit — the control only renders when the program is on and a
   *  customer is attached. availableCredit is that customer's remaining headroom. */
  creditEnabled?: boolean;
  availableCredit?: number;
  creditBalance?: number;
  /**
   * Rendered above the payment methods, where the cashier cannot miss it and
   * the sale can still be stopped.
   *
   * Undefined on the retail path, which therefore renders nothing at all. Used
   * by a dine-in settle for the two things that only become true between
   * ordering and paying: lines the menu re-priced under the tab, and a tab whose
   * branch does not match the open drawer.
   */
  warning?: ReactNode;
}

const BASE_PAYMENT_OPTIONS: { method: PaymentMethod; icon: typeof Banknote; label: string }[] = [
  { method: 'CASH', icon: Banknote, label: 'Cash' },
  { method: 'CARD', icon: CreditCard, label: 'Card' },
  { method: 'ONLINE', icon: QrCode, label: 'Online' },
  { method: 'SPLIT', icon: SplitSquareHorizontal, label: 'Split' },
];
const CREDIT_OPTION = { method: 'CREDIT' as PaymentMethod, icon: Wallet, label: 'Credit' };

const TENDER_PRESETS = [100, 500, 1000, 2000, 5000];

/**
 * Full-screen tender surface. Payment method, quick-tender, number pad and the
 * big change-due readout all live here so the cart column stays uncluttered and
 * the items remain visible while ringing up. Portals to <body>, so it carries
 * its own `dark` class to match the force-dark terminal.
 */
export function TenderOverlay({
  open,
  onClose,
  paymentMethod,
  onPaymentMethodChange,
  cashTendered,
  onCashTenderedChange,
  subtotal,
  discountAmount = 0,
  taxAmount,
  taxLabel = 'Tax',
  taxInclusive = false,
  total,
  isProcessing,
  onComplete,
  loyaltyEnabled = false,
  customerPoints = 0,
  pointValue = 0,
  pointsToRedeem = 0,
  onPointsToRedeemChange,
  creditEnabled = false,
  availableCredit = 0,
  creditBalance = 0,
  warning,
}: TenderOverlayProps) {
  const [cashStr, setCashStr] = useState(cashTendered > 0 ? String(cashTendered) : '');

  const paymentOptions = creditEnabled ? [...BASE_PAYMENT_OPTIONS, CREDIT_OPTION] : BASE_PAYMENT_OPTIONS;

  // Loyalty redemption. Points are capped to the balance and to what the bill can
  // absorb (you can't redeem more than the total). The discount is recomputed from
  // the configured point value; the backend re-validates and is the source of truth.
  const loyaltyActive = loyaltyEnabled && customerPoints > 0 && pointValue > 0;
  const maxRedeemablePoints = loyaltyActive
    ? Math.min(customerPoints, Math.floor(total / pointValue))
    : 0;
  const redeemPts = Math.max(0, Math.min(pointsToRedeem, maxRedeemablePoints));
  const loyaltyDiscount = loyaltyActive ? +(redeemPts * pointValue).toFixed(2) : 0;
  const amountDue = Math.max(0, +(total - loyaltyDiscount).toFixed(2));

  // Store credit: the amount due goes on the customer's account. Blocked when it
  // would exceed their remaining headroom (the backend re-validates authoritatively).
  const creditActive = paymentMethod === 'CREDIT';
  const creditExceeds = creditActive && amountDue > availableCredit;

  useEffect(() => {
    if (cashTendered === 0) setCashStr('');
    else if (cashTendered !== parseFloat(cashStr)) setCashStr(String(cashTendered));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashTendered]);

  const updateCash = (next: string) => {
    setCashStr(next);
    onCashTenderedChange(parseFloat(next) || 0);
  };
  const setTender = (amount: number) => updateCash(amount.toFixed(2));
  const appendDigit = (ch: string) => {
    if (cashStr.length >= 12) return;
    if (ch === '.' && cashStr.includes('.')) return;
    if (ch === '.' && cashStr.length === 0) { updateCash('0.'); return; }
    updateCash(cashStr + ch);
  };

  const showCashFlow = paymentMethod === 'CASH' || paymentMethod === 'SPLIT';
  const cashChange = paymentMethod === 'CASH' && cashTendered > amountDue ? cashTendered - amountDue : 0;
  const cashShort =
    paymentMethod === 'CASH' && cashTendered > 0 && cashTendered < amountDue ? amountDue - cashTendered : 0;
  const completeDisabled = isProcessing || cashShort > 0 || creditExceeds;

  // Keyboard inside the overlay: digits/decimal/backspace edit the cash amount,
  // ←/→ switch payment method, F10 = exact, Enter = complete. (Esc closes via Radix.)
  useEffect(() => {
    if (!open) return;
    const methods: PaymentMethod[] = paymentOptions.map((o) => o.method);
    const onKey = (e: KeyboardEvent) => {
      if (typeof e.key !== 'string') return;
      // Don't hijack keystrokes while the user is typing in a field (e.g. the
      // redeem-points box) — otherwise the cash-amount handler swallows the digits.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const n = methods.length;
        const i = Math.max(0, methods.indexOf(paymentMethod));
        onPaymentMethodChange(methods[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n]);
        return;
      }
      if (e.key === 'F10') { e.preventDefault(); if (amountDue > 0) setTender(amountDue); return; }
      if (e.key === 'Enter') { e.preventDefault(); if (!completeDisabled) onComplete(); return; }
      if (!showCashFlow) return;
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); appendDigit(e.key); return; }
      if (e.key === '.') { e.preventDefault(); appendDigit('.'); return; }
      if (e.key === 'Backspace') { e.preventDefault(); updateCash(cashStr.slice(0, -1)); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paymentMethod, showCashFlow, completeDisabled, cashStr, amountDue]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dark sm:max-w-2xl bg-card border-border text-foreground sm:rounded-2xl">
        <DialogHeader className="space-y-3">
          <div className="flex items-baseline justify-between">
            <DialogTitle className="text-lg font-bold text-foreground">Payment</DialogTitle>
            <DialogDescription className="sr-only">
              Choose a payment method, enter the amount tendered, and complete the sale.
            </DialogDescription>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Amount due</div>
              <div className="text-3xl font-black text-primary tabular-nums">{CURRENCY.symbol} {amountDue.toFixed(2)}</div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {warning}

          <div
            className={cn('grid gap-2', paymentOptions.length >= 5 ? 'grid-cols-5' : 'grid-cols-4')}
            role="radiogroup"
            aria-label="Payment method"
          >
            {paymentOptions.map(({ method, icon: Icon, label }) => {
              const isSelected = paymentMethod === method;
              return (
                <button
                  key={method}
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => onPaymentMethodChange(method)}
                  className={cn(
                    'flex flex-col items-center justify-center min-h-touch py-3 rounded-xl border transition-all',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected
                      ? 'bg-primary border-primary text-primary-foreground shadow-lg shadow-primary/20'
                      : 'bg-muted/40 border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon size={22} className="mb-1" aria-hidden="true" />
                  <span className="text-[11px] font-bold uppercase tracking-wider">{label}</span>
                </button>
              );
            })}
          </div>

          {loyaltyActive && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <Star size={16} className="text-primary" aria-hidden="true" />
                  <span className="font-semibold text-foreground">Redeem points</span>
                  <span className="text-muted-foreground">({customerPoints} available)</span>
                </div>
                {redeemPts > 0 && (
                  <button
                    type="button"
                    onClick={() => onPointsToRedeemChange?.(0)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={maxRedeemablePoints}
                  value={redeemPts || ''}
                  onChange={(e) =>
                    onPointsToRedeemChange?.(
                      Math.max(0, Math.min(maxRedeemablePoints, parseInt(e.target.value, 10) || 0))
                    )
                  }
                  placeholder="0"
                  className="w-24 rounded-md bg-background border border-border px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onPointsToRedeemChange?.(maxRedeemablePoints)}
                  disabled={maxRedeemablePoints === 0}
                >
                  Max ({maxRedeemablePoints})
                </Button>
                {loyaltyDiscount > 0 && (
                  <span className="ml-auto text-sm font-bold text-success tabular-nums">
                    - {CURRENCY.symbol} {loyaltyDiscount.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          )}

          {showCashFlow ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                    {paymentMethod === 'SPLIT' ? 'Cash portion' : 'Cash tendered'}
                  </label>
                  <div className="text-xl font-bold text-foreground tabular-nums">
                    {CURRENCY.symbol} {(cashTendered || 0).toFixed(2)}
                  </div>
                </div>
                <QuickTenderButtons total={total} presets={TENDER_PRESETS} onTender={setTender} />
                {paymentMethod === 'SPLIT' && cashTendered > 0 && (
                  <div className="flex items-baseline justify-between text-sm border-t border-border pt-2">
                    <span className="text-muted-foreground">Remaining (card / other)</span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {CURRENCY.symbol} {Math.max(0, amountDue - cashTendered).toFixed(2)}
                    </span>
                  </div>
                )}
                {cashChange > 0 && (
                  <div className="flex items-baseline justify-between rounded-xl bg-success/10 px-4 py-3 border border-success/20">
                    <span className="text-sm font-semibold text-success uppercase tracking-wider">Change due</span>
                    <span className="text-3xl font-black text-success tabular-nums">{CURRENCY.symbol} {cashChange.toFixed(2)}</span>
                  </div>
                )}
                {cashShort > 0 && (
                  <div className="flex items-baseline justify-between rounded-xl bg-warning/10 px-4 py-3 border border-warning/20">
                    <span className="text-sm font-semibold text-warning uppercase tracking-wider">Short by</span>
                    <span className="text-xl font-bold text-warning tabular-nums">{CURRENCY.symbol} {cashShort.toFixed(2)}</span>
                  </div>
                )}
              </div>
              <NumberPad value={cashStr} onChange={updateCash} />
            </div>
          ) : creditActive ? (
            <div className={cn(
              'rounded-xl border p-4 text-sm space-y-2',
              creditExceeds ? 'border-warning/40 bg-warning/5' : 'border-primary/30 bg-primary/5'
            )}>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Charge to account</span>
                <span className="font-bold text-foreground tabular-nums">{CURRENCY.symbol} {amountDue.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Available credit</span>
                <span className="font-medium text-foreground tabular-nums">{CURRENCY.symbol} {availableCredit.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-border/60 pt-2">
                <span className="text-muted-foreground">New balance after</span>
                <span className="font-semibold text-foreground tabular-nums">
                  {CURRENCY.symbol} {(creditBalance + amountDue).toFixed(2)}
                </span>
              </div>
              {creditExceeds && (
                <p className="text-warning font-semibold pt-1">
                  Exceeds available credit by {CURRENCY.symbol} {(amountDue - availableCredit).toFixed(2)}.
                  Take a lower amount on another method or raise the limit.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-background/40 p-4 text-sm text-muted-foreground">
              Collect <span className="font-semibold text-foreground">{CURRENCY.symbol} {amountDue.toFixed(2)}</span>{' '}
              via {paymentMethod === 'CARD' ? 'card terminal' : 'online / QR'} and confirm payment received,
              then complete the sale.
            </div>
          )}

          <div className="space-y-1.5 border-t border-border pt-3">
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
            {loyaltyDiscount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-primary">Points redeemed ({redeemPts})</span>
                <span className="text-primary font-medium tabular-nums">- {CURRENCY.symbol} {loyaltyDiscount.toFixed(2)}</span>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="min-h-touch rounded-xl px-6" onClick={onClose} disabled={isProcessing}>
              Back
            </Button>
            <Button
              onClick={onComplete}
              disabled={completeDisabled}
              aria-label={`Complete sale, total ${CURRENCY.symbol} ${amountDue.toFixed(2)}`}
              className="flex-1 h-14 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-lg rounded-2xl shadow-xl shadow-primary/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {isProcessing ? (
                <span className="flex items-center gap-2"><Loader2 className="animate-spin" size={20} aria-hidden="true" /> PROCESSING…</span>
              ) : (
                <span className="flex items-center gap-2"><CheckCircle2 size={20} aria-hidden="true" /> COMPLETE SALE</span>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
