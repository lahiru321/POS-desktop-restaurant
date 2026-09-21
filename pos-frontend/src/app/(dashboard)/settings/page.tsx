"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { taxService, TaxRate, TaxRateRequest } from "@/services/taxService";
import { tenantService, TenantInfoUpdateRequest } from "@/services/tenantService";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Receipt } from "@/components/pos/Receipt";
import { HardwareSettings } from "@/components/settings/HardwareSettings";
import type { SaleResponse } from "@/services/salesService";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Settings,
  Plus,
  Edit2,
  Trash2,
  Percent,
  Shield,
  Star,
  Loader2,
  Info,
  AlertTriangle,
  Lock,
  Building2,
  Receipt as ReceiptIcon,
  Cpu,
  Image as ImageIcon,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn, CURRENCY } from "@/lib/utils";
import { FeatureGuard } from "@/components/auth/FeatureGuard";
import { QK } from "@/lib/queryKeys";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = !!user?.roles?.includes("ADMIN");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<TaxRate | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<TaxRate | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formRate, setFormRate] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [formIsActive, setFormIsActive] = useState(true);

  // Business info form state
  const [bizName, setBizName] = useState("");
  const [bizAddress1, setBizAddress1] = useState("");
  const [bizAddress2, setBizAddress2] = useState("");
  const [bizPhone, setBizPhone] = useState("");
  const [bizReceiptFooter, setBizReceiptFooter] = useState("");
  const [bizLogoUrl, setBizLogoUrl] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);

  // Loyalty settings form state
  const [loyEnabled, setLoyEnabled] = useState(true);
  const [loySpend, setLoySpend] = useState("10");
  const [loyValue, setLoyValue] = useState("0.10");

  // Pricing mode: true = shelf prices include VAT (extracted on the invoice),
  // false = VAT added at the till. Defaults to inclusive (LK convention).
  const [taxInclusive, setTaxInclusive] = useState(true);

  // Restaurant settings form state. `restaurantMode` is the tenant half of the
  // two-level gate (the RESTAURANT feature flag is the other half) — off means
  // the terminal behaves exactly like the retail build.
  const [restMode, setRestMode] = useState(false);
  const [restCovers, setRestCovers] = useState("2");

  const { data: tenantInfo, isLoading: tenantLoading } = useQuery({
    queryKey: QK.tenantInfo,
    queryFn: () => tenantService.getInfo(),
  });

  useEffect(() => {
    if (tenantInfo) {
      setBizName(tenantInfo.name ?? "");
      setBizAddress1(tenantInfo.addressLine1 ?? "");
      setBizAddress2(tenantInfo.addressLine2 ?? "");
      setBizPhone(tenantInfo.phone ?? "");
      setBizReceiptFooter(tenantInfo.receiptFooter ?? "");
      setBizLogoUrl(tenantInfo.logoUrl ?? "");
      setLoyEnabled(tenantInfo.loyaltyEnabled);
      setLoySpend(String(tenantInfo.loyaltySpendPerPoint ?? 10));
      setLoyValue(String(tenantInfo.loyaltyPointValue ?? 0.1));
      setTaxInclusive(tenantInfo.taxInclusive ?? true);
      setRestMode(tenantInfo.restaurantMode ?? false);
      setRestCovers(String(tenantInfo.defaultCovers ?? 2));
    }
  }, [tenantInfo]);

  const updateTenantMutation = useMutation({
    mutationFn: (data: TenantInfoUpdateRequest) => tenantService.updateInfo(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK.tenantInfo });
      toast.success("Business info saved");
    },
    onError: (error: unknown) => {
      toast.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          "Failed to save business info"
      );
    },
  });

  const handleSaveBusinessInfo = (e: React.FormEvent) => {
    e.preventDefault();
    updateTenantMutation.mutate({
      name: bizName.trim(),
      addressLine1: bizAddress1.trim() || null,
      addressLine2: bizAddress2.trim() || null,
      phone: bizPhone.trim() || null,
      receiptFooter: bizReceiptFooter.trim() || null,
      logoUrl: bizLogoUrl || null,
    });
  };

  const handleSetTaxInclusive = (next: boolean) => {
    if (!tenantInfo || next === taxInclusive) return;
    setTaxInclusive(next); // optimistic; reverts on refetch if the save fails
    updateTenantMutation.mutate({
      name: tenantInfo.name,
      addressLine1: tenantInfo.addressLine1 ?? null,
      addressLine2: tenantInfo.addressLine2 ?? null,
      phone: tenantInfo.phone ?? null,
      logoUrl: tenantInfo.logoUrl ?? null,
      receiptFooter: tenantInfo.receiptFooter ?? null,
      taxInclusive: next,
    });
  };

  const handleSaveLoyalty = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantInfo) return;
    const spend = Number(loySpend);
    const value = Number(loyValue);
    if (!Number.isFinite(spend) || spend <= 0) {
      toast.error("Spend-per-point must be greater than 0");
      return;
    }
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Point value must be 0 or more");
      return;
    }
    // The tenant update is a full replace — carry the current business fields
    // through so saving loyalty settings doesn't wipe the receipt header info.
    updateTenantMutation.mutate({
      name: tenantInfo.name,
      addressLine1: tenantInfo.addressLine1 ?? null,
      addressLine2: tenantInfo.addressLine2 ?? null,
      phone: tenantInfo.phone ?? null,
      logoUrl: tenantInfo.logoUrl ?? null,
      receiptFooter: tenantInfo.receiptFooter ?? null,
      loyaltyEnabled: loyEnabled,
      loyaltySpendPerPoint: spend,
      loyaltyPointValue: value,
    });
  };

  const handleSaveRestaurant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantInfo) return;
    const covers = Number(restCovers);
    if (!Number.isInteger(covers) || covers < 1 || covers > 99) {
      toast.error("Default covers must be a whole number between 1 and 99");
      return;
    }
    // The tenant update is a full replace — carry the current business fields
    // through so saving restaurant settings doesn't wipe the receipt header info.
    updateTenantMutation.mutate({
      name: tenantInfo.name,
      addressLine1: tenantInfo.addressLine1 ?? null,
      addressLine2: tenantInfo.addressLine2 ?? null,
      phone: tenantInfo.phone ?? null,
      logoUrl: tenantInfo.logoUrl ?? null,
      receiptFooter: tenantInfo.receiptFooter ?? null,
      restaurantMode: restMode,
      defaultCovers: covers,
    });
  };

  const restDirty =
    !!tenantInfo &&
    (restMode !== tenantInfo.restaurantMode || Number(restCovers) !== tenantInfo.defaultCovers);

  const loyDirty =
    !!tenantInfo &&
    (loyEnabled !== tenantInfo.loyaltyEnabled ||
      Number(loySpend) !== tenantInfo.loyaltySpendPerPoint ||
      Number(loyValue) !== tenantInfo.loyaltyPointValue);

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after a remove
    if (!file) return;
    setLogoUploading(true);
    try {
      const dataUri = await tenantService.uploadLogo(file);
      setBizLogoUrl(dataUri);
    } catch (error) {
      toast.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          "Failed to upload logo"
      );
    } finally {
      setLogoUploading(false);
    }
  };

  const bizDirty =
    !!tenantInfo &&
    (bizName.trim() !== (tenantInfo.name ?? "") ||
      bizAddress1.trim() !== (tenantInfo.addressLine1 ?? "") ||
      bizAddress2.trim() !== (tenantInfo.addressLine2 ?? "") ||
      bizPhone.trim() !== (tenantInfo.phone ?? "") ||
      bizReceiptFooter.trim() !== (tenantInfo.receiptFooter ?? "") ||
      bizLogoUrl !== (tenantInfo.logoUrl ?? ""));

  const { data: taxRates, isLoading } = useQuery({
    queryKey: ["tax-rates"],
    queryFn: taxService.getAllTaxRates,
  });

  const createMutation = useMutation({
    mutationFn: (data: TaxRateRequest) => taxService.createTaxRate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tax-rates"] });
      toast.success("Tax rate created successfully");
      closeModal();
    },
    onError: (error: unknown) => {
      toast.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to create tax rate"
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: TaxRateRequest }) =>
      taxService.updateTaxRate(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tax-rates"] });
      toast.success("Tax rate updated successfully");
      closeModal();
    },
    onError: (error: unknown) => {
      toast.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to update tax rate"
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => taxService.deleteTaxRate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tax-rates"] });
      toast.success("Tax rate deleted");
      setDeleteConfirm(null);
    },
    onError: (error: unknown) => {
      toast.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to delete tax rate"
      );
    },
  });

  const openCreate = () => {
    setEditingRate(null);
    setFormName("");
    setFormRate("");
    setFormDescription("");
    setFormIsDefault(false);
    setFormIsActive(true);
    setIsModalOpen(true);
  };

  const openEdit = (rate: TaxRate) => {
    setEditingRate(rate);
    setFormName(rate.name);
    setFormRate(rate.ratePercent.toString());
    setFormDescription(rate.description || "");
    setFormIsDefault(rate.isDefault);
    setFormIsActive(rate.isActive);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingRate(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: TaxRateRequest = {
      name: formName,
      rate: parseFloat(formRate),
      description: formDescription || undefined,
      isDefault: formIsDefault,
      isActive: formIsActive,
    };

    if (editingRate) {
      updateMutation.mutate({ id: editingRate.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  // Stats
  const activeCount = taxRates?.filter((r) => r.isActive).length || 0;
  const defaultRate = taxRates?.find((r) => r.isDefault);

  return (
    <div className="p-8 space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Settings className="text-primary" size={24} />
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          </div>
          <p className="text-muted-foreground">
            Configure your business rules and system preferences.
          </p>
        </div>
      </div>

      {/* Tab layout — sections stay scoped per tab so the page stays scannable
          even as more settings (receipt, hardware, advanced) get added. */}
      <Tabs defaultValue="business" orientation="vertical" className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6 items-start">
        <TabsList className="flex lg:flex-col h-auto bg-card/50 border border-border p-1 gap-1 w-full overflow-x-auto">
          <TabsTrigger value="business" className="lg:w-full lg:justify-start gap-2">
            <Building2 size={14} /> Business
          </TabsTrigger>
          <TabsTrigger value="tax" className="lg:w-full lg:justify-start gap-2">
            <Percent size={14} /> Tax
          </TabsTrigger>
          <TabsTrigger value="loyalty" className="lg:w-full lg:justify-start gap-2">
            <Star size={14} /> Loyalty
          </TabsTrigger>
          <TabsTrigger value="restaurant" className="lg:w-full lg:justify-start gap-2">
            <UtensilsCrossed size={14} /> Restaurant
          </TabsTrigger>
          <TabsTrigger value="receipt" className="lg:w-full lg:justify-start gap-2">
            <ReceiptIcon size={14} /> Receipt
          </TabsTrigger>
          <TabsTrigger value="hardware" className="lg:w-full lg:justify-start gap-2">
            <Cpu size={14} /> Hardware
          </TabsTrigger>
        </TabsList>

        <div className="space-y-6 min-w-0">
        <TabsContent value="business" className="space-y-4 mt-0">
        <div className="flex items-center gap-2">
          <Building2 className="text-primary" size={20} />
          <h2 className="text-xl font-semibold text-foreground">Business Info</h2>
          {!isAdmin && (
            <Badge variant="outline" className="bg-muted text-muted-foreground border-border ml-2">
              Read-only
            </Badge>
          )}
        </div>

        <Card className="bg-background border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-foreground">
              Receipt header details
            </CardTitle>
            <CardDescription>
              Store name, address, and phone shown at the top of every printed receipt.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tenantLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-4">
                <Loader2 className="animate-spin" size={18} /> Loading business info...
              </div>
            ) : (
              <form onSubmit={handleSaveBusinessInfo} className="space-y-4 max-w-2xl">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Store Name <span className="text-destructive">*</span>
                  </label>
                  <Input
                    value={bizName}
                    onChange={(e) => setBizName(e.target.value)}
                    placeholder="e.g. Lumora Grocery"
                    className="bg-card border-border"
                    maxLength={255}
                    required
                    disabled={!isAdmin}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      Address Line 1
                    </label>
                    <Input
                      value={bizAddress1}
                      onChange={(e) => setBizAddress1(e.target.value)}
                      placeholder="123 Business Avenue"
                      className="bg-card border-border"
                      maxLength={255}
                      disabled={!isAdmin}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      Address Line 2
                    </label>
                    <Input
                      value={bizAddress2}
                      onChange={(e) => setBizAddress2(e.target.value)}
                      placeholder="Colombo 05, Sri Lanka"
                      className="bg-card border-border"
                      maxLength={255}
                      disabled={!isAdmin}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Phone</label>
                  <Input
                    value={bizPhone}
                    onChange={(e) => setBizPhone(e.target.value)}
                    placeholder="011-2345678"
                    className="bg-card border-border max-w-xs"
                    maxLength={50}
                    disabled={!isAdmin}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Displayed on receipts as &ldquo;Phone: {bizPhone || "011-2345678"}&rdquo;
                  </p>
                </div>

                {isAdmin && (
                  <>
                    <div className="border-t border-border pt-4">
                      <p className="text-sm font-semibold text-foreground mb-3">Branding</p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Store Logo</label>
                      <div className="flex items-center gap-4">
                        <div className="h-20 w-20 shrink-0 rounded-lg border border-border bg-card flex items-center justify-center overflow-hidden">
                          {bizLogoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- user-supplied data URI, not a Next route
                            <img src={bizLogoUrl} alt="Store logo" className="max-h-full max-w-full object-contain" />
                          ) : (
                            <ImageIcon className="text-muted-foreground" size={24} />
                          )}
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <label
                              className={cn(
                                "inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium cursor-pointer hover:bg-foreground/5 transition-colors",
                                logoUploading && "opacity-60 pointer-events-none"
                              )}
                            >
                              {logoUploading ? (
                                <Loader2 className="animate-spin" size={14} />
                              ) : (
                                <ImageIcon size={14} />
                              )}
                              {bizLogoUrl ? "Replace logo" : "Upload logo"}
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/gif,image/webp"
                                className="hidden"
                                onChange={handleLogoChange}
                                disabled={logoUploading}
                              />
                            </label>
                            {bizLogoUrl && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setBizLogoUrl("")}
                                className="text-muted-foreground hover:text-destructive gap-1"
                              >
                                <X size={14} /> Remove
                              </Button>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            PNG, JPEG, GIF, or WebP. Max 512 KB. Printed at the top of every receipt.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Receipt Footer</label>
                      <textarea
                        value={bizReceiptFooter}
                        onChange={(e) => setBizReceiptFooter(e.target.value)}
                        placeholder="Return within 7 days with receipt."
                        className="w-full rounded-md bg-card border border-border text-sm text-foreground px-3 py-2 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                        rows={3}
                        maxLength={500}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Printed at the bottom of every receipt. Leave blank to use the default message.
                      </p>
                    </div>
                  </>
                )}

                {isAdmin && (
                  <div className="flex justify-end pt-2">
                    <Button
                      type="submit"
                      disabled={!bizDirty || !bizName.trim() || updateTenantMutation.isPending}
                      className="bg-primary hover:bg-primary/90 min-w-[140px]"
                    >
                      {updateTenantMutation.isPending && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Save Changes
                    </Button>
                  </div>
                )}
              </form>
            )}
          </CardContent>
        </Card>
        </TabsContent>

        <TabsContent value="tax" className="space-y-4 mt-0">
      {/* Tax Configuration Section */}
      <FeatureGuard
        feature="TAX_CONFIG"
        fallback={
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Percent className="text-muted-foreground" size={20} />
              <h2 className="text-xl font-semibold text-muted-foreground">Tax Configuration</h2>
              <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 ml-2">Premium</Badge>
            </div>
            <Card className="bg-background border-border border-dashed border-2">
              <CardContent className="h-64 flex flex-col items-center justify-center text-center p-8">
                <div className="w-16 h-16 rounded-full bg-card flex items-center justify-center mb-4">
                  <Lock className="text-muted-foreground" size={32} />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">Feature Locked</h3>
                <p className="text-muted-foreground text-sm max-w-sm mb-6">
                  Advanced tax configuration, category mapping, and multi-layered taxation are available in the <strong>Medium Business</strong> and <strong>Enterprise</strong> plans.
                </p>
                <Button className="bg-primary hover:bg-primary/90">
                  View Upgrade Plans
                </Button>
              </CardContent>
            </Card>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Percent className="text-primary" size={20} />
              <h2 className="text-xl font-semibold text-foreground">
                Tax Configuration
              </h2>
            </div>
            <Button
              onClick={openCreate}
              className="gap-2 bg-primary hover:bg-primary/90"
            >
              <Plus size={18} /> Add Tax Rate
            </Button>
          </div>

          {/* Info Banner */}
          <div className="bg-primary/5 border border-primary/10 rounded-xl p-4 flex gap-3 items-start">
            <Info className="text-primary shrink-0 mt-0.5" size={18} />
            <div className="text-sm text-indigo-300/80 leading-relaxed space-y-1">
              <p>
                Tax rates are applied to products based on their category. Assign
                a tax rate to a category, and all products in that category will
                use it.
              </p>
              <p className="text-primary/60">
                <strong>Resolution Order:</strong> Product Category Tax Rate →
                Default Tax Rate → 0% (tax-exempt)
              </p>
            </div>
          </div>

          {/* Pricing mode: inclusive vs exclusive VAT */}
          <Card className="bg-background border-border">
            <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">Pricing mode</p>
                <p className="text-sm text-muted-foreground max-w-xl">
                  {taxInclusive
                    ? "Prices include VAT. The marked price is what the customer pays; VAT is broken out on the invoice (Sri Lankan retail convention)."
                    : "Prices exclude VAT. VAT is added on top of the price at the till."}
                </p>
              </div>
              <div className="flex rounded-xl border border-border overflow-hidden shrink-0 self-start">
                <button
                  type="button"
                  onClick={() => handleSetTaxInclusive(true)}
                  disabled={updateTenantMutation.isPending}
                  className={`px-4 py-2 text-sm font-semibold transition-colors ${
                    taxInclusive
                      ? "bg-primary text-primary-foreground"
                      : "bg-transparent text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Inclusive
                </button>
                <button
                  type="button"
                  onClick={() => handleSetTaxInclusive(false)}
                  disabled={updateTenantMutation.isPending}
                  className={`px-4 py-2 text-sm font-semibold transition-colors border-l border-border ${
                    !taxInclusive
                      ? "bg-primary text-primary-foreground"
                      : "bg-transparent text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Exclusive
                </button>
              </div>
            </CardContent>
          </Card>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-background border-border">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Percent className="text-primary" size={22} />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Total Rates
                  </p>
                  <p className="text-2xl font-bold text-foreground">
                    {taxRates?.length || 0}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-background border-border">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center">
                  <Shield className="text-success" size={22} />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Active Rates
                  </p>
                  <p className="text-2xl font-bold text-foreground">{activeCount}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-background border-border">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center">
                  <Star className="text-warning" size={22} />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Default Rate
                  </p>
                  <p className="text-2xl font-bold text-foreground">
                    {defaultRate
                      ? `${defaultRate.ratePercent}%`
                      : "Not Set"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tax Rates Table */}
          <Card className="bg-background border-border overflow-hidden">
            <CardHeader className="bg-card/30 border-b border-border pb-4">
              <CardTitle className="text-base font-semibold text-foreground">
                Tax Rates Registry
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground font-bold uppercase text-[10px] tracking-widest pl-6">
                      Name
                    </TableHead>
                    <TableHead className="text-muted-foreground font-bold uppercase text-[10px] tracking-widest">
                      Rate
                    </TableHead>
                    <TableHead className="text-muted-foreground font-bold uppercase text-[10px] tracking-widest">
                      Description
                    </TableHead>
                    <TableHead className="text-muted-foreground font-bold uppercase text-[10px] tracking-widest">
                      Status
                    </TableHead>
                    <TableHead className="text-muted-foreground font-bold uppercase text-[10px] tracking-widest">
                      Type
                    </TableHead>
                    <TableHead className="text-right text-muted-foreground font-bold uppercase text-[10px] tracking-widest pr-6">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-48 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Loader2
                            className="animate-spin text-primary"
                            size={28}
                          />
                          <p className="text-sm font-medium">
                            Loading tax rates...
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : !taxRates || taxRates.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-48 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Percent size={40} className="opacity-10" />
                          <p className="text-sm font-medium">
                            No tax rates configured yet
                          </p>
                          <Button
                            variant="link"
                            className="text-primary"
                            onClick={openCreate}
                          >
                            Create your first tax rate
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    taxRates.map((rate) => (
                      <TableRow
                        key={rate.id}
                        className="border-border hover:bg-foreground/5 transition-colors group"
                      >
                        <TableCell className="py-4 pl-6">
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                "w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold",
                                rate.isActive
                                  ? "bg-primary/10 text-primary"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              %
                            </div>
                            <span className="font-semibold text-foreground">
                              {rate.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-lg font-black text-primary">
                            {rate.ratePercent}%
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {rate.description || "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={cn(
                              rate.isActive
                                ? "bg-success/10 text-success border-success/20"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {rate.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {rate.isDefault ? (
                            <Badge className="bg-warning/10 text-warning border-warning/20 gap-1">
                              <Star size={12} fill="currentColor" /> Default
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Standard
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Edit tax rate"
                              title="Edit"
                              className="h-8 w-8 text-primary hover:bg-primary/10"
                              onClick={() => openEdit(rate)}
                            >
                              <Edit2 size={15} />
                            </Button>
                            {!rate.isDefault && (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Delete tax rate"
                                title="Delete"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setDeleteConfirm(rate)}
                              >
                                <Trash2 size={15} />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </FeatureGuard>
        </TabsContent>

        <TabsContent value="loyalty" className="space-y-4 mt-0">
          <div className="flex items-center gap-2">
            <Star className="text-primary" size={20} />
            <h2 className="text-xl font-semibold text-foreground">Loyalty Program</h2>
            {!isAdmin && (
              <Badge variant="outline" className="bg-muted text-muted-foreground border-border ml-2">
                Read-only
              </Badge>
            )}
          </div>

          <Card className="bg-background border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-foreground">Points & redemption</CardTitle>
              <CardDescription>
                Reward customers with points as they spend, and let them redeem points for money off
                future purchases at the register.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tenantLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-4">
                  <Loader2 className="animate-spin" size={18} /> Loading loyalty settings...
                </div>
              ) : (
                <form onSubmit={handleSaveLoyalty} className="space-y-5 max-w-2xl">
                  <div className="flex items-center justify-between rounded-lg border border-border p-4">
                    <div className="space-y-0.5">
                      <label className="text-sm font-medium text-foreground">Enable loyalty program</label>
                      <p className="text-xs text-muted-foreground">
                        When off, no points are earned or redeemable at checkout.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      className="w-5 h-5 accent-primary rounded"
                      checked={loyEnabled}
                      onChange={(e) => setLoyEnabled(e.target.checked)}
                      disabled={!isAdmin}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Earn rate</label>
                      <div className="relative">
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={loySpend}
                          onChange={(e) => setLoySpend(e.target.value)}
                          className="bg-card border-border"
                          disabled={!isAdmin || !loyEnabled}
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Spend per point. e.g. <strong>{loySpend || "10"}</strong> means 1 point for every{" "}
                        {CURRENCY.symbol}
                        {loySpend || "10"} spent.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Point value</label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={loyValue}
                        onChange={(e) => setLoyValue(e.target.value)}
                        className="bg-card border-border"
                        disabled={!isAdmin || !loyEnabled}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Cash value of 1 point when redeemed. e.g. <strong>{loyValue || "0.10"}</strong> means 100
                        points = {CURRENCY.symbol}
                        {(Number(loyValue || "0.10") * 100).toFixed(2)} off.
                      </p>
                    </div>
                  </div>

                  {isAdmin && (
                    <div className="flex justify-end pt-2">
                      <Button
                        type="submit"
                        disabled={!loyDirty || updateTenantMutation.isPending}
                        className="bg-primary hover:bg-primary/90 min-w-[140px]"
                      >
                        {updateTenantMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Changes
                      </Button>
                    </div>
                  )}
                </form>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="restaurant" className="space-y-4 mt-0">
          <div className="flex items-center gap-2">
            <UtensilsCrossed className="text-primary" size={20} />
            <h2 className="text-xl font-semibold text-foreground">Restaurant</h2>
            {!isAdmin && (
              <Badge variant="outline" className="bg-muted text-muted-foreground border-border ml-2">
                Read-only
              </Badge>
            )}
          </div>

          <Card className="bg-background border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-foreground">Table service</CardTitle>
              <CardDescription>
                Turn this on if you serve guests at tables. The register gains table tabs and
                kitchen tickets; with it off the app behaves exactly like a retail till.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tenantLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-4">
                  <Loader2 className="animate-spin" size={18} /> Loading restaurant settings...
                </div>
              ) : (
                <form onSubmit={handleSaveRestaurant} className="space-y-5 max-w-2xl">
                  <div className="flex items-center justify-between rounded-lg border border-border p-4">
                    <div className="space-y-0.5">
                      <label className="text-sm font-medium text-foreground">Restaurant mode</label>
                      <p className="text-xs text-muted-foreground">
                        When off, no table, tab or kitchen features appear anywhere in the app.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      className="w-5 h-5 accent-primary rounded"
                      checked={restMode}
                      onChange={(e) => setRestMode(e.target.checked)}
                      disabled={!isAdmin}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Default covers</label>
                      <Input
                        type="number"
                        step="1"
                        min="1"
                        max="99"
                        value={restCovers}
                        onChange={(e) => setRestCovers(e.target.value)}
                        className="bg-card border-border"
                        disabled={!isAdmin || !restMode}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Guests pre-filled when a new dine-in tab is opened. The server can change it
                        per table.
                      </p>
                    </div>
                  </div>

                  {isAdmin && (
                    <div className="flex justify-end pt-2">
                      <Button
                        type="submit"
                        disabled={!restDirty || updateTenantMutation.isPending}
                        className="bg-primary hover:bg-primary/90 min-w-[140px]"
                      >
                        {updateTenantMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Changes
                      </Button>
                    </div>
                  )}
                </form>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="receipt" className="space-y-4 mt-0">
          <div className="flex items-center gap-2">
            <ReceiptIcon className="text-primary" size={20} />
            <h2 className="text-xl font-semibold text-foreground">Receipt</h2>
          </div>
          <Card className="bg-background border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-foreground">Live preview</CardTitle>
              <CardDescription>
                Preview of a receipt printed with your current Business Info. Edits in the Business
                tab show up here immediately — save them to apply to real sales.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ReceiptPreview
                businessName={bizName || tenantInfo?.name || "Your Store"}
                addressLine1={bizAddress1 || tenantInfo?.addressLine1 || undefined}
                addressLine2={bizAddress2 || tenantInfo?.addressLine2 || undefined}
                phone={bizPhone || tenantInfo?.phone || undefined}
                logoUrl={bizLogoUrl || tenantInfo?.logoUrl || undefined}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hardware" className="space-y-4 mt-0">
          <div className="flex items-center gap-2">
            <Cpu className="text-primary" size={20} />
            <h2 className="text-xl font-semibold text-foreground">Hardware</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Connect and configure physical store peripherals such as barcode scanners,
            thermal printers, and cash drawers.
          </p>
          <HardwareSettings />
        </TabsContent>
        </div>
      </Tabs>

      {/* Create/Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={closeModal}>
        <DialogContent className="sm:max-w-[425px] bg-background border-border text-foreground">
          <DialogHeader>
            <DialogTitle>
              {editingRate ? "Edit Tax Rate" : "Create Tax Rate"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {editingRate
                ? "Update the tax rate details below."
                : "Define a new tax rate for your business."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                value={formName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormName(e.target.value)
                }
                placeholder="e.g. GST, VAT, Sales Tax"
                className="bg-card border-border"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Rate (%) <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={formRate}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setFormRate(e.target.value)
                  }
                  placeholder="e.g. 10"
                  className="bg-card border-border pr-10"
                  required
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">
                  %
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Enter as percentage. e.g. 10 for 10%, 5.5 for 5.5%.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Description
              </label>
              <Input
                value={formDescription}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormDescription(e.target.value)
                }
                placeholder="Optional description"
                className="bg-card border-border"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <label className="text-sm font-medium text-foreground">
                  Default Rate
                </label>
                <p className="text-xs text-muted-foreground">
                  Applied when a product&apos;s category has no specific tax rate.
                </p>
              </div>
              <input
                type="checkbox"
                className="w-5 h-5 accent-primary rounded"
                checked={formIsDefault}
                onChange={(e) => setFormIsDefault(e.target.checked)}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <label className="text-sm font-medium text-foreground">
                  Active
                </label>
                <p className="text-xs text-muted-foreground">
                  Inactive tax rates won&apos;t be applied to any sales.
                </p>
              </div>
              <input
                type="checkbox"
                className="w-5 h-5 accent-primary rounded"
                checked={formIsActive}
                onChange={(e) => setFormIsActive(e.target.checked)}
              />
            </div>

            <DialogFooter className="pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={closeModal}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || !formName || !formRate}
                className="bg-primary hover:bg-primary/90 min-w-[120px]"
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {editingRate ? "Save Changes" : "Create Rate"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteConfirm}
        onOpenChange={() => setDeleteConfirm(null)}
      >
        <DialogContent className="sm:max-w-[400px] bg-background border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle size={20} /> Delete Tax Rate
            </DialogTitle>
            <DialogDescription className="text-muted-foreground pt-2">
              Are you sure you want to delete{" "}
              <span className="text-foreground font-semibold">
                {deleteConfirm?.name}
              </span>
              ? This action cannot be undone. Products using this rate will fall
              back to the default tax.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-4">
            <Button
              variant="ghost"
              onClick={() => setDeleteConfirm(null)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deleteConfirm && deleteMutation.mutate(deleteConfirm.id)
              }
              disabled={deleteMutation.isPending}
              className="bg-destructive hover:bg-red-700"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Delete Tax Rate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Renders the actual <Receipt> component with a stable demo sale so business-info
 * edits are previewable before they're saved. Wrapped with a slight scale and a
 * paper-like backdrop so it feels like a real printed receipt at-a-glance.
 */
interface ReceiptPreviewProps {
  businessName: string;
  addressLine1?: string;
  addressLine2?: string;
  phone?: string;
  logoUrl?: string;
}

function ReceiptPreview({ businessName, addressLine1, addressLine2, phone, logoUrl }: ReceiptPreviewProps) {
  // Demo sale — three line items, mixed payment, fixed timestamp so the preview
  // is stable across renders (don't re-roll on every keystroke).
  const demoSale: SaleResponse = {
    id: "preview",
    invoiceNumber: "INV-PREVIEW",
    totalAmount: 1450,
    taxAmount: 145,
    discountAmount: 0,
    netAmount: 1595,
    paymentStatus: "PAID",
    paymentMethod: "CASH",
    createdAt: "2026-04-25T14:30:00",
    cashierName: "Demo Cashier",
    items: [
      { id: "1", productId: "p1", productName: "Coca-Cola 1L", quantity: 2, unitPrice: 250, totalAmount: 500 },
      { id: "2", productId: "p2", productName: "Snickers Bar", quantity: 3, unitPrice: 150, totalAmount: 450 },
      { id: "3", productId: "p3", productName: "Lay's Chips", quantity: 2, unitPrice: 250, totalAmount: 500 },
    ],
  };

  return (
    <div className="flex justify-center bg-card/60 border border-border rounded-lg p-6">
      <div className="shadow-2xl">
        <Receipt
          sale={demoSale}
          tenant={{
            name: businessName,
            addressLine1,
            addressLine2,
            phone,
          }}
          logoUrl={logoUrl}
          tendered={1600}
          change={5}
          taxLabel="Tax (10%)"
        />
      </div>
    </div>
  );
}
