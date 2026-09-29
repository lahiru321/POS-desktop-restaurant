'use client';

import { useEffect, useState } from 'react';
import { AlertOctagon, Loader2, Printer, RotateCw, Hand } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { KitchenPrintFailure } from '@/hooks/useKitchenPrinting';

interface KitchenPrintFailedDialogProps {
  failure: KitchenPrintFailure | undefined;
  /** Including the one on screen. */
  remaining: number;
  busy: boolean;
  onRetry: (failure: KitchenPrintFailure) => void;
  onPrintAtCounter: (failure: KitchenPrintFailure) => void;
  onMarkHandled: (failure: KitchenPrintFailure, note: string) => void;
}

/**
 * A kitchen ticket that did not print. Blocking on purpose: no close button,
 * no Esc, no click-outside. A toast would be dismissed mid-rush and the kitchen
 * would never cook the order, so the only ways out are to get it printed or for
 * a person to say, on the record, how they told the kitchen instead.
 *
 * Built on the shared Radix Dialog, so `usePosKeyboard` stands down while it
 * is open.
 */
export function KitchenPrintFailedDialog({
  failure,
  remaining,
  busy,
  onRetry,
  onPrintAtCounter,
  onMarkHandled,
}: KitchenPrintFailedDialogProps) {
  const [handling, setHandling] = useState(false);
  const [note, setNote] = useState('');

  // A fresh ticket starts from the three choices, never a half-typed note.
  const ticketId = failure?.ticket.id;
  useEffect(() => {
    setHandling(false);
    setNote('');
  }, [ticketId]);

  if (!failure) return null;
  const { ticket, error } = failure;
  const isVoid = ticket.ticketType === 'VOID';

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        hideCloseButton
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="dark sm:max-w-lg bg-card border-destructive/50 text-foreground sm:rounded-2xl"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-destructive">
            <AlertOctagon className="h-5 w-5 shrink-0" aria-hidden="true" />
            Kitchen printer did not respond
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Ticket <span className="font-semibold text-foreground">{ticket.label}</span>
            {ticket.tableName ? ` for ${ticket.tableName}` : ticket.orderType === 'TAKEAWAY' ? ' (takeaway)' : ''} was
            recorded but not printed.{' '}
            {isVoid ? 'The kitchen may still be cooking these.' : 'The kitchen does not have this order.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <ul className="rounded-xl border border-border bg-background/60 p-3 text-sm">
            {ticket.items.map((item, i) => (
              <li key={i} className="py-0.5">
                <span className="font-semibold tabular-nums">{item.quantity} ×</span> {item.itemName}
                {item.modifiers.length > 0 && (
                  <span className="text-muted-foreground"> · {item.modifiers.join(', ')}</span>
                )}
                {item.notes && <span className="italic text-muted-foreground"> · {item.notes}</span>}
              </li>
            ))}
          </ul>
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          {remaining > 1 && (
            <p className="text-xs text-muted-foreground">
              {remaining - 1} more ticket{remaining - 1 === 1 ? '' : 's'} waiting after this one.
            </p>
          )}
        </div>

        {handling ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (note.trim()) onMarkHandled(failure, note);
            }}
          >
            <label htmlFor="kitchen-handled-note" className="text-sm font-semibold">
              How was the kitchen told?
            </label>
            <Input
              id="kitchen-handled-note"
              autoFocus
              value={note}
              maxLength={400}
              placeholder="e.g. Told the chef at the pass"
              onChange={(e) => setNote(e.target.value)}
              className="bg-background"
            />
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setHandling(false)} disabled={busy}>
                Back
              </Button>
              <Button type="submit" variant="destructive" disabled={busy || !note.trim()}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Mark handled
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <Button onClick={() => onRetry(failure)} disabled={busy} className="w-full min-h-touch gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              Retry print
            </Button>
            <Button
              variant="outline"
              onClick={() => onPrintAtCounter(failure)}
              disabled={busy}
              className="w-full min-h-touch gap-2"
            >
              <Printer className="h-4 w-4" /> Print at the counter instead
            </Button>
            <Button
              variant="ghost"
              onClick={() => setHandling(true)}
              disabled={busy}
              className="w-full min-h-touch gap-2 text-muted-foreground"
            >
              <Hand className="h-4 w-4" /> I&apos;ll tell the kitchen — mark handled
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
