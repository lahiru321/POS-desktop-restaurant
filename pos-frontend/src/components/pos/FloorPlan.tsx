"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Users } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QK } from "@/lib/queryKeys";
import { cn, fc, getApiErrorMessage } from "@/lib/utils";
import { tableService, type RestaurantTable } from "@/services/tableService";
import {
  restaurantOrderService,
  type RestaurantOrder,
} from "@/services/restaurantOrderService";
import { tenantService } from "@/services/tenantService";

/**
 * The floor, as one reusable surface.
 *
 * Mounted twice, deliberately, and this component is the half both mounts share:
 *
 *  - `/floor` (a real route) is where a server *starts* a shift. Nothing is in
 *    flight there, so navigating away costs nothing.
 *  - `FloorSheet` renders this *inside* the terminal, so a table can be switched
 *    mid-service without unmounting the terminal — `useCart` is `useState` and
 *    dies on navigation, so routing to `/floor` mid-sale would destroy the cart.
 *
 * The only thing that differs between the two is what happens once a tab is
 * ready, which is why that is the single callback prop: the route pushes to
 * `/terminal?orderId=...`, the sheet hands the id to the already-mounted
 * terminal and closes itself.
 *
 * Freshness is `refetchInterval` and nothing else. There is no WebSocket, SSE or
 * STOMP anywhere in this project, on either side, and this does not introduce
 * one — polling is the established pattern, and the database is the real
 * arbiter of a race (see the partial unique index note below).
 */

/** How often the floor re-reads itself. The project-wide freshness interval. */
const FLOOR_POLL_MS = 15_000;

export interface FloorPlanProps {
  /**
   * A tab is open on the tapped table and ready to be worked on — either just
   * opened (the table was free) or resumed (it was already occupied).
   */
  onOrderReady: (orderId: string) => void;
  className?: string;
}

