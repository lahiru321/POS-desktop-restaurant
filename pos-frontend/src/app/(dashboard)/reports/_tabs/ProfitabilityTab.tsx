"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { reportService } from "@/services/reportService";
import { ProfitabilityReport, ProductProfitRecord } from "@/types/report";
import { format } from "date-fns";
import { Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { downloadCsv, fetchAllPages } from "@/lib/csv";
import { toast } from "sonner";

const PAGE_SIZE = 15;
const fc = (val: number) =>
  new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(val);

interface DateRange { start: string; end: string }
interface Props { dateRange: DateRange; onDateChange: (r: DateRange) => void; branchId?: string }

export function ProfitabilityTab({ dateRange, onDateChange, branchId }: Props) {
  const [page, setPage] = useState(0);
  const [isExporting, setIsExporting] = useState(false);

  const { data, isLoading } = useQuery<ProfitabilityReport>({
    queryKey: ["reports", "profitability", dateRange, page, branchId],
    queryFn: () => reportService.getProfitabilityReport(dateRange.start, dateRange.end, page, PAGE_SIZE, branchId),
  });

  const chartData = (data?.products.content ?? []).slice(0, 10).map(p => ({
    name: p.productName.length > 12 ? p.productName.substring(0, 12) + "..." : p.productName,
    profit: p.grossProfit,
    revenue: p.revenue,
  }));

  const exportCSV = async () => {
    if (!data?.products?.content?.length) return;
    setIsExporting(true);
    try {
      const all = await fetchAllPages(
        async (p, s) => (await reportService.getProfitabilityReport(dateRange.start, dateRange.end, p, s, branchId)).products,
      );
      const headers = ["Menu Item", "SKU", "Category", "Units Sold", "Revenue", "COGS", "Gross Profit", "Margin %"];
      const rows = all.map(p => [
        p.productName, p.sku, p.category, p.unitsSold,
        p.revenue, p.costOfGoodsSold, p.grossProfit, p.marginPct,
      ]);
      downloadCsv(`report-profitability-${format(new Date(), "yyyyMMdd")}.csv`, headers, rows);
    } catch {
      toast.error("Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 bg-card/50 border-border backdrop-blur-sm h-[320px]">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium">Top 10 Profitable Menu Items</CardTitle>
          </CardHeader>
          <CardContent className="h-full pb-10">
            <div className="w-full h-full">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                    <XAxis dataKey="name" stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: "8px" }}
                      itemStyle={{ color: "#10b981" }}
                    />
                    <Bar dataKey="profit" name="Gross Profit" radius={[4, 4, 0, 0]}>
                      {chartData.map((_, i) => (
                        <Cell key={`cell-${i}`} fill={i % 2 === 0 ? "#10b981" : "#059669"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-xs italic">
                  <p>Revenue vs profit for your best-earning menu items</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 md:grid-cols-1 gap-4">
          {[
            { label: "Total Revenue", value: fc(data?.totalRevenue ?? 0), cls: "text-foreground" },
            { label: "Total Profit", value: fc(data?.totalProfit ?? 0), cls: "text-success" },
            { label: "Total COGS", value: fc(data?.totalCost ?? 0), cls: "text-destructive" },
            { label: "Overall Margin", value: `${data?.overallMarginPct ?? 0}%`, cls: "text-warning" },
          ].map(stat => (
            <Card key={stat.label} className="bg-card/50 border-border p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{stat.label}</p>
              <p className={`text-xl font-bold ${stat.cls}`}>{isLoading ? "..." : stat.value}</p>
            </Card>
          ))}
        </div>
      </div>

      <Card className="bg-card/50 border-border">
        <CardHeader className="space-y-3 pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <CardTitle>Menu Item Profitability Breakdown</CardTitle>
              <CardDescription>Revenue, cost, and margin per menu item sold in the period.</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="border-border text-foreground gap-1" onClick={exportCSV} disabled={isExporting}>
              <Download size={14} /> {isExporting ? "Exporting…" : "CSV"}
            </Button>
          </div>
          <DateRangePicker value={dateRange} onChange={onDateChange} onRangeChange={() => setPage(0)} />
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border bg-card/40">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Menu Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-center">Units Sold</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">COGS</TableHead>
                  <TableHead className="text-right">Gross Profit</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 animate-pulse text-muted-foreground">Loading...</TableCell>
                  </TableRow>
                ) : !data?.products?.content?.length ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">No sales data for this period.</TableCell>
                  </TableRow>
                ) : (
                  data.products.content.map((p: ProductProfitRecord) => (
                    <TableRow key={p.productId} className="hover:bg-muted/50">
                      <TableCell>
                        <div className="font-medium text-foreground">{p.productName}</div>
                        <div className="text-xs text-muted-foreground font-mono">{p.sku}</div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{p.category}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="border-border">{p.unitsSold}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-foreground">{fc(p.revenue)}</TableCell>
                      <TableCell className="text-right text-destructive">{fc(p.costOfGoodsSold)}</TableCell>
                      <TableCell className="text-right font-bold text-success">{fc(p.grossProfit)}</TableCell>
                      <TableCell className="text-right">
                        <span className={`font-bold ${p.marginPct >= 30 ? "text-success" : p.marginPct >= 15 ? "text-warning" : "text-destructive"}`}>
                          {p.marginPct}%
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <Pagination
            currentPage={page}
            totalPages={data?.products?.totalPages ?? 0}
            onPageChange={setPage}
            isLoading={isLoading}
          />
        </CardContent>
      </Card>
    </div>
  );
}
