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
import { DEFAULT_KITCHEN_STATION } from '@/lib/kitchenStations';

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
/** GS ! 0x01 — double height, normal width: tall text that keeps every column. */
const DOUBLE_HEIGHT = '\x1D\x21\x01';

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
  const isMove = ticket.ticketType === 'MOVE';

  const cmds: PrintData[] = [INIT];

  if (isVoid) cmds.push(...banner('** VOID **'));
  if (isMove) cmds.push(...banner('** MOVED **'));
  if (opts.reprint) cmds.push(ALIGN_CENTER, BOLD_ON, DOUBLE, '** REPRINT **\n', NORMAL, BOLD_OFF);

  // ── Header ────────────────────────────────────────────────────────────
  cmds.push(ALIGN_CENTER, BOLD_ON, DOUBLE, `${ticket.label}\n`, NORMAL, BOLD_OFF);
  // Named once there is more than one station, so a sheet reprinted at the
  // counter — or picked up at the wrong pass — still says where it belongs.
  // KITCHEN is left off: a one-printer kitchen never sees the word.
  if (ticket.station && ticket.station !== DEFAULT_KITCHEN_STATION) {
    cmds.push(BOLD_ON, DOUBLE_HEIGHT, `>> ${truncate(ticket.station, width - 6)} <<\n`, NORMAL, BOLD_OFF);
  }
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

  // ── A move has no items: one big line telling the runner where to go ──
  if (isMove) {
    // Tall but not wide: double height keeps every column, so "ORDER 9 FROM T7
    // JOINS" survives 58mm paper instead of being cut to 16 characters.
    cmds.push(ALIGN_CENTER, BOLD_ON, DOUBLE_HEIGHT, `${truncate(ticket.notice ?? 'TABLE CHANGED', width)}\n`, NORMAL, BOLD_OFF);
    cmds.push(ALIGN_LEFT, sep, FEED_AND_CUT);
    return cmds;
  }

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
