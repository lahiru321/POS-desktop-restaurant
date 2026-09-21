"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FloorPlan } from "@/components/pos/FloorPlan";

/**
 * The floor, as a sheet — the mid-service mount.
 *
 * This exists *because* `/floor` cannot be used once a sale is underway:
 * `useCart` holds the cart in `useState`, so navigating to the floor route would
 * unmount the terminal and throw the cart away. Rendering the same `FloorPlan`
 * in a sheet over the terminal switches tables without unmounting anything.
 *
 * That is also why this component never navigates. It hands the order id to
 * `onSelectOrder` and closes itself; the terminal — still mounted, still holding
 * its state — decides what to do with it.
 *
 * Self-contained on purpose: nothing here reaches into the terminal, `useCart`
 * or the hotkey map. The next slice mounts it (F11) and consumes the id.
 */
export interface FloorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * A tab is open on the tapped table and ready to work on — newly opened or
   * resumed. The sheet closes itself immediately after calling this.
   */
  onSelectOrder: (orderId: string) => void;
}

export function FloorSheet({ open, onOpenChange, onSelectOrder }: FloorSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        // Full height, and much wider than the default `sm:max-w-sm` — this is a
        // floor plan being read at arm's length, not a settings panel.
        className="flex h-full w-full flex-col gap-0 border-gray-800 bg-black p-4 text-white sm:w-[min(960px,94vw)] sm:max-w-none sm:p-6"
      >
        <SheetHeader className="mb-4 text-left">
          <SheetTitle className="text-2xl font-bold tracking-tight text-white">
            Floor
          </SheetTitle>
          <SheetDescription className="text-gray-400">
            Tap a free table to seat it, or an occupied one to pick its tab back
            up. The till stays exactly as you left it.
          </SheetDescription>
        </SheetHeader>

        <FloorPlan
          className="flex-1"
          onOrderReady={(orderId) => {
            // Hand off first, then close — no routing, so the terminal (and the
            // cart it is holding) is never unmounted.
            onSelectOrder(orderId);
            onOpenChange(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
