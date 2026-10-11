"use client";

import { useQuery } from "@tanstack/react-query";
import { differenceInMinutes } from "date-fns";
import { Clock, UtensilsCrossed, Users } from "lucide-react";
import { restaurantOrderService } from "@/services/restaurantOrderService";
import { QK } from "@/lib/queryKeys";
import { formatCurrency } from "@/lib/format";

/** "45 min", "2 h 10 min". */
function openFor(openedAt: string): string {
  const minutes = Math.max(0, differenceInMinutes(new Date(), new Date(openedAt)));
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${Math.floor(minutes / 60)} h`;
}

/**
 * Who is eating right now and what they owe so far — the money still on the
 * floor, not yet in the sales figures above. Same query the till's floor polls,
 * so it is shared from cache when both are open. Running totals are indicative
 * (no tax or loyalty); the bill is worked out at settle.
 */
export function OpenTabsCard() {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: QK.restaurantOpenOrders,
    queryFn: () => restaurantOrderService.getOpenOrders(),
    refetchInterval: 30000,
  });

  // Longest-waiting first: the table most likely to want its bill.
  const sorted = [...orders].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  const total = orders.reduce((sum, o) => sum + (o.runningTotal ?? 0), 0);
  const guests = orders.reduce((sum, o) => sum + (o.orderType === "DINE_IN" ? o.covers : 0), 0);

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <UtensilsCrossed size={18} className="text-primary" /> Open tabs
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">On the floor now, not yet paid</p>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <p className="text-xs text-muted-foreground">Tabs</p>
            <p className="text-2xl font-bold tabular-nums">{isLoading ? "…" : orders.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Guests</p>
            <p className="text-2xl font-bold tabular-nums">{isLoading ? "…" : guests}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Running total</p>
            <p className="text-2xl font-bold tabular-nums text-primary">{isLoading ? "…" : formatCurrency(total)}</p>
          </div>
        </div>
      </div>

      {!isLoading && orders.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No open tabs. Every table is free.</p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {sorted.map((o) => {
            const minutes = differenceInMinutes(new Date(), new Date(o.openedAt));
            return (
              <div key={o.id} className="rounded-xl border border-border bg-muted/30 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold leading-tight">{o.label.replace(/^Order /, "#")}</p>
                  <p className="font-bold tabular-nums">{formatCurrency(o.runningTotal ?? 0)}</p>
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className={`flex items-center gap-1 ${minutes >= 90 ? "text-warning font-semibold" : ""}`}>
                    <Clock size={12} /> {openFor(o.openedAt)}
                  </span>
                  {o.orderType === "DINE_IN" ? (
                    o.covers > 0 && (
                      <span className="flex items-center gap-1">
                        <Users size={12} /> {o.covers}
                      </span>
                    )
                  ) : (
                    <span>Takeaway</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
