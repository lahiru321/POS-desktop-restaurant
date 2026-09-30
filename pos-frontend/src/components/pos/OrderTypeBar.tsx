'use client';

import { LayoutGrid, ShoppingBag, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CounterMode = 'COUNTER' | 'TAKEAWAY';

interface OrderTypeBarProps {
  counterMode: CounterMode;
  onCounterModeChange: (mode: CounterMode) => void;
  /** Dine-in is a table, so it opens the floor rather than switching a mode. */
  onDineIn: () => void;
}

interface TypeButtonProps {
  label: string;
  hint: string;
  Icon: LucideIcon;
  active?: boolean;
  onClick: () => void;
  radio?: boolean;
}

function TypeButton({ label, hint, Icon, active = false, onClick, radio = false }: TypeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      role={radio ? 'radio' : undefined}
      aria-checked={radio ? active : undefined}
      className={cn(
        'flex h-14 min-w-0 flex-1 items-center justify-center gap-2.5 rounded-xl border px-3 text-left transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-gray-800 bg-gray-900 text-gray-200 hover:border-primary/50 hover:text-white',
      )}
    >
      <Icon size={22} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-base font-bold leading-tight">{label}</span>
        <span
          className={cn(
            'hidden truncate text-[11px] leading-tight md:block',
            active ? 'opacity-80' : 'text-gray-500',
          )}
        >
          {hint}
        </span>
      </span>
    </button>
  );
}

/**
 * The first thing a cashier picks for every order, so it is the biggest thing
 * on the till: Dine-in (seat a table), Takeaway (paid now, then sent to the
 * kitchen) or Quick sale (paid now, nothing for the kitchen — a bottle of water).
 */
export function OrderTypeBar({ counterMode, onCounterModeChange, onDineIn }: OrderTypeBarProps) {
  return (
    <div className="flex min-w-0 flex-1 gap-2" role="radiogroup" aria-label="Order type">
      <TypeButton label="Dine-in" hint="Pick a table (F11)" Icon={LayoutGrid} onClick={onDineIn} />
      <TypeButton
        label="Takeaway"
        hint="Pay, then to the kitchen"
        Icon={ShoppingBag}
        radio
        active={counterMode === 'TAKEAWAY'}
        onClick={() => onCounterModeChange('TAKEAWAY')}
      />
      <TypeButton
        label="Quick sale"
        hint="Pay, nothing to the kitchen"
        Icon={Zap}
        radio
        active={counterMode === 'COUNTER'}
        onClick={() => onCounterModeChange('COUNTER')}
      />
    </div>
  );
}
