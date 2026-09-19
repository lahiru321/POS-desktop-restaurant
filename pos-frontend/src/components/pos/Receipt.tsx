'use client';

import React, { forwardRef } from 'react';
import { SaleResponse } from '@/services/salesService';
import { format } from 'date-fns';

interface ReceiptProps {
  sale: SaleResponse | null;
  tenant?: {
    name: string;
    addressLine1?: string;
    addressLine2?: string;
    phone?: string;
  };
  branch?: { name: string } | null;
  /** Store logo as a data URI, rendered above the store name when provided. */
  logoUrl?: string;
  /** Whether to show the Branch line — generally only in multi-branch setups. */
  showBranch?: boolean;
  tendered?: number;
  change?: number;
  /** e.g. "VAT 15%" — rendered inside the Tax line parentheses when provided. */
  taxLabel?: string;
}

const ITEM_NAME_MAX = 18; // thermal width constraint

export const Receipt = forwardRef<HTMLDivElement, ReceiptProps>(function Receipt(
  { sale, tenant, branch, logoUrl, showBranch = false, tendered, change, taxLabel },
  ref,
) {
  if (!sale) return null;

  const created = new Date(sale.createdAt);
  const storeName = tenant?.name || 'STORE';
  const firstName = sale.cashierName?.split(' ')[0] ?? sale.cashierName ?? 'Staff';
  const isCash = sale.paymentMethod === 'CASH';
  // Inclusive: tax is already inside the prices — break it out below the total
  // (LK tax-invoice requirement) instead of adding it as a line above.
  const taxInclusive = sale.taxInclusive ?? false;

  // Currency-agnostic number formatting — two decimals, aligns right via tabular-nums.
  const fmt = (n: number) => n.toFixed(2);

  return (
    <div
      ref={ref}
      className="p-3 bg-white text-black font-mono text-[12px] leading-[1.3] w-[80mm] tabular-nums"
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="text-center">
        {logoUrl && (
          /* eslint-disable-next-line @next/next/no-img-element -- print/standalone HTML, not a Next route */
          <img src={logoUrl} alt={storeName} className="mx-auto mb-1 max-h-16 w-auto object-contain" />
        )}
        <h1 className="font-bold uppercase text-[16px] tracking-wide">{storeName}</h1>
        {tenant?.addressLine1 && <p>{tenant.addressLine1}</p>}
        {tenant?.addressLine2 && <p>{tenant.addressLine2}</p>}
        {tenant?.phone && <p>Phone: {tenant.phone}</p>}
      </div>

      <div className="border-t border-dashed border-black my-2" />

      {/* ── Meta ───────────────────────────────────────────────────────── */}
      <div>
        <p>Invoice No: {sale.invoiceNumber}</p>
        <p>Date: {format(created, 'dd-MM-yyyy')}</p>
        <p>Time: {format(created, 'HH:mm')}</p>
        <p>Cashier: {firstName}</p>
        {showBranch && branch?.name && <p>Branch: {branch.name}</p>}
        {sale.customerName && <p>Customer: {sale.customerName}</p>}
      </div>

      <div className="border-t border-dashed border-black my-2" />

      {/* ── Items ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-[1fr_28px_52px_56px] gap-1 font-semibold">
        <span>Item</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Price</span>
        <span className="text-right">Total</span>
      </div>

      <div className="border-t border-dashed border-black my-1" />

      {sale.items.map((item, idx) => {
        const name =
          item.productName.length > ITEM_NAME_MAX
            ? item.productName.slice(0, ITEM_NAME_MAX - 1) + '…'
            : item.productName;
        const lineTotal = item.unitPrice * item.quantity;
        return (
          <div key={idx} className="grid grid-cols-[1fr_28px_52px_56px] gap-1">
            <span className="truncate">{name}</span>
            <span className="text-right">{item.quantity}</span>
            <span className="text-right">{fmt(item.unitPrice)}</span>
            <span className="text-right">{fmt(lineTotal)}</span>
          </div>
        );
      })}

      <div className="border-t border-dashed border-black my-2" />

      {/* ── Summary ────────────────────────────────────────────────────── */}
      <div>
        <p className="flex justify-between">
          <span>Subtotal:</span>
          <span>{fmt(sale.totalAmount)}</span>
        </p>
        {sale.discountAmount > 0 && (
          <p className="flex justify-between">
            <span>Discount:</span>
            <span>{fmt(sale.discountAmount)}</span>
          </p>
        )}
        {!taxInclusive && (
          <p className="flex justify-between">
            <span>Tax{taxLabel ? ` (${taxLabel})` : ''}:</span>
            <span>{fmt(sale.taxAmount)}</span>
          </p>
        )}
        {(sale.loyaltyDiscountAmount ?? 0) > 0 && (
          <p className="flex justify-between">
            <span>Points redeemed:</span>
            <span>- {fmt(sale.loyaltyDiscountAmount ?? 0)}</span>
          </p>
        )}
      </div>

      <div className="border-t border-dashed border-black my-2" />

      <p className="flex justify-between font-bold text-[15px]">
        <span>TOTAL:</span>
        <span>{fmt(sale.netAmount)}</span>
      </p>

      {taxInclusive && (
        <div className="mt-1">
          <p className="flex justify-between">
            <span>Taxable value:</span>
            <span>{fmt(sale.netAmount - sale.taxAmount)}</span>
          </p>
          <p className="flex justify-between">
            <span>{taxLabel || 'VAT'} (incl.):</span>
            <span>{fmt(sale.taxAmount)}</span>
          </p>
        </div>
      )}

      {isCash ? (
        <div className="mt-1">
          <p className="flex justify-between">
            <span>Cash:</span>
            <span>{fmt(tendered ?? sale.amountTendered ?? sale.netAmount)}</span>
          </p>
          <p className="flex justify-between">
            <span>Change:</span>
            <span>{fmt(change ?? sale.changeDue ?? 0)}</span>
          </p>
        </div>
      ) : (
        <p className="flex justify-between mt-1">
          <span>Paid:</span>
          <span>{sale.paymentMethod === 'CREDIT' ? 'On Account' : sale.paymentMethod}</span>
        </p>
      )}

      {(sale.customerName && ((sale.earnedPoints ?? 0) > 0 || sale.loyaltyBalance != null)) && (
        <>
          <div className="border-t border-dashed border-black my-2" />
          <div className="text-center">
            {(sale.earnedPoints ?? 0) > 0 && <p>Points earned: {sale.earnedPoints}</p>}
            {sale.loyaltyBalance != null && <p>Points balance: {sale.loyaltyBalance}</p>}
          </div>
        </>
      )}

      <div className="border-t border-dashed border-black my-2" />

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div className="text-center">
        <p className="font-bold">Thank You For Shopping!</p>
        <p>Return within 7 days with receipt.</p>
        <p className="mt-2 text-[10px]">Powered by Lumora Tech</p>
      </div>
    </div>
  );
});

Receipt.displayName = 'Receipt';
