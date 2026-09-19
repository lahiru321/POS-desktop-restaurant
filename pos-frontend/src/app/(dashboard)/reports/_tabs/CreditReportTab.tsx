"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { reportService } from "@/services/reportService";
import { CustomerCreditRecord } from "@/types/report";
import { Page } from "@/types/common";
import { format } from "date-fns";
import { Download, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { downloadCsv, fetchAllPages } from "@/lib/csv";
import { toast } from "sonner";

const PAGE_SIZE = 15;
const fc = (val: number) =>
  new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(val);

export function CreditReportTab() {
  const [page, setPage] = useState(0);
  const [isExporting, setIsExporting] = useState(false);

  const { data, isLoading } = useQuery<Page<CustomerCreditRecord>>({
    queryKey: ["reports", "customer-credit", page],
    queryFn: () => reportService.getCustomerCredit(page, PAGE_SIZE),
  });

  const totalOutstanding = (data?.content ?? []).reduce((sum, c) => sum + c.creditBalance, 0);

  const exportCSV = async () => {
    if (!data?.content?.length) return;
    setIsExporting(true);
    try {
      const all = await fetchAllPages((p, s) => reportService.getCustomerCredit(p, s));
      const headers = ["Customer", "Email", "Phone", "Credit Limit", "Outstanding", "Available", "Last Repayment"];
      const rows = all.map(c => [
        c.customerName, c.email ?? "", c.phone ?? "",
        c.creditLimit, c.creditBalance, c.availableCredit,
        c.lastRepaymentAt ? format(new Date(c.lastRepaymentAt), "yyyy-MM-dd") : "",
      ]);
      downloadCsv(`report-customer-credit-${format(new Date(), "yyyyMMdd")}.csv`, headers, rows);
    } catch {
      toast.error("Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card className="bg-card/50 border-border backdrop-blur-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap">
        <div>
          <CardTitle>Accounts Receivable</CardTitle>
          <CardDescription>
            Customers with store credit, highest outstanding first.
            {(data?.content?.length ?? 0) > 0 && (
              <> This page owes <span className="font-semibold text-foreground">{fc(totalOutstanding)}</span>.</>
            )}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" className="border-border text-foreground gap-1" onClick={exportCSV} disabled={isExporting}>
          <Download size={14} /> {isExporting ? "Exporting…" : "CSV"}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-border bg-card/40">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Credit Limit</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Last Repayment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 animate-pulse text-muted-foreground">Loading...</TableCell>
                </TableRow>
              ) : !data?.content?.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                    <Wallet size={40} className="opacity-10 mx-auto mb-2" />
                    No customers on store credit yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.content.map((c) => (
                  <TableRow key={c.customerId} className="hover:bg-muted/50">
                    <TableCell>
                      <div className="font-medium text-foreground">{c.customerName}</div>
                      <div className="text-xs text-muted-foreground">{c.email || c.phone || "—"}</div>
                    </TableCell>
                    <TableCell className="text-right text-foreground">{fc(c.creditLimit)}</TableCell>
                    <TableCell className={`text-right font-bold ${c.creditBalance > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {fc(c.creditBalance)}
                    </TableCell>
                    <TableCell className="text-right text-success">{fc(c.availableCredit)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {c.lastRepaymentAt ? format(new Date(c.lastRepaymentAt), "dd MMM yyyy") : "—"}
                    </TableCell>
                  </TableRow>
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
  );
}
