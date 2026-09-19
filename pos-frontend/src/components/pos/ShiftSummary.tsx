'use client';

import React from 'react';
import { SalesSummaryResponse } from '@/services/salesService';
import { CashSession } from '@/services/cashSessionService';
import { Card, CardContent } from '@/components/ui/card';
import { Banknote, CreditCard, QrCode, ShoppingBag, Wallet, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CURRENCY } from '@/lib/utils';

interface ShiftSummaryProps {
  summary: SalesSummaryResponse | null;
  session?: CashSession | null;
  onClose: () => void;
}

export const ShiftSummary: React.FC<ShiftSummaryProps> = ({ summary, session, onClose }) => {
  if (!summary) return null;

  const drawerExpected = session
    ? (session.openingBalance ?? 0) + (session.cashSalesTotal ?? 0)
        + (session.cashRepaymentsTotal ?? 0) - (session.cashRefundsTotal ?? 0)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <Card className="w-full max-w-md bg-gray-900 border-gray-800 shadow-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ShoppingBag className="text-primary" size={20} />
            Shift Summary
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-gray-500 hover:text-white">
            <X size={20} />
          </Button>
        </div>
        
        <CardContent className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-black/40 rounded-2xl border border-gray-800">
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Total Orders</p>
              <p className="text-2xl font-black text-white">{summary.totalOrders}</p>
            </div>
            <div className="p-4 bg-black/40 rounded-2xl border border-gray-800">
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Net Sales</p>
              <p className="text-2xl font-black text-primary">{CURRENCY.symbol} {summary.totalNetSales.toFixed(2)}</p>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Payment Breakdown</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-gray-950 rounded-xl border border-gray-800/50">
                <div className="flex items-center gap-3">
                  <Banknote className="text-success" size={18} />
                  <span className="text-sm font-medium text-gray-300">Cash</span>
                </div>
                <span className="font-bold text-white">{CURRENCY.symbol} {(summary.salesByPaymentMethod['CASH'] || 0).toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-950 rounded-xl border border-gray-800/50">
                <div className="flex items-center gap-3">
                  <CreditCard className="text-blue-500" size={18} />
                  <span className="text-sm font-medium text-gray-300">Card</span>
                </div>
                <span className="font-bold text-white">{CURRENCY.symbol} {(summary.salesByPaymentMethod['CARD'] || 0).toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-950 rounded-xl border border-gray-800/50">
                <div className="flex items-center gap-3">
                  <QrCode className="text-purple-500" size={18} />
                  <span className="text-sm font-medium text-gray-300">Online</span>
                </div>
                <span className="font-bold text-white">{CURRENCY.symbol} {(summary.salesByPaymentMethod['ONLINE'] || 0).toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-800 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Gross Sales</span>
              <span className="text-gray-300">{CURRENCY.symbol} {summary.totalGrossSales.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total Tax</span>
              <span className="text-gray-300">{CURRENCY.symbol} {summary.totalTax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total Discounts</span>
              <span className="text-destructive/70">-{CURRENCY.symbol} {summary.totalDiscounts.toFixed(2)}</span>
            </div>
          </div>

          {session && drawerExpected !== null && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1.5">
                <Wallet size={13} /> Drawer
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Opening Float</span>
                  <span className="text-gray-300">{CURRENCY.symbol} {(session.openingBalance ?? 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Cash Sales</span>
                  <span className="text-success">+{CURRENCY.symbol} {(session.cashSalesTotal ?? 0).toFixed(2)}</span>
                </div>
                {(session.cashRepaymentsTotal ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Credit Repayments</span>
                    <span className="text-success">+{CURRENCY.symbol} {(session.cashRepaymentsTotal ?? 0).toFixed(2)}</span>
                  </div>
                )}
                {(session.cashRefundsTotal ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Cash Refunds</span>
                    <span className="text-destructive">-{CURRENCY.symbol} {(session.cashRefundsTotal ?? 0).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold border-t border-gray-800 pt-2">
                  <span className="text-gray-300">Expected in Drawer</span>
                  <span className="text-primary">{CURRENCY.symbol} {drawerExpected.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          <Button onClick={onClose} className="w-full h-12 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-bold">
            Close Summary
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
