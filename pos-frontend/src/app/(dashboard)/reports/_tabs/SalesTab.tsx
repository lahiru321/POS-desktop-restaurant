"use client";

import { useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { reportService } from "@/services/reportService";
import { ORDER_TYPE_LABELS, SalesReportRecord } from "@/types/report";
import { Page } from "@/types/common";
import { format } from "date-fns";
import { Download, ChevronRight, ChevronDown, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { downloadCsv, fetchAllPages } from "@/lib/csv";
import { toast } from "sonner";

const PAGE_SIZE = 15;
const fc = (val: number) =>
  new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(val);

interface DateRange { start: string; end: string }

interface Props {
  dateRange: DateRange;
  onDateChange: (r: DateRange) => void;
  onReturn: (saleId: string) => void;
  branchId?: string;
}

export function SalesTab({ dateRange, onDateChange, onReturn, branchId }: Props) {
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [isExporting, setIsExporting] = useState(false);

  const toggle = (id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const { data, isLoading } = useQuery<Page<SalesReportRecord>>({
    queryKey: ["reports", "sales", dateRange, page, branchId],
    queryFn: () => reportService.getSalesReport(dateRange.start, dateRange.end, page, PAGE_SIZE, branchId),
  });

  const chartData = (data?.content ?? [])
    .slice()
    .reverse()
    .map(s => ({ name: format(new Date(s.createdAt), "MM/dd HH:mm"), amount: s.netAmount }));

  const exportCSV = async () => {
    if (!data?.content?.length) return;
    setIsExporting(true);
    try {
      const all = await fetchAllPages(
        (p, s) => reportService.getSalesReport(dateRange.start, dateRange.end, p, s, branchId),
      );
      const headers = ["Invoice #", "Date", "Order Type", "Table", "Customer", "Cashier", "Payment", "Status", "Total", "Tax", "Service Charge", "Net", "Cash Tendered", "Change Given"];
      const rows = all.map(s => [
        s.invoiceNumber, format(new Date(s.createdAt), "yyyy-MM-dd HH:mm"),
        ORDER_TYPE_LABELS[s.orderType] ?? s.orderType, s.tableName ?? "",
        s.customerName, s.cashierName, s.paymentMethod,
        s.paymentStatus, s.totalAmount, s.taxAmount, s.serviceChargeAmount ?? 0, s.netAmount,
        s.amountTendered ?? "", s.amountTendered != null ? (s.changeDue ?? 0) : "",
      ]);
      downloadCsv(`report-sales-${format(new Date(), "yyyyMMdd")}.csv`, headers, rows);
    } catch {
      toast.error("Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  const totalRevenue = data?.content?.reduce((s, r) => s + r.netAmount, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 bg-card/50 border-border backdrop-blur-sm h-[320px]">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium">Sales Volume Trend</CardTitle>
          </CardHeader>
          <CardContent className="h-full pb-10">
            <div className="w-full h-full">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#facc15" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#facc15" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                    <XAxis dataKey="name" stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: "8px" }}
                      labelStyle={{ color: "#9ca3af", marginBottom: "4px" }}
                      itemStyle={{ color: "#facc15" }}
                    />
                    <Area type="monotone" dataKey="amount" stroke="#facc15" fillOpacity={1} fill="url(#colorSales)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-xs italic">
                  <p>Financial transaction volume across selected period</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card className="bg-card/50 border-border p-4">
            <p className="text-xs text-muted-foreground">Total Revenue</p>
            <h3 className="text-2xl font-bold text-primary">{fc(totalRevenue)}</h3>
          </Card>
          <Card className="bg-card/50 border-border p-4">
            <p className="text-xs text-muted-foreground">Total Transactions</p>
            <h3 className="text-2xl font-bold">{data?.totalElements ?? 0}</h3>
          </Card>
          <Card className="bg-card/50 border-border p-4">
            <p className="text-xs text-muted-foreground">Average Order Value</p>
            <h3 className="text-2xl font-bold text-success">
              {fc(totalRevenue / (data?.totalElements || 1))}
            </h3>
          </Card>
        </div>
      </div>

      <Card className="bg-card/50 border-border backdrop-blur-sm">
        <CardHeader className="space-y-3 pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <CardTitle>Sales Filters</CardTitle>
              <CardDescription>Select a date range to filter sales records.</CardDescription>
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
                  <TableHead className="w-10" />
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date &amp; Time</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Net Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-10 text-muted-foreground animate-pulse">
                      Loading sales report...
                    </TableCell>
                  </TableRow>
                ) : !data?.content?.length ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                      No sales found for the selected period.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.content.map(sale => (
                    <Fragment key={sale.saleId}>
                      <TableRow
                        className="hover:bg-muted/50 cursor-pointer"
                        onClick={() => toggle(sale.saleId)}
                      >
                        <TableCell className="w-10 px-3">
                          {expanded[sale.saleId]
                            ? <ChevronDown size={16} className="text-primary" />
                            : <ChevronRight size={16} className="text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-mono text-primary">{sale.invoiceNumber}</TableCell>
                        <TableCell className="text-foreground">
                          {format(new Date(sale.createdAt), "MMM dd, yyyy HH:mm")}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {ORDER_TYPE_LABELS[sale.orderType] ?? sale.orderType}
                          {sale.tableName && <span className="text-muted-foreground"> · {sale.tableName}</span>}
                        </TableCell>
                        <TableCell>{sale.customerName}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{sale.cashierName}</TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground uppercase">{sale.paymentMethod}</span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={sale.paymentStatus === "PAID" ? "default" : "outline"}
                            className={
                              sale.paymentStatus === "PAID"
                                ? "bg-success/10 text-success hover:bg-success/20"
                                : sale.paymentStatus === "REFUNDED"
                                ? "bg-warning/10 text-warning hover:bg-warning/20"
                                : ""
                            }
                          >
                            {sale.paymentStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-bold text-foreground">
                          {fc(sale.netAmount)}
                        </TableCell>
                        <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onReturn(sale.saleId)}
                            className="text-warning hover:text-warning hover:bg-warning/10"
                          >
                            <RotateCcw size={14} className="mr-1" /> Return
                          </Button>
                        </TableCell>
                      </TableRow>
                      {expanded[sale.saleId] && (
                        <TableRow key={`${sale.saleId}-items`}>
                          <TableCell colSpan={10} className="p-0 border-b border-border">
                            <div className="bg-background/80 px-6 py-4 ml-8 mr-4 my-2 rounded-lg border border-border/50">
                              {/* Cash handling — only meaningful when physical cash
                                  changed hands (CASH/SPLIT). Net cancels out the change,
                                  so this is for audit / drawer-variance tracing, not revenue. */}
                              {sale.amountTendered != null && (
                                <div className="mb-4">
                                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                                    Cash Handling
                                  </h4>
                                  <div className="grid grid-cols-3 gap-4 max-w-md">
                                    <div>
                                      <p className="text-xs text-muted-foreground">Net Amount</p>
                                      <p className="text-sm font-semibold text-foreground">{fc(sale.netAmount)}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-muted-foreground">Cash Tendered</p>
                                      <p className="text-sm font-semibold text-foreground">{fc(sale.amountTendered)}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-muted-foreground">Change Given</p>
                                      <p className="text-sm font-semibold text-foreground">{fc(sale.changeDue ?? 0)}</p>
                                    </div>
                                  </div>
                                </div>
                              )}
                              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                                Items in this Transaction
                              </h4>
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-muted-foreground text-xs uppercase">
                                    <th className="text-left pb-2 pr-4">Menu Item</th>
                                    <th className="text-left pb-2 pr-4">SKU</th>
                                    <th className="text-center pb-2 pr-4">Qty</th>
                                    <th className="text-right pb-2 pr-4">Unit Price</th>
                                    <th className="text-right pb-2 pr-4">Tax</th>
                                    <th className="text-right pb-2 pr-4">Discount</th>
                                    <th className="text-right pb-2">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sale.items?.map((item, idx) => (
                                    <tr key={idx} className="border-t border-border/30">
                                      <td className="py-2 pr-4">
                                        <span className="text-foreground font-medium">{item.productName}</span>
                                        {item.description && (
                                          <p className="text-xs text-muted-foreground mt-0.5 max-w-xs truncate">
                                            ↳ {item.description}
                                          </p>
                                        )}
                                      </td>
                                      <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">{item.sku || "—"}</td>
                                      <td className="py-2 pr-4 text-center text-foreground">{item.quantity}</td>
                                      <td className="py-2 pr-4 text-right text-foreground">{fc(item.unitPrice)}</td>
                                      <td className="py-2 pr-4 text-right text-muted-foreground">{fc(item.taxAmount)}</td>
                                      <td className="py-2 pr-4 text-right text-muted-foreground">{fc(item.discountAmount)}</td>
                                      <td className="py-2 text-right font-semibold text-foreground">{fc(item.totalAmount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <Pagination
            currentPage={page}
            totalPages={data?.totalPages ?? 0}
            onPageChange={setPage}
            isLoading={isLoading}
          />
        </CardContent>
      </Card>
    </div>
  );
}
