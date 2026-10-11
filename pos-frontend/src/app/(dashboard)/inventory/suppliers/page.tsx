"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supplierService, Supplier, PagedSuppliers } from "@/services/supplierService";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Edit2, Loader2, Download, CheckCircle2, Ban } from "lucide-react";
import { SupplierModal } from "./SupplierModal";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { exportToCsv, type CsvColumn } from "@/lib/exportCsv";

const SUPPLIER_CSV_COLUMNS: CsvColumn<Supplier>[] = [
  { header: "Name", value: (s) => s.name },
  { header: "Contact Person", value: (s) => s.contactPerson ?? "" },
  { header: "Email", value: (s) => s.email ?? "" },
  { header: "Phone", value: (s) => s.phone ?? "" },
  { header: "Address", value: (s) => s.address ?? "" },
  { header: "Status", value: (s) => (s.isActive ? "Active" : "Inactive") },
];

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(0);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const isUndoRef = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: ["suppliers", page, searchTerm],
    queryFn: () => supplierService.getSuppliers(page, 10, { search: searchTerm }),
  });

  // Export every supplier matching the current search (not just the page).
  const exportMutation = useMutation({
    mutationFn: async () => {
      const probe = await supplierService.getSuppliers(0, 1, { search: searchTerm });
      const total = probe.totalElements ?? 0;
      if (total === 0) return [] as Supplier[];
      const all = await supplierService.getSuppliers(0, total, { search: searchTerm });
      return all.content;
    },
    onSuccess: (rows) => {
      if (rows.length === 0) {
        toast.info("No suppliers to export");
        return;
      }
      exportToCsv("suppliers", SUPPLIER_CSV_COLUMNS, rows);
      toast.success(`Exported ${rows.length} supplier${rows.length === 1 ? "" : "s"}`);
    },
    onError: (error: unknown) => {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Export failed");
    },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: ({ ids, active }: { ids: string[]; active: boolean }) =>
      supplierService.bulkSetStatus(ids, active),
    onSuccess: (count, { active }) => {
      toast.success(`${count} supplier${count === 1 ? "" : "s"} ${active ? "activated" : "deactivated"}`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (error: unknown) => {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Bulk update failed");
    },
  });

  const toggleRow = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const pageSuppliers = data?.content ?? [];
  const allPageSelected = pageSuppliers.length > 0 && pageSuppliers.every((s) => selected.has(s.id));
  const somePageSelected = pageSuppliers.some((s) => selected.has(s.id));

  const togglePage = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of pageSuppliers) {
        if (checked) next.add(s.id);
        else next.delete(s.id);
      }
      return next;
    });
  };

  const toggleStatusMutation = useMutation({
    mutationFn: (id: string) => supplierService.toggleStatus(id),
    onMutate: async (id) => {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });

      await queryClient.cancelQueries({ queryKey: ["suppliers"] });

      const snapshots = queryClient.getQueriesData<PagedSuppliers>({ queryKey: ["suppliers"] });

      queryClient.setQueriesData<PagedSuppliers>({ queryKey: ["suppliers"] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          content: old.content.map((s) => (s.id === id ? { ...s, isActive: !s.isActive } : s)),
        };
      });

      const wasUndo = isUndoRef.current;
      isUndoRef.current = false;
      return { snapshots, wasUndo };
    },
    onError: (error: unknown, _id, context) => {
      context?.snapshots.forEach(([key, previous]) => {
        queryClient.setQueryData(key, previous);
      });
      toast.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          "Failed to update status"
      );
    },
    onSuccess: (updated, _id, context) => {
      if (context?.wasUndo) return;

      if (!updated.isActive) {
        toast.success(`${updated.name} deactivated`, {
          description: "It won't appear when creating new purchase orders.",
          action: {
            label: "Undo",
            onClick: () => {
              isUndoRef.current = true;
              toggleStatusMutation.mutate(updated.id);
            },
          },
        });
      } else {
        toast.success(`${updated.name} reactivated`);
      }
    },
    onSettled: (_data, _err, id) => {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
  });

  const handleToggleStatus = (supplier: Supplier) => {
    toggleStatusMutation.mutate(supplier.id);
  };

  return (
    <div className="p-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground mb-2">Suppliers</h1>
        <p className="text-muted-foreground">Who you buy ingredients and packaged items from</p>
      </div>

      <DataTableToolbar
        searchValue={searchTerm}
        onSearchChange={(v) => { setSearchTerm(v); setPage(0); }}
        searchPlaceholder="Search suppliers..."
        resultsCount={{ shown: data?.content.length ?? 0, total: data?.totalElements ?? 0, label: 'suppliers' }}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
            >
              {exportMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Export
            </Button>
            <Button
              onClick={() => {
                setSelectedSupplier(null);
                setIsModalOpen(true);
              }}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Supplier
            </Button>
          </>
        }
        selectionBar={
          selected.size > 0 ? (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{selected.size} selected</span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulkStatusMutation.isPending}
                  onClick={() => bulkStatusMutation.mutate({ ids: Array.from(selected), active: true })}
                  className="gap-2 text-success hover:text-success"
                >
                  <CheckCircle2 size={14} /> Activate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulkStatusMutation.isPending}
                  onClick={() => bulkStatusMutation.mutate({ ids: Array.from(selected), active: false })}
                  className="gap-2 text-muted-foreground"
                >
                  <Ban size={14} /> Deactivate
                </Button>
              </div>
            </div>
          ) : undefined
        }
      />

      <div className="bg-card border border-border rounded-lg p-4">
        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader className="bg-background/50">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="w-12 pl-4">
                  <Checkbox
                    checked={allPageSelected}
                    indeterminate={somePageSelected && !allPageSelected}
                    onCheckedChange={togglePage}
                    aria-label="Select all suppliers on this page"
                  />
                </TableHead>
                <TableHead>Supplier Name</TableHead>
                <TableHead>Contact Person</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : data?.content.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No suppliers found.
                  </TableCell>
                </TableRow>
              ) : (
                data?.content.map((supplier) => {
                  const isToggling = togglingIds.has(supplier.id);
                  return (
                  <TableRow
                    key={supplier.id}
                    data-state={selected.has(supplier.id) ? "selected" : undefined}
                    className={cn(
                      "border-border group hover:bg-foreground/5 data-[state=selected]:bg-primary/5 transition-colors",
                      !supplier.isActive && "bg-background/60"
                    )}
                  >
                    <TableCell className="pl-4">
                      <Checkbox
                        checked={selected.has(supplier.id)}
                        onCheckedChange={(c) => toggleRow(supplier.id, c)}
                        aria-label={`Select ${supplier.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <span
                        className={cn(
                          supplier.isActive
                            ? "text-foreground"
                            : "text-muted-foreground line-through decoration-gray-600"
                        )}
                      >
                        {supplier.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {supplier.contactPerson || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {supplier.email || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {supplier.phone || "-"}
                    </TableCell>
                    <TableCell className="py-4">
                      <div
                        className="flex items-center gap-2"
                        title={
                          supplier.isActive
                            ? "Active — available when creating POs. Toggle to deactivate."
                            : "Inactive — hidden from PO creation. Toggle to reactivate."
                        }
                      >
                        <Switch
                          checked={supplier.isActive}
                          disabled={isToggling}
                          onCheckedChange={() => handleToggleStatus(supplier)}
                          aria-label={`${supplier.isActive ? "Deactivate" : "Activate"} ${supplier.name}`}
                          aria-busy={isToggling}
                          className="data-[state=checked]:bg-success data-[state=unchecked]:bg-muted border-border"
                        />
                        <span
                          className={cn(
                            "text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border",
                            supplier.isActive
                              ? "text-success bg-success/10 border-success/30"
                              : "text-muted-foreground bg-muted border-border"
                          )}
                        >
                          {isToggling && <Loader2 size={11} className="animate-spin" />}
                          {supplier.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="py-4 text-right pr-6">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${supplier.name}`}
                          title="Edit"
                          className="text-muted-foreground hover:text-primary hover:bg-muted"
                          onClick={() => {
                            setSelectedSupplier(supplier);
                            setIsModalOpen(true);
                          }}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{page * 10 + 1}</span> to{" "}
              <span className="font-medium text-foreground">
                {Math.min((page + 1) * 10, data.totalElements)}
              </span>{" "}
              of <span className="font-medium text-foreground">{data.totalElements}</span> suppliers
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="border-border text-foreground hover:bg-muted"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= data.totalPages - 1}
                className="border-border text-foreground hover:bg-muted"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      <SupplierModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        supplier={selectedSupplier}
      />
    </div>
  );
}
