import api from './api';

export interface TenantInfo {
  id: string;
  name: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
  receiptFooter?: string | null;
  /** Loyalty program settings (always present — server fills defaults). */
  loyaltyEnabled: boolean;
  /** Currency spent to earn 1 point (e.g. 10 → 1 pt per LKR 10). */
  loyaltySpendPerPoint: number;
  /** Cash value of 1 point when redeemed (e.g. 0.10 → 100 pts = LKR 10). */
  loyaltyPointValue: number;
  /** True if shelf prices are VAT-inclusive (tax extracted for the invoice) vs
   *  exclusive (tax added at the till). Defaults to inclusive (LK convention). */
  taxInclusive: boolean;
  /** True if this business runs as a restaurant (tables, tabs, kitchen tickets).
   *  The second half of the two-level gate — the RESTAURANT feature flag says the
   *  API exists, this says the business wants it. Defaults to false. */
  restaurantMode: boolean;
  /** Covers (seated guests) pre-filled when a new dine-in tab is opened. */
  defaultCovers: number;
}

export interface TenantInfoUpdateRequest {
  name: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
  receiptFooter?: string | null;
  /** Omit to leave loyalty settings unchanged. */
  loyaltyEnabled?: boolean;
  loyaltySpendPerPoint?: number;
  loyaltyPointValue?: number;
  /** Omit to leave the pricing mode unchanged. */
  taxInclusive?: boolean;
  /** Omit to leave the restaurant settings unchanged. */
  restaurantMode?: boolean;
  defaultCovers?: number;
}

export const tenantService = {
  getInfo: async (): Promise<TenantInfo> => {
    const res = await api.get<{ data: TenantInfo }>('/tenant/info');
    return res.data.data;
  },

  updateInfo: async (data: TenantInfoUpdateRequest): Promise<TenantInfo> => {
    const res = await api.put<{ data: TenantInfo }>('/tenant/info', data);
    return res.data.data;
  },

  /**
   * Validates a logo image server-side and returns it as a data URI. The URI is
   * only persisted when subsequently passed to updateInfo as `logoUrl`.
   */
  uploadLogo: async (file: File): Promise<string> => {
    const form = new FormData();
    form.append('file', file);
    const res = await api.post<{ data: { logoUrl: string } }>('/tenant/info/logo', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data.data.logoUrl;
  },
};
