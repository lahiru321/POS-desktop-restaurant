'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useNavItems } from '@/components/layout/navItems';

type SidebarNavProps = {
  /** When true, render icon-only (collapsed) form. */
  collapsed?: boolean;
  /** Called when a link is clicked — useful for closing a mobile drawer. */
  onNavigate?: () => void;
  className?: string;
};

export function SidebarNav({ collapsed = false, onNavigate, className }: SidebarNavProps) {
  const pathname = usePathname();
  const items = useNavItems();

  return (
    <nav
      className={cn(
        'flex-1 space-y-1 overflow-y-auto overflow-x-hidden py-3',
        // Tighter horizontal padding when collapsed so the 44px icon buttons +
        // the vertical scrollbar still fit inside the 64px rail (no horizontal scroll).
        collapsed ? 'px-1.5' : 'px-3',
        className
      )}
      aria-label="Main navigation"
    >
      {items.map((item) => {
        const isActive = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex items-center rounded-xl text-sm transition-all duration-200 group',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              collapsed ? 'justify-center h-11 w-11 mx-auto' : 'gap-3 px-4 py-3',
              isActive
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/10'
            )}
          >
            <item.icon
              size={20}
              className={cn(
                'transition-colors shrink-0',
                isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
              )}
            />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
