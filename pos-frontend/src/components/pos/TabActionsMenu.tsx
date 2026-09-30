'use client';

import { useState } from 'react';
import { ArrowRightLeft, Combine, LogOut, MoreHorizontal, Split } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface TabActionsMenuProps {
  disabled?: boolean;
  /** Absent when the tab has one unit or fewer — nothing to split. */
  onSplit?: () => void;
  /** Dine-in only. */
  onMove?: () => void;
  /** Dine-in only: seat the same party at another table too. */
  onJoinTable?: () => void;
  onLeave: () => void;
}

/**
 * The tab's occasional actions, behind one button so the strip above the menu
 * holds only what a waiter uses on every order: Send and the floor.
 */
export function TabActionsMenu({ disabled, onSplit, onMove, onJoinTable, onLeave }: TabActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const item = (label: string, hint: string, Icon: LucideIcon, action: () => void) => (
    <button
      key={label}
      type="button"
      disabled={disabled}
      onClick={() => {
        setOpen(false);
        action();
      }}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted disabled:opacity-50"
    >
      <Icon size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-11 gap-2 border-gray-800 bg-gray-950 px-3 text-gray-300 hover:bg-gray-800 hover:text-primary"
          aria-label="More tab actions"
        >
          <MoreHorizontal size={18} /> More
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="dark w-72 p-1.5">
        {onJoinTable && item('Join table', 'The party also sits at another table', Combine, onJoinTable)}
        {onMove && item('Move / merge', 'Change table, or join another tab', ArrowRightLeft, onMove)}
        {onSplit && item('Split bill', 'Pay for part of this tab now', Split, onSplit)}
        {item('Leave tab', 'Keep it open and go back to the till', LogOut, onLeave)}
      </PopoverContent>
    </Popover>
  );
}
