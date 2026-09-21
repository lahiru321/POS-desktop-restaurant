"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FloorPlan } from "@/components/pos/FloorPlan";
import { QK } from "@/lib/queryKeys";
import { tenantService } from "@/services/tenantService";
import { useAuthStore } from "@/stores/authStore";

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
  const hasRestaurantFeature = useAuthStore((s) => s.hasFeature("RESTAURANT"));

  // The second half of the two-level gate. The installer grants every feature to
  // every install, so the flag alone would grow a floor plan on a hardware shop;
  // `restaurantMode` is the tenant saying it actually runs as a restaurant.
  const { data: tenantInfo, isLoading: tenantLoading } = useQuery({
    queryKey: QK.tenantInfo,
    queryFn: tenantService.getInfo,
    staleTime: 5 * 60 * 1000,
  });

  const restaurantMode = tenantInfo?.restaurantMode ?? false;
  const allowed = hasRestaurantFeature && restaurantMode;

  useEffect(() => {
    // Wait for the tenant read before deciding — bouncing on a loading state
    // would kick a genuine restaurant back to the till on every cold start.
    if (tenantLoading) return;
    if (!allowed) router.replace("/terminal");
  }, [tenantLoading, allowed, router]);

  if (tenantLoading || !allowed) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-600" />
      </div>
    );
  }

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
