import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const printRaw = vi.hoisted(() => vi.fn());
const getConfig = vi.hoisted(() => vi.fn());
vi.mock('./qzTrayService', () => ({ qzTrayService: { printRaw } }));
vi.mock('./hardwareService', () => ({
  hardwareService: { getConfig, kickCashDrawer: vi.fn() },
}));

import { receiptPrinterService, type ReceiptData } from './receiptPrinterService';

const receipt = {
  tenantName: 'Cafe',
  branchName: 'Main',
  cashierName: 'Nimal',
  transactionId: 'INV-1',
  items: [],
  subtotal: 100,
  tax: 0,
  discount: 0,
  total: 100,
  paymentMethod: 'CASH',
  tendered: 100,
  change: 0,
} as ReceiptData;

const config = (printerMode: string) => ({
  printerMode,
  printerTarget: 'Till',
  paperWidth: '80mm',
  cashDrawerKick: true,
  kickCode: '27,112,0,25,250',
});

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
});

afterEach(() => {
  delete (window as { lumora?: unknown }).lumora;
  openSpy.mockRestore();
});

describe('receiptPrinterService.processHardwareCheckoutActions', () => {
  it('prints through QZ Tray and reports success', async () => {
    getConfig.mockReturnValue(config('qz_tray'));
    printRaw.mockResolvedValue(undefined);

    await expect(receiptPrinterService.processHardwareCheckoutActions(receipt)).resolves.toEqual({ ok: true });
  });

  it('in the desktop app, reports a QZ failure instead of opening a browser window', async () => {
    (window as { lumora?: unknown }).lumora = { isDesktop: true };
    getConfig.mockReturnValue(config('qz_tray'));
    printRaw.mockRejectedValue(new Error('Printer "Till" is offline'));

    const result = await receiptPrinterService.processHardwareCheckoutActions(receipt);

    expect(result).toEqual({ ok: false, error: 'Printer "Till" is offline' });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('in the desktop app with no QZ printer, says printing is not set up — no browser window', async () => {
    (window as { lumora?: unknown }).lumora = { isDesktop: true };
    getConfig.mockReturnValue(config('browser_print'));

    const result = await receiptPrinterService.processHardwareCheckoutActions(receipt);

    expect(result).toMatchObject({ ok: false, notConfigured: true });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('in a plain browser, still falls back to browser printing', async () => {
    getConfig.mockReturnValue(config('qz_tray'));
    printRaw.mockRejectedValue(new Error('QZ not running'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await receiptPrinterService.processHardwareCheckoutActions(receipt);

    expect(openSpy).toHaveBeenCalledWith('', '_blank');
  });
});
