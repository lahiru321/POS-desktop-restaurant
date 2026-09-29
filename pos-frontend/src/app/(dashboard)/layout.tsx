"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  LogOut,
  Monitor,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore, type User } from '@/stores/authStore';
import { TimeClockWidget } from '@/components/employee/TimeClockWidget';
import AuthGuard from '@/components/providers/AuthGuard';
import { performLogout } from '@/lib/performLogout';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { SidebarNav } from '@/components/layout/SidebarNav';
import { Logo } from '@/components/brand/Logo';
import { CommandPaletteTrigger } from '@/components/ui/command-palette';
import { DashboardHeaderSlotProvider } from '@/components/layout/DashboardHeaderSlot';

const COLLAPSE_KEY = 'lumora.sidebar.collapsed';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, hasFeature } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(COLLAPSE_KEY) : null;
    if (stored === '1') setCollapsed(true);
  }, []);

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      }
      return next;
    });
  };

  const handleLogout = async () => {
    await performLogout();
    router.push('/login');
  };

  const sidebarWidth = collapsed ? 'w-16' : 'w-64';

  return (
    <AuthGuard>
      <DashboardHeaderSlotProvider>
        {(headerSlot) => (
          <div className="min-h-screen bg-background text-foreground flex">
            <a
              href="#dashboard-main"
              className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg"
            >
              Skip to main content
            </a>
            <aside
              className={cn(
                'hidden md:flex bg-card border-r border-border flex-col sticky top-0 h-screen transition-[width] duration-200 print:hidden',
                sidebarWidth
              )}
              aria-label="Sidebar"
            >
              <SidebarHeader collapsed={collapsed} planTier={user?.planTier} />
              <SidebarNav collapsed={collapsed} />
              <SidebarFooter
                collapsed={collapsed}
                user={user}
                onLogout={handleLogout}
                hasFeature={hasFeature}
                toggleCollapse={toggleCollapse}
              />
            </aside>

            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetContent side="left" className="w-72 p-0 flex flex-col bg-card border-r border-border">
                <SidebarHeader collapsed={false} planTier={user?.planTier} />
                <SidebarNav onNavigate={() => setMobileOpen(false)} />
                <SidebarFooter
                  collapsed={false}
                  user={user}
                  onLogout={handleLogout}
                  hasFeature={hasFeature}
                />
              </SheetContent>
            </Sheet>

            <main id="dashboard-main" className="flex-1 overflow-auto bg-background flex flex-col min-w-0">
              <header className="h-14 border-b border-border bg-card/60 backdrop-blur sticky top-0 z-10 flex items-center gap-2 px-4 md:px-6 print:hidden">
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  aria-label="Open navigation"
                  onClick={() => setMobileOpen(true)}
                >
                  <Menu size={18} />
                </Button>
                <div className="flex-1 min-w-0">{headerSlot}</div>
                <CommandPaletteTrigger>
                  {(open) => (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={open}
                      className="hidden sm:inline-flex gap-2 text-muted-foreground"
                      aria-label="Open command palette (Cmd+K)"
                    >
                      <Search size={14} />
                      <span className="hidden lg:inline">Search...</span>
                      <kbd className="hidden lg:inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                        <span className="text-xs">Ctrl</span>K
                      </kbd>
                    </Button>
                  )}
                </CommandPaletteTrigger>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => window.location.reload()}
                  aria-label="Refresh"
                  title="Refresh page (the desktop app has no browser reload)"
                >
                  <RefreshCw size={18} />
                </Button>
                <ThemeToggle />
              </header>
              <div className="flex-1">{children}</div>
            </main>
          </div>
        )}
      </DashboardHeaderSlotProvider>
    </AuthGuard>
  );
}

function SidebarHeader({ collapsed, planTier }: { collapsed: boolean; planTier?: string }) {
  return (
    <div className={cn('h-16 flex items-center border-b border-border', collapsed ? 'justify-center px-2' : 'px-5 gap-2')}>
      <Link
        href="/overview"
        className="flex items-center"
        aria-label="Lumora - go to overview"
      >
        <Logo variant={collapsed ? 'mark' : 'full'} size={collapsed ? 22 : 24} />
      </Link>
      {!collapsed && planTier && (
        <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold bg-muted text-muted-foreground uppercase tracking-widest border border-border">
          {planTier.replace('_BUSINESS', '')}
        </span>
      )}
    </div>
  );
}

type SidebarFooterProps = {
  collapsed: boolean;
  user: User | null;
  onLogout: () => void | Promise<void>;
  hasFeature: (feature: string) => boolean;
  toggleCollapse?: () => void;
};

function SidebarFooter({ collapsed, user, onLogout, hasFeature, toggleCollapse }: SidebarFooterProps) {
  return (
    <div className={cn('border-t border-border space-y-3', collapsed ? 'p-2' : 'p-3')}>
      {!user?.roles?.includes('ADMIN') && hasFeature('TIME_CLOCK') && !collapsed && <TimeClockWidget />}

      {(user?.roles?.includes('ADMIN') || user?.roles?.includes('MANAGER') || user?.roles?.includes('CASHIER')) && (
        <Link
          href="/terminal"
          aria-label="Open POS Terminal"
          title={collapsed ? 'POS Terminal' : undefined}
          className={cn(
            'flex items-center justify-center bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-primary/20',
            collapsed ? 'h-11 w-11 mx-auto' : 'gap-2 py-3'
          )}
        >
          <Monitor size={18} />
          {!collapsed && 'Open POS Terminal'}
        </Link>
      )}

      <div
        className={cn(
          'flex items-center bg-muted/30 rounded-xl border border-border',
          collapsed ? 'justify-center p-2' : 'gap-3 p-3'
        )}
      >
        <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold shrink-0 shadow-inner">
          {user?.firstName?.charAt(0) || 'U'}
          {user?.lastName?.charAt(0) || ''}
        </div>
        {!collapsed && (
          <>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-semibold text-foreground truncate pr-2">
                {user?.firstName} {user?.lastName}
              </span>
              <span className="text-xs text-primary font-medium truncate">
                {user?.roles?.[0]?.replace('_', ' ') || 'EMPLOYEE'}
              </span>
            </div>
            <button
              onClick={onLogout}
              aria-label="Log out"
              title="Log out"
              className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LogOut size={18} />
            </button>
          </>
        )}
      </div>

      {toggleCollapse && (
        <button
          onClick={toggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'w-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/10 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            collapsed ? 'h-10 w-10 mx-auto' : 'h-9'
          )}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      )}
    </div>
  );
}
