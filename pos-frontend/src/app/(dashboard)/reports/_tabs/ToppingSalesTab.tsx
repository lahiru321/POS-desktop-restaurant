"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download, Salad } from "lucide-react";
import { reportService } from "@/services/reportService";
import { ToppingSalesReport } from "@/types/report";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv } from "@/lib/csv";

const fc = (val: number) =>
  new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(val);
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

interface DateRange { start: string; end: string }
interface Props { dateRange: DateRange; onDateChange: (r: DateRange) => void; branchId?: string }

/**
 * Add-on revenue. Every product report leaves add-on lines out on purpose (they
 * carry no product), so extra cheese sold with every burger would otherwise
 * never show up anywhere. Net of completed refunds, keyed on the sale's date.
 */
export function ToppingSalesTab({ dateRange, onDateChange, branchId }: Props) {
  const { data, isLoading } = useQuery<ToppingSalesReport>({
    queryKey: ["reports", "topping-sales", dateRange, branchId],
    queryFn: () => reportService.getToppingSales(dateRange.start, dateRange.end, branchId),
  });

  const rows = data?.toppings ?? [];

  const exportCSV = () => {
    if (!rows.length) return;
    const headers = ["Add-on", "Portions sold", "Revenue", "Portions returned", "Refunded", "Net revenue"];
    downloadCsv(
      `report-addons-${format(new Date(), "yyyyMMdd")}.csv`,
      headers,
      rows.map((r) => [r.name, r.portionsSold, r.revenue, r.portionsReturned, r.refunded, r.netRevenue]),
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardDescription>Add-on net revenue</CardDescription>
            <CardTitle className="text-3xl font-bold text-primary flex items-center gap-2">
              <Salad size={26} />
              {isLoading ? "..." : fc(data?.netRevenue ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Sold, less completed refunds.</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardDescription>Portions sold</CardDescription>
            <CardTitle className="text-3xl font-bold">{isLoading ? "..." : qty(data?.totalPortions ?? 0)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Across {rows.length} add-on{rows.length === 1 ? "" : "s"}.</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardDescription>Refunded</CardDescription>
            <CardTitle className="text-3xl font-bold">{isLoading ? "..." : fc(data?.totalRefunded ?? 0)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Add-ons given back with, or without, their dish.</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 border-border">
        <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap pb-3">
          <div className="space-y-1">
            <CardTitle>Add-ons</CardTitle>
            <CardDescription>
              Not included in Profitability or top products, which count dishes only.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" className="border-border text-foreground gap-1" onClick={exportCSV}>
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
                  <TableHead>Add-on</TableHead>
                  <TableHead className="text-center">Sold</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-center">Returned</TableHead>
                  <TableHead className="text-right">Refunded</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 animate-pulse text-muted-foreground">Loading...</TableCell>
                  </TableRow>
                ) : !rows.length ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">No add-ons sold in this period.</TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.toppingId} className="hover:bg-muted/50">
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-center tabular-nums">{qty(row.portionsSold)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fc(row.revenue)}</TableCell>
                      <TableCell className="text-center tabular-nums text-muted-foreground">{qty(row.portionsReturned)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{fc(row.refunded)}</TableCell>
                      <TableCell className="text-right font-bold text-primary tabular-nums">{fc(row.netRevenue)}</TableCell>
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
