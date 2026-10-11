"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { returnService, ReturnResponse } from "@/services/returnService";
import { format } from "date-fns";
import { Download, ChevronRight, ChevronDown, ShieldCheck, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { useAuthStore } from "@/stores/authStore";
import { downloadCsv, fetchAllPages } from "@/lib/csv";
import { toast } from "sonner";

const PAGE_SIZE = 15;
const fc = (val: number) =>
  new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(val);

export function ReturnsTab() {
  const { user } = useAuthStore();
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [isExporting, setIsExporting] = useState(false);

  const toggle = (id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["reports", "returns", page],
    queryFn: () => returnService.getAllReturns({ page, size: PAGE_SIZE }),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      returnService.approveReturn(id, approve),
    onSuccess: () => refetch(),
  });

  const canApprove = user?.roles?.includes("MANAGER") || user?.roles?.includes("ADMIN");

  const exportCSV = async () => {
    if (!data?.content?.length) return;
    setIsExporting(true);
    try {
      const all = await fetchAllPages(
        (p, s) => returnService.getAllReturns({ page: p, size: s }),
      );
      const headers = ["Return #", "Date", "Reason", "Processed By", "Status", "Refund Amount"];
      const rows = all.map(r => [
        r.returnNumber, format(new Date(r.createdAt), "yyyy-MM-dd HH:mm"),
        r.reason, r.processedByName, r.status, r.refundAmount,
      ]);
      downloadCsv(`report-returns-${format(new Date(), "yyyyMMdd")}.csv`, headers, rows);
    } catch {
      toast.error("Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card className="bg-card/50 border-border backdrop-blur-sm">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <CardTitle>Returns History</CardTitle>
            <CardDescription>View past returns and manage pending approvals.</CardDescription>
          </div>
          <Button variant="outline" size="sm" className="border-border text-foreground gap-1" onClick={exportCSV} disabled={isExporting}>
            <Download size={14} /> {isExporting ? "Exporting…" : "CSV"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-border bg-card/40">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Return #</TableHead>
                <TableHead>Date &amp; Time</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Processed By</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Refund Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground animate-pulse">
                    Loading returns history...
                  </TableCell>
                </TableRow>
              ) : !data?.content?.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                    No returns found.
                  </TableCell>
                </TableRow>
              ) : (
                data.content.map((ret: ReturnResponse) => (
                  <>
                    <TableRow
                      key={ret.id}
                      className="hover:bg-muted/50 cursor-pointer"
                      onClick={() => toggle(ret.id)}
                    >
                      <TableCell className="w-10 px-3">
                        {expanded[ret.id]
                          ? <ChevronDown size={16} className="text-primary" />
                          : <ChevronRight size={16} className="text-muted-foreground" />}
                      </TableCell>
                      <TableCell className="font-mono text-primary">{ret.returnNumber}</TableCell>
                      <TableCell className="text-foreground">
                        {format(new Date(ret.createdAt), "MMM dd, yyyy HH:mm")}
                      </TableCell>
                      <TableCell>{ret.reason}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{ret.processedByName || "Unknown"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={ret.status === "COMPLETED" ? "default" : ret.status === "PENDING" ? "secondary" : ret.status === "APPROVED" ? "default" : "destructive"}
                          className={
                            ret.status === "COMPLETED" ? "bg-success/10 text-success hover:bg-success/20" :
                            ret.status === "PENDING" ? "bg-warning/10 text-warning hover:bg-warning/20" : ""
                          }
                        >
                          {ret.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-bold text-foreground">{fc(ret.refundAmount)}</TableCell>
                      <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                        {ret.status === "PENDING" && canApprove ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => approveMutation.mutate({ id: ret.id, approve: true })}
                              disabled={approveMutation.isPending}
                              className="text-success hover:text-success hover:bg-success/10 px-2"
                              title="Approve Return"
                            >
                              <ShieldCheck size={16} />
                            </Button>
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => approveMutation.mutate({ id: ret.id, approve: false })}
                              disabled={approveMutation.isPending}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
                              title="Reject Return"
                            >
                              <ShieldAlert size={16} />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground mr-2">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                    {expanded[ret.id] && (
                      <TableRow key={`${ret.id}-items`}>
                        <TableCell colSpan={8} className="p-0 border-b border-border">
                          <div className="bg-background/80 px-6 py-4 ml-8 mr-4 my-2 rounded-lg border border-border/50">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                              Returned Items
                            </h4>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-muted-foreground text-xs uppercase">
                                  <th className="text-left pb-2 pr-4">Menu Item</th>
                                  <th className="text-center pb-2 pr-4">Qty Returned</th>
                                  <th className="text-right pb-2 pr-4">Unit Price</th>
                                  <th className="text-right pb-2">Refund Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ret.items?.map((item, idx) => (
                                  <tr key={idx} className="border-t border-border/30">
                                    <td className="py-2 pr-4 text-foreground font-medium">{item.productName || "Unknown item"}</td>
                                    <td className="py-2 pr-4 text-center text-foreground">{item.quantityReturned}</td>
                                    <td className="py-2 pr-4 text-right text-foreground">{fc(item.unitPrice)}</td>
                                    <td className="py-2 text-right font-semibold text-foreground">{fc(item.refundAmount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
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
