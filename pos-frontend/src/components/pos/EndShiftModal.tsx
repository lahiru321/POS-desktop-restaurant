"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cashSessionService, CashSession } from "@/services/cashSessionService";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Wallet, Loader2 } from "lucide-react";
import { cn, fc, CURRENCY } from "@/lib/utils";
import { QK } from "@/lib/queryKeys";

interface EndShiftModalProps {
  open: boolean;
  onClose: () => void;
  onEnded?: (session: CashSession) => void;
}

const formatCurrency = (n: number | null | undefined) => fc(n ?? 0);

export function EndShiftModal({ open, onClose, onEnded }: EndShiftModalProps) {
  const queryClient = useQueryClient();
  const [closingBalance, setClosingBalance] = useState<string>("");
  const [notes, setNotes] = useState("");

  const { data: active, isLoading } = useQuery({
    queryKey: QK.cashSessionActive,
    queryFn: () => cashSessionService.getActive(),
    enabled: open,
  });

  const expected = useMemo(() => {
    if (!active) return 0;
    return (active.openingBalance ?? 0) + (active.cashSalesTotal ?? 0)
      + (active.cashRepaymentsTotal ?? 0) - (active.cashRefundsTotal ?? 0);
  }, [active]);

  const varianceLive = useMemo(() => {
    const actual = Number(closingBalance);
    if (!Number.isFinite(actual)) return null;
    return actual - expected;
  }, [closingBalance, expected]);

  const endMutation = useMutation({
    mutationFn: () => cashSessionService.end(Number(closingBalance), notes || undefined),
    onSuccess: (session) => {
      const variance = session.variance ?? 0;
      if (Math.abs(variance) < 0.01) {
        toast.success("Shift closed. Drawer balanced.");
      } else if (variance > 0) {
        toast.success(`Shift closed. Drawer over by ${formatCurrency(variance)}.`);
      } else {
        toast.warning(`Shift closed. Drawer short by ${formatCurrency(Math.abs(variance))}.`);
      }
      // Flip the cached session to null synchronously so the terminal gate and
      // the logout "drawer still open" warning immediately see a closed drawer,
      // rather than waiting on the async refetch from invalidateQueries.
      queryClient.setQueryData(QK.cashSessionActive, null);
      queryClient.invalidateQueries({ queryKey: QK.cashSessionActive });
      queryClient.invalidateQueries({ queryKey: ["time-clock-status"] });
      onEnded?.(session);
      onClose();
    },
    onError: (error: unknown) => {
      toast.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          "Failed to end shift"
      );
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(closingBalance);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Enter a valid counted amount");
      return;
    }
    endMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[500px] bg-gray-900 border-gray-800 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            End shift &amp; count drawer
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Count every note and coin in the drawer, then enter the total. The system will compare
            it to what&apos;s expected based on your opening float and cash sales.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
          </div>
        ) : !active ? (
          <div className="text-center py-6 text-gray-400 text-sm">No open cash session found.</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="grid grid-cols-3 gap-3 rounded-lg bg-gray-950 border border-gray-800 p-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500">Opening</p>
                <p className="text-base font-mono font-semibold text-gray-200">
                  {formatCurrency(active.openingBalance)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500">Cash sales</p>
                <p data-testid="end-shift-cash-sales" className="text-base font-mono font-semibold text-success">
                  +{formatCurrency(active.cashSalesTotal)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500">Expected</p>
                <p data-testid="end-shift-expected" className="text-base font-mono font-semibold text-primary">
                  {formatCurrency(expected)}
                </p>
              </div>
            </div>
            {(active.cashRefundsTotal ?? 0) > 0 && (
              <div className="flex items-center justify-between rounded-lg bg-red-950/30 border border-red-900/30 px-3 py-2 text-sm">
                <span className="text-gray-400">Cash refunds issued this shift</span>
                <span className="font-mono font-semibold text-destructive">
                  -{formatCurrency(active.cashRefundsTotal)}
                </span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="closingBalance">Counted cash in drawer *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                  {CURRENCY.symbol}
                </span>
                <Input
                  id="closingBalance"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  autoFocus
                  value={closingBalance}
                  onChange={(e) => setClosingBalance(e.target.value)}
                  className="pl-10 bg-gray-950 border-gray-800 focus-visible:ring-primary text-lg font-mono"
                  placeholder="0.00"
                />
              </div>
              {closingBalance !== "" && varianceLive !== null && (
                <p
                  className={cn(
                    "text-xs font-mono",
                    Math.abs(varianceLive) < 0.01
                      ? "text-success"
                      : varianceLive > 0
                      ? "text-warning"
                      : "text-destructive"
                  )}
                >
                  {Math.abs(varianceLive) < 0.01
                    ? "Drawer balances exactly."
                    : varianceLive > 0
                    ? `Over by ${formatCurrency(varianceLive)}`
                    : `Short by ${formatCurrency(Math.abs(varianceLive))}`}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="endNotes">Notes (optional)</Label>
              <Textarea
                id="endNotes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="bg-gray-950 border-gray-800 focus-visible:ring-primary"
                placeholder="Explain any variance (e.g. tip float, voided refund in cash)"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={endMutation.isPending}
                className="border-gray-700 hover:bg-gray-800"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={endMutation.isPending}
                className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-[140px]"
              >
                {endMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "End Shift"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
