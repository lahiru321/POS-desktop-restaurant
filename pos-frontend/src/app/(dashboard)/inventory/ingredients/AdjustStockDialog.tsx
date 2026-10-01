import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Trash } from "lucide-react";
import { toast } from "sonner";
import { ingredientService, Ingredient } from "@/services/ingredientService";
import { branchService } from "@/services/branchService";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/apiError";
import { QK } from "@/lib/queryKeys";
import { formatQty, hasAtMostDecimals, unitShort } from "@/lib/ingredientUnits";

export type AdjustMode = "WASTAGE" | "COUNT";

interface AdjustStockDialogProps {
  ingredient: Ingredient | null;
  mode: AdjustMode;
  /** The page's branch; empty when it shows all branches, and the dialog then asks. */
  branchId: string;
  onClose: () => void;
}

const COPY: Record<AdjustMode, { title: string; field: string; hint: string; button: string }> = {
  WASTAGE: {
    title: "Record wastage",
    field: "Amount thrown away",
    hint: "Spoiled, burnt, dropped or expired. It comes off the stock.",
    button: "Record wastage",
  },
  COUNT: {
    title: "Stock count",
    field: "Counted on the shelf",
    hint: "What is physically there now. The difference from the system's figure is recorded as usage.",
    button: "Save count",
  },
};

/**
 * Wastage and stock counts — the two ways ingredient stock goes down (until recipes
 * deduct it on sale). Both act on one branch.
 */
export function AdjustStockDialog({ ingredient, mode, branchId, onClose }: AdjustStockDialogProps) {
  const queryClient = useQueryClient();
  const [targetBranch, setTargetBranch] = useState(branchId);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const isOpen = ingredient !== null;

  const { data: branches } = useQuery({
    queryKey: ["branches", "me"],
    queryFn: branchService.getMyBranches,
    enabled: isOpen,
  });

  useEffect(() => {
    if (!isOpen) return;
    setTargetBranch(branchId);
    setQuantity("");
    setReason("");
  }, [isOpen, branchId, mode]);

  // With only one branch there is nothing to ask.
  useEffect(() => {
    if (isOpen && !targetBranch && branches?.length === 1) setTargetBranch(branches[0].id);
  }, [isOpen, targetBranch, branches]);

  // What this branch holds now — the page may be showing the all-branch total.
  const { data: atBranch } = useQuery({
    queryKey: QK.ingredientList(targetBranch, true),
    queryFn: () => ingredientService.getIngredients(targetBranch, true),
    enabled: isOpen && !!targetBranch,
  });
  const onHand = atBranch?.find((i) => i.id === ingredient?.id)?.quantity;

  const mutation = useMutation({
    mutationFn: () =>
      ingredientService.adjustStock(ingredient!.id, {
        branchId: targetBranch,
        type: mode,
        quantity: Number(quantity),
        reason: reason.trim() || undefined,
      }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: QK.ingredients });
      toast.success(`${updated.name}: ${formatQty(updated.quantity, updated.unit)} in stock`);
      onClose();
    },
    onError: (error: unknown) => {
      toast.error(apiErrorMessage(error, "Could not update the stock"));
    },
  });

  if (!ingredient) return null;
  const copy = COPY[mode];
  const unit = unitShort(ingredient.unit);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = Number(quantity);
    if (!targetBranch) {
      toast.error("Choose the branch.");
      return;
    }
    if (quantity.trim() === "" || !hasAtMostDecimals(q, 3) || q < 0 || (mode === "WASTAGE" && q === 0)) {
      toast.error(mode === "WASTAGE"
        ? "Enter how much was wasted, to at most 3 decimal places."
        : "Enter the counted quantity (0 or more), to at most 3 decimal places.");
      return;
    }
    mutation.mutate();
  };

  const Icon = mode === "WASTAGE" ? Trash : ClipboardCheck;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[420px] bg-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            {copy.title}: {ingredient.name}
          </DialogTitle>
          <DialogDescription>{copy.hint}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {!branchId && (branches?.length ?? 0) > 1 && (
            <div className="space-y-2">
              <Label>Branch *</Label>
              <Select value={targetBranch} onValueChange={setTargetBranch}>
                <SelectTrigger className="bg-background border-border" aria-label="Branch">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-foreground">
                  {branches?.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {targetBranch && onHand !== undefined && (
            <p className="text-sm text-muted-foreground">
              In stock now: <span className="font-semibold text-foreground">{formatQty(onHand, ingredient.unit)}</span>
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="adj-qty">{copy.field} ({unit}) *</Label>
            <Input
              id="adj-qty"
              autoFocus
              type="number"
              min="0"
              step="0.001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="bg-background border-border text-lg font-semibold"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="adj-reason">Note</Label>
            <Input
              id="adj-reason"
              maxLength={255}
              placeholder={mode === "WASTAGE" ? "e.g. Spoiled overnight" : "e.g. Monday stock take"}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="bg-background border-border"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="border-border">
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending} className="min-w-[120px]">
              {mutation.isPending ? "Saving..." : copy.button}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
