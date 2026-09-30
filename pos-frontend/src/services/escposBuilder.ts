import type { PrintData } from 'qz-tray';
import type { ReceiptData } from './receiptPrinterService';
import { format } from 'date-fns';
import { rawBytes, toPrinterText } from './printerText';

/**
 * Builds a raw ESC/POS print job (for QZ Tray) from the same {@link ReceiptData}
 * the browser-print path uses. Plain strings are raw ESC/POS commands; the logo
 * is handed to QZ as a base64 image element, which QZ rasterizes to 1-bit ESC/POS.
 */

// ── ESC/POS control codes ─────────────────────────────────────────────────
// Exported for kitchenTicketBuilder, so the two builders can never drift apart
// on what a byte sequence means.
export const INIT = '\x1B\x40';
/**
 * FS . — cancel Chinese (Kanji) character mode. Many ESC/POS printers (the DBL
 * 822 among them) ship with a GB18030 font and start in double-byte mode; this
 * puts them in single-byte mode for the job. Printers without the mode ignore it.
 */
export const SINGLE_BYTE = '\x1C\x2E';
export const ALIGN_LEFT = '\x1B\x61\x00';
export const ALIGN_CENTER = '\x1B\x61\x01';
export const BOLD_ON = '\x1B\x45\x01';
export const BOLD_OFF = '\x1B\x45\x00';
export const DOUBLE = '\x1D\x21\x11'; // double width + height
export const NORMAL = '\x1D\x21\x00';
export const FEED_AND_CUT = '\n\n\n\x1D\x56\x42\x00'; // feed then partial cut (GS V fn B)

const ITEM_NAME_MAX = 22;

const money = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(2);

/**
 * Fits text in `max` printable columns, ending "..." when it had to cut.
 * Cleaned first, so what is measured is what will print ("…" is three columns).
 */
export const truncate = (s: string, max: number): string => {
  const text = toPrinterText(s);
  if (text.length <= max) return text;
  return max <= 3 ? text.slice(0, max) : text.slice(0, max - 3) + '...';
};

/** Left text + right text padded to the paper's character width. */
export function leftRight(left: string, right: string, width: number): string {
  left = toPrinterText(left);
  right = toPrinterText(right);
  const space = Math.max(1, width - left.length - right.length);
  if (space === 1 && left.length + right.length >= width) {
    left = truncate(left, width - right.length - 1);
  }
  return left + ' '.repeat(Math.max(1, width - left.length - right.length)) + right + '\n';
}

/**
 * Decodes the drawer kick setting — "27,112,0,25,250" (decimal) or
 * "1B,70,00,19,FA" (hex) — into bytes.
 *
 * Decimal or hex is decided for the whole code, not number by number: in
 * "1B,70,00,19,FA" the "70" and "19" are hex too, and reading them as decimal
 * would send the wrong pulse. Hex when any part has a letter or a 0x prefix.
 */
export function kickBytes(kickCode: string): number[] {
  const parts = kickCode
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const hex = parts.some((c) => /^0x/i.test(c) || /[a-f]/i.test(c));
  return parts
    .map((c) => parseInt(c.replace(/^0x/i, ''), hex ? 16 : 10))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 255);
}

export interface EscPosOptions {
  paperWidth: '58mm' | '80mm';
  drawerKick: boolean;
  kickCode: string;
}

