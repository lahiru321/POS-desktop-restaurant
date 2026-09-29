import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { inventoryService } from "@/services/inventoryService";
import { returnService, ReturnItemRequest, ReturnRequest } from "@/services/returnService";
import { Product } from "@/types/inventory";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowRightLeft, Search, Plus, Minus, Info } from "lucide-react";
import { toast } from "sonner";
import { CURRENCY } from '@/lib/utils';

interface ExchangeModalProps {
  saleId: string | null;
  returnItems: ReturnItemRequest[];
  returnCredit: number;
  onClose: () => void;
}

interface CartItem extends Product {
  cartQuantity: number;
}

export function ExchangeModal({ saleId, returnItems, returnCredit, onClose }: ExchangeModalProps) {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [step, setStep] = useState<1 | 2>(1); // 1 = Select replacements, 2 = Confirm
  
  const { data: productsData, isLoading: searching } = useQuery({
    queryKey: ['products', 'search', searchTerm],
    queryFn: () => inventoryService.getProducts(0, 5, { search: searchTerm, isActive: true }),
    enabled: searchTerm.length > 2 || searchTerm === "",
  });

  const exchangeMutation = useMutation({
    mutationFn: (data: ReturnRequest) => returnService.processExchange(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports', 'sales'] });
      queryClient.invalidateQueries({ queryKey: ['reports', 'returns'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'products'] });
      toast.success("Exchange processed successfully.");
      onClose();
    },
    onError: (error: { response?: { data?: { message?: string } } }) => {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to process exchange");
    }
  });

  // Calculate totals
  const replacementTotal = cart.reduce((sum, item) => sum + (item.basePrice * item.cartQuantity), 0);
  const priceDifference = replacementTotal - returnCredit;

  // Cart operations
  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(p => p.id === product.id);
      if (existing) {
        if (existing.cartQuantity >= product.stockQuantity) {
            toast.error(`Only ${product.stockQuantity} in stock`);
            return prev;
        }
        return prev.map(p => p.id === product.id ? { ...p, cartQuantity: p.cartQuantity + 1 } : p);
      }
      if (product.stockQuantity < 1) {
          toast.error("Product out of stock");
          return prev;
      }
      return [...prev, { ...product, cartQuantity: 1 }];
    });
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(p => {
      if (p.id === id) {
        const newQty = Math.max(0, p.cartQuantity + delta);
        if (newQty > p.stockQuantity) {
            toast.error(`Only ${p.stockQuantity} in stock`);
            return p;
        }
        return { ...p, cartQuantity: newQty };
      }
      return p;
    }).filter(p => p.cartQuantity > 0));
  };

  const processExchange = () => {
    if (!saleId) return;

    exchangeMutation.mutate({
      saleId,
      reason: "Exchange",
      returnType: "EXCHANGE",
      refundMethod: "STORE_CREDIT", // Ignored by backend handling, but required by DTO
      items: returnItems,
      exchangeItems: cart.map(item => ({
        productId: item.id,
        quantity: item.cartQuantity,
        unitPrice: item.basePrice
      }))
    });
  };

  if (!saleId) return null;

  return (
    <Dialog open={!!saleId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[800px] bg-gray-900 border-gray-800 text-white p-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-gray-800 bg-gray-900/50">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <ArrowRightLeft className="text-primary" />
            Process Exchange
          </DialogTitle>
          <div className="flex items-center gap-2 mt-2">
            <div className={`h-1.5 w-1/2 rounded-full ${step === 1 ? 'bg-primary' : 'bg-success'}`}></div>
            <div className={`h-1.5 w-1/2 rounded-full ${step === 2 ? 'bg-primary' : 'bg-gray-800'}`}></div>
          </div>
        </DialogHeader>

        {step === 1 && (
          <div className="flex h-[500px]">
            {/* Left: Search & Select */}
            <div className="w-1/2 border-r border-gray-800 flex flex-col bg-gray-950/50">
              <div className="p-4 border-b border-gray-800">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input 
                    placeholder="Search products..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 bg-gray-900 border-gray-800"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {searching ? (
                   <div className="flex justify-center p-8"><Loader2 className="animate-spin text-gray-500" /></div>
                ) : productsData?.content.length === 0 ? (
                   <div className="text-center p-8 text-gray-500 text-sm">No products found</div>
                ) : (
                  <div className="space-y-1">
                    {productsData?.content.map(product => (
                      <div key={product.id} className="flex justify-between items-center p-3 rounded-md hover:bg-gray-800/80 group">
                        <div>
                          <p className="text-sm font-medium text-gray-200">{product.name}</p>
                          <p className="text-xs text-gray-500">Stock: {product.stockQuantity} | {CURRENCY.symbol} {product.basePrice.toFixed(2)}</p>
                        </div>
                        <Button 
                          size="sm" 
                          variant="secondary"
                          onClick={() => addToCart(product)}
                          disabled={product.stockQuantity < 1}
                          className="opacity-0 group-hover:opacity-100 transition-opacity bg-primary/20 text-primary hover:bg-primary hover:text-primary-foreground h-7 px-2"
                        >
                          <Plus size={14} />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Cart & Return Credit Summary */}
            <div className="w-1/2 flex flex-col bg-gray-900">
              <div className="p-4 border-b border-gray-800 bg-gray-800/30">
                <p className="text-sm text-gray-400 uppercase tracking-wider font-semibold">Replacement Items</p>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {cart.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-500">
                    <ArrowRightLeft className="h-12 w-12 mb-3 opacity-20" />
                    <p className="text-sm">Select replacement products</p>
                  </div>
                ) : (
                  cart.map(item => (
                    <div key={item.id} className="flex justify-between items-center bg-gray-950 p-3 rounded-lg border border-gray-800">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-200 truncate pr-2">{item.name}</p>
                        <p className="text-xs text-primary">{CURRENCY.symbol} {(item.basePrice * item.cartQuantity).toFixed(2)}</p>
                      </div>
                      <div className="flex items-center gap-2 bg-gray-900 rounded-md border border-gray-800">
                        <button onClick={() => updateQuantity(item.id, -1)} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-l-md transition-colors"><Minus size={14} /></button>
                        <span className="w-6 text-center text-sm font-medium">{item.cartQuantity}</span>
                        <button onClick={() => updateQuantity(item.id, 1)} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-r-md transition-colors"><Plus size={14} /></button>
                      </div>
                    </div>
                  ))
                )}
              </div>
              
              {/* Cart Footer */}
              <div className="p-4 border-t border-gray-800 bg-gray-800/30 space-y-4">
                <div className="space-y-1.5">
                  <div className="flex justify-between text-sm text-gray-400">
                    <span>Return Credit:</span>
                    <span className="text-success">+{CURRENCY.symbol} {returnCredit.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-400">
                    <span>Replacement Cost:</span>
                    <span className="text-destructive">-{CURRENCY.symbol} {replacementTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-medium pt-2 border-t border-gray-700">
                    <span>Balance:</span>
                    <span className={priceDifference > 0 ? "text-destructive" : priceDifference < 0 ? "text-success" : "text-gray-300"}>
                      {priceDifference > 0 ? `Customer pays ${CURRENCY.symbol} ${priceDifference.toFixed(2)}` : 
                       priceDifference < 0 ? `Refund ${CURRENCY.symbol} ${Math.abs(priceDifference).toFixed(2)}` : 
                       `Even Swap (${CURRENCY.symbol} 0.00)`}
                    </span>
                  </div>
                </div>
                
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1 border-gray-700 hover:bg-gray-800" onClick={onClose}>Cancel</Button>
                  <Button 
                    className="flex-1 bg-primary hover:bg-primary/90" 
                    disabled={cart.length === 0}
                    onClick={() => setStep(2)}
                  >
                    Review Exchange
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="p-6 space-y-6 bg-gray-900">
            <div className="flex items-start gap-3 bg-primary/10 border border-primary/20 p-4 rounded-lg">
              <Info className="text-primary mt-0.5" size={20} />
              <div>
                <h4 className="text-sm font-medium text-indigo-100">Exchange Summary</h4>
                <p className="text-sm text-indigo-300 mt-1">
                  This will create a new sale for the replacement items and restore stock for the returned items.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6 relative">
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-800 -translate-x-1/2"></div>
              
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Returning</h4>
                <div className="bg-gray-950 rounded border border-gray-800 p-3 h-40 overflow-y-auto">
                  {returnItems.map(item => (
                    <div key={item.saleItemId} className="flex justify-between text-sm py-1 border-b border-gray-800/50 last:border-0">
                      <span className="text-gray-300 truncate pr-2">Item #{item.productId?.slice(0,6) ?? '—'} <span className="text-gray-500">x{item.quantity}</span></span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between items-center text-sm pt-2">
                  <span className="text-gray-400">Total Credit:</span>
                  <span className="font-bold text-success">{CURRENCY.symbol} {returnCredit.toFixed(2)}</span>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Receiving</h4>
                <div className="bg-gray-950 rounded border border-gray-800 p-3 h-40 overflow-y-auto">
                  {cart.map(item => (
                    <div key={item.id} className="flex justify-between text-sm py-1 border-b border-gray-800/50 last:border-0">
                      <span className="text-gray-300 truncate pr-2">{item.name} <span className="text-gray-500">x{item.cartQuantity}</span></span>
                      <span className="text-gray-400">{CURRENCY.symbol} {(item.basePrice * item.cartQuantity).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between items-center text-sm pt-2">
                  <span className="text-gray-400">Total Cost:</span>
                  <span className="font-bold text-destructive">{CURRENCY.symbol} {replacementTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="bg-gray-950 p-4 rounded-lg border border-gray-800 flex justify-between items-center">
              <span className="text-gray-300 text-lg">Final Balance</span>
              <span className={`text-2xl font-bold ${priceDifference > 0 ? "text-destructive" : priceDifference < 0 ? "text-success" : "text-gray-100"}`}>
                 {priceDifference > 0 ? `Pay ${CURRENCY.symbol} ${priceDifference.toFixed(2)}` : 
                  priceDifference < 0 ? `Refund ${CURRENCY.symbol} ${Math.abs(priceDifference).toFixed(2)}` : 
                  `${CURRENCY.symbol} 0.00`}
              </span>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={() => setStep(1)} className="hover:bg-gray-800">
                Back
              </Button>
              <Button 
                onClick={processExchange}
                disabled={exchangeMutation.isPending}
                className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-[200px]"
              >
                {exchangeMutation.isPending ? "Processing..." : "Confirm & Process Exchange"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
