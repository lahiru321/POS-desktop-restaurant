import type { PrintData } from 'qz-tray';
import { format } from 'date-fns';
import {
  INIT,
  ALIGN_LEFT,
  ALIGN_CENTER,
  BOLD_ON,
  BOLD_OFF,
  DOUBLE,
  NORMAL,
  FEED_AND_CUT,
  leftRight,
  truncate,
} from './escposBuilder';
import type { KitchenTicket } from './kitchenTicketService';

/**
 * Builds the raw ESC/POS job for one kitchen ticket.
 *
 * Deliberately different from the receipt in three ways:
 * - **No money anywhere.** No price, subtotal, tax or currency symbol. A price
 *   on a kitchen ticket is a bug; the test asserts their absence.
 * - **No drawer kick.** The kitchen printer has no drawer.
 * - **Double-width item names.** Double width halves the usable columns — 24 at
 *   80 mm, 16 at 58 mm — which is the easiest thing here to get wrong.
 */

/** GS B n — white on black, so a VOID cannot be mistaken for an order. */
const REVERSE_ON = '\x1D\x42\x01';
const REVERSE_OFF = '\x1D\x42\x00';

export interface KitchenTicketOptions {
  paperWidth: '58mm' | '80mm';
  /** Sheets per ticket. Each is a complete sheet with its own cut. */
  copies?: number;
  /** Prints the ** REPRINT ** banner. */
  reprint?: boolean;
}

/** Normal-width columns for the paper. */
export function kitchenColumns(paperWidth: '58mm' | '80mm'): number {
  return paperWidth === '58mm' ? 32 : 48;
}

/** Longest item name that fits on one double-width line after "NN x ". */
export function kitchenItemNameMax(paperWidth: '58mm' | '80mm'): number {
  return kitchenColumns(paperWidth) / 2 - 4;
}

/** 2 → "2", 0.5 → "0.5". Never "2.00", which would read like a price. */
function qty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

function banner(text: string): PrintData[] {
  return [ALIGN_CENTER, BOLD_ON, DOUBLE, REVERSE_ON, ` ${text} \n`, REVERSE_OFF, NORMAL, BOLD_OFF];
}

function sheet(ticket: KitchenTicket, opts: KitchenTicketOptions): PrintData[] {
  const width = kitchenColumns(opts.paperWidth);
  const nameMax = kitchenItemNameMax(opts.paperWidth);
  const sep = '-'.repeat(width) + '\n';
  const isVoid = ticket.ticketType === 'VOID';

  const cmds: PrintData[] = [INIT];

  if (isVoid) cmds.push(...banner('** VOID **'));
  if (opts.reprint) cmds.push(ALIGN_CENTER, BOLD_ON, DOUBLE, '** REPRINT **\n', NORMAL, BOLD_OFF);

  // ── Header ────────────────────────────────────────────────────────────
  cmds.push(ALIGN_CENTER, BOLD_ON, DOUBLE, `${ticket.label}\n`, NORMAL, BOLD_OFF);
  const where =
    ticket.orderType === 'TAKEAWAY'
      ? 'TAKEAWAY'
      : `DINE-IN  ${ticket.tableName ?? ''}`.trimEnd();
  const covers = ticket.covers > 0 ? `   Covers: ${ticket.covers}` : '';
  cmds.push(BOLD_ON, `${where}${covers}\n`, BOLD_OFF);
  cmds.push(ALIGN_LEFT);
  cmds.push(
    leftRight(
      `Server: ${truncate(ticket.serverName ?? '-', width - 12)}`,
      format(new Date(ticket.firedAt), 'HH:mm'),
      width,
    ),
  );
  cmds.push(sep);

  // ── Items, grouped by course ─────────────────────────────────────────
  const courses = Array.from(new Set(ticket.items.map((i) => i.courseNo))).sort((a, b) => a - b);
  for (const course of courses) {
    if (courses.length > 1) cmds.push(BOLD_ON, `-- Course ${course} --\n`, BOLD_OFF);
    for (const item of ticket.items.filter((i) => i.courseNo === course)) {
      cmds.push(DOUBLE, `${qty(item.quantity)} x ${truncate(item.itemName.toUpperCase(), nameMax)}\n`, NORMAL);
      for (const modifier of item.modifiers) {
        cmds.push(`    + ${truncate(modifier, width - 6)}\n`);
      }
      // Bold, so the line cook cannot miss "no chilli".
      if (item.notes) cmds.push(BOLD_ON, `    ** ${truncate(item.notes, width - 10)} **\n`, BOLD_OFF);
    }
  }

  cmds.push(sep);
  if (isVoid) cmds.push(...banner('** VOID **'));
  cmds.push(FEED_AND_CUT);
  return cmds;
}

export function buildKitchenTicketCommands(ticket: KitchenTicket, opts: KitchenTicketOptions): PrintData[] {
  const copies = Math.max(1, Math.floor(opts.copies ?? 1));
  const cmds: PrintData[] = [];
  for (let i = 0; i < copies; i++) cmds.push(...sheet(ticket, opts));
  return cmds;
}
