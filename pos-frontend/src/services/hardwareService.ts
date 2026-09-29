/**
 * Hardware Service for interacting with specialized POS components.
 * Manages configuration and command pipelines for Thermal Printers and Cash Drawers.
 */

export interface HardwareConfig {
  printerMode: 'browser_print' | 'raw_usb' | 'qz_tray';
  printerTarget: string; // IP Address, USB Device ID, or "default"
  paperWidth: '58mm' | '80mm';
  cashDrawerKick: boolean;
  kickCode: string; // Often [27, 112, 0, 25, 250] in ESC/POS
  /**
   * Kitchen printer. Per-machine like the receipt printer, so it lives here in
   * localStorage rather than in the tenant settings. Kitchen printing is QZ Tray
   * only: there is no browser fallback, because a fallback that silently does
   * nothing (Electron denies window.open) means the kitchen never gets the order.
   */
  kitchenPrintEnabled: boolean;
  kitchenPrinterTarget: string;
  kitchenPaperWidth: '58mm' | '80mm';
  /** Sheets per ticket — 2 for a kitchen that keeps one at the pass. */
  kitchenCopies: number;
  /**
   * The multi-printer seam: station → printer. Empty today; every station
   * prints to `kitchenPrinterTarget` until per-station routing is switched on.
   */
  kitchenStationTargets: Record<string, string>;
}

const DEFAULT_CONFIG: HardwareConfig = {
  printerMode: 'browser_print',
  printerTarget: 'default',
  paperWidth: '80mm',
  cashDrawerKick: true,
  kickCode: '27,112,0,25,250',
  kitchenPrintEnabled: false,
  kitchenPrinterTarget: '',
  kitchenPaperWidth: '80mm',
  kitchenCopies: 1,
  kitchenStationTargets: {},
};

export const hardwareService = {
  getConfig(): HardwareConfig {
    if (typeof window === 'undefined') return DEFAULT_CONFIG;
    const stored = localStorage.getItem('lumora_hardware_config');
    if (!stored) return DEFAULT_CONFIG;
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    } catch {
      return DEFAULT_CONFIG;
    }
  },

  saveConfig(config: Partial<HardwareConfig>): HardwareConfig {
    const newConfig = { ...this.getConfig(), ...config };
    if (typeof window !== 'undefined') {
      localStorage.setItem('lumora_hardware_config', JSON.stringify(newConfig));
    }
    return newConfig;
  },

  /**
   * Generates the raw ESC/POS kick code buffer
   */
  getCashDrawerKickBuffer(config: HardwareConfig): Uint8Array {
    const codes = config.kickCode.split(',').map(Number);
    return new Uint8Array(codes);
  },

  /**
   * Opens the cash drawer. In `qz_tray` mode this sends the real ESC/POS kick
   * buffer to the printer via QZ Tray; otherwise (browser print) it can only be
   * simulated since the browser cannot send raw bytes to the device.
   */
  async kickCashDrawer(): Promise<void> {
    const config = this.getConfig();
    if (!config.cashDrawerKick) return;

    if (config.printerMode === 'qz_tray') {
      const { qzTrayService } = await import('./qzTrayService');
      const raw = String.fromCharCode(...Array.from(this.getCashDrawerKickBuffer(config)));
      await qzTrayService.printRaw(config.printerTarget, [raw]);
      return;
    }

    console.warn('💳 Cash Drawer Kick Simulated [Browser Print Mode]');
  }
};
