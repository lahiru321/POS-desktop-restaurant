"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { toast } from "sonner";
import { branchService } from "@/services/branchService";
import { inventoryService } from "@/services/inventoryService";
import { stockTransferService, StockTransferRequest } from "@/services/stockTransferService";

interface StockTransferModalProps {
  onClose: () => void;
}

export function StockTransferModal({ onClose }: StockTransferModalProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<StockTransferRequest>({
    sourceBranchId: "",
    destinationBranchId: "",
    productId: "",
    quantity: 1,
    notes: ""
  });

  const { data: branchesData } = useQuery({
    queryKey: ["branches", "me"],
    queryFn: () => branchService.getMyBranches()
  });

  const { data: productsData } = useQuery({
    queryKey: ['products'],
    queryFn: () => inventoryService.getProducts(0, 500, { isActive: true })
  });

  const mutation = useMutation({
    mutationFn: stockTransferService.createTransfer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stockTransfers'] });
      toast.success("Stock transfer created successfully");
      onClose();
    },
    onError: (error: unknown) => {
      const msg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || "Failed to create transfer");
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.sourceBranchId === formData.destinationBranchId) {
      toast.error("Source and destination must be different");
      return;
    }
    mutation.mutate(formData);
  };

  const branches = branchesData?.filter(b => b.isActive) || [];
  // Only counted items have stock to move; a dish cooked to order has none.
  const products = (productsData?.content || []).filter(p => p.trackStock);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-background border border-border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-semibold text-foreground">New Stock Transfer</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Packaged item</label>
            <select
              required
              className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              value={formData.productId}
              onChange={(e) => setFormData({ ...formData, productId: e.target.value })}
            >
              <option value="" disabled>Select a packaged item...</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name} (SKU: {p.sku})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Source Branch</label>
              <select
                required
                className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                value={formData.sourceBranchId}
                onChange={(e) => setFormData({ ...formData, sourceBranchId: e.target.value })}
              >
                <option value="" disabled>Select source...</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Destination Branch</label>
              <select
                required
                className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                value={formData.destinationBranchId}
                onChange={(e) => setFormData({ ...formData, destinationBranchId: e.target.value })}
              >
                <option value="" disabled>Select destination...</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Quantity</label>
            <input
              type="number"
              min="1"
              required
              className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 1 })}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Notes (Optional)</label>
            <textarea
              className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all resize-none h-24"
              placeholder="Reason for transfer..."
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm font-medium text-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-5 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all active:scale-95 disabled:opacity-50"
            >
              {mutation.isPending ? "Creating..." : "Create Transfer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
