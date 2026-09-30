"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eraser, LayoutGrid, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  autoPlace,
  editorBounds,
  layoutChanges,
  moveTable,
  positionsOf,
  type Cell,
  type Positions,
} from "@/lib/floorMap";
import { QK } from "@/lib/queryKeys";
import { cn, getApiErrorMessage } from "@/lib/utils";
import { tableService, type RestaurantArea, type RestaurantTable } from "@/services/tableService";

/** A press that travels further than this is a drag, not a tap. */
const DRAG_THRESHOLD_PX = 6;

interface DragState {
  tableId: string;
  x: number;
  y: number;
  /** "x,y" of the cell under the pointer, "tray", or null. */
  over: string | null;
}

/**
 * Lays out one area as a map: each table on a cell of a snap grid, as it
 * stands in the room. The till then draws the floor from this.
 *
 * Three ways to move a table, because a till is often a touchscreen:
 *  - **drag** it (mouse, pen or finger) onto a spot, or onto the tray below to
 *    take it off the map;
 *  - **tap** it, then tap a spot;
 *  - with a table selected, **arrow keys** nudge it and Delete takes it off.
 * Dropping on another table swaps the two. Nothing is saved until "Save
 * layout", which sends only what changed; the server checks the whole result.
 *
 * Pointer events rather than HTML drag-and-drop, which does not fire for touch.
 */
