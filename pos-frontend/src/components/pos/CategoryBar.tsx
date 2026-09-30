'use client';

import { cn } from '@/lib/utils';
import type { Category } from '@/types/inventory';

interface CategoryBarProps {
  categories: Category[];
  /** Null = All. */
  selectedId: string | null;
  onSelect: (categoryId: string | null) => void;
}

/**
 * The till's menu tabs. A waiter finds a dish by category, not by typing, so
 * this sits right above the grid with chips big enough to hit on a touch screen.
 * Only categories with something on the menu are passed in.
 */
export function CategoryBar({ categories, selectedId, onSelect }: CategoryBarProps) {
  if (categories.length === 0) return null;
  const chip = (id: string | null, label: string) => (
    <button
      key={id ?? 'all'}
      type="button"
      role="tab"
      aria-selected={selectedId === id}
      onClick={() => onSelect(id)}
      className={cn(
        'h-11 shrink-0 rounded-xl border px-4 text-sm font-semibold transition-colors',
        selectedId === id
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-gray-800 bg-gray-900 text-gray-300 hover:border-primary/50 hover:text-white',
      )}
    >
      {label}
    </button>
  );
  return (
    <div
      role="tablist"
      aria-label="Menu categories"
      className="flex shrink-0 gap-2 overflow-x-auto bg-black px-4 pb-3 custom-scrollbar"
    >
      {chip(null, 'All')}
      {categories.map((c) => chip(c.id, c.name))}
    </div>
  );
}