export function FloorPlan({ onOrderReady, className }: FloorPlanProps) {
  const queryClient = useQueryClient();

  const {
    data: areas = [],
    isLoading: areasLoading,
    error: areasError,
  } = useQuery({
    queryKey: QK.restaurantAreas,
    queryFn: tableService.getAreas,
    refetchInterval: FLOOR_POLL_MS,
  });

  // Every OPEN tab for the tenant. This is what turns a tile from a name into
  // "Order 14 / LKR 4,250 / 38 min".
  const { data: openOrders = [], error: ordersError } = useQuery({
    queryKey: QK.restaurantOpenOrders,
    queryFn: restaurantOrderService.getOpenOrders,
    refetchInterval: FLOOR_POLL_MS,
  });

  // Covers for a new tab come from the tenant setting, not from the table's seat
  // count: seats is the furniture, covers is how many people actually sat down,
  // and the till's own default is the better guess. Seating stays one tap.
  const { data: tenantInfo } = useQuery({
    queryKey: QK.tenantInfo,
    queryFn: tenantService.getInfo,
    staleTime: 5 * 60 * 1000,
  });

  const ordersByTable = useMemo(() => {
    const map = new Map<string, RestaurantOrder>();
    for (const order of openOrders) {
      if (order.tableId) map.set(order.tableId, order);
    }
    return map;
  }, [openOrders]);

  // Elapsed minutes have to keep moving between polls, so they tick on their own
  // clock rather than riding the refetch.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Hidden areas and hidden tables are hidden *from the floor* — that is exactly
  // what the admin screen's "Hidden" toggle promises.
  const visibleAreas = useMemo(
    () =>
      areas
        .filter((a) => a.isActive)
        .map((a) => ({ ...a, tables: a.tables.filter((t) => t.isActive) })),
    [areas]
  );

  const [activeArea, setActiveArea] = useState<string | null>(null);
  useEffect(() => {
    if (visibleAreas.length === 0) return;
    if (activeArea && visibleAreas.some((a) => a.id === activeArea)) return;
    setActiveArea(visibleAreas[0].id);
  }, [visibleAreas, activeArea]);

  const [pendingTableId, setPendingTableId] = useState<string | null>(null);

  const refreshFloor = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: QK.restaurantOpenOrders }),
      queryClient.invalidateQueries({ queryKey: QK.restaurantAreas }),
    ]);

  const openTab = useMutation({
    mutationFn: (table: RestaurantTable) =>
      restaurantOrderService.openOrder({
        orderType: "DINE_IN",
        tableId: table.id,
        // Omitted when tenant info hasn't loaded — the server has its own
        // default and is the authority on it either way.
        covers: tenantInfo?.defaultCovers,
      }),
    onSuccess: async (order) => {
      setPendingTableId(null);
      await refreshFloor();
      onOrderReady(order.id);
    },
    onError: async (err: unknown) => {
      setPendingTableId(null);
      // A refused open is nearly always the partial unique index doing its job —
      // another device seated this table inside the poll window. Say what the
      // server said, then re-read the floor so the tile flips to occupied.
      toast.error(getApiErrorMessage(err, "Could not open a tab on this table"));
      await refreshFloor();
    },
  });

  const handleTap = (
    table: RestaurantTable,
    order: RestaurantOrder | undefined
  ) => {
    if (openTab.isPending) return;

    // Occupied → resume the tab already running on it. Never try to open a
    // second one: `uk_rest_order_open_table` is a partial unique index on
    // (table_id) WHERE status = 'OPEN', so the server would refuse anyway.
    if (order) {
      onOrderReady(order.id);
      return;
    }

    if (table.status === "OCCUPIED") {
      // The table says occupied but no open tab of ours matches it — typically a
      // tab opened at another branch. Opening would be refused, so don't pretend.
      toast.error(
        `${table.name} is occupied, but its tab is not visible here. It may belong to another branch — settle or void it there first.`
      );
      return;
    }

    setPendingTableId(table.id);
    openTab.mutate(table);
  };

  const loadError = areasError ?? ordersError;

  if (areasLoading) {
    return (
      <div className={cn("flex items-center justify-center py-20", className)}>
        <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={cn("px-4 py-16 text-center", className)}>
        <p className="text-sm text-red-400">
          {getApiErrorMessage(loadError, "The floor could not be loaded.")}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          It will retry on its own every {FLOOR_POLL_MS / 1000} seconds.
        </p>
      </div>
    );
  }

  if (visibleAreas.length === 0) {
    return (
      <div className={cn("px-4 py-16 text-center", className)}>
        <p className="text-sm text-gray-400">No areas are on the floor yet.</p>
        <p className="mt-1 text-xs text-gray-500">
          Add areas and tables under Restaurant &rarr; Tables in the dashboard.
        </p>
      </div>
    );
  }

  return (
    <Tabs
      value={activeArea ?? visibleAreas[0].id}
      onValueChange={setActiveArea}
      className={cn("flex min-h-0 flex-col", className)}
    >
      {/* Touch-first: tall triggers, scrolled horizontally rather than wrapped,
          so a dozen areas never push the tiles off screen. */}
      <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-gray-800 bg-gray-900/60 p-1">
        {visibleAreas.map((area) => {
          const occupied = area.tables.filter((t) =>
            ordersByTable.has(t.id)
          ).length;
          return (
            <TabsTrigger
              key={area.id}
              value={area.id}
              className="h-12 shrink-0 rounded-lg px-5 text-base font-semibold text-gray-400 data-[state=active]:bg-gray-800 data-[state=active]:text-white"
            >
              {area.name}
              <span className="ml-2 text-xs font-normal tabular-nums text-gray-500">
                {occupied}/{area.tables.length}
              </span>
            </TabsTrigger>
          );
        })}
      </TabsList>

      {visibleAreas.map((area) => (
        <TabsContent
          key={area.id}
          value={area.id}
          className="mt-4 min-h-0 flex-1 overflow-y-auto"
        >
          {area.tables.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-500">
              No tables in {area.name} yet.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
              {area.tables.map((table) => (
                <TableTile
                  key={table.id}
                  table={table}
                  order={ordersByTable.get(table.id)}
                  now={now}
                  pending={pendingTableId === table.id}
                  disabled={openTab.isPending && pendingTableId !== table.id}
                  onTap={handleTap}
                />
              ))}
            </div>
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function TableTile({
  table,
  order,
  now,
  pending,
  disabled,
  onTap,
}: {
  table: RestaurantTable;
  order?: RestaurantOrder;
  now: number;
  pending: boolean;
  disabled: boolean;
  onTap: (table: RestaurantTable, order: RestaurantOrder | undefined) => void;
}) {
  const occupied = !!order || table.status === "OCCUPIED";
  const elapsed = order ? formatElapsed(order.openedAt, now) : null;

  return (
    <button
      type="button"
      onClick={() => onTap(table, order)}
      disabled={disabled || pending}
      aria-label={
        order
          ? `${table.name}, occupied, ${order.label}. Resume this tab.`
          : `${table.name}, ${table.seats} seats, available. Open a tab.`
      }
      // Tall enough to hit standing up, at speed, with a thumb.
      className={cn(
        "flex min-h-[132px] flex-col justify-between rounded-2xl border-2 p-4 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        "disabled:cursor-not-allowed disabled:opacity-60",
        occupied
          ? "border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20"
          : "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-2xl font-bold leading-tight text-white">
          {table.name}
        </span>
        {pending ? (
          <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-gray-300" />
        ) : (
          <span className="mt-1 flex shrink-0 items-center gap-1 text-xs tabular-nums text-gray-400">
            <Users size={12} />
            {table.seats}
          </span>
        )}
      </div>

      {order ? (
        <div className="mt-3 space-y-0.5">
          <p className="truncate text-sm font-semibold text-amber-200">
            {order.label}
          </p>
          <p className="text-lg font-bold tabular-nums text-white">
            {fc(order.runningTotal)}
          </p>
          <p className="text-xs tabular-nums text-gray-400">
            {elapsed}
            {order.covers > 0 && ` · ${order.covers} covers`}
          </p>
        </div>
      ) : occupied ? (
        <p className="mt-3 text-xs text-amber-200/80">
          Occupied &mdash; tab not visible here
        </p>
      ) : (
        <p className="mt-3 text-sm font-medium text-emerald-300">Available</p>
      )}
    </button>
  );
}

/**
 * "38 min" / "1h 22m" since the tab was opened. `openedAt` is ISO-8601 with a
 * UTC offset, so the elapsed span is zone-independent even though the store's
 * business date is not.
 *
 * Exported because the terminal's dine-in banner says the same thing about the
 * same tab; two copies would eventually disagree.
 */
export function formatElapsed(openedAt: string, now: number): string {
  const opened = Date.parse(openedAt);
  if (Number.isNaN(opened)) return "";
  const minutes = Math.max(0, Math.floor((now - opened) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
