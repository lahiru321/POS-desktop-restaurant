'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Mail, Phone, MapPin, Star, Calendar, Receipt, ShoppingBag, Loader2, Wallet } from 'lucide-react';
import { customerService } from '@/services/customerService';
import { salesService, SaleResponse } from '@/services/salesService';
import { loyaltyService, LoyaltyTransaction } from '@/services/loyaltyService';
import { CustomerCreditPanel } from '@/components/customers/CustomerCreditPanel';
import { useAuthStore } from '@/stores/authStore';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { DashboardHeaderSlot } from '@/components/layout/DashboardHeaderSlot';

export default function CustomerProfilePage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;
  const [salesPage, setSalesPage] = useState(0);
  const [loyaltyPage, setLoyaltyPage] = useState(0);
  const creditEnabled = useAuthStore((state) => state.hasFeature('STORE_CREDIT'));

  const { data: customer, isLoading: customerLoading } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => customerService.getCustomer(customerId),
    enabled: !!customerId
  });

  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ['customer-sales', customerId, salesPage],
    queryFn: () => salesService.getSalesByCustomer(customerId, salesPage, 10),
    enabled: !!customerId
  });

  const { data: loyaltyData, isLoading: loyaltyLoading } = useQuery({
    queryKey: ['customer-loyalty', customerId, loyaltyPage],
    queryFn: () => loyaltyService.getLedger(customerId, loyaltyPage, 10),
    enabled: !!customerId
  });

  if (customerLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={48} />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>Customer not found.</p>
        <Button variant="link" onClick={() => router.push('/customers')} className="text-primary mt-4">
          Return to directory
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 p-6">
      <DashboardHeaderSlot>
        <Breadcrumbs
          items={[
            { label: 'Customers', href: '/customers' },
            { label: `${customer.firstName} ${customer.lastName}` },
          ]}
        />
      </DashboardHeaderSlot>

      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/customers')}
          aria-label="Back to customers"
          className="text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={24} />
        </Button>
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground mb-1">
            {customer.firstName} {customer.lastName}
          </h1>
          <p className="text-muted-foreground text-sm flex items-center gap-2">
            <Calendar size={14} /> Member since {new Date(customer.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Hero Stats Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-primary/10 border-primary/20 shadow-xl col-span-1 md:col-span-2">
          <CardHeader>
            <CardTitle className="text-primary">Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 text-foreground">
              <Phone size={18} className="text-success" />
              <span className="font-medium">{customer.phone || 'No phone number'}</span>
            </div>
            <div className="flex items-center gap-3 text-foreground">
              <Mail size={18} className="text-blue-500" />
              <span className="font-medium">{customer.email || 'No email address'}</span>
            </div>
            <div className="flex items-start gap-3 text-foreground">
              <MapPin size={18} className="text-destructive shrink-0 mt-1" />
              <span className="font-medium leading-relaxed max-w-sm">{customer.address || 'No address provided'}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-xl text-center flex flex-col justify-center items-center py-8">
          <Star size={48} className="text-primary mb-4" fill="currentColor" />
          <h3 className="text-muted-foreground font-bold uppercase tracking-widest text-xs mb-1">Loyalty Points</h3>
          <p className="text-5xl font-black text-foreground">{customer.loyaltyPoints}</p>
        </Card>
      </div>

      {/* Tabs area */}
      <Tabs defaultValue="history" className="w-full">
        <TabsList className="bg-card border-border">
          <TabsTrigger value="history" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Receipt size={16} className="mr-2" /> Purchase History
          </TabsTrigger>
          <TabsTrigger value="loyalty" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Star size={16} className="mr-2" /> Loyalty Activity
          </TabsTrigger>
          {creditEnabled && (
            <TabsTrigger value="credit" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Wallet size={16} className="mr-2" /> Store Credit
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="history" className="mt-6">
          <Card className="bg-card border-border shadow-xl overflow-hidden">
            <CardHeader className="bg-muted/40 pb-4">
              <CardTitle className="text-lg font-bold text-foreground">Past Transactions</CardTitle>
              <CardDescription>A complete log of previous sales for this customer.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/60">
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground font-bold uppercase text-[10px] tracking-widest pl-6">Date</TableHead>
                    <TableHead className="text-muted-foreground font-bold uppercase text-[10px] tracking-widest">Invoice</TableHead>
                    <TableHead className="text-muted-foreground font-bold uppercase text-[10px] tracking-widest">Items</TableHead>
                    <TableHead className="text-muted-foreground font-bold uppercase text-[10px] tracking-widest">Payment</TableHead>
                    <TableHead className="text-right text-muted-foreground font-bold uppercase text-[10px] tracking-widest pr-6">Net Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-64 text-center">
                        <Loader2 className="animate-spin text-primary inline-block" size={32} />
                      </TableCell>
                    </TableRow>
                  ) : !salesData || salesData.content.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-64 text-center text-muted-foreground">
                        <ShoppingBag size={48} className="opacity-10 mx-auto mb-2" />
                        <p className="font-medium">No purchase history found.</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    salesData.content.map((sale: SaleResponse) => (
                      <TableRow key={sale.id} className="border-border hover:bg-foreground/5 transition-colors">
                        <TableCell className="py-4 pl-6 text-foreground">
                          {new Date(sale.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-primary">{sale.invoiceNumber}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {sale.items.length} items (Avg {(sale.netAmount / Math.max(sale.items.length, 1)).toFixed(2)}/item)
                        </TableCell>
                        <TableCell>
                          <span className="px-2 py-1 bg-muted text-foreground rounded text-[10px] font-bold">
                            {sale.paymentMethod}
                          </span>
                        </TableCell>
                        <TableCell className="text-right pr-6 font-bold text-success">
                          ${sale.netAmount.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              
              {/* Pagination */}
              {salesData && salesData.totalPages > 1 && (
                <div className="p-4 border-t border-border flex items-center justify-between">
                  <p className="text-xs text-muted-foreground font-medium">
                    Showing {(salesPage * 10) + 1} to {Math.min((salesPage + 1) * 10, salesData.totalElements)} of {salesData.totalElements} sales
                  </p>
                  <div className="flex gap-2">
                    <Button 
                      disabled={salesPage === 0} 
                      onClick={() => setSalesPage(p => p - 1)}
                      variant="outline" 
                      size="sm" 
                      className="bg-background border-border text-muted-foreground h-8"
                    >
                      Previous
                    </Button>
                    <Button 
                      disabled={(salesPage + 1) >= salesData.totalPages} 
                      onClick={() => setSalesPage(p => p + 1)}
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
        </TabsContent>

        <TabsContent value="loyalty" className="mt-6">
          <Card className="bg-card border-border shadow-xl overflow-hidden">
            <CardHeader className="bg-muted/40 pb-4">
              <CardTitle className="text-lg font-bold text-foreground">Loyalty Activity</CardTitle>
              <CardDescription>
                Every points earned and redeemed for this customer, newest first. Current balance:{' '}
                <span className="font-bold text-primary">{customer.loyaltyPoints} pts</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/60">
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground font-bold uppercase text-[10px] tracking-widest pl-6">Date</TableHead>
                    <TableHead className="text-muted-foreground font-bold uppercase text-[10px] tracking-widest">Activity</TableHead>
                    <TableHead className="text-right text-muted-foreground font-bold uppercase text-[10px] tracking-widest">Points</TableHead>
                    <TableHead className="text-right text-muted-foreground font-bold uppercase text-[10px] tracking-widest pr-6">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loyaltyLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-64 text-center">
                        <Loader2 className="animate-spin text-primary inline-block" size={32} />
                      </TableCell>
                    </TableRow>
                  ) : !loyaltyData || loyaltyData.content.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-64 text-center text-muted-foreground">
                        <Star size={48} className="opacity-10 mx-auto mb-2" />
                        <p className="font-medium">No loyalty activity yet.</p>
                        <p className="text-xs mt-1">Points appear here once this customer earns or redeems them.</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    loyaltyData.content.map((tx: LoyaltyTransaction) => (
                      <TableRow key={tx.id} className="border-border hover:bg-foreground/5 transition-colors">
                        <TableCell className="py-4 pl-6 text-foreground">
                          {format(new Date(tx.createdAt), 'dd MMM yyyy, HH:mm')}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`px-2 py-1 rounded text-[10px] font-bold ${
                              tx.type === 'EARN'
                                ? 'bg-success/10 text-success'
                                : tx.type === 'REDEEM'
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
                        <TableCell className={`text-right font-bold tabular-nums ${tx.points >= 0 ? 'text-success' : 'text-destructive'}`}>
                          {tx.points >= 0 ? '+' : ''}{tx.points}
                        </TableCell>
                        <TableCell className="text-right pr-6 font-medium text-foreground tabular-nums">
                          {tx.balanceAfter}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              {loyaltyData && loyaltyData.totalPages > 1 && (
                <div className="p-4 border-t border-border flex items-center justify-between">
                  <p className="text-xs text-muted-foreground font-medium">
                    Showing {(loyaltyPage * 10) + 1} to {Math.min((loyaltyPage + 1) * 10, loyaltyData.totalElements)} of {loyaltyData.totalElements} entries
                  </p>
                  <div className="flex gap-2">
                    <Button
                      disabled={loyaltyPage === 0}
                      onClick={() => setLoyaltyPage(p => p - 1)}
                      variant="outline"
                      size="sm"
                      className="bg-background border-border text-muted-foreground h-8"
                    >
                      Previous
                    </Button>
                    <Button
                      disabled={(loyaltyPage + 1) >= loyaltyData.totalPages}
                      onClick={() => setLoyaltyPage(p => p + 1)}
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
        </TabsContent>

        {creditEnabled && (
          <TabsContent value="credit" className="mt-6">
            <CustomerCreditPanel customerId={customerId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
