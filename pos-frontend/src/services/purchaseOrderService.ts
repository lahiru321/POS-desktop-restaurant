import api from './api';

export type POStatus = 'DRAFT' | 'ORDERED' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';

export type PurchaseOrderItemType = 'PRODUCT' | 'INGREDIENT';

export interface PurchaseOrderItem {
  id: string;
  itemType: PurchaseOrderItemType;
  /** The product's or the ingredient's name. */
  name: string;
  /** The ingredient's unit (KG, L, ...); PCS for a packaged item. */
  unit: string;
  productId?: string | null;
  ingredientId?: string | null;
  productName: string;
  sku?: string | null;
  /** Up to 3 decimals on an ingredient line (2.5 kg); whole on a packaged item. */
  orderedQuantity: number;
  receivedQuantity: number;
  unitCost: number;
  totalCost: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  branchId: string;
  branchName: string;
  status: POStatus;
  expectedDate?: string;
  totalAmount: number;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  receivedBy?: string;
  receivedByName?: string;
  items: PurchaseOrderItem[];
  createdAt: string;
  updatedAt: string;
}

/** Exactly one of productId (a stock-tracked menu item) or ingredientId. */
export interface PurchaseOrderItemRequest {
  productId?: string;
  ingredientId?: string;
  quantity: number;
  unitCost: number;
}

export interface PurchaseOrderRequest {
  supplierId: string;
  branchId: string;
  expectedDate?: string;
  notes?: string;
  items: PurchaseOrderItemRequest[];
}

export interface ReceivePoItemRequest {
  poItemId: string;
  receivedQuantity: number;
}

export interface PagedPurchaseOrders {
  content: PurchaseOrder[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  last: boolean;
  first: boolean;
}

export const purchaseOrderService = {
  getPurchaseOrders: async (
    page = 0,
    size = 10,
    options?: {
      sort?: string;
      status?: POStatus;
      supplierId?: string;
      search?: string;
    }
  ) => {
    const params = new URLSearchParams({
      page: page.toString(),
      size: size.toString(),
    });

    if (options?.sort) params.append('sort', options.sort);
    if (options?.status) params.append('status', options.status);
    if (options?.supplierId) params.append('supplierId', options.supplierId);
    if (options?.search && options.search.trim()) params.append('search', options.search.trim());

    const response = await api.get<{ data: PagedPurchaseOrders }>(`/purchase-orders?${params.toString()}`);
    return response.data.data;
  },

  getPurchaseOrder: async (id: string) => {
    const response = await api.get<{ data: PurchaseOrder }>(`/purchase-orders/${id}`);
    return response.data.data;
  },

  createPurchaseOrder: async (data: PurchaseOrderRequest) => {
    const response = await api.post<{ data: PurchaseOrder }>('/purchase-orders', data);
    return response.data.data;
  },

  updatePurchaseOrderStatus: async (id: string, status: POStatus) => {
    const response = await api.patch<{ data: PurchaseOrder }>(`/purchase-orders/${id}/status?status=${status}`);
    return response.data.data;
  },

  receivePurchaseOrder: async (id: string, items: ReceivePoItemRequest[]) => {
    const response = await api.post<{ data: PurchaseOrder }>(`/purchase-orders/${id}/receive`, items);
    return response.data.data;
  },
};
