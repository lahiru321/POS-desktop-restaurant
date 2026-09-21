// ──────────────────────────────────────────────
// Platform Stats
// ──────────────────────────────────────────────
export interface PlatformStatsResponse {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  smallBusinessCount: number;
  mediumBusinessCount: number;
  enterpriseCount: number;
  expiredSubscriptions: number;
  projectedMrr: number;
}

// ──────────────────────────────────────────────
// Plan Tier & Feature Enum Types
// ──────────────────────────────────────────────
export type PlanTier = 'SMALL_BUSINESS' | 'MEDIUM_BUSINESS' | 'ENTERPRISE';

export type Feature =
  | 'SALES'
  | 'INVENTORY'
  | 'REPORTS'
  | 'CUSTOMERS'
  | 'EMPLOYEES'
  | 'PURCHASE_ORDERS'
  | 'STOCK_TRANSFERS'
  | 'RETURNS'
  | 'TAX_CONFIG'
  | 'TIME_CLOCK'
  | 'ADVANCED_ANALYTICS'
  | 'API_ACCESS'
  | 'EXPENSES'
  | 'FINANCIAL_REPORTS'
  | 'BRANCH_RESTRICTIONS'
  | 'STORE_CREDIT'
  | 'RESTAURANT';

// ──────────────────────────────────────────────
// Tenant Summary (used in list view)
// ──────────────────────────────────────────────
export interface TenantSummaryResponse {
  id: string;
  name: string;
  domain: string;
  planTier: PlanTier;
  isActive: boolean;
  isSubscriptionExpired: boolean;
  subscriptionEnd: string | null;
  maxLocations: number;
  maxUsers: number;
  maxProducts: number;
  createdAt: string;
}

export interface PagedTenantResponse {
  content: TenantSummaryResponse[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  last: boolean;
  first: boolean;
}

// ──────────────────────────────────────────────
// Tenant Usage Statistics (live counters)
// ──────────────────────────────────────────────
export interface TenantUsageStats {
  activeLocations: number;
  activeUsers: number;
  totalProducts: number;
  totalOrders: number;
  lifetimeRevenue: number;
}

// ──────────────────────────────────────────────
// Tenant Detail (full page response)
// ──────────────────────────────────────────────
export interface TenantDetailResponse {
  // Core identity
  id: string;
  name: string;
  domain: string;
  slug: string;
  createdAt: string;

  // Business profile (set by the tenant under Settings)
  addressLine1: string | null;
  addressLine2: string | null;
  phone: string | null;
  logoUrl: string | null;
  receiptFooter: string | null;

  // Status
  isActive: boolean;
  isSubscriptionExpired: boolean;

  // Configuration
  planTier: PlanTier;
  featuresEnabled: Feature[];
  maxLocations: number;
  maxUsers: number;
  maxProducts: number;
  subscriptionStart: string | null;
  subscriptionEnd: string | null;
  notes: string | null;

  // Live usage counters
  usage: TenantUsageStats;
}

// ──────────────────────────────────────────────
// Tenant Users (detail → Users tab; also the "forgot email" lookup)
// ──────────────────────────────────────────────
export interface TenantUserResponse {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  active: boolean;
  mustChangePassword: boolean;
  roles: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

// ──────────────────────────────────────────────
// Tenant Provisioning Payload
// ──────────────────────────────────────────────
export interface CreateTenantRequest {
  name: string;
  domain: string;
  planTier: PlanTier;
  adminEmail: string;
  adminFirstName: string;
  adminLastName: string;
  adminPassword: string;
}

// ──────────────────────────────────────────────
// Tenant Configuration Update Payload
// ──────────────────────────────────────────────
export interface TenantConfigurationRequest {
  planTier: PlanTier;
  featuresEnabled: Feature[];
  maxLocations: number;
  maxUsers: number;
  maxProducts: number;
  subscriptionStart: string | null;
  subscriptionEnd: string | null;
  notes: string | null;
}
