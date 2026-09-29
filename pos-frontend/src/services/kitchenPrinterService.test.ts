import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./hardwareService', () => ({
  hardwareService: { getConfig: vi.fn() },
}));
vi.mock('./qzTrayService', () => ({
  qzTrayService: { printRaw: vi.fn() },
}));
vi.mock('./kitchenTicketService', () => ({
  kitchenTicketService: { acknowledge: vi.fn() },
}));

import { hardwareService, type HardwareConfig } from './hardwareService';
import { qzTrayService } from './qzTrayService';
import { kitchenTicketService, type KitchenTicket } from './kitchenTicketService';
import { kitchenPrinterService, NO_KITCHEN_PRINTER_NOTE } from './kitchenPrinterService';

const getConfig = vi.mocked(hardwareService.getConfig);
const printRaw = vi.mocked(qzTrayService.printRaw);
const acknowledge = vi.mocked(kitchenTicketService.acknowledge);

function config(overrides: Partial<HardwareConfig> = {}): HardwareConfig {
  return {
    printerMode: 'qz_tray',
    printerTarget: 'Counter',
    paperWidth: '80mm',
    cashDrawerKick: true,
    kickCode: '27,112,0,25,250',
    kitchenPrintEnabled: true,
    kitchenPrinterTarget: 'Kitchen',
    kitchenPaperWidth: '80mm',
    kitchenCopies: 1,
    kitchenStationTargets: {},
    ...overrides,
  };
}

const ticket: KitchenTicket = {
  id: 'kt1',
  orderId: 'o1',
  orderNumber: 42,
  label: '#0042-R1',
  ticketType: 'ROUND',
  roundNo: 1,
  station: 'KITCHEN',
  status: 'PENDING',
  orderType: 'DINE_IN',
  tableName: 'T4',
  covers: 2,
  printAttempts: 0,
  firedAt: '2026-09-29T19:42:00+05:30',
  items: [{ itemName: 'Kottu', quantity: 1, modifiers: [], courseNo: 1 }],
};

// Any attempt to browser-print would go through window.open or window.print.
const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  acknowledge.mockResolvedValue(ticket);
});

describe('kitchenPrinterService.printTicket', () => {
  it('prints to the kitchen printer through QZ Tray', async () => {
    getConfig.mockReturnValue(config());
    printRaw.mockResolvedValue(undefined);

    await expect(kitchenPrinterService.printTicket(ticket)).resolves.toEqual({ ok: true });
    expect(printRaw).toHaveBeenCalledWith('Kitchen', expect.any(Array));
  });

  it('routes a station with its own printer there', async () => {
    getConfig.mockReturnValue(config({ kitchenStationTargets: { BAR: 'Bar printer' } }));
    printRaw.mockResolvedValue(undefined);

    await kitchenPrinterService.printTicket({ ...ticket, station: 'BAR' });
    expect(printRaw).toHaveBeenCalledWith('Bar printer', expect.any(Array));
  });

  it.each([
    ['not on QZ Tray', config({ printerMode: 'browser_print' }), /QZ Tray/],
    ['no kitchen printer chosen', config({ kitchenPrinterTarget: '' }), /No kitchen printer/],
  ])('returns ok:false — never throws, never browser-prints — when %s', async (_, cfg, error) => {
    getConfig.mockReturnValue(cfg);

    const result = await kitchenPrinterService.printTicket(ticket);

    expect(result).toEqual({ ok: false, error: expect.stringMatching(error) });
    expect(printRaw).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(printSpy).not.toHaveBeenCalled();
  });

  it('returns the printer error when QZ rejects, without falling back', async () => {
    getConfig.mockReturnValue(config());
    printRaw.mockRejectedValue(new Error('Printer offline'));

    await expect(kitchenPrinterService.printTicket(ticket)).resolves.toEqual({
      ok: false,
      error: 'Printer offline',
    });
    expect(openSpy).not.toHaveBeenCalled();
    expect(printSpy).not.toHaveBeenCalled();
  });
});

describe('kitchenPrinterService.dispatch', () => {
  it('acks PRINTED after a good print', async () => {
    getConfig.mockReturnValue(config());
    printRaw.mockResolvedValue(undefined);

    await expect(kitchenPrinterService.dispatch(ticket)).resolves.toEqual({ status: 'printed' });
    expect(acknowledge).toHaveBeenCalledWith('kt1', { outcome: 'PRINTED' });
  });

  it.each([
    ['QZ rejects', () => printRaw.mockRejectedValue(new Error('Paper out')), config()],
    ['not on QZ Tray', () => undefined, config({ printerMode: 'browser_print' })],
    ['no printer chosen', () => undefined, config({ kitchenPrinterTarget: '' })],
  ])('acks FAILED and reports it when %s', async (_, arrange, cfg) => {
    getConfig.mockReturnValue(cfg);
    arrange();

    const outcome = await kitchenPrinterService.dispatch(ticket);

    expect(outcome.status).toBe('failed');
    expect(acknowledge).toHaveBeenCalledWith('kt1', { outcome: 'FAILED', note: expect.any(String) });
  });

  it('with kitchen printing switched off, records the ticket as handled and prints nothing', async () => {
    getConfig.mockReturnValue(config({ kitchenPrintEnabled: false }));

    await expect(kitchenPrinterService.dispatch(ticket)).resolves.toEqual({ status: 'noPrinter' });
    expect(printRaw).not.toHaveBeenCalled();
    expect(acknowledge).toHaveBeenCalledWith('kt1', { outcome: 'HANDLED', note: NO_KITCHEN_PRINTER_NOTE });
  });

  it('still reports a failed print truthfully when the ack cannot reach the server', async () => {
    getConfig.mockReturnValue(config());
    printRaw.mockRejectedValue(new Error('Paper out'));
    acknowledge.mockRejectedValue(new Error('Network Error'));

    await expect(kitchenPrinterService.dispatch(ticket)).resolves.toEqual({
      status: 'failed',
      error: 'Paper out',
    });
  });
});
