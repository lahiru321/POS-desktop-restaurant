"use client";

import { useForm, Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { 
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage 
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { inventoryService } from "@/services/inventoryService";
import { branchService } from "@/services/branchService";
import { supplierService, Supplier } from "@/services/supplierService";
import { toast } from "sonner";
import { Product, ProductRequest, Category, Brand } from "@/types/inventory";
import { Branch } from "@/services/branchService";
import { useRouter, useSearchParams } from "next/navigation";
import { QK } from "@/lib/queryKeys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Save, Sparkles, PencilLine, Upload, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import InventoryAdjustmentModal from "./InventoryAdjustmentModal";

const productSchema = z.object({
  name: z.string().min(1, "Product name is required"),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  description: z.string().optional(),
  basePrice: z.coerce.number().min(0),
  costPrice: z.coerce.number().min(0).optional(),
  stockQuantity: z.coerce.number().int().min(0),
  lowStockThreshold: z.coerce.number().int().min(0),
  categoryId: z.string().uuid().optional().nullable(),
  brandId: z.string().uuid().optional().nullable(),
  primarySupplierId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().default(true),
  // False = made to order: no stock row, no shortage block, sells freely.
  trackStock: z.boolean().default(true),
  imageUrl: z.string().optional(),
  branchStockLevels: z.record(z.string().uuid(), z.coerce.number().int().min(0)).optional(),
});

type ProductFormValues = z.infer<typeof productSchema>;

interface ProductFormProps {
  initialData?: Product | null;
}

export default function ProductForm({ initialData }: ProductFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isAdjModalOpen, setIsAdjModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      form.setValue("imageUrl", reader.result as string, { shouldValidate: true });
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    form.setValue("imageUrl", "", { shouldValidate: true });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: inventoryService.getCategories
  });

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: inventoryService.getBrands
  });

  const { data: suppliersPage } = useQuery({
    queryKey: ['suppliers-all'],
    queryFn: () => supplierService.getSuppliers(0, 500),
  });
  const suppliers = suppliersPage?.content?.filter((s: Supplier) => s.isActive) ?? [];

  const { data: branches } = useQuery({
    queryKey: QK.branches,
    queryFn: branchService.getAllBranches
  });

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema) as Resolver<ProductFormValues>,
    defaultValues: {
      name: initialData?.name || "",
      sku: initialData?.sku || "",
      barcode: initialData?.barcode || "",
      description: initialData?.description || "",
      basePrice: initialData?.basePrice || 0,
      costPrice: initialData?.costPrice || 0,
      stockQuantity: initialData?.stockQuantity || 0,
      lowStockThreshold: initialData?.lowStockThreshold || 5,
      categoryId: initialData?.categoryId || null,
      brandId: initialData?.brandId || null,
      primarySupplierId: initialData?.primarySupplierId || null,
      isActive: initialData?.isActive ?? true,
      trackStock: initialData?.trackStock ?? true,
      imageUrl: initialData?.imageUrl || "",
      branchStockLevels: {},
    },
  });

  // Drives the Inventory card: an untracked product has no stock count and no
  // low-stock threshold to show. stockQuantity stays in the payload as 0 — the
  // API still requires it, and the server ignores it when tracking is off.
  const trackStock = form.watch("trackStock");

  const searchParams = useSearchParams();
  const barcodeFromUrl = searchParams.get("barcode");
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialData) {
      form.reset({
        name: initialData.name || "",
        sku: initialData.sku || "",
        barcode: initialData.barcode || "",
        description: initialData.description || "",
        basePrice: initialData.basePrice || 0,
        costPrice: initialData.costPrice || 0,
        stockQuantity: initialData.stockQuantity || 0,
        lowStockThreshold: initialData.lowStockThreshold || 5,
        categoryId: initialData.categoryId || null,
        brandId: initialData.brandId || null,
        primarySupplierId: initialData.primarySupplierId || null,
        isActive: initialData.isActive ?? true,
        imageUrl: initialData.imageUrl || "",
        branchStockLevels: {},
      });
    }
  }, [initialData, form]);

  useEffect(() => {
    if (barcodeFromUrl && !initialData) {
      form.setValue("barcode", barcodeFromUrl);
      toast.info(`Barcode ${barcodeFromUrl} auto-filled from scanner.`);
      
      // Small delay to ensure the field is focused after mount
      const timer = setTimeout(() => {
        nameInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [barcodeFromUrl, initialData, form]);

  const mutation = useMutation({
    mutationFn: (data: ProductFormValues) => {
      const payload: ProductRequest = {
        ...data,
        categoryId: data.categoryId || undefined,
        brandId: data.brandId || undefined,
        primarySupplierId: data.primarySupplierId || undefined,
        costPrice: data.costPrice || undefined,
        sku: data.sku || undefined,
        barcode: data.barcode || undefined,
        branchStockLevels: data.branchStockLevels ? Object.entries(data.branchStockLevels).map(([branchId, quantity]) => ({
          branchId,
          quantity
        })) : undefined
      };
      
      if (initialData) {
        return inventoryService.updateProduct(initialData.id, payload);
      }
      return inventoryService.createProduct(payload);
    },
    onSuccess: async (updated) => {
      if (initialData) {
        queryClient.setQueryData(['product', initialData.id], updated);
      }
      await queryClient.invalidateQueries({
        queryKey: ['products'],
        refetchType: 'all',
      });
      toast.success(initialData ? "Product updated" : "Product created");
      router.push("/inventory/products");
    },
    onError: (error: unknown) => {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to save product");
    }
  });

  const onSubmit = (values: ProductFormValues) => {
    mutation.mutate(values);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/inventory/products">
            <Button variant="ghost" size="icon" aria-label="Back to products" title="Back to products" className="rounded-full hover:bg-muted" type="button">
              <ArrowLeft size={20} />
            </Button>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">
            {initialData ? 'Edit Product' : 'New Product'}
          </h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg">General Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Product Name</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Enter product name" 
                          className="bg-background border-border" 
                          {...field} 
                          ref={(e) => {
                            field.ref(e);
                            // @ts-expect-error — ref callback type mismatch between RHF and HTMLElement
                            nameInputRef.current = e;
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <textarea 
                          className="w-full min-h-[100px] px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                          placeholder="Provide details about the product..."
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg">Pricing & Identification</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="basePrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sale Price ($)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" className="bg-background border-border" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="costPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cost Price ($)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" className="bg-background border-border" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="sku"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>SKU</FormLabel>
                        <FormControl>
                          <Input placeholder="Leave empty for auto-generation" className="bg-background border-border" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="barcode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Barcode</FormLabel>
                        <FormControl>
                        <div className="relative">
                          <Input 
                            placeholder="UPC / EAN" 
                            className={`bg-background border-border ${barcodeFromUrl && !initialData ? 'border-primary/50 text-primary' : ''}`} 
                            {...field} 
                          />
                          {barcodeFromUrl && !initialData && (
                            <Sparkles className="absolute right-3 top-1/2 -translate-y-1/2 text-primary" size={16} />
                          )}
                        </div>
                      </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg">Inventory</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="trackStock"
                  render={({ field }) => (
                    <FormItem className="flex items-start justify-between gap-4 space-y-0 rounded-lg border border-border p-3">
                      <div className="space-y-0.5">
                        <FormLabel className="text-sm">Track stock</FormLabel>
                        <p className="text-[11px] leading-snug text-muted-foreground">
                          {field.value
                            ? "Counted in units. Sales deduct stock and stop at zero."
                            : "Made to order. No stock count, never runs out, sells in any quantity."}
                        </p>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          aria-label="Track stock for this product"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {!trackStock ? null : !initialData && branches && branches.length > 1 ? (
                  <div className="space-y-4">
                    <label className="text-sm font-semibold text-muted-foreground">Initial Stock per Branch</label>
                    {branches.map((branch: Branch) => (
                      <FormField
                        key={branch.id}
                        control={form.control}
                        name={`branchStockLevels.${branch.id}`}
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between gap-4 space-y-0">
                            <FormLabel className="text-xs text-muted-foreground w-1/2">{branch.name}</FormLabel>
                            <FormControl className="w-1/2">
                              <Input type="number" className="bg-background border-border h-8" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                ) : (
                  <FormField
                    control={form.control}
                    name="stockQuantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{initialData ? 'Total Stock (Read-only)' : 'Initial Stock'}</FormLabel>
                        <div className="flex gap-2">
                          <FormControl className="flex-1">
                            <Input type="number" className="bg-background border-border" {...field} disabled={!!initialData} />
                          </FormControl>
                          {initialData && (
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="shrink-0 border-border hover:bg-muted"
                              onClick={() => setIsAdjModalOpen(true)}
                              aria-label="Adjust inventory"
                              title="Adjust Inventory"
                            >
                              <PencilLine size={16} className="text-primary" />
                            </Button>
                          )}
                        </div>
                        {initialData && <p className="text-[10px] text-muted-foreground">Stock can be managed via the Adjustment tool.</p>}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                {trackStock && (
                  <FormField
                    control={form.control}
                    name="lowStockThreshold"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Low Stock Threshold</FormLabel>
                        <FormControl>
                          <Input type="number" className="bg-background border-border" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg">Classification</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="categoryId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <FormControl>
                        <select 
                          className="w-full h-10 px-3 bg-background border border-border rounded-lg text-sm"
                          value={field.value || ""}
                          onChange={(e) => field.onChange(e.target.value || null)}
                        >
                          <option value="">Select Category</option>
                          {categories?.map((c: Category) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="brandId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Brand</FormLabel>
                      <FormControl>
                        <select
                          className="w-full h-10 px-3 bg-background border border-border rounded-lg text-sm"
                          value={field.value || ""}
                          onChange={(e) => field.onChange(e.target.value || null)}
                        >
                          <option value="">Select Brand</option>
                          {brands?.map((b: Brand) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="primarySupplierId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary Supplier</FormLabel>
                      <FormControl>
                        <select
                          className="w-full h-10 px-3 bg-background border border-border rounded-lg text-sm"
                          value={field.value || ""}
                          onChange={(e) => field.onChange(e.target.value || null)}
                        >
                          <option value="">No preferred supplier</option>
                          {suppliers.map((s: Supplier) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card className="bg-card border-border overflow-hidden">
              <CardHeader>
                <CardTitle className="text-lg">Product Image</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="aspect-square rounded border border-border bg-background flex items-center justify-center relative overflow-hidden">
                  {form.watch("imageUrl") ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={form.watch("imageUrl")!} className="w-full h-full object-cover" alt="Preview" />
                      <button
                        type="button"
                        onClick={handleRemoveImage}
                        className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-foreground rounded-full p-1 z-10"
                      >
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <div className="text-center text-muted-foreground">
                      <div className="text-2xl mb-1">🖼️</div>
                      <p className="text-xs font-medium">No Image</p>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2 border-border text-foreground hover:text-foreground hover:bg-muted"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={15} />
                  {form.watch("imageUrl") ? "Change Image" : "Upload Image"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="flex justify-end gap-4 pb-12 border-t border-border pt-8">
          <Link href="/inventory/products">
            <Button variant="ghost" type="button">Discard</Button>
          </Link>
          <Button type="submit" className="gap-2 min-w-[150px]" disabled={mutation.isPending}>
            <Save size={18} /> {mutation.isPending ? 'Saving...' : (initialData ? 'Update Product' : 'Save Product')}
          </Button>
        </div>

        {initialData && (
          <InventoryAdjustmentModal
            product={initialData}
            isOpen={isAdjModalOpen}
            onClose={() => setIsAdjModalOpen(false)}
          />
        )}
      </form>
    </Form>
  );
}
