"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirmDialog } from "@/components/super-admin/ConfirmDialog";
import { QK } from "@/lib/queryKeys";
import { CURRENCY, getApiErrorMessage } from "@/lib/utils";
import {
  toppingService,
  type ToppingGroup,
  type Topping,
  type ToppingPriceMode,
  type ToppingSelectionMode,
} from "@/services/toppingService";

/**
 * Authoring for add-ons.
 *
 * The one field that deserves care is the price mode. FIXED means the server
 * always bills the price set here and ignores whatever the till sends; PROMPT is
 * an explicit licence for the cashier to type a price, bounded by the maximum.
 * Both are enforced server-side — this screen only decides which applies.
 */
export default function ToppingsPage() {
  const queryClient = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const { data: groups = [], isLoading } = useQuery({
    queryKey: QK.toppingGroups,
    queryFn: toppingService.getGroups,
  });

  const [newGroupName, setNewGroupName] = useState("");
  const [editingTopping, setEditingTopping] = useState<{ groupId: string; topping?: Topping } | null>(null);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: QK.toppingGroups });
    // The till caches which products have add-ons and each product's groups.
    await queryClient.invalidateQueries({ queryKey: QK.productsWithToppings });
    await queryClient.invalidateQueries({ queryKey: ["product-topping-groups"] });
  };

  const createGroup = useMutation({
    mutationFn: (name: string) =>
      toppingService.createGroup({ name, selectionMode: "MULTI", minSelect: 0, isActive: true }),
    onSuccess: async () => {
      setNewGroupName("");
      await invalidate();
      toast.success("Group created");
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, "Could not create the group")),
  });

  const updateGroup = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ToppingGroup> & { name: string } }) =>
      toppingService.updateGroup(id, {
        name: patch.name,
        selectionMode: patch.selectionMode,
        minSelect: patch.minSelect ?? 0,
        maxSelect: patch.maxSelect ?? null,
        isActive: patch.isActive ?? true,
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Group updated");
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, "Could not update the group")),
  });

  const deleteGroup = useMutation({
    mutationFn: (id: string) => toppingService.deleteGroup(id),
    onSuccess: async () => {
      await invalidate();
      toast.success("Group deleted");
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, "Could not delete the group")),
  });

  const saveTopping = useMutation({
    mutationFn: ({ id, data }: { id?: string; data: Parameters<typeof toppingService.createTopping>[0] }) =>
      id ? toppingService.updateTopping(id, data) : toppingService.createTopping(data),
    onSuccess: async () => {
      setEditingTopping(null);
      await invalidate();
      toast.success("Add-on saved");
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, "Could not save the add-on")),
  });

  const deleteTopping = useMutation({
    mutationFn: (id: string) => toppingService.deleteTopping(id),
    onSuccess: async () => {
      await invalidate();
      toast.success("Add-on deleted");
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, "Could not delete the add-on")),
  });

  const askDeleteGroup = async (group: ToppingGroup) => {
    const ok = await confirm({
      title: `Delete "${group.name}"?`,
      description:
        "Its add-ons and every product attachment go with it. Sales already rung keep their printed names, so past receipts are unaffected.",
      confirmLabel: "Delete group",
      variant: "destructive",
    });
    if (ok) deleteGroup.mutate(group.id);
  };

  return (
    <div className="space-y-6">
      {confirmDialog}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Add-ons</h1>
          <p className="text-sm text-muted-foreground">
            Extras the till offers on a dish — extra cheese, onions, sauces.
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newGroupName.trim()) {
              toast.error("Name the group first");
              return;
            }
            createGroup.mutate(newGroupName.trim());
          }}
        >
          <Input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="New group, e.g. Extras"
            className="w-56 bg-background"
          />
          <Button type="submit" disabled={createGroup.isPending}>
            <Plus size={16} className="mr-1" /> Add group
          </Button>
        </form>
      </header>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && groups.length === 0 && (
        <Card className="bg-card border-border">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No add-on groups yet. Create one above, then attach it to a product
            from that product&apos;s edit page.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((group) => (
          <Card key={group.id} className="bg-card border-border">
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              <div className="min-w-0">
                <CardTitle className="text-lg truncate">{group.name}</CardTitle>
                <p className="text-[11px] text-muted-foreground">
                  {group.selectionMode === "SINGLE" ? "Pick one" : "Pick any"}
                  {group.minSelect > 0 ? ` · min ${group.minSelect}` : ""}
                  {group.maxSelect != null ? ` · max ${group.maxSelect}` : ""}
                  {group.isActive ? "" : " · inactive"}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateGroup.mutate({
                      id: group.id,
                      patch: {
                        ...group,
                        selectionMode: (group.selectionMode === "SINGLE" ? "MULTI" : "SINGLE") as ToppingSelectionMode,
                      },
                    })
                  }
                >
                  {group.selectionMode === "SINGLE" ? "Pick one" : "Pick any"}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={`Delete ${group.name}`}
                  onClick={() => askDeleteGroup(group)}
                >
                  <Trash2 size={15} className="text-destructive" />
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-2">
              {group.toppings.length === 0 && (
                <p className="text-xs text-muted-foreground">No add-ons in this group yet.</p>
              )}

              {group.toppings.map((topping) => (
                <div
                  key={topping.id}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <span className="flex-1 truncate text-sm">{topping.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {topping.priceMode === "PROMPT"
                      ? `typed · max ${topping.maxPrice != null ? topping.maxPrice.toFixed(2) : "—"}`
                      : `${CURRENCY.symbol} ${topping.defaultPrice.toFixed(2)}`}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${topping.name}`}
                    onClick={() => setEditingTopping({ groupId: group.id, topping })}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${topping.name}`}
                    onClick={() => deleteTopping.mutate(topping.id)}
                  >
                    <Trash2 size={14} className="text-destructive" />
                  </Button>
                </div>
              ))}

              {editingTopping?.groupId === group.id ? (
                <ToppingEditor
                  groupId={group.id}
                  topping={editingTopping.topping}
                  pending={saveTopping.isPending}
                  onCancel={() => setEditingTopping(null)}
                  onSave={(data, id) => saveTopping.mutate({ id, data })}
                />
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setEditingTopping({ groupId: group.id })}
                >
                  <Plus size={15} className="mr-1" /> Add an option
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ToppingEditor({
  groupId,
  topping,
  pending,
  onCancel,
  onSave,
}: {
  groupId: string;
  topping?: Topping;
  pending: boolean;
  onCancel: () => void;
  onSave: (data: Parameters<typeof toppingService.createTopping>[0], id?: string) => void;
}) {
  const [name, setName] = useState(topping?.name ?? "");
  const [priceMode, setPriceMode] = useState<ToppingPriceMode>(topping?.priceMode ?? "FIXED");
  const [defaultPrice, setDefaultPrice] = useState(String(topping?.defaultPrice ?? 0));
  const [maxPrice, setMaxPrice] = useState(topping?.maxPrice != null ? String(topping.maxPrice) : "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(defaultPrice);
    if (!name.trim()) {
      toast.error("Name the add-on");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Enter a valid price");
      return;
    }
    const cap = maxPrice.trim() === "" ? null : parseFloat(maxPrice);
    if (priceMode === "PROMPT" && cap != null && (!Number.isFinite(cap) || cap < price)) {
      toast.error("The maximum cannot be below the suggested price");
      return;
    }
    onSave(
      {
        groupId,
        name: name.trim(),
        priceMode,
        defaultPrice: price,
        maxPrice: priceMode === "PROMPT" ? cap : null,
        isActive: topping?.isActive ?? true,
      },
      topping?.id,
    );
  };

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-primary/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">{topping ? "Edit add-on" : "New add-on"}</span>
        <Button type="button" variant="ghost" size="icon" onClick={onCancel} aria-label="Cancel">
          <X size={14} />
        </Button>
      </div>

      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Extra cheese"
        className="bg-background"
      />

      <div className="flex gap-2">
        <Button
          type="button"
          variant={priceMode === "FIXED" ? "default" : "outline"}
          size="sm"
          className="flex-1"
          onClick={() => setPriceMode("FIXED")}
        >
          Fixed price
        </Button>
        <Button
          type="button"
          variant={priceMode === "PROMPT" ? "default" : "outline"}
          size="sm"
          className="flex-1"
          onClick={() => setPriceMode("PROMPT")}
        >
          Typed at order
        </Button>
      </div>

      <div className="flex gap-2">
        <label className="flex-1 space-y-1">
          <span className="text-[11px] text-muted-foreground">
            {priceMode === "PROMPT" ? "Suggested price" : "Price"}
          </span>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={defaultPrice}
            onChange={(e) => setDefaultPrice(e.target.value)}
            className="bg-background"
          />
        </label>
        {priceMode === "PROMPT" && (
          <label className="flex-1 space-y-1">
            <span className="text-[11px] text-muted-foreground">Maximum (optional)</span>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="bg-background"
            />
          </label>
        )}
      </div>

      {priceMode === "PROMPT" && (
        <p className="text-[11px] text-muted-foreground">
          The cashier types this price at the till. The server still refuses
          anything above the maximum.
        </p>
      )}

      <Button type="submit" size="sm" className="w-full" disabled={pending}>
        Save
      </Button>
    </form>
  );
}
