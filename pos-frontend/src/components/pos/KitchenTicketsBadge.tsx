'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';

import { QK } from '@/lib/queryKeys';
import { kitchenTicketService, type KitchenTicket } from '@/services/kitchenTicketService';

/** The established freshness pattern — there is no realtime transport in this stack. */
const POLL_MS = 15_000;

/**
 * Red until every kitchen ticket is resolved: failed prints, and tickets no
 * till ever confirmed (browser closed, machine died mid-print). Tenant-wide, so
 * a failure on one till shows on every till until somebody deals with it.
 * Renders nothing when all is well.
 */
export function KitchenTicketsBadge({ onReview }: { onReview: (tickets: KitchenTicket[]) => void }) {
  const { data: tickets = [] } = useQuery({
    queryKey: QK.kitchenTicketsUnresolved,
    queryFn: kitchenTicketService.getUnresolved,
    refetchInterval: POLL_MS,
  });

  if (tickets.length === 0) return null;

  return (
    <button
      type="button"
      onClick={() => onReview(tickets)}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-destructive px-2.5 text-xs font-bold text-destructive-foreground shadow animate-pulse hover:animate-none"
      title="Kitchen tickets that did not print"
    >
      <AlertTriangle size={14} aria-hidden="true" />
      {tickets.length} kitchen ticket{tickets.length === 1 ? '' : 's'} not printed
    </button>
  );
}
