"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, CalendarClock } from "lucide-react";

import api from "@/services/api";
import type { ApiResponse } from "@/types/common";
import { QK } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

/** Mirrors the backend's LicensePolicy.Status. */
interface LicenseStatus {
  state: "OK" | "EXPIRING" | "GRACE" | "EXPIRED";
  expiresAt?: string | null;
  graceEndsAt?: string | null;
  daysLeft?: number | null;
}

/**
 * Warns before the license stops the till — 30 days ahead in amber, then in red
 * through the 7-day grace period with the exact day it will stop. Renders nothing
 * when the license is fine, and nothing outside the desktop app (the endpoint
 * exists only there; a 404 means "no license to warn about").
 */
export function LicenseBanner({ className }: { className?: string }) {
  const { data } = useQuery({
    queryKey: QK.licenseStatus,
    queryFn: () =>
      api
        .get<ApiResponse<LicenseStatus>>("/license/status")
        .then((res) => res.data.data)
        .catch(() => null),
    staleTime: 60 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
    retry: false,
  });

  if (!data || data.state === "OK" || data.state === "EXPIRED") return null;

  const grace = data.state === "GRACE";
  const days = data.daysLeft ?? 0;
  const when = (iso?: string | null) => (iso ? format(new Date(iso), "EEE d MMM") : "");

  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-2 px-4 py-2 text-sm print:hidden",
        grace ? "bg-destructive/15 text-destructive" : "bg-warning/10 text-warning",
        className,
      )}
    >
      {grace ? <AlertTriangle size={16} className="shrink-0" /> : <CalendarClock size={16} className="shrink-0" />}
      <span>
        {grace ? (
          <>
            <strong>Your StoreX Restaurant license has expired.</strong> The till keeps working until{" "}
            <strong>{when(data.graceEndsAt)}</strong> ({days === 1 ? "1 day" : `${days} days`}), then it will not
            start. Contact support to renew.
          </>
        ) : (
          <>
            Your StoreX Restaurant license expires on <strong>{when(data.expiresAt)}</strong> (
            {days === 1 ? "1 day" : `${days} days`}). Contact support to renew.
          </>
        )}
      </span>
    </div>
  );
}
