"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FloorPlan } from "@/components/pos/FloorPlan";

/**
 * The floor, as a route — where a server *starts* a shift.
 *
 * This is the safe mount. Nothing is in flight on this page, so tapping a table
 * and navigating to `/terminal?orderId=...` costs nothing. The mid-service path
 * is deliberately NOT this page: `useCart` is `useState`, so routing here with a
 * cart open would destroy it. That case uses `FloorSheet` inside the terminal
 * instead, which keeps the terminal mounted.
 *
 * Both render the same `FloorPlan`; only the hand-off differs.
 */
export default function FloorPage() {
  const router = useRouter();

  return (
    <div className="flex h-full flex-col p-4 sm:p-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Floor</h1>
          <p className="text-sm text-gray-400">
            Tap a free table to seat it, or an occupied one to pick its tab back
            up.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => router.push("/terminal")}
          className="h-11 shrink-0 gap-2 border-gray-800 bg-gray-950 text-gray-300 hover:bg-gray-800 hover:text-primary"
        >
          <ArrowLeft size={16} /> Terminal
        </Button>
      </header>

      <FloorPlan
        className="flex-1"
        // No cart exists on this page, so a full navigation is free. The terminal
        // picks the tab up from `?orderId` (wired in the next slice).
        onOrderReady={(orderId) => router.push(`/terminal?orderId=${orderId}`)}
      />
    </div>
  );
}
