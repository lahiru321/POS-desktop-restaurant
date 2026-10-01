import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wheat } from "lucide-react";
import { toast } from "sonner";
import { ingredientService, Ingredient, IngredientRequest, IngredientUnit } from "@/services/ingredientService";
import { supplierService } from "@/services/supplierService";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/apiError";
import { QK } from "@/lib/queryKeys";
import { CURRENCY } from "@/lib/utils";
import { INGREDIENT_UNITS, hasAtMostDecimals, unitShort } from "@/lib/ingredientUnits";

const NO_SUPPLIER = "__none__";

interface IngredientModalProps {
  isOpen: boolean;
  onClose: () => void;
  ingredient?: Ingredient | null;
}

/** Add or edit an ingredient. Stock is not set here: use Stock count, or receive a purchase order. */
export function IngredientModal({ isOpen, onClose, ingredient }: IngredientModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<IngredientUnit>("KG");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState("");
  const [supplierId, setSupplierId] = useState(NO_SUPPLIER);

  const { data: suppliersData } = useQuery({
    queryKey: ["suppliers-all"],
    queryFn: () => supplierService.getSuppliers(0, 100),
    enabled: isOpen,
  });
  const suppliers = (suppliersData?.content ?? []).filter(
    (s) => s.isActive || s.id === ingredient?.primarySupplierId
  );

  useEffect(() => {
    if (!isOpen) return;
    setName(ingredient?.name ?? "");
    setUnit(ingredient?.unit ?? "KG");
    setCostPerUnit(ingredient ? String(ingredient.costPerUnit) : "");
    setLowStockThreshold(ingredient?.lowStockThreshold ? String(ingredient.lowStockThreshold) : "");
    setSupplierId(ingredient?.primarySupplierId ?? NO_SUPPLIER);
  }, [ingredient, isOpen]);

  const saveMutation = useMutation({
    mutationFn: (data: IngredientRequest) =>
      ingredient ? ingredientService.updateIngredient(ingredient.id, data) : ingredientService.createIngredient(data),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: QK.ingredients });
      toast.success(ingredient ? `${saved.name} updated` : `${saved.name} added`);
      onClose();
    },
    onError: (error: unknown) => {
      toast.error(apiErrorMessage(error, "Could not save the ingredient"));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cost = costPerUnit.trim() === "" ? 0 : Number(costPerUnit);
    const threshold = lowStockThreshold.trim() === "" ? 0 : Number(lowStockThreshold);
    if (!name.trim()) {
      toast.error("Give the ingredient a name.");
      return;
    }
    if (!(cost >= 0) || !hasAtMostDecimals(cost, 4)) {
      toast.error("Cost per unit must be zero or more, to at most 4 decimal places.");
      return;
    }
    if (!(threshold >= 0) || !hasAtMostDecimals(threshold, 3)) {
      toast.error("Low-stock alert must be zero or more, to at most 3 decimal places.");
      return;
    }
    saveMutation.mutate({
      name: name.trim(),
      unit,
      costPerUnit: cost,
      lowStockThreshold: threshold,
      primarySupplierId: supplierId === NO_SUPPLIER ? null : supplierId,
    });
  };

  const short = unitShort(unit);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[460px] bg-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wheat className="h-5 w-5 text-primary" />
            {ingredient ? "Edit ingredient" : "Add ingredient"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="ing-name">Name *</Label>
            <Input
              id="ing-name"
              autoFocus
              placeholder="e.g. Basmati rice, Coconut oil, Eggs"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-background border-border"
            />
          </div>

          <div className="space-y-2">
            <Label>Unit *</Label>
            <Select value={unit} onValueChange={(v) => setUnit(v as IngredientUnit)}>
              <SelectTrigger className="bg-background border-border" aria-label="Unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border text-foreground">
                {INGREDIENT_UNITS.map((u) => (
                  <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              What you buy and count it in. Stock, costs and purchase orders all use this unit.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ing-cost">Cost per {short} ({CURRENCY.symbol})</Label>
              <Input
                id="ing-cost"
                type="number"
                min="0"
                step="0.0001"
                placeholder="0.00"
                value={costPerUnit}
                onChange={(e) => setCostPerUnit(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ing-low">Low-stock alert ({short})</Label>
              <Input
                id="ing-low"
                type="number"
                min="0"
                step="0.001"
                placeholder="Off"
                value={lowStockThreshold}
                onChange={(e) => setLowStockThreshold(e.target.value)}
                className="bg-background border-border"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Receiving a purchase order updates the cost to the latest price. Leave the alert empty to never warn.
          </p>

          <div className="space-y-2">
            <Label>Usual supplier</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="bg-background border-border" aria-label="Usual supplier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border text-foreground">
                <SelectItem value={NO_SUPPLIER}>None</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="border-border">
              Cancel
            </Button>
            <Button type="submit" disabled={saveMutation.isPending} className="min-w-[110px]">
              {saveMutation.isPending ? "Saving..." : ingredient ? "Save" : "Add ingredient"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
