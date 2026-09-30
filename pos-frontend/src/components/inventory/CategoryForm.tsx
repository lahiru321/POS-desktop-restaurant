"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { 
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage 
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { inventoryService } from "@/services/inventoryService";
import { taxService } from "@/services/taxService";
import { QK } from "@/lib/queryKeys";
import { toast } from "sonner";
import { Category } from "@/types/inventory";
import { KitchenStationInput } from "./KitchenStationInput";
import {
  KITCHEN_STATION_MAX_LENGTH,
  KITCHEN_STATION_PATTERN,
  normalizeKitchenStation,
} from "@/lib/kitchenStations";

const categorySchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().optional(),
  description: z.string().optional(),
  parentId: z.string().uuid().optional().nullable(),
  taxRateId: z.string().uuid().optional().nullable(),
  kitchenStation: z
    .string()
    .max(KITCHEN_STATION_MAX_LENGTH, "20 characters or fewer")
    .regex(KITCHEN_STATION_PATTERN, "Letters, numbers, spaces, - and _ only")
    .optional(),
});

type CategoryFormValues = z.infer<typeof categorySchema>;

interface CategoryFormProps {
  initialData?: Category | null;
  onSuccess: () => void;
  onCancel: () => void;
  categories?: Category[];
}

export default function CategoryForm({ 
  initialData, 
  onSuccess, 
  onCancel,
  categories = [] 
}: CategoryFormProps) {
  const queryClient = useQueryClient();

  // Fetch active tax rates for the dropdown
  const { data: taxRates = [] } = useQuery({
    queryKey: QK.taxRatesActive,
    queryFn: taxService.getActiveTaxRates,
  });

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: initialData?.name || "",
      slug: initialData?.slug || "",
      description: initialData?.description || "",
      parentId: initialData?.parentId ?? null,
      taxRateId: initialData?.taxRateId ?? null,
      kitchenStation: initialData?.kitchenStation ?? "",
    },
  });

  const mutation = useMutation({
    mutationFn: (data: CategoryFormValues) => {
      if (initialData) {
        return inventoryService.updateCategory(initialData.id, {
          ...data,
          parentId: data.parentId ?? undefined,
          taxRateId: data.taxRateId ?? undefined,
          kitchenStation: normalizeKitchenStation(data.kitchenStation),
        });
      }
      return inventoryService.createCategory({
        ...data,
        parentId: data.parentId ?? undefined,
        taxRateId: data.taxRateId ?? undefined,
        kitchenStation: normalizeKitchenStation(data.kitchenStation),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK.categories });
      queryClient.invalidateQueries({ queryKey: QK.kitchenStations });
      toast.success(initialData ? "Category updated" : "Category created");
      onSuccess();
    },
    onError: (error: unknown) => {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to save category");
    }
  });

  const onSubmit = (values: CategoryFormValues) => {
    mutation.mutate(values);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Electronics, Beverages..." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Slug (Optional)</FormLabel>
              <FormControl>
                <Input placeholder="beverages" {...field} />
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
                <Input placeholder="Brief description..." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="parentId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Parent Category</FormLabel>
                <FormControl>
                  <select 
                    className="w-full h-10 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    value={field.value || ""}
                    onChange={(e) => field.onChange(e.target.value || null)}
                  >
                    <option value="">None (Top Level)</option>
                    {categories
                      .filter(c => c.id !== initialData?.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))
                    }
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="taxRateId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tax Rate</FormLabel>
                <FormControl>
                  <select 
                    className="w-full h-10 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    value={field.value || ""}
                    onChange={(e) => field.onChange(e.target.value || null)}
                  >
                    <option value="">None (Use Default)</option>
                    {taxRates.map((rate) => (
                      <option key={rate.id} value={rate.id}>
                        {rate.name} ({rate.ratePercent}%)
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="kitchenStation"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Kitchen station</FormLabel>
              <FormControl>
                <KitchenStationInput
                  ref={field.ref}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="Kitchen"
                />
              </FormControl>
              <p className="text-[11px] text-muted-foreground">
                Which kitchen printer this category&apos;s dishes print on — e.g. BAR for drinks. Leave empty for
                the main kitchen. A product can override it.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving..." : initialData ? "Update Category" : "Create Category"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
