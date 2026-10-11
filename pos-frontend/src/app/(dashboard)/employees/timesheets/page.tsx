"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { timeClockService } from "@/services/timeClockService";
import { format } from "date-fns";
import {
  Clock,
  ArrowLeft,
  Search,
  Loader2,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRouter } from "next/navigation";
import { FeatureGuard } from "@/components/auth/FeatureGuard";
import { Pagination } from "@/components/ui/pagination";
import { DateRangePicker, DateRangeValue } from "@/components/ui/date-range-picker";
import { useAuthStore } from "@/stores/authStore";
import { roleLabel } from "@/lib/roles";

// ─── Constants ────────────────────────────────────────────────────────────────
const todayEnd   = () => format(new Date(), "yyyy-MM-dd'T'23:59:59");

const defaultDateRange = (): DateRangeValue => ({ start: "2000-01-01T00:00:00", end: todayEnd() });

// ─── Helpers ─────────────────────────────────────────────────────────────────
const ROLE_COLORS: Record<string, string> = {
  ADMIN: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  MANAGER: "bg-violet-500/10 text-violet-400 border-violet-500/30",
  CASHIER: "bg-primary/10 text-primary border-primary/30",
  INVENTORY_MANAGER: "bg-warning/10 text-warning border-warning/30",
};

function RoleBadge({ role }: { role: string }) {
  const cls = ROLE_COLORS[role] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {roleLabel(role)}
    </span>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="text-xs font-medium text-success bg-success/10 border border-success/20 px-2 py-0.5 rounded-full inline-flex items-center gap-1.5 shadow-sm shadow-emerald-500/10">
      <span className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_4px_rgba(16,185,129,0.8)]" />
      On Clock
    </span>
  ) : (
    <span className="text-xs font-medium text-muted-foreground bg-muted/10 border border-border/20 px-2 py-0.5 rounded-full inline-flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-muted" />
      Clocked Out
    </span>
  );
}

export default function TimesheetsPage() {
  const router = useRouter();
  const { hasRole } = useAuthStore();
  const canViewAll = hasRole('ADMIN') || hasRole('MANAGER');

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateRange, setDateRange] = useState<DateRangeValue>(defaultDateRange);

  const resetPage = () => setPage(0);

  const { data: timesheetsData, isLoading, isError } = useQuery({
    queryKey: ["timesheets", page, search, statusFilter, dateRange],
    queryFn: () => timeClockService.getAllHistory(page, 15, {
      from: dateRange.start,
      to: dateRange.end,
      status: statusFilter || undefined,
      search: search || undefined,
    }),
    enabled: canViewAll,
  });

  const records = timesheetsData?.content || [];

  return (
    <FeatureGuard
      feature="TIME_CLOCK"
      fallback={
        <div className="flex h-full min-h-[500px] flex-col items-center justify-center p-8 text-center animate-in fade-in duration-500">
          <div className="rounded-full bg-destructive/10 p-4 mb-4">
            <Clock className="h-10 w-10 text-destructive" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight mb-2">Feature Not Available</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Employee time management and clock-in/out reports are available in the{" "}
            <strong>Small Business</strong> plan and above.
          </p>
          <Button
            variant="outline"
            className="mt-6 border-border"
            onClick={() => router.push('/employees')}
          >
            Back to Employees
          </Button>
        </div>
      }
    >
      <div className="p-8 max-w-7xl mx-auto space-y-6">
        {/* ─── Header ─── */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push('/employees')}
              aria-label="Back to employees"
              title="Back to employees"
              className="h-9 w-9 border border-border rounded-lg hover:bg-card text-muted-foreground"
            >
              <ArrowLeft size={18} />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <Clock className="text-primary" size={24} /> Timesheets
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Review clock-in and clock-out history for all employees
              </p>
            </div>
          </div>
        </div>

        {/* ─── Filters ─── */}
        <div className="bg-background/50 rounded-2xl border border-border p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <Filter size={12} /> Filters
          </div>
          {/* Row 1: search + status */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <Input
                type="text"
                placeholder="Search employee name..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); resetPage(); }}
                className="pl-9 bg-background border-border focus-visible:ring-primary rounded-xl h-10 w-full"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); resetPage(); }}
              className="h-10 min-w-[160px] rounded-xl border border-border bg-background text-foreground text-sm px-3 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">On Clock</option>
              <option value="COMPLETED">Clocked Out</option>
            </select>
          </div>
          {/* Row 2: date range (full width) */}
          <DateRangePicker
            value={dateRange}
            onChange={(r) => { setDateRange(r); resetPage(); }}
          />
        </div>

        {/* ─── Main Table ─── */}
        <div className="bg-background/50 rounded-2xl border border-border overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-card/50">
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="font-semibold text-foreground">Employee</TableHead>
                  <TableHead className="font-semibold text-foreground">Status</TableHead>
                  <TableHead className="font-semibold text-foreground">Clock In</TableHead>
                  <TableHead className="font-semibold text-foreground">Clock Out</TableHead>
                  <TableHead className="font-semibold text-foreground">Duration</TableHead>
                  <TableHead className="font-semibold text-foreground">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!canViewAll ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      You need Admin or Manager access to view all timesheets.
                    </TableCell>
                  </TableRow>
                ) : isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center">
                      <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
                      <p className="text-sm text-muted-foreground mt-2">Loading timesheets...</p>
                    </TableCell>
                  </TableRow>
                ) : isError ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-destructive">
                      Failed to load timesheets. Please try again.
                    </TableCell>
                  </TableRow>
                ) : records.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      No time records found matching your filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  records.map((record) => (
                    <TableRow key={record.id} className="border-border/50 hover:bg-card/50 transition-colors">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xs shrink-0">
                            {record.userName.charAt(0)}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{record.userName}</span>
                            <span className="mt-1">
                              {record.userRole.split(',').map(role => (
                                <RoleBadge key={role} role={role.trim()} />
                              ))}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge active={!record.clockOutTime} />
                      </TableCell>
                      <TableCell className="text-sm text-foreground">
                        {format(new Date(record.clockInTime), "MMM d, h:mm a")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {record.clockOutTime ? format(new Date(record.clockOutTime), "MMM d, h:mm a") : '—'}
                      </TableCell>
                      <TableCell className="text-sm font-medium text-foreground">
                        {record.durationMinutes !== null
                          ? `${Math.floor(record.durationMinutes / 60)}h ${record.durationMinutes % 60}m`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                        {record.notes || '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* ─── Pagination Footer ─── */}
          {!isLoading && timesheetsData && (
            <div className="p-4 border-t border-border bg-background/80">
              <Pagination
                currentPage={page}
                totalPages={timesheetsData.totalPages}
                onPageChange={setPage}
                isLoading={isLoading}
              />
            </div>
          )}
        </div>
      </div>
    </FeatureGuard>
  );
}
