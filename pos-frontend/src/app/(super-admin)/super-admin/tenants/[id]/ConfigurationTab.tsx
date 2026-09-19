'use client';

import React, { useState, useEffect } from 'react';
import {
  TenantDetailResponse,
  TenantConfigurationRequest,
  PlanTier,
  Feature,
} from '@/types/superAdmin';
import {
  ShoppingCart,
  Package,
  BarChart3,
  Users,
  UserCog,
  ClipboardList,
  ArrowLeftRight,
  RotateCcw,
  Receipt,
  Clock,
  LineChart,
  Plug,
  Save,
  Loader2,
  ChevronDown,
  Wallet,
  TrendingUp,
  Building2,
} from 'lucide-react';

// ── Plan tier presets ──
const PLAN_DEFAULTS: Record<PlanTier, { maxLocations: number; maxUsers: number; maxProducts: number; features: Feature[] }> = {
  SMALL_BUSINESS: {
    maxLocations: 1,
    maxUsers: 5,
    maxProducts: 500,
    features: ['SALES', 'INVENTORY', 'REPORTS', 'CUSTOMERS', 'EMPLOYEES'],
  },
  MEDIUM_BUSINESS: {
    maxLocations: 3,
    maxUsers: 15,
    maxProducts: 5000,
    features: ['SALES', 'INVENTORY', 'REPORTS', 'CUSTOMERS', 'EMPLOYEES', 'PURCHASE_ORDERS', 'RETURNS', 'TAX_CONFIG', 'EXPENSES', 'FINANCIAL_REPORTS', 'STORE_CREDIT'],
  },
  ENTERPRISE: {
    maxLocations: 999,
    maxUsers: 999,
    maxProducts: 999999,
    features: ['SALES', 'INVENTORY', 'REPORTS', 'CUSTOMERS', 'EMPLOYEES', 'PURCHASE_ORDERS', 'STOCK_TRANSFERS', 'RETURNS', 'TAX_CONFIG', 'TIME_CLOCK', 'ADVANCED_ANALYTICS', 'API_ACCESS', 'EXPENSES', 'FINANCIAL_REPORTS', 'STORE_CREDIT'],
  },
};

// ── Feature metadata for the grid ──
const ALL_FEATURES: { key: Feature; label: string; description: string; icon: React.ReactNode; tier: 'core' | 'advanced' | 'enterprise' }[] = [
  { key: 'SALES', label: 'Sales & POS', description: 'Terminal checkout and transactions', icon: <ShoppingCart className="w-4 h-4" />, tier: 'core' },
  { key: 'INVENTORY', label: 'Inventory', description: 'Stock tracking and management', icon: <Package className="w-4 h-4" />, tier: 'core' },
  { key: 'REPORTS', label: 'Reports', description: 'Sales and X/Z reports', icon: <BarChart3 className="w-4 h-4" />, tier: 'core' },
  { key: 'CUSTOMERS', label: 'Customers', description: 'CRM and loyalty tracking', icon: <Users className="w-4 h-4" />, tier: 'core' },
  { key: 'EMPLOYEES', label: 'Employees', description: 'Staff profiles and permissions', icon: <UserCog className="w-4 h-4" />, tier: 'core' },
  { key: 'PURCHASE_ORDERS', label: 'Purchase Orders', description: 'Supplier PO management', icon: <ClipboardList className="w-4 h-4" />, tier: 'advanced' },
  { key: 'STOCK_TRANSFERS', label: 'Stock Transfers', description: 'Inter-branch stock movement', icon: <ArrowLeftRight className="w-4 h-4" />, tier: 'advanced' },
  { key: 'RETURNS', label: 'Returns & Refunds', description: 'Full/partial refund workflows', icon: <RotateCcw className="w-4 h-4" />, tier: 'advanced' },
  { key: 'TAX_CONFIG', label: 'Tax Configuration', description: 'Tax rules and rates', icon: <Receipt className="w-4 h-4" />, tier: 'enterprise' },
  { key: 'TIME_CLOCK', label: 'Time Clock', description: 'Employee clock-in/out', icon: <Clock className="w-4 h-4" />, tier: 'enterprise' },
  { key: 'ADVANCED_ANALYTICS', label: 'Advanced Analytics', description: 'Profitability and deep insights', icon: <LineChart className="w-4 h-4" />, tier: 'enterprise' },
  { key: 'API_ACCESS', label: 'API Access', description: 'Third-party integrations', icon: <Plug className="w-4 h-4" />, tier: 'enterprise' },
  { key: 'EXPENSES', label: 'Expenses', description: 'Operating expense tracking', icon: <Wallet className="w-4 h-4" />, tier: 'advanced' },
  { key: 'FINANCIAL_REPORTS', label: 'Financial Reports', description: 'Net P&L and cash flow', icon: <TrendingUp className="w-4 h-4" />, tier: 'advanced' },
  { key: 'BRANCH_RESTRICTIONS', label: 'Branch Access Control', description: 'Limit staff to assigned branches', icon: <Building2 className="w-4 h-4" />, tier: 'advanced' },
  { key: 'STORE_CREDIT', label: 'Store Credit', description: 'Buy-now-pay-later customer accounts', icon: <Wallet className="w-4 h-4" />, tier: 'advanced' },
];

interface Props {
  tenant: TenantDetailResponse;
  onSave: (payload: TenantConfigurationRequest) => Promise<void>;
  saving: boolean;
}

