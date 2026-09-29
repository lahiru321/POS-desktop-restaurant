'use client';

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { QK } from '@/lib/queryKeys';
import { getApiErrorMessage } from '@/lib/utils';
import { kitchenPrinterService } from '@/services/kitchenPrinterService';
import { kitchenTicketService, type KitchenTicket } from '@/services/kitchenTicketService';

/** A ticket the kitchen may not have, waiting for a person to decide. */
export interface KitchenPrintFailure {
  ticket: KitchenTicket;
  error: string;
}

const COUNTER_NOTE = 'Printed at the counter and carried to the kitchen';

/**
 * The till's side of the kitchen contract: print every ticket the server
 * hands back, acknowledge each one, and put every failure in front of the
 * cashier until somebody resolves it.
 *
 * Failures queue rather than replace each other. A void and a round can both
 * fail in one go, and the dialog walks them one at a time — dismissing the
 * first must never quietly lose the second.
 */
export function useKitchenPrinting() {
  const queryClient = useQueryClient();
  const [failures, setFailures] = useState<KitchenPrintFailure[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    (orderIds: string[]) => {
      queryClient.invalidateQueries({ queryKey: QK.kitchenTicketsUnresolved });
      for (const id of Array.from(new Set(orderIds))) {
        queryClient.invalidateQueries({ queryKey: QK.kitchenTicketsForOrder(id) });
      }
    },
    [queryClient],
  );

  const enqueue = useCallback((items: KitchenPrintFailure[]) => {
    if (items.length === 0) return;
    setFailures((current) => {
      const known = new Set(current.map((f) => f.ticket.id));
      return [...current, ...items.filter((f) => !known.has(f.ticket.id))];
    });
  }, []);

  const resolve = useCallback((ticketId: string) => {
    setFailures((current) => current.filter((f) => f.ticket.id !== ticketId));
  }, []);

  /** Prints each ticket in turn — never in parallel, so a jam fails one, not all. */
  const dispatchTickets = useCallback(
    async (tickets: KitchenTicket[], opts: { reprint?: boolean } = {}) => {
      const failed: KitchenPrintFailure[] = [];
      for (const ticket of tickets) {
        const outcome = await kitchenPrinterService.dispatch(ticket, opts);
        if (outcome.status === 'printed') {
          toast.success(`${ticket.label} sent to the kitchen`);
        } else if (outcome.status === 'noPrinter') {
          toast.info(
            ticket.ticketType === 'VOID'
              ? `${ticket.label} recorded — tell the kitchen to stop`
              : `${ticket.label} recorded — tell the kitchen`,
            { description: 'No kitchen printer is set up on this till.', duration: 8000 },
          );
        } else {
          failed.push({ ticket, error: outcome.error });
        }
      }
      enqueue(failed);
      refresh(tickets.map((t) => t.orderId));
    },
    [enqueue, refresh],
  );

  const retry = useCallback(
    async (failure: KitchenPrintFailure) => {
      setBusy(true);
      try {
        const outcome = await kitchenPrinterService.dispatch(failure.ticket);
        if (outcome.status === 'failed') {
          setFailures((current) =>
            current.map((f) => (f.ticket.id === failure.ticket.id ? { ...f, error: outcome.error } : f)),
          );
          toast.error(`${failure.ticket.label} still did not print`);
        } else {
          resolve(failure.ticket.id);
          toast.success(`${failure.ticket.label} sent to the kitchen`);
        }
      } finally {
        setBusy(false);
        refresh([failure.ticket.orderId]);
      }
    },
    [refresh, resolve],
  );

  const printAtCounter = useCallback(
    async (failure: KitchenPrintFailure) => {
      setBusy(true);
      try {
        const result = await kitchenPrinterService.printAtCounter(failure.ticket);
        if (!result.ok) {
          toast.error('The counter printer did not print it either', { description: result.error });
          return;
        }
        await kitchenTicketService.acknowledge(failure.ticket.id, { outcome: 'HANDLED', note: COUNTER_NOTE });
        resolve(failure.ticket.id);
        toast.success(`${failure.ticket.label} printed at the counter — take it to the kitchen`);
      } catch (err) {
        toast.error(getApiErrorMessage(err, 'Printed, but could not record it'));
      } finally {
        setBusy(false);
        refresh([failure.ticket.orderId]);
      }
    },
    [refresh, resolve],
  );

  const markHandled = useCallback(
    async (failure: KitchenPrintFailure, note: string) => {
      setBusy(true);
      try {
        await kitchenTicketService.acknowledge(failure.ticket.id, { outcome: 'HANDLED', note: note.trim() });
        resolve(failure.ticket.id);
      } catch (err) {
        toast.error(getApiErrorMessage(err, 'Could not record that'));
      } finally {
        setBusy(false);
        refresh([failure.ticket.orderId]);
      }
    },
    [refresh, resolve],
  );

  /** Puts tickets the badge found — failed, or stuck pending — in front of the cashier. */
  const review = useCallback(
    (tickets: KitchenTicket[]) =>
      enqueue(
        tickets.map((ticket) => ({
          ticket,
          error:
            ticket.lastError ??
            (ticket.status === 'PENDING'
              ? 'This till never confirmed it printed — the kitchen may not have it.'
              : 'The kitchen printer did not respond'),
        })),
      ),
    [enqueue],
  );

  /** The stored sheet again, with a REPRINT banner. Fires nothing new. */
  const reprint = useCallback(
    async (ticketId: string) => {
      try {
        const fresh = await kitchenTicketService.reprint(ticketId);
        await dispatchTickets([fresh], { reprint: true });
      } catch (err) {
        toast.error(getApiErrorMessage(err, 'Could not reprint that ticket'));
      }
    },
    [dispatchTickets],
  );

  return {
    /** The failure on screen now, if any. */
    current: failures[0] as KitchenPrintFailure | undefined,
    /** Including the one on screen. */
    remaining: failures.length,
    busy,
    dispatchTickets,
    retry,
    printAtCounter,
    markHandled,
    review,
    reprint,
  };
}
