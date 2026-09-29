import { describe, expect, it } from 'vitest';
import {
  buildKitchenTicketCommands,
  kitchenColumns,
  kitchenItemNameMax,
} from './kitchenTicketBuilder';
import { DOUBLE, FEED_AND_CUT } from './escposBuilder';
import type { KitchenTicket } from './kitchenTicketService';

function makeTicket(overrides: Partial<KitchenTicket> = {}): KitchenTicket {
  return {
    id: 'kt1',
    orderId: 'o1',
    orderNumber: 42,
    label: '#0042-R2',
    ticketType: 'ROUND',
    roundNo: 2,
    station: 'KITCHEN',
    status: 'PENDING',
    orderType: 'DINE_IN',
    tableName: 'T4',
    covers: 4,
    serverName: 'Nimal',
    printAttempts: 0,
    firedAt: '2026-09-29T19:42:00+05:30',
    items: [
      {
        itemName: 'Chicken kottu',
        quantity: 2,
        modifiers: ['Extra cheese', 'Special sauce'],
        notes: 'no chilli',
        courseNo: 1,
      },
    ],
    ...overrides,
  };
}

/** The job as the printer would see it: strings joined, images ignored. */
function text(ticket: KitchenTicket, opts = {}): string {
  return buildKitchenTicketCommands(ticket, { paperWidth: '80mm', ...opts })
    .filter((c): c is string => typeof c === 'string')
    .join('');
}

describe('kitchenTicketBuilder', () => {
  it('uses 32 columns at 58mm and 48 at 80mm, halved for double-width names', () => {
    expect(kitchenColumns('58mm')).toBe(32);
    expect(kitchenColumns('80mm')).toBe(48);
    expect(kitchenItemNameMax('58mm')).toBe(12);
    expect(kitchenItemNameMax('80mm')).toBe(20);
  });

  it('prints no money: no currency symbol and nothing shaped like a price', () => {
    const out = text(makeTicket());
    expect(out).not.toMatch(/\d+\.\d{2}/);
    expect(out).not.toMatch(/Rs|LKR|\$/);
  });

  it('never sends a drawer kick', () => {
    // ESC p — the pulse command every kick code starts with.
    expect(text(makeTicket())).not.toContain('\x1B\x70');
  });

  it('prints the label, table, covers and server in the header', () => {
    const out = text(makeTicket());
    expect(out).toContain('#0042-R2');
    expect(out).toContain('DINE-IN  T4');
    expect(out).toContain('Covers: 4');
    expect(out).toContain('Server: Nimal');
  });

  it('labels takeaway tickets TAKEAWAY with no table', () => {
    const out = text(makeTicket({ orderType: 'TAKEAWAY', tableName: null, covers: 0 }));
    expect(out).toContain('TAKEAWAY');
    expect(out).not.toContain('DINE-IN');
    expect(out).not.toContain('Covers');
  });

  it('switches to double width immediately before every item name', () => {
    const cmds = buildKitchenTicketCommands(makeTicket(), { paperWidth: '80mm' });
    const itemIndex = cmds.findIndex((c) => typeof c === 'string' && c.includes('CHICKEN KOTTU'));
    expect(cmds[itemIndex - 1]).toBe(DOUBLE);
  });

  it('prints add-ons one per line and the note in bold', () => {
    const out = text(makeTicket());
    expect(out).toContain('    + Extra cheese\n');
    expect(out).toContain('    + Special sauce\n');
    expect(out).toContain('\x1B\x45\x01    ** no chilli **\n');
  });

  it('truncates a long name to fit a double-width line', () => {
    const cmds = buildKitchenTicketCommands(
      makeTicket({
        items: [{ itemName: 'Devilled seafood fried rice special', quantity: 1, modifiers: [], courseNo: 1 }],
      }),
      { paperWidth: '58mm' },
    );
    const line = cmds.find((c): c is string => typeof c === 'string' && c.startsWith('1 x '))!;
    // "1 x " + name, all inside the 16 double-width columns of 58mm paper.
    expect(line.trimEnd().length).toBeLessThanOrEqual(16);
  });

  it('prints a fractional quantity without trailing zeros', () => {
    const out = text(makeTicket({ items: [{ itemName: 'Rice', quantity: 0.5, modifiers: [], courseNo: 1 }] }));
    expect(out).toContain('0.5 x RICE');
  });

  it('puts a VOID banner at the top and the bottom of a void ticket', () => {
    const out = text(makeTicket({ ticketType: 'VOID', label: '#0042-R3-VOID' }));
    expect(out.match(/\*\* VOID \*\*/g)).toHaveLength(2);
    expect(out).toContain('#0042-R3-VOID');
  });

  it('marks a reprint', () => {
    expect(text(makeTicket(), { reprint: true })).toContain('** REPRINT **');
    expect(text(makeTicket())).not.toContain('REPRINT');
  });

  it('prints each copy as a whole sheet with its own cut', () => {
    const cmds = buildKitchenTicketCommands(makeTicket(), { paperWidth: '80mm', copies: 2 });
    expect(cmds.filter((c) => c === FEED_AND_CUT)).toHaveLength(2);
  });

  it('groups items under course headings only when there is more than one course', () => {
    const single = text(makeTicket());
    expect(single).not.toContain('Course');

    const multi = text(
      makeTicket({
        items: [
          { itemName: 'Soup', quantity: 1, modifiers: [], courseNo: 1 },
          { itemName: 'Kottu', quantity: 1, modifiers: [], courseNo: 2 },
        ],
      }),
    );
    expect(multi.indexOf('-- Course 1 --')).toBeLessThan(multi.indexOf('SOUP'));
    expect(multi.indexOf('-- Course 2 --')).toBeLessThan(multi.indexOf('KOTTU'));
  });
});
