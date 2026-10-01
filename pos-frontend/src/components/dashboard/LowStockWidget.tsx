"use client";
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, MapPin, Wheat } from 'lucide-react';
import { inventoryService } from '@/services/inventoryService';
import { branchService } from '@/services/branchService';
import { ingredientService } from '@/services/ingredientService';
import { QK } from '@/lib/queryKeys';
import { formatQty } from '@/lib/ingredientUnits';

export function LowStockWidget() {
  const [branchId, setBranchId] = useState<string>('');
  
  const { data: branchesData } = useQuery({
    queryKey: QK.branches,
    queryFn: () => branchService.getAllBranches()
  });

  const { data: lowStockData, isLoading } = useQuery({
    queryKey: ['lowStock', branchId],
    queryFn: () => inventoryService.getLowStockAlerts(branchId || undefined, 0, 10),
    refetchInterval: 30000 // Refresh every 30s
  });

  // Ingredients at or below their alert — at the branch, or summed over all of them.
  const { data: lowIngredients, isLoading: ingredientsLoading } = useQuery({
    queryKey: QK.ingredientLowStock(branchId),
    queryFn: () => ingredientService.getLowStock(branchId || undefined),
    refetchInterval: 30000,
  });

  const alerts = lowStockData?.content || [];
  const ingredientAlerts = lowIngredients || [];
  const selectedBranchName = branchesData?.find(b => b.id === branchId)?.name;
  const branches = branchesData?.filter(b => b.isActive) || [];

  return (
    <div className="bg-background border border-border rounded-3xl p-6 shadow-2xl relative overflow-hidden group h-full flex flex-col">
      <div className="absolute top-0 right-0 w-48 h-48 bg-destructive/5 rounded-full blur-3xl -mr-24 -mt-24 pointer-events-none"></div>
      
      <div className="flex items-center justify-between mb-6 z-10 relative">
        <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
          <AlertTriangle className="text-warning" size={24} />
          Low Stock Alerts
        </h3>
        
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          aria-label="Filter low-stock alerts by branch"
          className="bg-card border border-border text-xs rounded-xl px-3 py-1.5 flex items-center gap-2 text-foreground outline-none focus:ring-1 focus:ring-primary focus:border-transparent transition-all"
        >
          <option value="">All Branches</option>
          {branches.map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar z-10">
        {isLoading || ingredientsLoading ? (
          <div className="text-muted-foreground text-sm text-center py-4">Loading stock levels...</div>
        ) : alerts.length === 0 && ingredientAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mb-3">
              <span className="text-success text-2xl">✓</span>
            </div>
            <p className="text-sm font-medium">All stock levels are healthy</p>
          </div>
        ) : (
          <>
          {alerts.map((alert, idx) => {
            const isCritical = alert.currentQuantity === 0;
            return (
              <div 
                key={`${alert.productId}-${alert.branchId}-${idx}`}
                className="flex items-center justify-between p-3 rounded-2xl bg-card/50 border border-border/80 hover:bg-muted/50 transition-colors"
              >
                <div>
                  <div className="font-medium text-foreground text-sm">{alert.productName}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    <MapPin size={10} /> {alert.branchName}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-bold ${isCritical ? 'text-destructive' : 'text-warning'}`}>
                    {alert.currentQuantity} <span className="text-xs text-muted-foreground font-normal">/ {alert.threshold}</span>
                  </div>
                  <div className={`text-[10px] mt-0.5 ${isCritical ? 'text-destructive/80' : 'text-warning/80'}`}>
                    {isCritical ? 'Out of stock' : 'Low stock'}
                  </div>
                </div>
              </div>
            );
          })}
          {ingredientAlerts.map(ing => {
            const isCritical = ing.quantity <= 0;
            return (
              <div
                key={`ingredient-${ing.id}`}
                className="flex items-center justify-between p-3 rounded-2xl bg-card/50 border border-border/80 hover:bg-muted/50 transition-colors"
              >
                <div>
                  <div className="font-medium text-foreground text-sm">{ing.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    <Wheat size={10} /> Ingredient{selectedBranchName ? ` · ${selectedBranchName}` : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-bold ${isCritical ? 'text-destructive' : 'text-warning'}`}>
                    {formatQty(ing.quantity, ing.unit)}{' '}
                    <span className="text-xs text-muted-foreground font-normal">/ {formatQty(ing.lowStockThreshold, ing.unit)}</span>
                  </div>
                  <div className={`text-[10px] mt-0.5 ${isCritical ? 'text-destructive/80' : 'text-warning/80'}`}>
                    {isCritical ? 'Out of stock' : 'Low stock'}
                  </div>
                </div>
              </div>
            );
          })}
          </>
        )}
      </div>
    </div>
  );
}
