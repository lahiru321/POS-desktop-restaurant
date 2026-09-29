'use client';

import React, { useEffect, useState } from 'react';
import { hardwareService, HardwareConfig } from '@/services/hardwareService';
import { qzTrayService } from '@/services/qzTrayService';
import { Printer, Usb, Keyboard, Save, CheckCircle2, AlertTriangle, Wifi, RefreshCw, Loader2, ChefHat } from 'lucide-react';
import { buildKitchenTicketCommands } from '@/services/kitchenTicketBuilder';
import type { KitchenTicket } from '@/services/kitchenTicketService';
import { toast } from 'sonner';

/**
 * Hardware peripherals configuration — printer mode, paper width, cash drawer
 * kick code, etc. Persisted via {@link hardwareService} (currently localStorage)
 * and read by the receipt printer service at checkout time.
 *
 * Lives as a self-contained component so it can be embedded in the Settings
 * tab layout without needing a dedicated route.
 */
/** What "Test kitchen ticket" prints. Never saved or acknowledged — it is not an order. */
const SAMPLE_KITCHEN_TICKET: KitchenTicket = {
  id: 'test',
  orderId: 'test',
  orderNumber: 0,
  label: '#0000-TEST',
  ticketType: 'ROUND',
  roundNo: 1,
  station: 'KITCHEN',
  status: 'PENDING',
  orderType: 'DINE_IN',
  tableName: 'T1',
  covers: 2,
  serverName: 'Test',
  printAttempts: 0,
  firedAt: new Date().toISOString(),
  items: [
    { itemName: 'Chicken kottu', quantity: 2, modifiers: ['Extra cheese'], notes: 'no chilli', courseNo: 1 },
    { itemName: 'Lime juice', quantity: 1, modifiers: [], courseNo: 1 },
  ],
};

