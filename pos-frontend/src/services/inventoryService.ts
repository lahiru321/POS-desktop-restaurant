import api from "./api";
import { 
  Category, CategoryRequest, 
  Brand, BrandRequest, 
  Product, ProductRequest,
  LowStockResponse
} from "@/types/inventory";
import { ApiResponse, Page } from "@/types/common";

export interface ProductFilters {
  search?: string;
  categoryId?: string;
  brandId?: string;
  isActive?: boolean;
  sort?: string;
  [key: string]: string | number | boolean | undefined;
}

export const inventoryService = {
  // --- Categories ---
  getCategories: () => 
    api.get<ApiResponse<Category[]>>("/categories").then(res => res.data.data),
  
  getCategory: (id: string) => 
    api.get<ApiResponse<Category>>(`/categories/${id}`).then(res => res.data.data),
  
  createCategory: (data: CategoryRequest) => 
    api.post<ApiResponse<Category>>("/categories", data).then(res => res.data.data),
  
  updateCategory: (id: string, data: CategoryRequest) => 
    api.put<ApiResponse<Category>>(`/categories/${id}`, data).then(res => res.data.data),
  
  deleteCategory: (id: string) => 
    api.delete<ApiResponse<void>>(`/categories/${id}`).then(res => res.data.data),

  // --- Brands ---
  getBrands: () => 
    api.get<ApiResponse<Brand[]>>("/brands").then(res => res.data.data),
  
  getBrand: (id: string) => 
    api.get<ApiResponse<Brand>>(`/brands/${id}`).then(res => res.data.data),
  
  createBrand: (data: BrandRequest) => 
    api.post<ApiResponse<Brand>>("/brands", data).then(res => res.data.data),
  
  updateBrand: (id: string, data: BrandRequest) => 
    api.put<ApiResponse<Brand>>(`/brands/${id}`, data).then(res => res.data.data),
  
  deleteBrand: (id: string) => 
    api.delete<ApiResponse<void>>(`/brands/${id}`).then(res => res.data.data),

  // --- Products ---
  getProducts: (page = 0, size = 10, filters?: Record<string, string | number | boolean | undefined>) => {
    const params = new URLSearchParams({ page: page.toString(), size: size.toString() });
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          params.append(key, typeof value === 'boolean' ? value.toString() : String(value));
        }
      });
    }
    return api.get<ApiResponse<Page<Product>>>(`/products?${params.toString()}`).then(res => res.data.data);
  },
  
  /** Fast barcode/SKU lookup for POS terminal scanning */
  lookupByCode: (code: string, onlyActive = false) =>
    api.get<ApiResponse<Product>>(`/products/lookup?code=${encodeURIComponent(code)}&onlyActive=${onlyActive}`)
      .then(res => res.data.data),

  getProduct: (id: string) => 
    api.get<ApiResponse<Product>>(`/products/${id}`).then(res => res.data.data),
  
  toggleStatus: (id: string) =>
    api.patch<ApiResponse<Product>>(`/products/${id}/status`).then(res => res.data.data),

  bulkSetStatus: (ids: string[], active: boolean) =>
    api.post<ApiResponse<number>>(`/products/bulk-status`, { ids, active }).then(res => res.data.data),
  
  createProduct: (data: ProductRequest) => 
    api.post<ApiResponse<Product>>("/products", data).then(res => res.data.data),
  
  updateProduct: (id: string, data: ProductRequest) => 
    api.put<ApiResponse<Product>>(`/products/${id}`, data).then(res => res.data.data),
  
  updateStock: (id: string, quantityChange: number) => 
    api.patch<ApiResponse<void>>(`/products/${id}/stock?quantityChange=${quantityChange}`).then(res => res.data.data),
  
  deleteProduct: (id: string) => 
    api.delete<ApiResponse<void>>(`/products/${id}`).then(res => res.data.data),

  getLowStockAlerts: (branchId?: string, page = 0, size = 10) => {
    const params = new URLSearchParams();
    params.set('page', page.toString());
    params.set('size', size.toString());
    if (branchId) params.set('branchId', branchId);
    
    return api.get<ApiResponse<Page<LowStockResponse>>>(`/products/low-stock?${params.toString()}`)
      .then(res => res.data.data);
  },

  // --- Bulk Operations ---
  importProducts: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post("/products/import", formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }).then(res => res.data);
  },

  exportProducts: () => {
    // Same columns as the import template, so the file can be edited and imported back.
    return api.get("/products/export", { responseType: 'blob' }).then(res => {
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `menu_items_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    });
  },
};
