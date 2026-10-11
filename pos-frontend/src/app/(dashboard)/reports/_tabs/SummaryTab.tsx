"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Ban, Download, Percent, Receipt, Users } from "lucide-react";
import { reportService } from "@/services/reportService";
import { ORDER_TYPE_LABELS, RestaurantSummaryReport } from "@/types/report";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv } from "@/lib/csv";

const fc = (val: number) =>
  new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(val);

interface DateRange { start: string; end: string }
interface Props {
  dateRange: DateRange;
  onDateChange: (r: DateRange) => void;
  branchId?: string;
  onShowVoids: () => void;
}

/** Shared with VoidsTab, which reads the same report. */
export const restaurantSummaryKey = (dateRange: DateRange, branchId?: string) =>
  ["reports", "restaurant-summary", dateRange, branchId] as const;

/**
 * The owner's first look: how the money came in (dine-in, takeaway, counter),
 * the service charge, and how much came off tabs as voids.
 */
export function SummaryTab({ dateRange, onDateChange, branchId, onShowVoids }: Props) {
  const { data, isLoading } = useQuery<RestaurantSummaryReport>({
    queryKey: restaurantSummaryKey(dateRange, branchId),
    queryFn: () => reportService.getRestaurantSummary(dateRange.start, dateRange.end, branchId),
  });

  const lines = data?.orderTypes ?? [];

  const exportCSV = () => {
    if (!data) return;
    downloadCsv(
      `report-summary-${format(new Date(), "yyyyMMdd")}.csv`,
      ["Order Type", "Bills", "Revenue", "Avg Bill", "Share %", "Covers"],
      [
        ...lines.map((l) => [ORDER_TYPE_LABELS[l.orderType], l.bills, l.revenue, l.averageBill, l.sharePct, l.covers]),
        ["Total", data.bills, data.revenue, data.averageBill, 100, data.covers],
        [],
        ["Service charge collected", data.serviceChargeCollected],
        ["Bills with service charge waived", data.serviceChargeWaivedBills],
        ["Voided (menu value)", data.voidedAmount],
        ["Voided after the kitchen had it", data.voidedAfterKitchenAmount],
        ["Void count", data.voidCount],
        ["Whole tabs voided", data.voidedTabs],
      ],
    );
  };

  const kpis = [
    {
      label: "Revenue",
      value: fc(data?.revenue ?? 0),
      note: `${data?.bills ?? 0} bill${data?.bills === 1 ? "" : "s"}`,
      icon: Receipt,
      cls: "text-primary",
    },
    {
      label: "Average bill",
      value: fc(data?.averageBill ?? 0),
      note: "Revenue ÷ bills",
      icon: Receipt,
      cls: "text-foreground",
    },
    {
      label: "Guests (dine-in)",
      value: String(data?.covers ?? 0),
      note: data?.covers ? `${fc(data.revenuePerCover)} per guest` : "No covers entered on tabs",
      icon: Users,
      cls: "text-foreground",
    },
    {
      label: "Service charge",
      value: fc(data?.serviceChargeCollected ?? 0),
      note: data?.serviceChargeWaivedBills
        ? `Waived on ${data.serviceChargeWaivedBills} bill${data.serviceChargeWaivedBills === 1 ? "" : "s"}`
        : "None waived",
      icon: Percent,
      cls: "text-foreground",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <DateRangePicker value={dateRange} onChange={onDateChange} />
        <Button variant="outline" size="sm" className="border-border text-foreground gap-1" onClick={exportCSV} disabled={!data}>
          <Download size={14} /> CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="bg-card/50 border-border">
            <CardHeader className="pb-2">
              <CardDescription>{k.label}</CardDescription>
              <CardTitle className={`text-3xl font-bold flex items-center gap-2 ${k.cls}`}>
                <k.icon size={24} />
                {isLoading ? "..." : k.value}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{isLoading ? "" : k.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="bg-card/50 border-border lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle>How orders came in</CardTitle>
            <CardDescription>
              Dine-in and takeaway are tabs and takeaway orders; counter is a sale rung with no tab.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border bg-card/40">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Order type</TableHead>
                    <TableHead className="text-center">Bills</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Avg bill</TableHead>
                    <TableHead className="w-[30%]">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-10 animate-pulse text-muted-foreground">Loading...</TableCell>
                    </TableRow>
                  ) : (
                    lines.map((l) => (
                      <TableRow key={l.orderType} className="hover:bg-muted/50">
                        <TableCell className="font-medium">{ORDER_TYPE_LABELS[l.orderType]}</TableCell>
                        <TableCell className="text-center tabular-nums">{l.bills}</TableCell>
                        <TableCell className="text-right tabular-nums">{fc(l.revenue)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{fc(l.averageBill)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, l.sharePct)}%` }} />
                            </div>
                            <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{l.sharePct}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Ban size={18} className="text-destructive" /> Voids
            </CardTitle>
            <CardDescription>Food taken off tabs after it was rung.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-3xl font-bold text-destructive tabular-nums">{isLoading ? "..." : fc(data?.voidedAmount ?? 0)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {data?.voidCount ?? 0} void{data?.voidCount === 1 ? "" : "s"}
                {data?.voidedTabs ? `, ${data.voidedTabs} whole tab${data.voidedTabs === 1 ? "" : "s"}` : ""}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Already with the kitchen</p>
              <p className="text-lg font-semibold tabular-nums">{isLoading ? "..." : fc(data?.voidedAfterKitchenAmount ?? 0)}</p>
              <p className="text-xs text-muted-foreground">Food that was cooked, or being cooked, when it came off.</p>
            </div>
            <Button variant="outline" size="sm" className="w-full border-border" onClick={onShowVoids}>
              See every void
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
