"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import {
  TrendingUp,
  Receipt,
  BarChart3,
  Wallet,
  LayoutDashboard,
  Ban,
  HandCoins,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReturnModal } from "@/components/pos/ReturnModal";
import { ExchangeModal } from "@/components/pos/ExchangeModal";
import { RotateCcw, Salad } from "lucide-react";
import { FeatureGuard } from "@/components/auth/FeatureGuard";
import { ReturnItemRequest } from "@/services/returnService";

import { SummaryTab } from "./_tabs/SummaryTab";
import { SalesTab } from "./_tabs/SalesTab";
import { VoidsTab } from "./_tabs/VoidsTab";
import { ReturnsTab } from "./_tabs/ReturnsTab";
import { TaxTab } from "./_tabs/TaxTab";
import { ProfitabilityTab } from "./_tabs/ProfitabilityTab";
import { CashReconciliationTab } from "./_tabs/CashReconciliationTab";
import { CreditReportTab } from "./_tabs/CreditReportTab";
import { ToppingSalesTab } from "./_tabs/ToppingSalesTab";
import { BranchFilter } from "@/components/reports/BranchFilter";

export default function ReportsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const branchId = searchParams.get("branch") ?? undefined;

  // Persist the selected branch in the URL so it survives reloads and is shareable.
  const setBranchId = (id: string | undefined) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("branch", id);
    else params.delete("branch");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  };

  const [activeTab, setActiveTab] = useState("summary");
  const [returnSaleId, setReturnSaleId] = useState<string | null>(null);
  const [exchangeData, setExchangeData] = useState<{
    saleId: string;
    returnItems: ReturnItemRequest[];
    returnCredit: number;
  } | null>(null);

  const [dateRange, setDateRange] = useState({
    start: format(new Date(new Date().setDate(new Date().getDate() - 7)), "yyyy-MM-dd'T'00:00:00"),
    end: format(new Date(), "yyyy-MM-dd'T'23:59:59"),
  });

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground mt-2">
            How the restaurant is doing: sales, voids, the cash drawer and tax.
          </p>
        </div>
        <BranchFilter value={branchId} onChange={setBranchId} className="print:hidden" />
      </div>

      {/* One till on the cashier desk: the owner's few reports, most used first.
          Returns stays because it is where a manager approves a pending refund;
          Customer Credit because it is the only list of who owes money. */}
      <Tabs defaultValue="summary" value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="flex flex-wrap h-auto gap-1 justify-start bg-card border border-border p-1 print:hidden">
          <TabsTrigger value="summary" className="gap-2 px-3">
            <LayoutDashboard size={16} />
            <span>Summary</span>
          </TabsTrigger>
          <TabsTrigger value="sales" className="gap-2 px-3">
            <TrendingUp size={16} />
            <span>Sales History</span>
          </TabsTrigger>
          <TabsTrigger value="voids" className="gap-2 px-3">
            <Ban size={16} />
            <span>Voids</span>
          </TabsTrigger>
          <FeatureGuard feature="ADVANCED_ANALYTICS">
            <TabsTrigger value="profitability" className="gap-2 px-3">
              <BarChart3 size={16} />
              <span>Menu Items</span>
            </TabsTrigger>
          </FeatureGuard>
          <TabsTrigger value="addons" className="gap-2 px-3">
            <Salad size={16} />
            <span>Add-ons</span>
          </TabsTrigger>
          <TabsTrigger value="cash-reconciliation" className="gap-2 px-3">
            <Wallet size={16} />
            <span>Cash Drawer</span>
          </TabsTrigger>
          <FeatureGuard feature="RETURNS">
            <TabsTrigger value="returns" className="gap-2 px-3">
              <RotateCcw size={16} />
              <span>Returns</span>
            </TabsTrigger>
          </FeatureGuard>
          <FeatureGuard feature="TAX_CONFIG">
            <TabsTrigger value="tax" className="gap-2 px-3">
              <Receipt size={16} />
              <span>Tax</span>
            </TabsTrigger>
          </FeatureGuard>
          <FeatureGuard feature="STORE_CREDIT">
            <TabsTrigger value="customer-credit" className="gap-2 px-3">
              <HandCoins size={16} />
              <span>Customer Credit</span>
            </TabsTrigger>
          </FeatureGuard>
        </TabsList>

        <TabsContent value="summary" className="space-y-6">
          <SummaryTab
            dateRange={dateRange}
            onDateChange={setDateRange}
            branchId={branchId}
            onShowVoids={() => setActiveTab("voids")}
          />
        </TabsContent>

        <TabsContent value="sales" className="space-y-6">
          <SalesTab
            dateRange={dateRange}
            onDateChange={setDateRange}
            onReturn={setReturnSaleId}
            branchId={branchId}
          />
        </TabsContent>

        <TabsContent value="voids" className="space-y-6">
          <VoidsTab dateRange={dateRange} onDateChange={setDateRange} branchId={branchId} />
        </TabsContent>

        <FeatureGuard feature="ADVANCED_ANALYTICS">
          <TabsContent value="profitability" className="space-y-6">
            <ProfitabilityTab dateRange={dateRange} onDateChange={setDateRange} branchId={branchId} />
          </TabsContent>
        </FeatureGuard>

        <TabsContent value="addons" className="space-y-6">
          <ToppingSalesTab dateRange={dateRange} onDateChange={setDateRange} branchId={branchId} />
        </TabsContent>

        <TabsContent value="cash-reconciliation" className="space-y-6">
          <CashReconciliationTab dateRange={dateRange} onDateChange={setDateRange} branchId={branchId} />
        </TabsContent>

        <FeatureGuard feature="RETURNS">
          <TabsContent value="returns" className="space-y-6">
            <ReturnsTab />
          </TabsContent>
        </FeatureGuard>

        <FeatureGuard feature="TAX_CONFIG">
          <TabsContent value="tax" className="space-y-6">
            <TaxTab dateRange={dateRange} onDateChange={setDateRange} />
          </TabsContent>
        </FeatureGuard>

        <FeatureGuard feature="STORE_CREDIT">
          <TabsContent value="customer-credit" className="space-y-6">
            <CreditReportTab />
          </TabsContent>
        </FeatureGuard>
      </Tabs>

      {returnSaleId && (
        <ReturnModal
          saleId={returnSaleId}
          onClose={() => setReturnSaleId(null)}
          onExchange={(saleId, items, credit) =>
            setExchangeData({ saleId, returnItems: items, returnCredit: credit })
          }
        />
      )}

      {exchangeData && (
        <ExchangeModal
          saleId={exchangeData.saleId}
          returnItems={exchangeData.returnItems}
          returnCredit={exchangeData.returnCredit}
          onClose={() => setExchangeData(null)}
        />
      )}
    </div>
  );
}