export default function ConfigurationTab({ tenant, onSave, saving }: Props) {
  const [planTier, setPlanTier] = useState<PlanTier>(tenant.planTier);
  const [features, setFeatures] = useState<Feature[]>([...tenant.featuresEnabled]);
  const [maxLocations, setMaxLocations] = useState(tenant.maxLocations);
  const [maxUsers, setMaxUsers] = useState(tenant.maxUsers);
  const [maxProducts, setMaxProducts] = useState(tenant.maxProducts);
  const [subStart, setSubStart] = useState(tenant.subscriptionStart || '');
  const [subEnd, setSubEnd] = useState(tenant.subscriptionEnd || '');
  const [notes, setNotes] = useState(tenant.notes || '');

  // Reset form when tenant data refreshes (e.g. after save)
  useEffect(() => {
    setPlanTier(tenant.planTier);
    setFeatures([...tenant.featuresEnabled]);
    setMaxLocations(tenant.maxLocations);
    setMaxUsers(tenant.maxUsers);
    setMaxProducts(tenant.maxProducts);
    setSubStart(tenant.subscriptionStart || '');
    setSubEnd(tenant.subscriptionEnd || '');
    setNotes(tenant.notes || '');
  }, [tenant]);

  const handlePlanChange = (newPlan: PlanTier) => {
    setPlanTier(newPlan);
    const defaults = PLAN_DEFAULTS[newPlan];
    setFeatures([...defaults.features]);
    setMaxLocations(defaults.maxLocations);
    setMaxUsers(defaults.maxUsers);
    setMaxProducts(defaults.maxProducts);
  };

  const toggleFeature = (feature: Feature) => {
    setFeatures((prev) =>
      prev.includes(feature) ? prev.filter((f) => f !== feature) : [...prev, feature]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      planTier,
      featuresEnabled: features,
      maxLocations,
      maxUsers,
      maxProducts,
      subscriptionStart: subStart || null,
      subscriptionEnd: subEnd || null,
      notes: notes || null,
    });
  };

  const tierColors: Record<string, string> = {
    core: 'bg-blue-50 text-blue-700 border-blue-200',
    advanced: 'bg-purple-50 text-purple-700 border-purple-200',
    enterprise: 'bg-amber-50 text-amber-700 border-amber-200',
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Plan Tier Selector */}
      <div>
        <h3 className="text-base font-bold text-muted-foreground mb-1">Base Plan Tier</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Selecting a plan pre-fills the default limits and features. You can override individually below.
        </p>
        <div className="relative w-full max-w-xs">
          <select
            value={planTier}
            onChange={(e) => handlePlanChange(e.target.value as PlanTier)}
            className="w-full appearance-none bg-background border border-border rounded-xl px-4 py-3 pr-10 text-sm font-semibold text-muted-foreground focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer"
          >
            <option value="SMALL_BUSINESS">Small Business</option>
            <option value="MEDIUM_BUSINESS">Medium Business</option>
            <option value="ENTERPRISE">Enterprise</option>
          </select>
          <ChevronDown className="w-4 h-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {/* Resource Limits */}
      <div>
        <h3 className="text-base font-bold text-muted-foreground mb-1">Resource Limits</h3>
        <p className="text-sm text-muted-foreground mb-4">Override the plan defaults for this specific tenant.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <LimitInput label="Max Branches" value={maxLocations} onChange={setMaxLocations} />
          <LimitInput label="Max Users" value={maxUsers} onChange={setMaxUsers} />
          <LimitInput label="Max Products" value={maxProducts} onChange={setMaxProducts} />
        </div>
      </div>

      {/* Feature Toggle Grid */}
      <div>
        <h3 className="text-base font-bold text-muted-foreground mb-1">Feature Matrix</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Toggle individual modules on or off. Overrides plan defaults for à la carte control.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ALL_FEATURES.map((feat) => {
            const isEnabled = features.includes(feat.key);
            return (
              <button
                key={feat.key}
                type="button"
                onClick={() => toggleFeature(feat.key)}
                className={`relative flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all duration-200 ${
                  isEnabled
                    ? 'border-blue-500 bg-blue-50/50 shadow-sm shadow-blue-500/10'
                    : 'border-border bg-background hover:border-border hover:bg-muted/50'
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                    isEnabled ? 'bg-blue-100 text-blue-600' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {feat.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${isEnabled ? 'text-muted-foreground' : 'text-muted-foreground'}`}>
                      {feat.label}
                    </span>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${tierColors[feat.tier]}`}>
                      {feat.tier}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{feat.description}</p>
                </div>
                {/* Toggle indicator */}
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                    isEnabled ? 'border-blue-500 bg-blue-500' : 'border-border bg-background'
                  }`}
                >
                  {isEnabled && (
                    <svg className="w-3 h-3 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Subscription Dates */}
      <div>
        <h3 className="text-base font-bold text-muted-foreground mb-1">Subscription Period</h3>
        <p className="text-sm text-muted-foreground mb-4">Leave expiry blank for unlimited subscriptions.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">Start Date</label>
            <input
              type="date"
              value={subStart ? subStart.substring(0, 10) : ''}
              onChange={(e) => setSubStart(e.target.value ? e.target.value + 'T00:00:00' : '')}
              className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">Expiry Date</label>
            <input
              type="date"
              value={subEnd ? subEnd.substring(0, 10) : ''}
              onChange={(e) => setSubEnd(e.target.value ? e.target.value + 'T23:59:59' : '')}
              className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Admin Notes */}
      <div>
        <h3 className="text-base font-bold text-muted-foreground mb-1">Internal Notes</h3>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Private admin notes about this tenant..."
          className="w-full border border-border rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        />
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-4 border-t border-border">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-8 py-3 rounded-xl font-semibold shadow-lg shadow-blue-500/20 transition-all duration-200 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" /> Save Configuration
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function LimitInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-muted-foreground mb-1.5">{label}</label>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 1)}
        className="w-full border border-border rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
    </div>
  );
}
