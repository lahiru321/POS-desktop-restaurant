"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { reportService } from "@/services/reportService";
import { InventoryValuationReport } from "@/types/report";
import { format } from "date-fns";
import { TrendingUp, DollarSign, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { downloadCsv } from "@/lib/csv";

const PAGE_SIZE = 15;
const fc = (val: number) =>
  new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(val);

export function InventoryTab({ branchId }: { branchId?: string }) {
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery<InventoryValuationReport>({
    queryKey: ["reports", "valuation", branchId],
    queryFn: () => reportService.getInventoryValuation(branchId),
  });

  const breakdown = data?.categoryBreakdown ?? [];
  const paged = breakdown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(breakdown.length / PAGE_SIZE));

  const exportCSV = () => {
    if (!breakdown.length) return;
    const headers = ["Category", "Items", "Stock", "Cost Value", "Menu Value", "Profit"];
    const rows = breakdown.map(cat => [
      cat.categoryName, cat.productCount, cat.stockCount,
      cat.costValue, cat.retailValue, cat.retailValue - cat.costValue,
    ]);
    downloadCsv(`report-inventory-${format(new Date(), "yyyyMMdd")}.csv`, headers, rows);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardDescription>Total Inventory Cost</CardDescription>
            <CardTitle className="text-3xl font-bold flex items-center gap-2">
              <DollarSign className="text-primary" />
              {isLoading ? "..." : fc(data?.totalCostValue ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">The net value based on product cost price.</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardDescription>Stock at menu prices</CardDescription>
            <CardTitle className="text-3xl font-bold flex items-center gap-2 text-success">
              <TrendingUp />
              {isLoading ? "..." : fc(data?.totalRetailValue ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Potential revenue if everything is sold.</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardDescription>Potential Profit</CardDescription>
            <CardTitle className="text-3xl font-bold text-warning">
              {isLoading ? "..." : fc(data?.potentialProfit ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className="bg-warning/10 text-warning">
              {isLoading ? "0%" : (((data?.potentialProfit ?? 0) / (data?.totalCostValue || 1)) * 100).toFixed(1) + "% Margin"}
            </Badge>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 border-border">
        <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle>Category Breakdown</CardTitle>
            <CardDescription>Detailed valuation across different product categories.</CardDescription>
          </div>
          <Button variant="outline" size="sm" className="border-border text-foreground gap-1" onClick={exportCSV}>
            <Download size={14} /> CSV
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border bg-card/40">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-center">Products</TableHead>
                  <TableHead className="text-center">Total Stock</TableHead>
                  <TableHead className="text-right">Cost Value</TableHead>
                  <TableHead className="text-right">Menu Value</TableHead>
                  <TableHead className="text-right">Potential Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground animate-pulse">
                      Loading valuation report...
                    </TableCell>
                  </TableRow>
                ) : (
                  paged.map(cat => (
                    <TableRow key={cat.categoryName} className="hover:bg-muted/50">
                      <TableCell className="font-medium">{cat.categoryName}</TableCell>
                      <TableCell className="text-center">{cat.productCount}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="border-border">{cat.stockCount}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{fc(cat.costValue)}</TableCell>
                      <TableCell className="text-right text-success">{fc(cat.retailValue)}</TableCell>
                      <TableCell className="text-right font-bold text-warning">
                        {fc(cat.retailValue - cat.costValue)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            isLoading={isLoading}
          />
        </CardContent>
      </Card>
    </div>
  );
}
