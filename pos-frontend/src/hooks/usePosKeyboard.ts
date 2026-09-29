import { useEffect, useRef } from 'react';

export const POS_SEARCH_INPUT_ID = 'pos-search-input';
export const POS_ADD_CUSTOMER_BUTTON_ID = 'pos-add-customer-button';
export const POS_CUSTOM_ITEM_BUTTON_ID = 'pos-custom-item-button';

export type PosRegion = 'grid' | 'cart';

export interface PosKeyboardActions {
  addFocusedProduct: () => void;
  incFocusedCart: () => void;
  decFocusedCart: () => void;
  removeFocusedCart: () => void;
  discountFocusedCart: () => void;
  charge: () => void;
  cyclePayment: () => void;
  printLastReceipt: () => void;
  correctLastPayment: () => void;
  /** F5 — on a tab, send the new items to the kitchen. A no-op at a counter sale. */
  hold: () => void;
  discard: () => void;
  showHelp: () => void;
  /**
   * F11 — open the floor sheet and switch tables without unmounting the
   * terminal. Takes F11 from the browser's own fullscreen toggle.
   */
  toggleFloor: () => void;
}

export interface UsePosKeyboardProps {
  /** Disable everything while a blocking overlay/modal owns the keyboard. */
  disabled?: boolean;
  activeRegion: PosRegion;
  setActiveRegion: (updater: (r: PosRegion) => PosRegion) => void;
  productCount: number;
  setGridIndex: (updater: (i: number) => number) => void;
  cartCount: number;
  setCartIndex: (updater: (i: number) => number) => void;
  actions: PosKeyboardActions;
}

const clamp = (i: number, max: number) => Math.max(0, Math.min(i, max));

/** Count CSS grid tracks of the product grid (responsive), for up/down nav. */
function gridColumns(): number {
  const el = document.querySelector('[data-product-grid]');
  if (!el) return 1;
  const cols = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length;
  return Math.max(1, cols);
}

/**
 * The terminal's full keyboard model: F-key actions, arrow navigation across the
 * product grid (2-D) and cart lines (1-D), per-line qty/remove/discount keys, and
 * region switching. One global listener, bound once; reads the latest props via a
 * ref so it never goes stale and doesn't re-bind every render.
 *
 * Scanner coexistence: `useBarcodeScanner` consumes rapid digit bursts ending in
 * Enter. We never bind plain digits here, and we ignore an Enter that arrives
 * <60ms after a character (a scanner's terminator) so a scan can't double-fire
 * "add focused product".
 */
export function usePosKeyboard(props: UsePosKeyboardProps) {
  const ref = useRef(props);
  ref.current = props;
  const lastCharTime = useRef(0);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const p = ref.current;
      if (p.disabled || typeof e.key !== 'string') return;

      // Yield the keyboard to any open modal dialog (discount, start/end shift,
      // add-customer, …). The tender + shortcuts overlays disable this hook via
      // `disabled` and own their keys; this covers dialogs the hook isn't told
      // about, so nav keys reach the dialog instead of editing the cart behind it.
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;

      const target = e.target as HTMLElement;
      const inInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // F-keys work from anywhere (including the search box).
      switch (e.key) {
        case 'F1': e.preventDefault(); p.actions.showHelp(); return;
        case 'F2': {
          e.preventDefault();
          const el = document.getElementById(POS_SEARCH_INPUT_ID) as HTMLInputElement | null;
          el?.focus(); el?.select(); return;
        }
        case 'F3': {
          e.preventDefault();
          (document.getElementById(POS_ADD_CUSTOMER_BUTTON_ID) as HTMLButtonElement | null)?.click();
          return;
        }
        case 'F4': e.preventDefault(); p.actions.cyclePayment(); return;
        case 'F10': {
          e.preventDefault();
          (document.getElementById(POS_CUSTOM_ITEM_BUTTON_ID) as HTMLButtonElement | null)?.click();
          return;
        }
        case 'F5': e.preventDefault(); p.actions.hold(); return;
        case 'F6': e.preventDefault(); if (p.activeRegion === 'cart') p.actions.discountFocusedCart(); return;
        case 'F7': e.preventDefault(); p.actions.correctLastPayment(); return;
        case 'F8': e.preventDefault(); p.actions.discard(); return;
        case 'F9': e.preventDefault(); p.actions.charge(); return;
        case 'F12': e.preventDefault(); p.actions.printLastReceipt(); return;
        case 'F11': e.preventDefault(); p.actions.toggleFloor(); return;
      }

      // While typing in the search box, let normal input behaviour through —
      // except ArrowDown, which jumps focus into the product grid.
      if (inInput) {
        if (e.key === 'ArrowDown' && target.id === POS_SEARCH_INPUT_ID && p.productCount > 0) {
          e.preventDefault();
          (target as HTMLInputElement).blur();
          p.setActiveRegion(() => 'grid');
          p.setGridIndex((i) => clamp(i, p.productCount - 1));
        }
        return;
      }

      // "?" mirrors F1 (only when not typing in a field — handled by the guard above).
      if (e.key === '?') { e.preventDefault(); p.actions.showHelp(); return; }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        lastCharTime.current = Date.now();
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        p.setActiveRegion((r) => (r === 'grid' ? 'cart' : 'grid'));
        return;
      }

      const isScannerEnter = e.key === 'Enter' && Date.now() - lastCharTime.current < 60;

      if (p.activeRegion === 'grid') {
        switch (e.key) {
          case 'ArrowRight': e.preventDefault(); p.setGridIndex((i) => clamp(i + 1, p.productCount - 1)); return;
          case 'ArrowLeft': e.preventDefault(); p.setGridIndex((i) => clamp(i - 1, p.productCount - 1)); return;
          case 'ArrowDown': { e.preventDefault(); const c = gridColumns(); p.setGridIndex((i) => clamp(i + c, p.productCount - 1)); return; }
          case 'ArrowUp': { e.preventDefault(); const c = gridColumns(); p.setGridIndex((i) => (i - c < 0 ? i : i - c)); return; }
          case 'Enter': if (isScannerEnter) return; e.preventDefault(); p.actions.addFocusedProduct(); return;
        }
      } else {
        switch (e.key) {
          case 'ArrowDown': e.preventDefault(); p.setCartIndex((i) => clamp(i + 1, p.cartCount - 1)); return;
          case 'ArrowUp': e.preventDefault(); p.setCartIndex((i) => clamp(i - 1, p.cartCount - 1)); return;
          case '+': case '=': case 'ArrowRight': e.preventDefault(); p.actions.incFocusedCart(); return;
          case '-': case '_': case 'ArrowLeft': e.preventDefault(); p.actions.decFocusedCart(); return;
          case 'Delete': case 'Backspace': e.preventDefault(); p.actions.removeFocusedCart(); return;
          case 'Enter': if (isScannerEnter) return; e.preventDefault(); p.actions.charge(); return;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

export interface HotkeyLegendEntry { key: string; label: string }

export const HOTKEY_LEGEND: HotkeyLegendEntry[] = [
  { key: '↑↓←→', label: 'Move' },
  { key: 'F2', label: 'Search' },
  { key: 'F3', label: 'Customer' },
  { key: 'F10', label: 'Custom item' },
  { key: 'F9', label: 'Charge' },
  { key: 'F7', label: 'Correct payment' },
  { key: 'F5', label: 'Send to kitchen' },
  { key: 'F11', label: 'Floor' },
  { key: 'F1', label: 'Shortcuts' },
];
