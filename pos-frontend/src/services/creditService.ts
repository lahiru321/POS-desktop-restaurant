import api from './api';
import { ApiResponse, Page as PageResponse } from '@/types/common';

export interface CreditSummary {
  customerId: string;
  creditLimit: number;
  creditBalance: number;
  availableCredit: number;
}

export interface CreditTransaction {
  id: string;
  /** CHARGE, REPAYMENT or ADJUST. */
  type: 'CHARGE' | 'REPAYMENT' | 'ADJUST';
  /** Signed amount (positive charged, negative repaid). */
  amount: number;
  /** Outstanding balance after this entry. */
  balanceAfter: number;
  /** Repayments only: CASH/CARD/ONLINE. */
  paymentMethod?: string | null;
  description?: string | null;
  saleId?: string | null;
  createdAt: string;
}

export interface RepaymentRequest {
  amount: number;
  paymentMethod: 'CASH' | 'CARD' | 'ONLINE';
  description?: string;
}

export const creditService = {
  getSummary: (customerId: string) =>
    api.get<ApiResponse<CreditSummary>>(`/credit/customers/${customerId}/summary`)
      .then(res => res.data.data),

  getLedger: (customerId: string, params?: { page?: number; size?: number }) =>
    api.get<ApiResponse<PageResponse<CreditTransaction>>>(`/credit/customers/${customerId}`, { params })
      .then(res => res.data.data),

  recordRepayment: (customerId: string, data: RepaymentRequest) =>
    api.post<ApiResponse<CreditSummary>>(`/credit/customers/${customerId}/repay`, data)
      .then(res => res.data.data),
};
