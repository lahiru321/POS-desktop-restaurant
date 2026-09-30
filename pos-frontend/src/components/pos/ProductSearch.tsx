'use client';

import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { POS_SEARCH_INPUT_ID } from '@/hooks/usePosKeyboard';

interface ProductSearchProps {
  search: string;
  onSearchChange: (value: string) => void;
}

export function ProductSearch({ search, onSearchChange }: ProductSearchProps) {
  return (
    <div className="px-4 pt-3 pb-2 bg-black">
      <div className="relative group">
        <Search
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-primary transition-colors"
          size={18}
        />
        <Input
          id={POS_SEARCH_INPUT_ID}
          type="text"
          placeholder="Search the menu or scan a barcode (F2)"
          className="w-full h-11 pl-11 pr-4 bg-gray-900/50 border-gray-800 focus:border-primary/50 focus:ring-primary/20 text-base rounded-xl"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          autoFocus
        />
      </div>
    </div>
  );
}