export function HardwareSettings() {
  const [config, setConfig] = useState<HardwareConfig | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [printers, setPrinters] = useState<string[]>([]);
  const [qzConnected, setQzConnected] = useState(false);
  const [qzBusy, setQzBusy] = useState(false);

  useEffect(() => {
    setConfig(hardwareService.getConfig());
  }, []);

  if (!config) return null;
  const cfg = config; // non-null alias for handlers below

  const refreshPrinters = async () => {
    setQzBusy(true);
    try {
      const list = await qzTrayService.listPrinters();
      setPrinters(list);
      setQzConnected(true);
      toast.success('Connected to QZ Tray', { description: `${list.length} printer(s) found.` });
    } catch {
      setQzConnected(false);
      toast.error('QZ Tray not reachable', {
        description: 'Make sure the QZ Tray app is installed and running on this machine.',
      });
    } finally {
      setQzBusy(false);
    }
  };

  const handleTestPrint = async () => {
    setQzBusy(true);
    try {
      await qzTrayService.printRaw(cfg.printerTarget, [
        '\x1B\x40',
        '\x1B\x61\x01',
        '\x1B\x45\x01',
        'Lumora POS\n',
        '\x1B\x45\x00',
        'QZ Tray test print\n',
        `${new Date().toLocaleString()}\n`,
        '\n\n\n\x1D\x56\x42\x00',
      ]);
      toast.success('Test sent to printer');
    } catch {
      toast.error('Test print failed', { description: 'Check QZ Tray and the selected printer.' });
    } finally {
      setQzBusy(false);
    }
  };

  const handleTestKitchen = async () => {
    if (!cfg.kitchenPrinterTarget) {
      toast.error('Choose a kitchen printer first');
      return;
    }
    setQzBusy(true);
    try {
      await qzTrayService.printRaw(
        cfg.kitchenPrinterTarget,
        buildKitchenTicketCommands(
          { ...SAMPLE_KITCHEN_TICKET, firedAt: new Date().toISOString() },
          { paperWidth: cfg.kitchenPaperWidth, copies: 1 },
        ),
      );
      toast.success('Test ticket sent to the kitchen printer', {
        description: 'Check it has no prices and that no drawer opened.',
      });
    } catch {
      toast.error('Kitchen test print failed', { description: 'Check QZ Tray and the kitchen printer.' });
    } finally {
      setQzBusy(false);
    }
  };

  const handleSave = () => {
    setIsSaving(true);
    hardwareService.saveConfig(config);
    setTimeout(() => {
      setIsSaving(false);
      toast.success('Hardware Configuration Saved', {
        description: 'New settings will apply to your next transaction.',
      });
    }, 500);
  };

  const handleTestCashDrawer = async () => {
    try {
      await hardwareService.kickCashDrawer();
      toast.info('Test Signal Sent', { description: 'Check if the Cash Drawer opened.' });
    } catch {
      toast.error('Could not send kick', { description: 'QZ Tray not reachable.' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Receipt Printer */}
        <div className="col-span-1 md:col-span-2 bg-card border border-border rounded-2xl p-6 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6 opacity-10">
            <Printer size={100} />
          </div>

          <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
            <Printer className="text-blue-400" /> Thermal Printer
          </h2>

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Printing Mode</label>
              <select
                value={config.printerMode}
                onChange={(e) => setConfig({ ...config, printerMode: e.target.value as HardwareConfig['printerMode'] })}
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-foreground focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
              >
                <option value="browser_print">Standard Browser Print (Recommended)</option>
                <option value="qz_tray">QZ Tray (Native ESC/POS)</option>
                <option value="raw_usb" disabled>Native WebUSB ESC/POS — Coming Soon</option>
              </select>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {config.printerMode === 'qz_tray'
                  ? 'Native ESC/POS via the QZ Tray app: silent print, paper cut, and real cash-drawer kick. Requires QZ Tray installed on this machine (shows a one-time trust prompt until signing is configured).'
                  : 'Renders the receipt as HTML and uses the browser print dialog. Works with any OS-installed printer.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Paper Width</label>
                <select
                  value={config.paperWidth}
                  onChange={(e) => setConfig({ ...config, paperWidth: e.target.value as HardwareConfig['paperWidth'] })}
                  className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-foreground focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="58mm">58mm (Small)</option>
                  <option value="80mm">80mm (Standard)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  {config.printerMode === 'qz_tray' ? 'Printer' : 'Target Interface / IP'}
                </label>
                {config.printerMode === 'qz_tray' ? (
                  <select
                    value={config.printerTarget}
                    onChange={(e) => setConfig({ ...config, printerTarget: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-foreground focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="default">System default</option>
                    {printers.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                    {config.printerTarget &&
                      config.printerTarget !== 'default' &&
                      !printers.includes(config.printerTarget) && (
                        <option value={config.printerTarget}>{config.printerTarget}</option>
                      )}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={config.printerTarget}
                    onChange={(e) => setConfig({ ...config, printerTarget: e.target.value })}
                    placeholder="e.g. 192.168.1.100 or 'default'"
                    className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-foreground focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                )}
              </div>
            </div>

            {config.printerMode === 'qz_tray' && (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  onClick={refreshPrinters}
                  disabled={qzBusy}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-60"
                >
                  {qzBusy ? <Loader2 size={16} className="animate-spin" /> : <Wifi size={16} />}
                  {qzConnected ? 'Refresh printers' : 'Connect to QZ Tray'}
                </button>
                <button
                  onClick={handleTestPrint}
                  disabled={qzBusy}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-60"
                >
                  <RefreshCw size={16} /> Test print
                </button>
                <span className="inline-flex items-center gap-1.5 text-xs">
                  {qzConnected ? (
                    <>
                      <CheckCircle2 size={14} className="text-success" />
                      <span className="text-success">Connected</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Not connected</span>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Cash Drawer */}
        <div className="col-span-1 border border-border rounded-2xl p-6 bg-card shadow-xl">
          <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
            <Usb className="text-success" /> Cash Drawer
          </h2>

          <div className="space-y-5">
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border/50">
              <div>
                <span className="block font-medium text-foreground">Auto-Kick</span>
                <span className="text-xs text-muted-foreground">Open on Cash Sale</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={config.cashDrawerKick}
                  onChange={(e) => setConfig({ ...config, cashDrawerKick: e.target.checked })}
                />
                <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-background after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-success"></div>
              </label>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">ESC/POS Kick Code (HEX/DEC)</label>
              <input
                type="text"
                value={config.kickCode}
                onChange={(e) => setConfig({ ...config, kickCode: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground text-sm font-mono focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>

            <button
              onClick={handleTestCashDrawer}
              className="w-full py-2.5 border border-border text-foreground rounded-lg hover:bg-muted transition-colors text-sm font-medium mt-4 flex items-center justify-center gap-2"
            >
              <AlertTriangle size={16} className="text-warning" />
              Test Kick Signal
            </button>
          </div>
        </div>

        {/* Kitchen Printer */}
        <div className="col-span-1 md:col-span-3 bg-card border border-border rounded-2xl p-6 shadow-xl">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div>
              <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                <ChefHat className="text-warning" /> Kitchen Printer
              </h2>
              <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
                Prints a ticket every time a table&apos;s new items are sent (F5), and a VOID ticket when
                something the kitchen already has is removed. No prices, no drawer. Turn it off if this till
                has no kitchen printer: orders are still recorded, and the till reminds you to tell the kitchen.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <span className="mr-3 text-sm font-medium text-foreground">
                {config.kitchenPrintEnabled ? 'On' : 'Off'}
              </span>
              <input
                type="checkbox"
                className="sr-only peer"
                checked={config.kitchenPrintEnabled}
                onChange={(e) => setConfig({ ...config, kitchenPrintEnabled: e.target.checked })}
              />
              <div className="relative w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-background after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-success"></div>
            </label>
          </div>

          {config.kitchenPrintEnabled && config.printerMode !== 'qz_tray' && (
            <p className="mb-5 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-warning">
              <AlertTriangle size={16} className="shrink-0" />
              Kitchen printing needs QZ Tray. Set Printing Mode above to QZ Tray, or every ticket will fail.
            </p>
          )}

          <div className={`grid grid-cols-1 sm:grid-cols-3 gap-4 ${config.kitchenPrintEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Kitchen printer</label>
              <select
                value={config.kitchenPrinterTarget}
                onChange={(e) => setConfig({ ...config, kitchenPrinterTarget: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-foreground focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="">— Choose a printer —</option>
                {printers.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
                {config.kitchenPrinterTarget && !printers.includes(config.kitchenPrinterTarget) && (
                  <option value={config.kitchenPrinterTarget}>{config.kitchenPrinterTarget}</option>
                )}
              </select>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Use &quot;Connect to QZ Tray&quot; above to list printers. Pick a different printer from the receipt one.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Paper width</label>
              <select
                value={config.kitchenPaperWidth}
                onChange={(e) =>
                  setConfig({ ...config, kitchenPaperWidth: e.target.value as HardwareConfig['kitchenPaperWidth'] })
                }
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-foreground focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="58mm">58mm (Small)</option>
                <option value="80mm">80mm (Standard)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Copies per ticket</label>
              <select
                value={config.kitchenCopies}
                onChange={(e) => setConfig({ ...config, kitchenCopies: Number(e.target.value) })}
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-foreground focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value={1}>1</option>
                <option value={2}>2 (one for the pass)</option>
                <option value={3}>3</option>
              </select>
            </div>
          </div>

          {config.kitchenPrintEnabled && config.printerMode === 'qz_tray' && (
            <button
              onClick={handleTestKitchen}
              disabled={qzBusy}
              className="mt-5 inline-flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-60"
            >
              {qzBusy ? <Loader2 size={16} className="animate-spin" /> : <ChefHat size={16} />}
              Test kitchen ticket
            </button>
          )}
        </div>

        {/* Global Barcode Scanner */}
        <div className="col-span-1 md:col-span-3 bg-indigo-950/20 border border-indigo-900/50 rounded-2xl p-6 shadow-xl flex items-start sm:items-center gap-6 flex-col sm:flex-row">
          <div className="p-4 bg-indigo-900/30 rounded-full shrink-0">
            <Keyboard className="text-indigo-400 w-8 h-8" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              Global Barcode Scanning Active <CheckCircle2 className="text-success w-5 h-5" />
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Your POS terminal is natively listening for high-speed scanner inputs globally.
              You do NOT need to click inside a search bar to scan a product. Just scan and it will
              add to the cart automatically!
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end border-t border-border pt-6">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all disabled:opacity-70 disabled:cursor-not-allowed shadow-lg shadow-indigo-900/20"
        >
          {isSaving ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Save size={20} />
          )}
          {isSaving ? 'Saving Hardware Profiles...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
}
