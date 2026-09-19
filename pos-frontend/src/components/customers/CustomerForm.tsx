'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { 
  Form, 
  FormControl, 
  FormField, 
  FormItem, 
  FormLabel, 
  FormMessage 
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FeatureGuard } from '@/components/auth/FeatureGuard';
import { CustomerRequest } from '@/services/customerService';
import { CURRENCY } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

const customerSchema = z.object({
  firstName: z.string().min(2, "First name is too short"),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal('')),
  address: z.string().optional(),
  creditLimit: z.number().min(0, "Must be 0 or more").optional(),
});

interface CustomerFormProps {
  initialData?: Partial<CustomerRequest>;
  onSubmit: (data: CustomerRequest) => void;
  isLoading?: boolean;
}

export const CustomerForm: React.FC<CustomerFormProps> = ({ initialData, onSubmit, isLoading }) => {
  const form = useForm<z.infer<typeof customerSchema>>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      firstName: initialData?.firstName || '',
      lastName: initialData?.lastName || '',
      phone: initialData?.phone || '',
      email: initialData?.email || '',
      address: initialData?.address || '',
      creditLimit: initialData?.creditLimit ?? 0,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-foreground">First Name</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. John" {...field} className="bg-background border-border" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-foreground">Last Name</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Doe" {...field} className="bg-background border-border" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-foreground">Phone Number</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. +123456789" {...field} className="bg-background border-border" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-foreground">Email Address</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. john@example.com" {...field} className="bg-background border-border" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-foreground">Full Address</FormLabel>
              <FormControl>
                <Input placeholder="e.g. 123 Main St, New York..." {...field} className="bg-background border-border" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FeatureGuard feature="STORE_CREDIT">
          <FormField
            control={form.control}
            name="creditLimit"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-foreground">Credit Limit ({CURRENCY.symbol})</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={field.value ?? 0}
                    onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                    className="bg-background border-border"
                  />
                </FormControl>
                <p className="text-xs text-muted-foreground">
                  Maximum this customer may owe on store credit. 0 disables buying on credit.
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
        </FeatureGuard>

        <Button
          type="submit"
          disabled={isLoading}
          className="w-full bg-primary hover:bg-primary font-bold h-11"
        >
          {isLoading ? <Loader2 className="animate-spin" /> : 'Save Customer Profile'}
        </Button>
      </form>
    </Form>
  );
};
