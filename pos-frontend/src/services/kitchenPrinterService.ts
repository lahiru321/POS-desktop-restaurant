import { hardwareService } from './hardwareService';
import { qzTrayService } from './qzTrayService';
import { kitchenTicketService, type KitchenTicket } from './kitchenTicketService';
import { buildKitchenTicketCommands } from './kitchenTicketBuilder';

export type KitchenPrintResult = { ok: true } | { ok: false; error: string };

/**
 * What happened to one ticket once the till was done with it.
 *
 * `printed` — on paper in the kitchen. `noPrinter` — this till has kitchen
 * printing switched off, so the ticket was recorded and marked handled, and the
 * cashier must say it out loud. `failed` — the printer did not take it; the
 * ticket is FAILED on the server and must go in front of the cashier.
 */
export type KitchenDispatchOutcome =
  | { status: 'printed' }
  | { status: 'noPrinter' }
  | { status: 'failed'; error: string };

/** Recorded on the ticket when a till with no kitchen printer sends an order. */
export const NO_KITCHEN_PRINTER_NOTE = 'No kitchen printer on this till — told the kitchen verbally';

function message(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'The kitchen printer did not respond';
}

/**
 * Kitchen printing, with one rule above all others: **no silent fallback.**
 *
 * `receiptPrinterService.processHardwareCheckoutActions` swallows a QZ error
 * and falls back to a browser print. For a receipt that is a nuisance; for a
 * kitchen ticket it means the cashier sees success while the kitchen never gets
 * the order — and the fallback is dead anyway in the packaged app, where
 * `electron/main.ts` denies `window.open`. So nothing here ever browser-prints,
 * and nothing here ever throws: every path returns a result the caller must
 * look at.
 */
export const kitchenPrinterService = {
  /** Prints one ticket on the kitchen printer. Never throws, never falls back. */
  async printTicket(ticket: KitchenTicket, opts: { reprint?: boolean } = {}): Promise<KitchenPrintResult> {
    try {
      const cfg = hardwareService.getConfig();
      if (!cfg.kitchenPrintEnabled) {
        return { ok: false, error: 'Kitchen printing is switched off in Settings → Hardware.' };
      }
      if (cfg.printerMode !== 'qz_tray') {
        return { ok: false, error: 'Kitchen printing needs QZ Tray. Choose it in Settings → Hardware.' };
      }
      const target = cfg.kitchenStationTargets?.[ticket.station] || cfg.kitchenPrinterTarget;
      if (!target) {
        return { ok: false, error: 'No kitchen printer is chosen in Settings → Hardware.' };
      }
      await qzTrayService.printRaw(
        target,
        buildKitchenTicketCommands(ticket, {
          paperWidth: cfg.kitchenPaperWidth,
          copies: cfg.kitchenCopies,
          reprint: opts.reprint,
        }),
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: message(err) };
    }
  },

  /**
   * The same sheet on the receipt printer — the escape hatch when the kitchen
   * printer is down. Somebody then carries it to the pass. Never throws.
   */
  async printAtCounter(ticket: KitchenTicket): Promise<KitchenPrintResult> {
    try {
      const cfg = hardwareService.getConfig();
      if (cfg.printerMode !== 'qz_tray') {
        return { ok: false, error: 'The counter printer is not on QZ Tray, so it cannot print a kitchen ticket.' };
      }
      await qzTrayService.printRaw(
        cfg.printerTarget,
        buildKitchenTicketCommands(ticket, { paperWidth: cfg.paperWidth, copies: 1 }),
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: message(err) };
    }
  },

  /**
   * Prints a ticket and always tells the server how it went.
   *
   * With kitchen printing switched off on this till, the ticket is acked
   * HANDLED with a note saying so — a deliberate "no kitchen printer here"
   * setup, not a failure, and the audit says exactly that. With it switched on,
   * a print failure is acked FAILED and returned as `failed`, for the caller to
   * put in front of the cashier.
   *
   * If the ack itself cannot reach the server, the outcome is still returned
   * truthfully; the ticket stays PENDING and the badge picks it up.
   */
  async dispatch(ticket: KitchenTicket, opts: { reprint?: boolean } = {}): Promise<KitchenDispatchOutcome> {
    const cfg = hardwareService.getConfig();
    if (!cfg.kitchenPrintEnabled) {
      await kitchenTicketService
        .acknowledge(ticket.id, { outcome: 'HANDLED', note: NO_KITCHEN_PRINTER_NOTE })
        .catch(() => undefined);
      return { status: 'noPrinter' };
    }

    const result = await this.printTicket(ticket, opts);
    if (result.ok) {
      await kitchenTicketService.acknowledge(ticket.id, { outcome: 'PRINTED' }).catch(() => undefined);
      return { status: 'printed' };
    }
    await kitchenTicketService
      .acknowledge(ticket.id, { outcome: 'FAILED', note: result.error })
      .catch(() => undefined);
    return { status: 'failed', error: result.error };
  },
};
