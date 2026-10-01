import api from './api';
import { ApiResponse } from '@/types/common';

/** The unit an ingredient is bought, counted and costed in. */
export type IngredientUnit = 'KG' | 'G' | 'L' | 'ML' | 'PCS';

export type IngredientMovementType = 'PURCHASE' | 'WASTAGE' | 'COUNT' | 'ADJUST';

export interface Ingredient {
  id: string;
  name: string;
  unit: IngredientUnit;
  costPerUnit: number;
  /** 0 = never alert. */
  lowStockThreshold: number;
  primarySupplierId?: string | null;
  primarySupplierName?: string | null;
  isActive: boolean;
  /** On hand at the requested branch, or summed over the caller's branches. */
  quantity: number;
  /** quantity x costPerUnit. */
  stockValue: number;
  isLowStock: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IngredientRequest {
  name: string;
  unit: IngredientUnit;
  costPerUnit?: number;
  lowStockThreshold?: number;
  primarySupplierId?: string | null;
}

/**
 * WASTAGE: how much was thrown away. COUNT: what is physically there now.
 * ADJUST: a signed correction. Stock is bought by receiving a purchase order.
 */
export interface IngredientAdjustRequest {
  branchId: string;
  type: Exclude<IngredientMovementType, 'PURCHASE'>;
  quantity: number;
  reason?: string;
}

export interface IngredientMovement {
  id: string;
  type: IngredientMovementType;
  branchId: string;
  branchName: string;
  quantityChange: number;
  quantityAfter: number;
  unitCost?: number | null;
  /** The purchase order behind a PURCHASE. */
  referenceId?: string | null;
  reason?: string | null;
  createdByName?: string | null;
  createdAt: string;
}

export interface PagedIngredientMovements {
  content: IngredientMovement[];
  totalElements: number;
  totalPages: number;
  number: number;
  last: boolean;
}

export const ingredientService = {
  getIngredients: (branchId?: string, includeInactive = false) =>
    api
      .get<ApiResponse<Ingredient[]>>('/ingredients', {
        params: { ...(branchId ? { branchId } : {}), includeInactive },
      })
      .then((res) => res.data.data),

  getLowStock: (branchId?: string) =>
    api
      .get<ApiResponse<Ingredient[]>>('/ingredients/low-stock', { params: branchId ? { branchId } : {} })
      .then((res) => res.data.data),

  createIngredient: (data: IngredientRequest) =>
    api.post<ApiResponse<Ingredient>>('/ingredients', data).then((res) => res.data.data),

  updateIngredient: (id: string, data: IngredientRequest) =>
    api.put<ApiResponse<Ingredient>>(`/ingredients/${id}`, data).then((res) => res.data.data),

  toggleStatus: (id: string) =>
    api.patch<ApiResponse<Ingredient>>(`/ingredients/${id}/status`).then((res) => res.data.data),

  adjustStock: (id: string, data: IngredientAdjustRequest) =>
    api.post<ApiResponse<Ingredient>>(`/ingredients/${id}/adjust`, data).then((res) => res.data.data),

  getMovements: (id: string, branchId?: string, page = 0, size = 20) =>
    api
      .get<ApiResponse<PagedIngredientMovements>>(`/ingredients/${id}/movements`, {
        params: { ...(branchId ? { branchId } : {}), page, size },
      })
      .then((res) => res.data.data),
};
