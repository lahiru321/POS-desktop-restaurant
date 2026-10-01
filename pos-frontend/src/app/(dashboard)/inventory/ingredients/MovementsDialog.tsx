import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { History, Loader2 } from "lucide-react";
import { ingredientService, Ingredient, IngredientMovementType } from "@/services/ingredientService";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QK } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { formatQty } from "@/lib/ingredientUnits";

const PAGE_SIZE = 15;

const TYPE_LABEL: Record<IngredientMovementType, { label: string; className: string }> = {
  PURCHASE: { label: "Received", className: "bg-success/10 text-success border-success/30" },
  WASTAGE: { label: "Wastage", className: "bg-destructive/10 text-destructive border-destructive/30" },
  COUNT: { label: "Stock count", className: "bg-primary/10 text-primary border-primary/30" },
  ADJUST: { label: "Adjustment", className: "bg-muted text-muted-foreground border-border" },
};

interface MovementsDialogProps {
  ingredient: Ingredient | null;
  /** The page's branch; empty = every branch the user can see. */
  branchId: string;
  onClose: () => void;
}

/** Every change to an ingredient's stock, newest first, with the balance after each. */
export function MovementsDialog({ ingredient, branchId, onClose }: MovementsDialogProps) {
  const [page, setPage] = useState(0);
  const isOpen = ingredient !== null;

  useEffect(() => {
    setPage(0);
  }, [ingredient?.id, branchId]);

  const { data, isLoading } = useQuery({
    queryKey: QK.ingredientMovements(ingredient?.id ?? "", branchId, page),
    queryFn: () => ingredientService.getMovements(ingredient!.id, branchId || undefined, page, PAGE_SIZE),
    enabled: isOpen,
  });

  if (!ingredient) return null;
  const rows = data?.content ?? [];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[760px] bg-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Stock history: {ingredient.name}
          </DialogTitle>
          <DialogDescription>
            Purchases received, wastage and stock counts{branchId ? " at this branch" : " across your branches"}.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border overflow-hidden max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-background/60 text-muted-foreground text-xs uppercase sticky top-0">
              <tr>
                <th className="text-left py-2 px-3 font-medium">When</th>
                <th className="text-left py-2 px-3 font-medium">What</th>
                {!branchId && <th className="text-left py-2 px-3 font-medium">Branch</th>}
                <th className="text-right py-2 px-3 font-medium">Change</th>
                <th className="text-right py-2 px-3 font-medium">Balance</th>
                <th className="text-left py-2 px-3 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-muted-foreground">
                    No stock movements yet. Receive a purchase order or do a stock count to start.
                  </td>
                </tr>
              ) : (
                rows.map((m) => {
                  const type = TYPE_LABEL[m.type];
                  return (
                    <tr key={m.id} className="border-t border-border/50">
                      <td className="py-2 px-3 whitespace-nowrap text-muted-foreground">
                        {format(new Date(m.createdAt), "dd MMM yyyy, HH:mm")}
                        {m.createdByName && <div className="text-xs">{m.createdByName}</div>}
                      </td>
                      <td className="py-2 px-3">
                        <Badge variant="outline" className={cn("font-medium", type.className)}>{type.label}</Badge>
                      </td>
                      {!branchId && <td className="py-2 px-3 text-muted-foreground">{m.branchName}</td>}
                      <td
                        className={cn(
                          "py-2 px-3 text-right font-semibold tabular-nums",
                          m.quantityChange > 0 ? "text-success" : m.quantityChange < 0 ? "text-destructive" : "text-muted-foreground"
                        )}
                      >
                        {m.quantityChange > 0 ? "+" : ""}
                        {formatQty(m.quantityChange, ingredient.unit)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{formatQty(m.quantityAfter, ingredient.unit)}</td>
                      <td className="py-2 px-3 text-muted-foreground">{m.reason || "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Page {page + 1} of {data.totalPages}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Newer
              </Button>
              <Button variant="outline" size="sm" disabled={data.last} onClick={() => setPage((p) => p + 1)}>
                Older
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
