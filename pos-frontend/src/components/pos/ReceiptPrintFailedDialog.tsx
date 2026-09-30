'use client';

import { Loader2, Printer, RotateCw } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface ReceiptPrintFailure {
  /** What the receipt was for, in the till's words: "INV-3F2A1B9C". */
  label: string;
  /** Cash sales also open the drawer through the receipt printer. */
  opensDrawer: boolean;
  error: string;
}

/**
 * The receipt printer did not print. The sale itself is already saved, so this
 * is not an alarm — but it is never silent either: the cashier needs to know
 * the customer has no receipt, and on a cash sale that the drawer did not open.
 * Retry (Enter) prints it again, drawer kick included; Skip (Esc) carries on.
 *
 * Built on the shared Radix Dialog, so `usePosKeyboard` stands down while open.
 */
export function ReceiptPrintFailedDialog({
  failure,
  busy,
  onRetry,
  onSkip,
}: {
  failure: ReceiptPrintFailure | null;
  busy: boolean;
  onRetry: () => void;
  onSkip: () => void;
}) {
  if (!failure) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onSkip()}>
      <DialogContent
        onPointerDownOutside={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !busy) {
            e.preventDefault();
            onRetry();
          }
        }}
        className="dark sm:max-w-md bg-card border-warning/50 text-foreground sm:rounded-2xl"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-warning">
            <Printer className="h-5 w-5 shrink-0" aria-hidden="true" />
            Receipt did not print
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            The sale <span className="font-semibold text-foreground">{failure.label}</span> is saved.
            {failure.opensDrawer ? ' The cash drawer did not open.' : ''} Check the receipt printer is on and
            has paper, and that QZ Tray is running, then retry.
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">{failure.error}</p>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onSkip} disabled={busy} className="min-h-touch">
            Skip receipt
          </Button>
          <Button onClick={onRetry} disabled={busy} className="min-h-touch gap-2" autoFocus>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
            Retry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
