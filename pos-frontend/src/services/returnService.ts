import api from "./api";
import { ApiResponse, Page } from "@/types/common";

export type ReturnStatus = 'PENDING' | 'APPROVED' | 'COMPLETED' | 'REJECTED';
export type RefundMethod = 'ORIGINAL' | 'CASH' | 'STORE_CREDIT';
export type ReturnType = 'REFUND' | 'EXCHANGE' | 'DAMAGED_WRITEOFF';

export interface ReturnItemRequest {
  saleItemId: string;
  /** Ignored by the server, which reads it off the sale line. Null for an
   *  add-on or a custom line, which have no product. */
  productId?: string | null;
  quantity: number;
}

export interface ExchangeItemRequest {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface ReturnRequest {
  saleId: string;
  reason: string;
  returnType?: ReturnType;
  refundMethod: RefundMethod;
  notes?: string;
  items: ReturnItemRequest[];
  exchangeItems?: ExchangeItemRequest[];
}

export interface ReturnItemResponse {
  id: string;
  saleItemId: string;
  productId: string;
  productName?: string;
  quantityReturned: number;
  unitPrice: number;
  refundAmount: number;
}

export interface ReturnResponse {
  id: string;
  saleId: string;
  returnNumber: string;
  invoiceNumber: string;
  reason: string;
  returnType: ReturnType;
  status: ReturnStatus;
  refundAmount: number;
  refundMethod: RefundMethod;
  processedBy: string;
  processedByName: string;
  approvedBy?: string;
  approvedByName?: string;
  notes?: string;
  exchangeSaleId?: string;
  exchangeTotal?: number;
  priceDifference?: number;
  items: ReturnItemResponse[];
  createdAt: string;
  updatedAt: string;
}

export const returnService = {
  createReturn: (data: ReturnRequest) => 
    api.post<ApiResponse<ReturnResponse>>("/returns", data).then(res => res.data.data),
  
  getReturn: (id: string) => 
    api.get<ApiResponse<ReturnResponse>>(`/returns/${id}`).then(res => res.data.data),

  getReturnsBySale: (saleId: string) => 
    api.get<ApiResponse<ReturnResponse[]>>(`/returns/sale/${saleId}`).then(res => res.data.data),

  getAllReturns: (params?: { page?: number; size?: number }) => 
    api.get<ApiResponse<Page<ReturnResponse>>>("/returns", { params }).then(res => res.data.data),

  approveReturn: (id: string, approve: boolean) => 
    api.put<ApiResponse<ReturnResponse>>(`/returns/${id}/approve`, null, { params: { approve } }).then(res => res.data.data),

  processExchange: (data: ReturnRequest) => 
    api.post<ApiResponse<ReturnResponse>>("/returns/exchange", data).then(res => res.data.data),
};
