import { describe, expect, it } from 'vitest';
import { buildReceiptCommands, INIT, kickBytes, leftRight, SINGLE_BYTE, truncate } from './escposBuilder';
import type { ReceiptData } from './receiptPrinterService';

function receipt(overrides: Partial<ReceiptData> = {}): ReceiptData {
  return {
    tenantName: 'Café Lanka',
    transactionId: 'INV-0001',
    cashierName: 'Nimal Perera',
    items: [{ name: 'Chicken kottu with extra cheese and egg', quantity: 1, price: 950, total: 950 }],
    subtotal: 950,
    discount: 0,
    tax: 86.36,
    total: 950,
    tendered: 1000,
    change: 50,
    paymentMethod: 'CASH',
    taxInclusive: true,
    ...overrides,
  } as ReceiptData;
}

describe('escposBuilder', () => {
  it('cuts long text with "...", never "…", within the column budget', () => {
    expect(truncate('Chicken kottu with extra cheese', 16)).toBe('Chicken kottu...');
    expect(truncate('Chicken kottu with extra cheese', 16)).toHaveLength(16);
    expect(truncate('Short', 16)).toBe('Short');
  });

  it('measures cleaned text, so a "…" in a name cannot push the price off the line', () => {
    const line = leftRight('Tea… large', '120.00', 20);
    expect(line).toBe('Tea... large  120.00\n');
    expect(line.trimEnd()).toHaveLength(20);
  });

  it('starts every receipt in single-byte mode', () => {
    const cmds = buildReceiptCommands(receipt(), { paperWidth: '80mm', drawerKick: false, kickCode: '' });
    expect(cmds.slice(0, 2)).toEqual([INIT, SINGLE_BYTE]);
  });

  it('sends the drawer kick as hex bytes, not as text', () => {
    const cmds = buildReceiptCommands(receipt(), {
      paperWidth: '80mm',
      drawerKick: true,
      kickCode: '27,112,0,25,250',
    });
    expect(cmds[2]).toEqual({ type: 'raw', format: 'command', flavor: 'hex', data: '1b700019fa' });
    // Nowhere as a string, where encoding could split 0xFA in two.
    expect(cmds.filter((c) => typeof c === 'string').join('')).not.toContain('\x1Bp');
  });

  it('reads the kick code in decimal or hex', () => {
    expect(kickBytes('27,112,0,25,250')).toEqual([27, 112, 0, 25, 250]);
    // Hex for the whole code: "70" and "19" here are hex, not decimal.
    expect(kickBytes('1B,70,00,19,FA')).toEqual([27, 112, 0, 25, 250]);
    expect(kickBytes('0x1B, 0x70, 0x00, 0x19, 0xFA')).toEqual([27, 112, 0, 25, 250]);
  });
});
