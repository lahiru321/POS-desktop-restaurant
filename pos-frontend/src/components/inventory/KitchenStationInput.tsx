"use client";

import { forwardRef, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { kitchenTicketService } from "@/services/kitchenTicketService";
import { QK } from "@/lib/queryKeys";
import { KITCHEN_STATION_MAX_LENGTH, SUGGESTED_KITCHEN_STATIONS } from "@/lib/kitchenStations";

interface KitchenStationInputProps {
  value: string | null | undefined;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** What an empty field means here — "Kitchen", or the category's station. */
  placeholder: string;
  className?: string;
}

/**
 * Free text with the stations already in use offered as suggestions, so a new
 * station is just a new name — and an existing one is picked, not re-typed as
 * "Bar" beside "BAR". Upper-cased as you type; the server normalizes again.
 */
export const KitchenStationInput = forwardRef<HTMLInputElement, KitchenStationInputProps>(
  function KitchenStationInput({ value, onChange, onBlur, placeholder, className }, ref) {
    const listId = useId();
    const { data: inUse = [] } = useQuery({
      queryKey: QK.kitchenStations,
      queryFn: kitchenTicketService.getStations,
      staleTime: 60 * 1000,
    });
    const options = Array.from(new Set([...SUGGESTED_KITCHEN_STATIONS, ...inUse]));

    return (
      <>
        <Input
          ref={ref}
          list={listId}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          onBlur={onBlur}
          placeholder={placeholder}
          maxLength={KITCHEN_STATION_MAX_LENGTH}
          autoComplete="off"
          className={className}
        />
        <datalist id={listId}>
          {options.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </>
    );
  },
);
