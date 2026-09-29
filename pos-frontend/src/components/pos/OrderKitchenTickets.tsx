'use client';

import { useQuery } from '@tanstack/react-query';
import { ChefHat, Printer } from 'lucide-react';
import { format } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { QK } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { kitchenTicketService, type KitchenTicketStatus } from '@/services/kitchenTicketService';

const STATUS_STYLE: Record<KitchenTicketStatus, string> = {
  PRINTED: 'text-success',
  PENDING: 'text-warning',
  FAILED: 'text-destructive',
};

/**
 * Every sheet sent for this tab, oldest first, each reprintable. A reprint is
 * the stored snapshot with a REPRINT banner — it never re-fires anything.
 */
export function OrderKitchenTickets({
  orderId,
  onReprint,
}: {
  orderId: string;
  onReprint: (ticketId: string) => void;
}) {
  const { data: tickets = [] } = useQuery({
    queryKey: QK.kitchenTicketsForOrder(orderId),
    queryFn: () => kitchenTicketService.getForOrder(orderId),
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-8 gap-2 border-gray-800 bg-gray-950 px-3 text-gray-300 hover:bg-gray-800 hover:text-primary"
          title="Tickets sent to the kitchen for this tab"
        >
          <ChefHat size={14} /> Kitchen
          {tickets.length > 0 && <span className="tabular-nums text-gray-500">{tickets.length}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="dark w-80 bg-card p-2 text-foreground">
        {tickets.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">Nothing sent to the kitchen yet.</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {tickets.map((ticket) => (
              <li key={ticket.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{ticket.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {format(new Date(ticket.firedAt), 'HH:mm')} ·{' '}
                    <span className={cn('font-medium', STATUS_STYLE[ticket.status])}>
                      {ticket.status.toLowerCase()}
                    </span>{' '}
                    · {ticket.items.length} line{ticket.items.length === 1 ? '' : 's'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onReprint(ticket.id)}
                  className="h-8 gap-1.5 px-2"
                  aria-label={`Reprint ${ticket.label}`}
                >
                  <Printer size={14} /> Reprint
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
