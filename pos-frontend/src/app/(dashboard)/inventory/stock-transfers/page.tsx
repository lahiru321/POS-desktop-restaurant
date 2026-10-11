"use client";
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, Plus, ArrowRightLeft, Flag, X } from 'lucide-react';
import { format } from 'date-fns';
import { stockTransferService } from '@/services/stockTransferService';
import { StockTransferModal } from '@/components/inventory/StockTransferModal';
import { toast } from 'sonner';
import { FeatureGuard } from '@/components/auth/FeatureGuard';
import { useConfirmDialog } from '@/components/super-admin/ConfirmDialog';

export default function StockTransfersPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const askInTransit = async (id: string) => {
    const ok = await confirm({
      title: 'Mark this transfer as In Transit?',
      description: 'Source-branch stock is reserved for this transfer. Destination branch will not see stock until completion.',
      confirmLabel: 'Mark In Transit',
    });
    if (ok) inTransitMutation.mutate(id);
  };

  const askComplete = async (id: string) => {
    const ok = await confirm({
      title: 'Complete this transfer?',
      description: 'This immediately moves stock from the source branch to the destination branch. Cannot be undone.',
      confirmLabel: 'Complete transfer',
    });
    if (ok) completeMutation.mutate(id);
  };

  const askCancel = async (id: string) => {
    const ok = await confirm({
      title: 'Cancel this transfer?',
      description: 'Any reserved stock will be returned to the source branch. The transfer record is preserved for audit.',
      confirmLabel: 'Cancel transfer',
      variant: 'destructive',
    });
    if (ok) cancelMutation.mutate(id);
  };

  const { data, isLoading } = useQuery({
    queryKey: ['stockTransfers', page, statusFilter],
    queryFn: () => stockTransferService.getTransfers(page, 10, statusFilter)
  });

  const completeMutation = useMutation({
    mutationFn: stockTransferService.completeTransfer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stockTransfers'] });
      toast.success("Transfer completed and stock updated");
    },
    onError: (err: unknown) => toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to complete transfer")
  });

  const inTransitMutation = useMutation({
    mutationFn: stockTransferService.markInTransit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stockTransfers'] });
      toast.success("Transfer marked as In Transit");
    },
    onError: (err: unknown) => toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to mark as in-transit")
  });

  const cancelMutation = useMutation({
    mutationFn: stockTransferService.cancelTransfer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stockTransfers'] });
      toast.success("Transfer cancelled");
    },
    onError: (err: unknown) => toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to cancel transfer")
  });

  const transfers = data?.content || [];
  const totalPages = data?.totalPages || 0;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <span className="px-3 py-1 rounded-full text-xs font-medium bg-warning/20 text-warning border border-warning/30">Pending</span>;
      case 'IN_TRANSIT':
        return <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-500 border border-blue-500/30">In Transit</span>;
      case 'COMPLETED':
        return <span className="px-3 py-1 rounded-full text-xs font-medium bg-success/20 text-success border border-success/30">Completed</span>;
      case 'CANCELLED':
        return <span className="px-3 py-1 rounded-full text-xs font-medium bg-destructive/20 text-destructive border border-destructive/30">Cancelled</span>;
      default:
        return null;
    }
  };

  return (
    <FeatureGuard
      feature="STOCK_TRANSFERS"
      fallback={
        <div className="flex h-full min-h-[500px] flex-col items-center justify-center p-8 text-center animate-in fade-in duration-500">
          <div className="rounded-full bg-destructive/10 p-4 mb-4">
            <ArrowRightLeft className="h-10 w-10 text-destructive" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight mb-2">Feature Not Available</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Your current subscription plan does not include access to the Stock Transfers module. 
            Please upgrade your workspace to manage multi-branch inventory movements.
          </p>
        </div>
      }
    >
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {confirmDialog}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ArrowRightLeft className="text-primary" size={28} />
            Stock Transfers
          </h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-2">
            Move inventory smoothly between your branches
          </p>
        </div>
        
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-all active:scale-95 shadow-lg shadow-primary/20"
        >
          <Plus size={18} />
          New Transfer
        </button>
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-border flex flex-wrap gap-4 items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Status:</label>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
              className="bg-background border border-border text-sm rounded-lg px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
            >
              <option value="">All</option>
              <option value="PENDING">Pending</option>
              <option value="IN_TRANSIT">In Transit</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-foreground">
            <thead className="bg-background/50 text-muted-foreground uppercase text-xs font-semibold">
              <tr>
                <th className="px-6 py-4">Transfer ID / Date</th>
                <th className="px-6 py-4">Item</th>
                <th className="px-6 py-4">Route</th>
                <th className="px-6 py-4 text-center">Qty</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">Loading transfers...</td>
                </tr>
              ) : transfers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <Truck size={48} className="mb-4 opacity-20" />
                      <p className="text-lg">No transfers found</p>
                      <p className="text-sm mt-1">Change filters or create a new transfer</p>
                    </div>
                  </td>
                </tr>
              ) : (
                transfers.map((transfer) => (
                  <tr key={transfer.id} className="hover:bg-muted/20 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="font-medium text-foreground" title={transfer.id}>TRF-{transfer.id.substring(0, 6).toUpperCase()}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {format(new Date(transfer.createdAt), "MMM d, yyyy h:mm a")}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-foreground">{transfer.productName}</div>
                      <div className="text-xs text-muted-foreground">SKU: {transfer.productSku}</div>
                      {transfer.notes && (
                        <div className="text-xs text-muted-foreground italic mt-1 line-clamp-1 truncate max-w-[150px]" title={transfer.notes}>
                          {transfer.notes}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-foreground bg-muted/50 px-2 py-1 rounded truncate max-w-[100px]" title={transfer.sourceBranchName}>
                          {transfer.sourceBranchName}
                        </span>
                        <ArrowRightLeft size={14} className="text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium text-primary bg-primary/10 px-2 py-1 rounded truncate max-w-[100px]" title={transfer.destinationBranchName}>
                          {transfer.destinationBranchName}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center font-semibold text-foreground">
                      {transfer.quantity}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {getStatusBadge(transfer.status)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {transfer.status === 'PENDING' && (
                          <button
                            onClick={() => askInTransit(transfer.id)}
                            className="bg-info/15 hover:bg-info/25 text-info p-2 rounded-lg transition-colors border border-info/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label="Mark transfer as In Transit"
                            title="Mark In Transit"
                          >
                            <Truck size={16} />
                          </button>
                        )}
                        {(transfer.status === 'PENDING' || transfer.status === 'IN_TRANSIT') && (
                          <button
                            onClick={() => askComplete(transfer.id)}
                            className="bg-success/20 hover:bg-success/30 text-success p-2 rounded-lg transition-colors border border-success/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label="Complete transfer"
                            title="Complete Transfer"
                          >
                            <Flag size={16} />
                          </button>
                        )}
                        {(transfer.status === 'PENDING' || transfer.status === 'IN_TRANSIT') && (
                          <button
                            onClick={() => askCancel(transfer.id)}
                            className="bg-destructive/10 hover:bg-destructive/20 text-destructive p-2 rounded-lg transition-colors border border-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label="Cancel transfer"
                            title="Cancel Transfer"
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-border flex justify-between items-center bg-background/30">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-muted-foreground">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages - 1}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {isModalOpen && <StockTransferModal onClose={() => setIsModalOpen(false)} />}
    </div>
    </FeatureGuard>
  );
}
