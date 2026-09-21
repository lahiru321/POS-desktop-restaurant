"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, X, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirmDialog } from "@/components/super-admin/ConfirmDialog";
import { QK } from "@/lib/queryKeys";
import { getApiErrorMessage } from "@/lib/utils";
import {
  tableService,
  type RestaurantArea,
  type RestaurantTable,
  type TableRequest,
  type TableStatus,
} from "@/services/tableService";

/**
 * Authoring for the floor: areas ("Ground Floor", "Terrace") and the tables in
 * them.
 *
 * The field this screen deliberately does NOT offer is status. A table is
 * OCCUPIED because an order was opened on it and AVAILABLE because that order
 * was settled or voided — the order lifecycle owns it, and no request shape
 * carries it. Letting an admin flip it here would let the floor disagree with
 * the tabs it is meant to reflect, so status is rendered read-only.
 *
 * Deletes that would orphan something are refused by the server (an area that
 * still has tables, a table with an open tab); that message is surfaced as-is
 * rather than rewritten, because it says exactly what has to be cleared first.
 */
export default function TablesPage() {
  const queryClient = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const { data: areas = [], isLoading } = useQuery({
    queryKey: QK.restaurantAreas,
    queryFn: tableService.getAreas,
  });

  const [newAreaName, setNewAreaName] = useState("");
  const [renamingArea, setRenamingArea] = useState<RestaurantArea | null>(null);
  const [editingTable, setEditingTable] = useState<{ areaId: string; table?: RestaurantTable } | null>(null);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: QK.restaurantAreas });
    // Prefix match: the floor view keys tables by area, so every variant goes.
    await queryClient.invalidateQueries({ queryKey: ["restaurant-tables"] });
  };

  const createArea = useMutation({
    mutationFn: (name: string) =>
      tableService.createArea({ name, sortOrder: areas.length, isActive: true }),
    onSuccess: async () => {
      setNewAreaName("");
      await invalidate();
      toast.success("Area created");
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, "Could not create the area")),
  });

  const updateArea = useMutation({
    mutationFn: ({
      id,
      name,
      isActive,
      sortOrder,
    }: {
      id: string;
      name: string;
      isActive: boolean;
      sortOrder: number;
    }) => tableService.updateArea(id, { name, sortOrder, isActive }),
    onSuccess: async () => {
      setRenamingArea(null);
      await invalidate();
      toast.success("Area updated");
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, "Could not update the area")),
  });

  const deleteArea = useMutation({
    mutationFn: (id: string) => tableService.deleteArea(id),
    onSuccess: async () => {
      await invalidate();
      toast.success("Area deleted");
    },
    // The server refuses an area that still has tables — show which, verbatim.
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, "Could not delete the area")),
  });

  const saveTable = useMutation({
    mutationFn: ({ id, data }: { id?: string; data: TableRequest }) =>
      id ? tableService.updateTable(id, data) : tableService.createTable(data),
    onSuccess: async () => {
      setEditingTable(null);
      await invalidate();
      toast.success("Table saved");
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, "Could not save the table")),
  });

  const deleteTable = useMutation({
    mutationFn: (id: string) => tableService.deleteTable(id),
    onSuccess: async () => {
      await invalidate();
      toast.success("Table deleted");
    },
    // "This table has an open tab. Settle or void it first." — never swallowed.
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, "Could not delete the table")),
  });

  const askDeleteArea = async (area: RestaurantArea) => {
    const ok = await confirm({
      title: `Delete "${area.name}"?`,
      description:
        "An area can only go once it is empty. Move or delete its tables first — the server refuses otherwise.",
      confirmLabel: "Delete area",
      variant: "destructive",
    });
    if (ok) deleteArea.mutate(area.id);
  };

  const askDeleteTable = async (table: RestaurantTable) => {
    const ok = await confirm({
      title: `Delete "${table.name}"?`,
      description:
        "A table with an open tab cannot be deleted — settle or void the tab first. Sales already rung keep their table name either way.",
      confirmLabel: "Delete table",
      variant: "destructive",
    });
    if (ok) deleteTable.mutate(table.id);
  };

  return (
    <div className="space-y-6 p-6">
      {confirmDialog}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tables</h1>
          <p className="text-sm text-muted-foreground">
            The floor the till seats guests on — areas, and the tables in them.
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newAreaName.trim()) {
              toast.error("Name the area first");
              return;
            }
            createArea.mutate(newAreaName.trim());
          }}
        >
          <Input
            value={newAreaName}
            onChange={(e) => setNewAreaName(e.target.value)}
            placeholder="New area, e.g. Terrace"
            maxLength={100}
            className="w-56 bg-background"
          />
          <Button type="submit" disabled={createArea.isPending}>
            <Plus size={16} className="mr-1" /> Add area
          </Button>
        </form>
      </header>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && areas.length === 0 && (
        <Card className="bg-card border-border">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No areas yet. Create one above — &quot;Ground Floor&quot; is a fine
            start — then add its tables.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {areas.map((area) => (
          <Card key={area.id} className="bg-card border-border">
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              {renamingArea?.id === area.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = renamingArea.name.trim();
                    if (!name) {
                      toast.error("Name the area");
                      return;
                    }
                    updateArea.mutate({
                      id: area.id,
                      name,
                      isActive: area.isActive,
                      sortOrder: area.sortOrder,
                    });
                  }}
                >
                  <Input
                    value={renamingArea.name}
                    onChange={(e) => setRenamingArea({ ...renamingArea, name: e.target.value })}
                    maxLength={100}
                    autoFocus
                    className="h-9 bg-background"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    aria-label="Save area name"
                    disabled={updateArea.isPending}
                  >
                    <Check size={15} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    aria-label="Cancel rename"
                    onClick={() => setRenamingArea(null)}
                  >
                    <X size={15} />
                  </Button>
                </form>
              ) : (
                <>
                  <div className="min-w-0">
                    <CardTitle className="text-lg truncate">{area.name}</CardTitle>
                    <p className="text-[11px] text-muted-foreground">
                      {area.tables.length === 1 ? "1 table" : `${area.tables.length} tables`}
                      {area.isActive ? "" : " · hidden from the floor"}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updateArea.isPending}
                      onClick={() =>
                        updateArea.mutate({
                          id: area.id,
                          name: area.name,
                          isActive: !area.isActive,
                          sortOrder: area.sortOrder,
                        })
                      }
                    >
                      {area.isActive ? "Active" : "Hidden"}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={`Rename ${area.name}`}
                      onClick={() => setRenamingArea(area)}
                    >
                      <Pencil size={15} />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={`Delete ${area.name}`}
                      onClick={() => askDeleteArea(area)}
                    >
                      <Trash2 size={15} className="text-destructive" />
                    </Button>
                  </div>
                </>
              )}
            </CardHeader>

            <CardContent className="space-y-2">
              {area.tables.length === 0 && (
                <p className="text-xs text-muted-foreground">No tables in this area yet.</p>
              )}

              {area.tables.map((table) => (
                <div
                  key={table.id}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <span className="flex-1 truncate text-sm">
                    {table.name}
                    {table.isActive ? "" : <span className="text-muted-foreground"> · hidden</span>}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {table.seats === 1 ? "1 seat" : `${table.seats} seats`}
                  </span>
                  <TableStatusBadge status={table.status} />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${table.name}`}
                    onClick={() => setEditingTable({ areaId: area.id, table })}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${table.name}`}
                    onClick={() => askDeleteTable(table)}
                  >
                    <Trash2 size={14} className="text-destructive" />
                  </Button>
                </div>
              ))}

              {editingTable?.areaId === area.id ? (
                <TableEditor
                  areaId={area.id}
                  table={editingTable.table}
                  nextSortOrder={area.tables.length}
                  pending={saveTable.isPending}
                  onCancel={() => setEditingTable(null)}
                  onSave={(data, id) => saveTable.mutate({ id, data })}
                />
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setEditingTable({ areaId: area.id })}
                >
                  <Plus size={15} className="mr-1" /> Add a table
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Read-only by design: the order lifecycle owns this, not this screen. */
function TableStatusBadge({ status }: { status: TableStatus }) {
  return status === "OCCUPIED" ? (
    <Badge variant="warning" title="An open tab is running on this table">
      Occupied
    </Badge>
  ) : (
    <Badge variant="success" title="No open tab — free to seat">
      Available
    </Badge>
  );
}

function TableEditor({
  areaId,
  table,
  nextSortOrder,
  pending,
  onCancel,
  onSave,
}: {
  areaId: string;
  table?: RestaurantTable;
  nextSortOrder: number;
  pending: boolean;
  onCancel: () => void;
  onSave: (data: TableRequest, id?: string) => void;
}) {
  const [name, setName] = useState(table?.name ?? "");
  const [seats, setSeats] = useState(String(table?.seats ?? 2));
  const [isActive, setIsActive] = useState(table?.isActive ?? true);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const covers = parseInt(seats, 10);
    if (!name.trim()) {
      toast.error("Name the table");
      return;
    }
    // Mirrors the server's @Positive / @Max(99) on seats.
    if (!Number.isFinite(covers) || covers < 1 || covers > 99) {
      toast.error("A table seats between 1 and 99");
      return;
    }
    onSave(
      {
        areaId,
        name: name.trim(),
        seats: covers,
        sortOrder: table?.sortOrder ?? nextSortOrder,
        isActive,
      },
      table?.id,
    );
  };

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-primary/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">{table ? "Edit table" : "New table"}</span>
        <Button type="button" variant="ghost" size="icon" onClick={onCancel} aria-label="Cancel">
          <X size={14} />
        </Button>
      </div>

      <div className="flex gap-2">
        <label className="flex-1 space-y-1">
          <span className="text-[11px] text-muted-foreground">Name</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="T1"
            maxLength={50}
            className="bg-background"
          />
        </label>
        <label className="w-24 space-y-1">
          <span className="text-[11px] text-muted-foreground">Seats</span>
          <Input
            type="number"
            min="1"
            max="99"
            step="1"
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            className="bg-background"
          />
        </label>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant={isActive ? "default" : "outline"}
          size="sm"
          className="flex-1"
          onClick={() => setIsActive(true)}
        >
          On the floor
        </Button>
        <Button
          type="button"
          variant={!isActive ? "default" : "outline"}
          size="sm"
          className="flex-1"
          onClick={() => setIsActive(false)}
        >
          Hidden
        </Button>
      </div>

      {table && (
        <p className="text-[11px] text-muted-foreground">
          Status follows the tab on this table — seating marks it occupied,
          settling frees it — so it cannot be set here.
        </p>
      )}

      <Button type="submit" size="sm" className="w-full" disabled={pending}>
        Save
      </Button>
    </form>
  );
}