export function buildReceiptCommands(data: ReceiptData, opts: EscPosOptions): PrintData[] {
  const width = opts.paperWidth === '58mm' ? 32 : 48;
  const sep = '-'.repeat(width) + '\n';
  const created = data.createdAt ?? new Date();
  const firstName = data.cashierName?.split(' ')[0] ?? 'Staff';
  const method = (data.paymentMethod || '').toUpperCase();

  const cmds: PrintData[] = [INIT, SINGLE_BYTE];

  // Open the drawer up front so it pops while the receipt is printing. As hex:
  // the pulse timing ends in 0xFA, which no text path may touch.
  if (opts.drawerKick && method === 'CASH') {
    cmds.push(rawBytes(kickBytes(opts.kickCode)));
  }

  // ── Header (logo + store details) ─────────────────────────────────────
  cmds.push(ALIGN_CENTER);
  if (data.logoUrl) {
    cmds.push({
      type: 'raw',
      format: 'image',
      flavor: 'base64',
      data: data.logoUrl.replace(/^data:image\/[a-z+]+;base64,/i, ''),
      options: { language: 'ESCPOS', dotDensity: 'double' },
    });
    cmds.push('\n');
  }
  cmds.push(BOLD_ON, DOUBLE, `${data.tenantName}\n`, NORMAL, BOLD_OFF);
  if (data.tenantAddressLine1) cmds.push(`${data.tenantAddressLine1}\n`);
  if (data.tenantAddressLine2) cmds.push(`${data.tenantAddressLine2}\n`);
  if (data.tenantPhone) cmds.push(`Phone: ${data.tenantPhone}\n`);

  // ── Meta ──────────────────────────────────────────────────────────────
  cmds.push(ALIGN_LEFT, sep);
  cmds.push(`Invoice No: ${data.transactionId}\n`);
  cmds.push(`Date: ${format(created, 'dd-MM-yyyy')}\n`);
  cmds.push(`Time: ${format(created, 'HH:mm')}\n`);
  cmds.push(`Cashier: ${firstName}\n`);
  if (data.showBranch && data.branchName) cmds.push(`Branch: ${data.branchName}\n`);

  // ── Items ─────────────────────────────────────────────────────────────
  cmds.push(sep);
  for (const item of data.items) {
    if (item.isAddon) {
      // Add-ons print indented under their dish, priced but without a second
      // "qty x unit" line — that detail belongs to the item being modified.
      cmds.push(leftRight(`  + ${truncate(item.name, ITEM_NAME_MAX - 4)}`, money(item.total), width));
    } else {
      cmds.push(leftRight(truncate(item.name, ITEM_NAME_MAX), money(item.total), width));
      cmds.push(`  ${item.quantity} x ${money(item.price)}\n`);
    }
    if (item.notes) {
      cmds.push(`  * ${truncate(item.notes, width - 4)}\n`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────
  cmds.push(sep);
  cmds.push(leftRight('Subtotal:', money(data.subtotal), width));
  if (data.discount > 0) cmds.push(leftRight('Discount:', money(data.discount), width));
  // Inclusive: tax is already inside the prices, broken out below the total.
  // Exclusive: tax is a separate added line.
  if (!data.taxInclusive) {
    cmds.push(leftRight(`Tax${data.taxLabel ? ` (${data.taxLabel})` : ''}:`, money(data.tax), width));
  }
  if (data.loyaltyDiscount && data.loyaltyDiscount > 0) {
    cmds.push(leftRight('Points redeemed:', `-${money(data.loyaltyDiscount)}`, width));
  }
  cmds.push(sep, BOLD_ON, leftRight('TOTAL:', money(data.total), width), BOLD_OFF);
  if (data.taxInclusive) {
    cmds.push(leftRight('Taxable value:', money(data.total - data.tax), width));
    cmds.push(leftRight(`${data.taxLabel ?? 'VAT'} (incl.):`, money(data.tax), width));
  }

  if (method === 'CASH') {
    cmds.push(leftRight('Cash:', money(data.tendered), width));
    cmds.push(leftRight('Change:', money(data.change), width));
  } else if (method === 'SPLIT') {
    cmds.push(leftRight('Cash:', money(data.tendered), width));
    cmds.push(leftRight('Card:', money(Math.max(0, data.total - data.tendered)), width));
  } else {
    cmds.push(leftRight('Paid:', data.paymentMethod, width));
  }

  // ── Loyalty ───────────────────────────────────────────────────────────
  if ((data.pointsEarned ?? 0) > 0 || data.pointsBalance !== undefined) {
    cmds.push(sep, ALIGN_CENTER);
    if ((data.pointsEarned ?? 0) > 0) cmds.push(`Points earned: ${data.pointsEarned}\n`);
    if (data.pointsBalance !== undefined) cmds.push(`Points balance: ${data.pointsBalance}\n`);
    cmds.push(ALIGN_LEFT);
  }

  // ── Footer ────────────────────────────────────────────────────────────
  cmds.push(sep, ALIGN_CENTER, BOLD_ON, 'Thank You For Shopping!\n', BOLD_OFF);
  cmds.push(`${data.receiptFooter || 'Return within 7 days with receipt.'}\n`);
  cmds.push('Powered by Lumora Tech\n');

  cmds.push(FEED_AND_CUT);
  return cmds;
}
