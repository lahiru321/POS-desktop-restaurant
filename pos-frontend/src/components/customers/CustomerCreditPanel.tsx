'use client';

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Wallet, Loader2, CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import { creditService, CreditTransaction, RepaymentRequest } from '@/services/creditService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CURRENCY } from '@/lib/utils';

const PAYMENT_METHODS: RepaymentRequest['paymentMethod'][] = ['CASH', 'CARD', 'ONLINE'];

/**
 * Store-credit panel for a customer profile: current limit / outstanding /
 * available, a repayment recorder, and the credit ledger. Rendered only for
 * tenants with the STORE_CREDIT feature (gated by the caller).
 */
export function CustomerCreditPanel({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [repayOpen, setRepayOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<RepaymentRequest['paymentMethod']>('CASH');
  const [note, setNote] = useState('');

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['customer-credit-summary', customerId],
    queryFn: () => creditService.getSummary(customerId),
    enabled: !!customerId,
  });

  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: ['customer-credit-ledger', customerId, page],
    queryFn: () => creditService.getLedger(customerId, { page, size: 10 }),
    enabled: !!customerId,
  });

  const repayMutation = useMutation({
    mutationFn: (data: RepaymentRequest) => creditService.recordRepayment(customerId, data),
    onSuccess: () => {
      toast.success('Repayment recorded');
      setRepayOpen(false);
      setAmount('');
      setNote('');
      setMethod('CASH');
      queryClient.invalidateQueries({ queryKey: ['customer-credit-summary', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-credit-ledger', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
    },
    onError: (err: unknown) => {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.message ?? 'Failed to record repayment'
        : 'Failed to record repayment';
      toast.error(message);
    },
  });

  const outstanding = summary?.creditBalance ?? 0;
  const parsedAmount = parseFloat(amount) || 0;
  const submitDisabled =
    repayMutation.isPending || parsedAmount <= 0 || parsedAmount > outstanding;

  const submitRepayment = () => {
    if (submitDisabled) return;
    repayMutation.mutate({
      amount: parsedAmount,
      paymentMethod: method,
      description: note.trim() || undefined,
    });
  };

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryStat label="Credit Limit" value={summary?.creditLimit} loading={summaryLoading} />
        <SummaryStat
          label="Outstanding"
          value={summary?.creditBalance}
          loading={summaryLoading}
          emphasize={(summary?.creditBalance ?? 0) > 0}
        />
        <SummaryStat label="Available" value={summary?.availableCredit} loading={summaryLoading} />
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => setRepayOpen(true)}
          disabled={outstanding <= 0}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold gap-2"
        >
          <Wallet size={16} /> Record Repayment
        </Button>
      </div>

      {/* Ledger */}
      <Card className="bg-card border-border shadow-xl overflow-hidden">
        <CardHeader className="bg-muted/40 pb-4">
          <CardTitle className="text-lg font-bold text-foreground">Credit Activity</CardTitle>
          <CardDescription>Every charge and repayment on this account, newest first.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/60">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground font-bold uppercase text-[10px] tracking-widest pl-6">Date</TableHead>
                <TableHead className="text-muted-foreground font-bold uppercase text-[10px] tracking-widest">Activity</TableHead>
                <TableHead className="text-right text-muted-foreground font-bold uppercase text-[10px] tracking-widest">Amount</TableHead>
                <TableHead className="text-right text-muted-foreground font-bold uppercase text-[10px] tracking-widest pr-6">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledgerLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-64 text-center">
                    <Loader2 className="animate-spin text-primary inline-block" size={32} />
                  </TableCell>
                </TableRow>
              ) : !ledger || ledger.content.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-64 text-center text-muted-foreground">
                    <CreditCard size={48} className="opacity-10 mx-auto mb-2" />
                    <p className="font-medium">No credit activity yet.</p>
                    <p className="text-xs mt-1">Charges appear here when this customer buys on credit.</p>
                  </TableCell>
                </TableRow>
              ) : (
                ledger.content.map((tx: CreditTransaction) => (
                  <TableRow key={tx.id} className="border-border hover:bg-foreground/5 transition-colors">
                    <TableCell className="py-4 pl-6 text-foreground">
                      {format(new Date(tx.createdAt), 'dd MMM yyyy, HH:mm')}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`px-2 py-1 rounded text-[10px] font-bold ${
                          tx.type === 'REPAYMENT'
                            ? 'bg-success/10 text-success'
                            : tx.type === 'CHARGE'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {tx.type}
                      </span>
                      {tx.description && (
                        <span className="text-xs text-muted-foreground ml-2">{tx.description}</span>
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-bold tabular-nums ${tx.amount <= 0 ? 'text-success' : 'text-destructive'}`}>
                      {tx.amount > 0 ? '+' : ''}{CURRENCY.symbol} {tx.amount.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right pr-6 font-medium text-foreground tabular-nums">
                      {CURRENCY.symbol} {tx.balanceAfter.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {ledger && ledger.totalPages > 1 && (
            <div className="p-4 border-t border-border flex items-center justify-between">
              <p className="text-xs text-muted-foreground font-medium">
                Showing {(page * 10) + 1} to {Math.min((page + 1) * 10, ledger.totalElements)} of {ledger.totalElements} entries
              </p>
              <div className="flex gap-2">
                <Button
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                  variant="outline"
                  size="sm"
                  className="bg-background border-border text-muted-foreground h-8"
                >
                  Previous
                </Button>
                <Button
                  disabled={(page + 1) >= ledger.totalPages}
                  onClick={() => setPage(p => p + 1)}
                  variant="outline"
                  size="sm"
                  className="bg-background border-border text-muted-foreground h-8"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Repayment modal */}
      <Dialog open={repayOpen} onOpenChange={(o) => !o && setRepayOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Repayment</DialogTitle>
            <DialogDescription>
              Outstanding balance: {CURRENCY.symbol} {outstanding.toFixed(2)}. A cash repayment is added to the open cash drawer.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="repay-amount">Amount ({CURRENCY.symbol})</Label>
              <Input
                id="repay-amount"
                type="number"
                min={0}
                step="0.01"
                max={outstanding}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
              {parsedAmount > outstanding && (
                <p className="text-xs text-destructive">Amount exceeds the outstanding balance.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Method</Label>
              <div className="grid grid-cols-3 gap-2">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={`py-2 rounded-lg border text-sm font-semibold transition-colors ${
                      method === m
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'bg-muted/40 border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="repay-note">Note (optional)</Label>
              <Input
                id="repay-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Reference / remark"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRepayOpen(false)} disabled={repayMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={submitRepayment} disabled={submitDisabled} className="gap-2">
              {repayMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : <Wallet size={16} />}
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  loading,
  emphasize,
}: {
  label: string;
  value?: number;
  loading?: boolean;
  emphasize?: boolean;
}) {
  return (
    <Card className="bg-card border-border shadow-sm">
      <CardContent className="py-5 text-center">
        <p className="text-muted-foreground font-bold uppercase tracking-widest text-[10px] mb-1">{label}</p>
        {loading ? (
          <Loader2 className="animate-spin text-primary inline-block mt-2" size={20} />
        ) : (
          <p className={`text-2xl font-black tabular-nums ${emphasize ? 'text-destructive' : 'text-foreground'}`}>
            {CURRENCY.symbol} {(value ?? 0).toFixed(2)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
