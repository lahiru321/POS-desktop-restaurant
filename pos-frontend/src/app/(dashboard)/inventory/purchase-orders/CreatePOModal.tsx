import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { purchaseOrderService, PurchaseOrderRequest } from "@/services/purchaseOrderService";
import { supplierService } from "@/services/supplierService";
import { branchService } from "@/services/branchService";
import { inventoryService } from "@/services/inventoryService";
import { ingredientService } from "@/services/ingredientService";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Truck, Trash2 } from "lucide-react";
import { CURRENCY } from '@/lib/utils';
import { QK } from "@/lib/queryKeys";
import { hasAtMostDecimals, unitShort } from "@/lib/ingredientUnits";

interface CreatePOModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type LineKind = "INGREDIENT" | "PRODUCT";

/** One order line: an ingredient (any quantity to 3 places) or a packaged menu item (whole units). */
interface OrderLine {
  key: string;
  kind: LineKind;
  refId: string;
  name: string;
  /** KG, L, ... for an ingredient; PCS for a packaged item. */
  unit: string;
  quantity: number;
  unitCost: number;
}

export function CreatePOModal({ isOpen, onClose }: CreatePOModalProps) {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<OrderLine[]>([]);
  const [pickerKind, setPickerKind] = useState<LineKind>("INGREDIENT");

  // Fetch Suppliers
  const { data: suppliersData } = useQuery({
    queryKey: ["suppliers-all"],
    queryFn: () => supplierService.getSuppliers(0, 100),
    enabled: isOpen,
  });

  // Fetch the branches this user may order for (delivery branch is enforced server-side).
  const { data: branches } = useQuery({
    queryKey: ["branches", "me"],
    queryFn: branchService.getMyBranches,
    enabled: isOpen,
  });

  const { data: ingredientsData } = useQuery({
    queryKey: QK.ingredientList("", false),
    queryFn: () => ingredientService.getIngredients(undefined, false),
    enabled: isOpen,
  });

  // Fetch Products
  const { data: productsData } = useQuery({
    queryKey: ["products-all"],
    queryFn: () => inventoryService.getProducts(0, 1000), // Get a decent chunk of products
    enabled: isOpen,
  });

  const suppliers = (suppliersData?.content || []).filter(s => s.isActive);
  // The selected supplier's own ingredients first — they are what this order is most likely for.
  const ingredients = [...(ingredientsData || [])].sort((a, b) =>
    Number(b.primarySupplierId === supplierId) - Number(a.primarySupplierId === supplierId));
  // A made-to-order dish has no stock to buy; the server refuses it too.
  const packagedItems = (productsData?.content || []).filter(p => p.trackStock && p.isActive);

  // Reset form when opened Let's rely on standard resets.
  useEffect(() => {
    if (isOpen) {
      setSupplierId("");
      setBranchId("");
      setExpectedDate("");
      setNotes("");
      setItems([]);
      setPickerKind("INGREDIENT");
    }
  }, [isOpen]);

  const addLine = (line: Omit<OrderLine, "key" | "quantity">) => {
    const key = `${line.kind}:${line.refId}`;
    if (items.some(i => i.key === key)) {
      toast.error(`${line.name} is already on this order.`);
      return;
    }
    setItems([...items, { ...line, key, quantity: 1 }]);
  };

  const addIngredient = (id: string) => {
    const ingredient = ingredients.find(i => i.id === id);
    if (!ingredient) return;
    addLine({
      kind: "INGREDIENT",
      refId: ingredient.id,
      name: ingredient.name,
      unit: ingredient.unit,
      unitCost: ingredient.costPerUnit || 0,
    });
  };

  const addProduct = (id: string) => {
    const product = packagedItems.find(p => p.id === id);
    if (!product) return;
    addLine({
      kind: "PRODUCT",
      refId: product.id,
      name: product.name,
      unit: "PCS",
      unitCost: product.costPrice || 0,
    });
  };

  const removeLine = (key: string) => {
    setItems(items.filter(i => i.key !== key));
  };

  const updateItemQty = (key: string, qty: number) => {
    setItems(items.map(i => i.key === key ? { ...i, quantity: qty } : i));
  };

  const updateItemCost = (key: string, cost: number) => {
    setItems(items.map(i => i.key === key ? { ...i, unitCost: cost } : i));
  };

  const createMutation = useMutation({
    mutationFn: (data: PurchaseOrderRequest) => purchaseOrderService.createPurchaseOrder(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success("Purchase order created successfully and saved as DRAFT");
      onClose();
    },
    onError: (error: unknown) => {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to create purchase order");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId || !branchId || items.length === 0) {
      toast.error("Please fill all required fields and add at least one item.");
      return;
    }
    for (const i of items) {
      const places = i.kind === "INGREDIENT" ? 3 : 0;
      if (!(i.quantity > 0) || !hasAtMostDecimals(i.quantity, places)) {
        toast.error(i.kind === "INGREDIENT"
          ? `${i.name}: enter a quantity above zero, to at most 3 decimal places.`
          : `${i.name}: packaged items are ordered in whole units.`);
        return;
      }
      if (!(i.unitCost >= 0) || !hasAtMostDecimals(i.unitCost, i.kind === "INGREDIENT" ? 4 : 2)) {
        toast.error(`${i.name}: check the unit cost.`);
        return;
      }
    }

    const requestData: PurchaseOrderRequest = {
      supplierId,
      branchId,
      expectedDate: expectedDate ? `${expectedDate}T00:00:00` : undefined,
      notes,
      items: items.map(i => ({
        ...(i.kind === "INGREDIENT" ? { ingredientId: i.refId } : { productId: i.refId }),
        quantity: i.quantity,
        unitCost: i.unitCost
      }))
    };

    createMutation.mutate(requestData);
  };

  const totalAmount = items.reduce((acc, current) => acc + (current.quantity * current.unitCost), 0);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[760px] h-[90vh] flex flex-col bg-card border-border text-foreground p-0">
        <DialogHeader className="p-6 pb-2 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Truck className="h-5 w-5 text-primary" />
            Create Purchase Order
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <ScrollArea className="flex-1 p-6">
            <div className="space-y-6">
              {/* Header Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Supplier *</Label>
                  <Select value={supplierId} onValueChange={setSupplierId}>
                    <SelectTrigger className="bg-background border-border">
                      <SelectValue placeholder="Select Supplier" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border text-foreground">
                      {suppliers.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Delivery Branch *</Label>
                  <Select value={branchId} onValueChange={setBranchId}>
                    <SelectTrigger className="bg-background border-border">
                      <SelectValue placeholder="Select Branch" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border text-foreground">
                      {branches?.map(b => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Expected Date</Label>
                  <Input
                    type="date"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                    className="bg-background border-border [color-scheme:dark]"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Input
                    placeholder="Optional remarks..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="bg-background border-border"
                  />
                </div>
              </div>

              {/* Items Section */}
              <div className="space-y-4 pt-4 border-t border-border">
                <div className="flex justify-between items-center gap-3 flex-wrap">
                  <Label className="text-lg font-semibold">Order Items</Label>
                  <div className="flex items-center gap-2">
                    <Tabs value={pickerKind} onValueChange={(v) => setPickerKind(v as LineKind)}>
                      <TabsList className="h-8">
                        <TabsTrigger value="INGREDIENT" className="text-xs h-6">Ingredients</TabsTrigger>
                        <TabsTrigger value="PRODUCT" className="text-xs h-6">Packaged items</TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <div className="w-[260px]">
                      {pickerKind === "INGREDIENT" ? (
                        <Select onValueChange={addIngredient} value="">
                          <SelectTrigger className="bg-background border-border h-8" aria-label="Add an ingredient">
                            <SelectValue placeholder={ingredients.length ? "+ Add ingredient..." : "No ingredients yet"} />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-border text-foreground">
                            {ingredients.map(i => (
                              <SelectItem key={i.id} value={i.id}>{i.name} ({unitShort(i.unit)})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Select onValueChange={addProduct} value="">
                          <SelectTrigger className="bg-background border-border h-8" aria-label="Add a packaged item">
                            <SelectValue placeholder={packagedItems.length ? "+ Add packaged item..." : "No stock-tracked items"} />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-border text-foreground">
                            {packagedItems.map(p => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                </div>

                {items.length === 0 ? (
                  <div className="text-center py-8 bg-background rounded border border-dashed border-border text-muted-foreground text-sm px-6">
                    Nothing added yet. Pick ingredients (rice, oil, vegetables) or packaged items
                    you resell (bottled drinks) from the dropdown above.
                  </div>
                ) : (
                  <div className="border border-border rounded-md overflow-hidden bg-background">
                    <table className="w-full text-sm">
                      <thead className="bg-card text-muted-foreground border-b border-border">
                        <tr>
                          <th className="text-left py-2 px-3 font-medium">Item</th>
                          <th className="text-left py-2 px-3 font-medium w-28">Unit Cost</th>
                          <th className="text-left py-2 px-3 font-medium w-32">Quantity</th>
                          <th className="text-right py-2 px-3 font-medium w-28">Total</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map(item => {
                          const isIngredient = item.kind === "INGREDIENT";
                          const unit = unitShort(item.unit);
                          return (
                          <tr key={item.key} className="border-b border-border/50 last:border-0 hover:bg-card/50 transition-colors">
                            <td className="py-2 px-3">
                              <div className="font-medium">{item.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {isIngredient ? "Ingredient" : "Packaged item"}
                              </div>
                            </td>
                            <td className="py-2 px-3">
                              <Input
                                type="number"
                                min="0"
                                step={isIngredient ? "0.0001" : "0.01"}
                                aria-label={`Cost per ${unit} for ${item.name}`}
                                className="h-8 bg-card border-border px-2"
                                value={item.unitCost}
                                onChange={(e) => updateItemCost(item.key, Number(e.target.value))}
                              />
                            </td>
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-1.5">
                                <Input
                                  type="number"
                                  min={isIngredient ? "0.001" : "1"}
                                  step={isIngredient ? "0.001" : "1"}
                                  aria-label={`Quantity of ${item.name}`}
                                  className="h-8 bg-card border-border px-2"
                                  value={item.quantity}
                                  onChange={(e) => updateItemQty(item.key, Number(e.target.value))}
                                />
                                <span className="text-xs text-muted-foreground w-7 shrink-0">{unit}</span>
                              </div>
                            </td>
                            <td className="py-2 px-3 text-right font-medium text-success">
                              {CURRENCY.symbol} {(item.quantity * item.unitCost).toFixed(2)}
                            </td>
                            <td className="py-2 px-2 text-center">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="Remove item"
                                title="Remove item"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                onClick={() => removeLine(item.key)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>

          <div className="p-4 border-t border-border bg-background flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">Total Order Amount</span>
              <span className="text-xl font-bold text-success">{CURRENCY.symbol} {totalAmount.toFixed(2)}</span>
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" onClick={onClose} className="border-border hover:bg-muted text-foreground">
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-[120px]">
                {createMutation.isPending ? "Saving..." : "Create Draft"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