export function FloorLayoutEditor({ area, onClose }: { area: RestaurantArea; onClose: () => void }) {
  const queryClient = useQueryClient();
  const saved = useMemo(() => positionsOf(area.tables), [area.tables]);
  const [draft, setDraft] = useState<Positions>(saved);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const press = useRef<{ tableId: string; x: number; y: number } | null>(null);
  // Whether the current press has become a drag. A ref, not state: a quick flick
  // can move and release inside one frame, before a state update has rendered.
  const dragging = useRef(false);
  // A drag ends with a click on the same element; this swallows that click.
  const suppressClick = useRef(false);

  const byId = useMemo(() => new Map(area.tables.map((t) => [t.id, t])), [area.tables]);
  const { cols, rows } = editorBounds(draft);
  const placed = area.tables.filter((t) => draft[t.id]);
  const unplaced = area.tables.filter((t) => !draft[t.id]);
  const changes = layoutChanges(saved, draft);

  const save = useMutation({
    mutationFn: () => tableService.saveLayout(area.id, changes),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QK.restaurantAreas });
      toast.success(`${area.name} layout saved`);
      onClose();
    },
    // "T1 and T4 are on the same spot" — the server's words are the useful ones.
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, "Could not save the layout")),
  });

  const move = (tableId: string, to: Cell | null) => setDraft((d) => moveTable(d, tableId, to));

  // ── Taps ────────────────────────────────────────────────────────────
  const tapTable = (table: RestaurantTable) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const target = draft[table.id];
    if (selected && selected !== table.id && target) {
      move(selected, target); // swap
      setSelected(null);
      return;
    }
    setSelected(selected === table.id ? null : table.id);
  };

  const tapCell = (cell: Cell) => {
    if (!selected) return;
    move(selected, cell);
    setSelected(null);
  };

  const tapTray = () => {
    if (selected && draft[selected]) move(selected, null);
    setSelected(null);
  };

  // ── Keys ────────────────────────────────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!selected) return;
    const at = draft[selected];
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (e.key in step && at) {
      e.preventDefault();
      const [dx, dy] = step[e.key];
      move(selected, { x: at.x + dx, y: at.y + dy });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      move(selected, null);
    }
  };

  // ── Drag ────────────────────────────────────────────────────────────
  const dropTargetAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y);
    const cell = el?.closest<HTMLElement>("[data-cell]");
    if (cell) return cell.dataset.cell ?? null;
    return el?.closest("[data-tray]") ? "tray" : null;
  };

  const onPointerDown = (e: React.PointerEvent, tableId: string) => {
    if (e.button !== 0) return;
    press.current = { tableId, x: e.clientX, y: e.clientY };
    dragging.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const start = press.current;
    if (!start) return;
    if (!dragging.current && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD_PX) return;
    dragging.current = true;
    setDrag({ tableId: start.tableId, x: e.clientX, y: e.clientY, over: dropTargetAt(e.clientX, e.clientY) });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const start = press.current;
    press.current = null;
    if (!start || !dragging.current) return; // a tap — onClick handles it
    dragging.current = false;
    suppressClick.current = true;
    const target = dropTargetAt(e.clientX, e.clientY);
    if (target === "tray") move(start.tableId, null);
    else if (target) {
      const [x, y] = target.split(",").map(Number);
      move(start.tableId, { x, y });
    }
    setDrag(null);
    setSelected(null);
  };

  const onPointerCancel = () => {
    press.current = null;
    dragging.current = false;
    setDrag(null);
  };

  const tableButton = (table: RestaurantTable, inTray: boolean) => {
    const cell = draft[table.id];
    const isSelected = selected === table.id;
    return (
      <button
        key={table.id}
        type="button"
        data-table={table.name}
        aria-pressed={isSelected}
        aria-label={`${table.name}, ${
          cell ? `column ${cell.x + 1}, row ${cell.y + 1}` : "not on the map"
        }${table.isActive ? "" : ", hidden"}`}
        onClick={() => tapTable(table)}
        onPointerDown={(e) => onPointerDown(e, table.id)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className={cn(
          "flex touch-none select-none flex-col items-center justify-center rounded-xl border-2 text-center transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          inTray ? "h-16 w-20" : "h-full w-full",
          table.isActive ? "border-primary/50 bg-primary/10" : "border-dashed border-border bg-muted/40 opacity-70",
          isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
          drag?.tableId === table.id && "opacity-30",
          "cursor-grab active:cursor-grabbing",
        )}
      >
        <span className="max-w-full truncate px-1 text-sm font-bold">{table.name}</span>
        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
          <Users size={10} />
          {table.seats}
          {!table.isActive && " · hidden"}
        </span>
      </button>
    );
  };

  const dragged = drag ? byId.get(drag.tableId) : undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-5xl"
        onEscapeKeyDown={(e) => {
          // First Escape drops the selection; only a second one closes.
          if (selected) {
            e.preventDefault();
            setSelected(null);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Arrange {area.name}</DialogTitle>
          <DialogDescription>
            Drag each table to where it stands in the room, or tap a table and then a spot. Dropping on
            another table swaps them. With a table selected, arrow keys move it and Delete takes it off the
            map.
          </DialogDescription>
        </DialogHeader>

        <div onKeyDown={onKeyDown} className="space-y-4">
          <div className="max-h-[55vh] overflow-auto rounded-xl border border-border bg-muted/20 p-2">
            <div
              role="grid"
              aria-label={`${area.name} floor map`}
              className="grid gap-1.5"
              style={{
                gridTemplateColumns: `repeat(${cols}, 5.5rem)`,
                gridTemplateRows: `repeat(${rows}, 4.5rem)`,
              }}
            >
              {Array.from({ length: rows * cols }, (_, i) => {
                const cell = { x: i % cols, y: Math.floor(i / cols) };
                const key = `${cell.x},${cell.y}`;
                const occupant = placed.find((t) => {
                  const c = draft[t.id];
                  return c && c.x === cell.x && c.y === cell.y;
                });
                return (
                  <div
                    key={key}
                    data-cell={key}
                    className={cn(
                      "rounded-xl",
                      !occupant && "border border-dashed border-border/60",
                      drag?.over === key && "bg-primary/20 ring-2 ring-primary",
                    )}
                  >
                    {occupant ? (
                      tableButton(occupant, false)
                    ) : (
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={`Empty spot, column ${cell.x + 1}, row ${cell.y + 1}`}
                        onClick={() => tapCell(cell)}
                        className={cn(
                          "h-full w-full rounded-xl",
                          selected ? "cursor-pointer hover:bg-primary/10" : "cursor-default",
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div
            data-tray
            onClick={(e) => {
              if (e.target === e.currentTarget) tapTray();
            }}
            className={cn(
              "min-h-[5.5rem] rounded-xl border border-dashed border-border p-3 transition-colors",
              drag?.over === "tray" && "bg-primary/10 ring-2 ring-primary",
              selected && draft[selected] && "cursor-pointer",
            )}
          >
            <p className="mb-2 text-xs text-muted-foreground" onClick={tapTray}>
              {unplaced.length > 0
                ? `Not on the map (${unplaced.length}) — the till shows these as plain tiles under the map.`
                : "Every table is on the map. Drop a table here to take it off."}
            </p>
            <div className="flex flex-wrap gap-2">{unplaced.map((t) => tableButton(t, true))}</div>
          </div>
        </div>

        <DialogFooter className="flex-wrap items-center gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={unplaced.length === 0}
              onClick={() =>
                setDraft((d) => autoPlace(d, area.tables.map((t) => t.id), Math.max(cols - 1, 4)))
              }
            >
              <LayoutGrid size={14} className="mr-1" /> Place the rest
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={placed.length === 0}
              onClick={() => {
                setDraft(Object.fromEntries(area.tables.map((t) => [t.id, null])));
                setSelected(null);
              }}
            >
              <Eraser size={14} className="mr-1" /> Clear map
            </Button>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={changes.length === 0 || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save layout"}
            </Button>
          </div>
        </DialogFooter>

        {/* Follows the pointer; pointer-events-none so the drop target underneath is
            what gets hit. Portaled to <body>: the dialog is CSS-transformed, which
            would make "fixed" relative to it instead of to the screen. */}
        {drag && dragged && createPortal(
          <div
            aria-hidden
            className="pointer-events-none fixed z-[100] flex h-16 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border-2 border-primary bg-primary/30 text-sm font-bold shadow-lg"
            style={{ left: drag.x, top: drag.y }}
          >
            {dragged.name}
          </div>,
          document.body,
        )}
      </DialogContent>
    </Dialog>
  );
}
