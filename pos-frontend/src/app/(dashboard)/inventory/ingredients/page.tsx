"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Edit2, History, Loader2, MoreHorizontal, Plus, Trash, Wheat } from "lucide-react";
import { toast } from "sonner";
import { ingredientService, Ingredient } from "@/services/ingredientService";
import { branchService } from "@/services/branchService";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { FeatureGuard } from "@/components/auth/FeatureGuard";
import { apiErrorMessage } from "@/lib/apiError";
import { QK } from "@/lib/queryKeys";
import { cn, CURRENCY } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { formatQty, formatUnitCost, unitShort } from "@/lib/ingredientUnits";
import { IngredientModal } from "./IngredientModal";
import { AdjustStockDialog, type AdjustMode } from "./AdjustStockDialog";
import { MovementsDialog } from "./MovementsDialog";

const ALL_BRANCHES = "__all__";

export default function IngredientsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [branchId, setBranchId] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<{ ingredient: Ingredient; mode: AdjustMode } | null>(null);
  const [historyFor, setHistoryFor] = useState<Ingredient | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const { data: branches } = useQuery({
    queryKey: ["branches", "me"],
    queryFn: branchService.getMyBranches,
  });

  const { data, isLoading } = useQuery({
    queryKey: QK.ingredientList(branchId, showInactive),
    queryFn: () => ingredientService.getIngredients(branchId || undefined, showInactive),
  });

  const toggleStatus = useMutation({
    mutationFn: (id: string) => ingredientService.toggleStatus(id),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: QK.ingredients });
      toast.success(updated.isActive ? `${updated.name} reactivated` : `${updated.name} deactivated`, {
        description: updated.isActive ? undefined : "It won't appear when creating purchase orders.",
      });
    },
    onError: (error: unknown) => toast.error(apiErrorMessage(error, "Failed to update status")),
  });

  const all = data ?? [];
  const term = search.trim().toLowerCase();
  const rows = all.filter(
    (i) =>
      (!term || i.name.toLowerCase().includes(term) || (i.primarySupplierName ?? "").toLowerCase().includes(term)) &&
      (!lowOnly || i.isLowStock)
  );
  const lowCount = all.filter((i) => i.isActive && i.isLowStock).length;
  const totalValue = rows.reduce((sum, i) => sum + (i.stockValue ?? 0), 0);
  const multiBranch = (branches?.length ?? 0) > 1;

  const openNew = () => {
    setEditing(null);
    setIsModalOpen(true);
  };

  return (
    <FeatureGuard
      feature="INVENTORY"
      fallback={<div className="p-8 text-muted-foreground">Ingredients are not part of your plan.</div>}
    >
      <div className="p-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mb-2">Ingredients</h1>
            <p className="text-muted-foreground">
              What the kitchen buys: stock per branch, wastage and stock counts. Stock arrives by receiving a purchase order.
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Stock value{lowOnly || term ? " (shown)" : ""}</div>
            <div className="text-2xl font-bold text-foreground tabular-nums">{formatCurrency(totalValue)}</div>
          </div>
        </div>

        <DataTableToolbar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search ingredients or suppliers..."
          resultsCount={{ shown: rows.length, total: all.length, label: "ingredients" }}
          filters={
            <>
              {multiBranch && (
                <Select value={branchId || ALL_BRANCHES} onValueChange={(v) => setBranchId(v === ALL_BRANCHES ? "" : v)}>
                  <SelectTrigger className="w-[180px] bg-background border-border" aria-label="Branch">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-foreground">
                    <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
                    {branches?.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                variant={lowOnly ? "default" : "outline"}
                size="sm"
                onClick={() => setLowOnly((v) => !v)}
                aria-pressed={lowOnly}
                className="h-10"
              >
                Low stock{lowCount > 0 ? ` (${lowCount})` : ""}
              </Button>
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <Switch checked={showInactive} onCheckedChange={setShowInactive} aria-label="Show inactive ingredients" />
                Show inactive
              </label>
            </>
          }
          actions={
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" />
              Add ingredient
            </Button>
          }
        />

        <div className="bg-card border border-border rounded-lg p-4">
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader className="bg-background/50">
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead>Ingredient</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">In stock</TableHead>
                  <TableHead className="text-right">Low alert</TableHead>
                  <TableHead className="text-right">Cost / unit</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                      {all.length === 0 ? (
                        <div className="flex flex-col items-center gap-3">
                          <Wheat className="h-8 w-8 opacity-50" />
                          <span>No ingredients yet. Add the things you buy — rice, oil, vegetables, meat.</span>
                          <Button size="sm" variant="outline" onClick={openNew}>
                            <Plus className="mr-2 h-4 w-4" /> Add ingredient
                          </Button>
                        </div>
                      ) : (
                        "Nothing matches."
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((i) => (
                    <TableRow
                      key={i.id}
                      className={cn("border-border hover:bg-foreground/5", !i.isActive && "bg-background/60")}
                    >
                      <TableCell className="font-medium">
                        <span className={cn(i.isActive ? "text-foreground" : "text-muted-foreground line-through")}>
                          {i.name}
                        </span>
                        {i.primarySupplierName && (
                          <div className="text-xs text-muted-foreground font-normal">{i.primarySupplierName}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{unitShort(i.unit)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={cn("font-semibold", i.isLowStock ? "text-warning" : "text-foreground")}>
                          {formatQty(i.quantity, i.unit)}
                        </span>
                        {i.isLowStock && (
                          <Badge variant="outline" className="ml-2 border-warning/40 bg-warning/10 text-warning text-[10px]">
                            {i.quantity <= 0 ? "OUT" : "LOW"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {i.lowStockThreshold > 0 ? formatQty(i.lowStockThreshold, i.unit) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {CURRENCY.symbol} {formatUnitCost(i.costPerUnit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(i.stockValue ?? 0)}</TableCell>
                      <TableCell>
                        <Switch
                          checked={i.isActive}
                          disabled={toggleStatus.isPending && toggleStatus.variables === i.id}
                          onCheckedChange={() => toggleStatus.mutate(i.id)}
                          aria-label={`${i.isActive ? "Deactivate" : "Activate"} ${i.name}`}
                          className="data-[state=checked]:bg-success data-[state=unchecked]:bg-muted"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() => setAdjusting({ ingredient: i, mode: "COUNT" })}
                          >
                            <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" /> Count
                          </Button>
                          <Popover open={menuFor === i.id} onOpenChange={(open) => setMenuFor(open ? i.id : null)}>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for ${i.name}`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              align="end"
                              className="w-48 p-1 bg-card border-border"
                              onClick={() => setMenuFor(null)}
                            >
                              <RowAction icon={Trash} label="Record wastage" onClick={() => setAdjusting({ ingredient: i, mode: "WASTAGE" })} />
                              <RowAction icon={History} label="Stock history" onClick={() => setHistoryFor(i)} />
                              <RowAction
                                icon={Edit2}
                                label="Edit"
                                onClick={() => {
                                  setEditing(i);
                                  setIsModalOpen(true);
                                }}
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <IngredientModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} ingredient={editing} />
        <AdjustStockDialog
          ingredient={adjusting?.ingredient ?? null}
          mode={adjusting?.mode ?? "COUNT"}
          branchId={branchId || (branches?.length === 1 ? branches[0].id : "")}
          onClose={() => setAdjusting(null)}
        />
        <MovementsDialog ingredient={historyFor} branchId={branchId} onClose={() => setHistoryFor(null)} />
      </div>
    </FeatureGuard>
  );
}

function RowAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground hover:bg-muted"
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      {label}
    </button>
  );
}
