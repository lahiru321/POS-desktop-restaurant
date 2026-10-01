"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Branch, BranchRequest } from "@/services/branchService";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

const formSchema = z.object({
  name: z.string().min(2, "Branch name must be at least 2 characters"),
  address: z.string().optional(),
  phoneNumber: z.string().optional(),
  isActive: z.boolean(),
});

interface BranchFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: BranchRequest) => void;
  initialData?: Branch | null;
  isLoading: boolean;
}

export default function BranchFormModal({ 
  isOpen, 
  onClose, 
  onSubmit, 
  initialData,
  isLoading 
}: BranchFormModalProps) {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      address: "",
      phoneNumber: "",
      isActive: true,
    },
  });

  useEffect(() => {
    if (initialData) {
      form.reset({
        name: initialData.name,
        address: initialData.address || "",
        phoneNumber: initialData.phoneNumber || "",
        isActive: initialData.isActive,
      });
    } else {
      form.reset({
        name: "",
        address: "",
        phoneNumber: "",
        isActive: true,
      });
    }
  }, [initialData, form, isOpen]);

  const onFormSubmit = (values: z.infer<typeof formSchema>) => {
    onSubmit(values as BranchRequest);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-background border-border text-foreground">
        <DialogHeader>
          <DialogTitle>{initialData ? "Edit Branch" : "Add New Branch"}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {initialData 
              ? "Update details for the selected branch physical location." 
              : "Register a new branch, store, or warehouse for your business."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onFormSubmit)} className="space-y-4 pt-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Branch Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Main outlet" {...field} className="bg-card border-border" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input placeholder="123 Business St, City" {...field} className="bg-card border-border" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phoneNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone Number</FormLabel>
                  <FormControl>
                    <Input placeholder="011-2345678" {...field} className="bg-card border-border" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base text-foreground">Active Status</FormLabel>
                    <div className="text-sm text-muted-foreground">
                      If disabled, this branch will not appear in the POS terminal.
                    </div>
                  </div>
                  <FormControl>
                    <input 
                      type="checkbox" 
                      className="w-5 h-5 accent-primary rounded"
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter className="pt-4">
              <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading} className="bg-primary hover:bg-primary/90 min-w-[100px]">
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {initialData ? "Save Changes" : "Create Branch"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
