'use client';

import { useEffect, useState } from 'react';
import { Delete, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const PIN_LENGTH = 4;

export interface ManagerPinRequest {
  /** What is being approved, in the till's words: "Void 1 x Chicken kottu". */
  title: string;
  /** Why a manager is needed. */
  reason: string;
}

/**
 * A manager walks over and types their 4-digit PIN on the till — the same pad
 * as the payment-correction screen. Tapped or typed (digits, Backspace, Enter).
 * The PIN is handed straight to the request that needs it and never kept; the
 * server checks it and names the approving manager in the audit log.
 */
export function ManagerPinDialog({
  request,
  onSubmit,
  onCancel,
}: {
  request: ManagerPinRequest | null;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState('');
  useEffect(() => setPin(''), [request]);

  const press = (digit: string) => setPin((p) => (p.length < PIN_LENGTH ? p + digit : p));
  const submit = () => {
    if (pin.length === PIN_LENGTH) onSubmit(pin);
  };

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="max-w-xs"
        onKeyDown={(e) => {
          if (/^\d$/.test(e.key)) press(e.key);
          else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
          else if (e.key === 'Enter') submit();
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" /> Manager PIN
          </DialogTitle>
          <DialogDescription>
            <span className="block font-semibold text-foreground">{request?.title}</span>
            {request?.reason}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center gap-3" role="status" aria-label={`${pin.length} of ${PIN_LENGTH} digits entered`}>
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <div
              key={i}
              className={cn(
                'h-4 w-4 rounded-full border-2 border-primary',
                pin.length > i ? 'bg-primary' : 'bg-transparent',
              )}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
            <Button key={n} variant="outline" size="touch" className="text-lg font-semibold" onClick={() => press(n)}>
              {n}
            </Button>
          ))}
          <Button
            variant="outline"
            size="touch-icon"
            aria-label="Backspace"
            onClick={() => setPin((p) => p.slice(0, -1))}
            disabled={pin.length === 0}
          >
            <Delete />
          </Button>
          <Button variant="outline" size="touch" className="text-lg font-semibold" onClick={() => press('0')}>
            0
          </Button>
          <Button variant="default" size="touch" className="font-bold" onClick={submit} disabled={pin.length !== PIN_LENGTH}>
            OK
          </Button>
        </div>
        <Button variant="ghost" className="w-full" onClick={onCancel}>
          Cancel
        </Button>
      </DialogContent>
    </Dialog>
  );
}
