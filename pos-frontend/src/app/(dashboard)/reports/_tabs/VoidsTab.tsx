"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download } from "lucide-react";
import { reportService } from "@/services/reportService";
import { RestaurantSummaryReport } from "@/types/report";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv } from "@/lib/csv";
import { restaurantSummaryKey } from "./SummaryTab";

const fc = (val: number) =>
  new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(val);
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

interface DateRange { start: string; end: string }
interface Props { dateRange: DateRange; onDateChange: (r: DateRange) => void; branchId?: string }

/**
 * Every item taken off a tab, newest first, with who did it and who approved
 * it. With one till, this is where the owner looks for food rung, paid for in
 * cash, and then voided.
 */
export function VoidsTab({ dateRange, onDateChange, branchId }: Props) {
  const { data, isLoading } = useQuery<RestaurantSummaryReport>({
    queryKey: restaurantSummaryKey(dateRange, branchId),
    queryFn: () => reportService.getRestaurantSummary(dateRange.start, dateRange.end, branchId),
  });

  const voids = data?.voids ?? [];

  const exportCSV = () => {
    if (!voids.length) return;
    downloadCsv(
      `report-voids-${format(new Date(), "yyyyMMdd")}.csv`,
      ["Date", "Order", "Menu Item", "Qty", "Kitchen Had", "Value", "Whole Tab", "Voided By", "Approved By", "Reason"],
      voids.map((v) => [
        format(new Date(v.voidedAt), "yyyy-MM-dd HH:mm"),
        v.orderLabel, v.itemName, v.quantity, v.firedQuantity, v.amount,
        v.wholeTab ? "Yes" : "No", v.voidedBy, v.approvedBy ?? "", v.reason ?? "",
      ]),
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Voided (menu value)", value: fc(data?.voidedAmount ?? 0), cls: "text-destructive" },
          { label: "Already with the kitchen", value: fc(data?.voidedAfterKitchenAmount ?? 0), cls: "text-warning" },
          { label: "Voids", value: String(data?.voidCount ?? 0), cls: "text-foreground" },
          { label: "Whole tabs voided", value: String(data?.voidedTabs ?? 0), cls: "text-foreground" },
        ].map((stat) => (
          <Card key={stat.label} className="bg-card/50 border-border p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{stat.label}</p>
            <p className={`text-xl font-bold ${stat.cls}`}>{isLoading ? "..." : stat.value}</p>
          </Card>
        ))}
      </div>

      <Card className="bg-card/50 border-border">
        <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap pb-3">
          <div className="space-y-1">
            <CardTitle>Voids</CardTitle>
            <CardDescription>
              Valued at menu price plus add-ons. &quot;Kitchen had&quot; is how much was already sent to cook.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" className="border-border text-foreground gap-1" onClick={exportCSV} disabled={!voids.length}>
            <Download size={14} /> CSV
          </Button>
        </CardHeader>
        <CardHeader className="pt-0 pb-3">
          <DateRangePicker value={dateRange} onChange={onDateChange} />
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border bg-card/40">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Menu Item</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-center">Kitchen had</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Voided by</TableHead>
                  <TableHead>Approved by</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-10 animate-pulse text-muted-foreground">Loading...</TableCell>
                  </TableRow>
                ) : !voids.length ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">No voids in this period.</TableCell>
                  </TableRow>
                ) : (
                  voids.map((v) => (
                    <TableRow key={v.id} className="hover:bg-muted/50">
                      <TableCell className="whitespace-nowrap text-muted-foreground">{format(new Date(v.voidedAt), "dd MMM, HH:mm")}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {v.orderLabel}
                        {v.wholeTab && (
                          <span className="ml-2 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                            Whole tab
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{v.itemName}</TableCell>
                      <TableCell className="text-center tabular-nums">{qty(v.quantity)}</TableCell>
                      <TableCell className={`text-center tabular-nums ${v.firedQuantity > 0 ? "text-warning font-semibold" : "text-muted-foreground"}`}>
                        {v.firedQuantity > 0 ? qty(v.firedQuantity) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-bold text-destructive tabular-nums">{fc(v.amount)}</TableCell>
                      <TableCell>{v.voidedBy}</TableCell>
                      <TableCell className="text-muted-foreground">{v.approvedBy ?? "—"}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-muted-foreground" title={v.reason ?? undefined}>{v.reason ?? "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
