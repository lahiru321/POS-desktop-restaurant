import type { PrintData } from 'qz-tray';
import api from './api';
import { toPrinterText } from './printerText';

/**
 * Thin wrapper around the QZ Tray connector (native ESC/POS printing).
 *
 * QZ Tray is a small Java app the cashier installs locally; it exposes a
 * WebSocket on localhost that this service connects to in order to send raw
 * bytes to the thermal printer (paper cut, cash-drawer kick, crisp 1-bit logo)
 * — things browser printing cannot do.
 *
 * The connector is loaded lazily and only in the browser so it never runs
 * during SSR. Requests are SIGNED when the backend has a key — on a desktop
 * install, the per-machine one `setup-qz-signing.ps1` makes and installs into
 * QZ Tray as override.crt — so QZ asks once ("Remember this decision") and then
 * prints silently. Without a key they go unsigned and QZ asks every time.
 */

type Qz = typeof import('qz-tray').default;

let qzPromise: Promise<Qz> | null = null;

async function getQz(): Promise<Qz> {
  if (typeof window === 'undefined') {
    throw new Error('QZ Tray is only available in the browser');
  }
  if (!qzPromise) {
    qzPromise = import('qz-tray').then((mod) => {
      const qz = mod.default;
      // QZ v2 ships no Promise lib — wire the browser's native Promise.
      qz.api.setPromiseType((resolver) => new Promise(resolver));
      setupSecurity(qz);
      return qz;
    });
  }
  return qzPromise;
}

/**
 * Registers the certificate/signature callbacks. When the backend has signing
 * configured, prints are signed (silent once allowed). Otherwise the certificate
 * fetch gets a 204, QZ treats the site as anonymous, and prompts on every connect.
 */
function setupSecurity(qz: Qz): void {
  qz.security.setSignatureAlgorithm('SHA512');

  qz.security.setCertificatePromise((resolve, reject) => {
    api
      .get<{ data: string }>('/hardware/qz/certificate')
      .then((res) => {
        const cert = res.status === 204 ? '' : res.data?.data;
        if (cert) resolve(cert);
        else reject();
      })
      .catch(() => reject());
  });

  qz.security.setSignaturePromise((toSign) => (resolve) => {
    api
      .post<{ data: { signature: string } }>('/hardware/qz/sign', { request: toSign })
      .then((res) => resolve(res.data?.data?.signature ?? ''))
      // Unsigned mode never reaches here; if signing fails, let QZ proceed (prompt).
      .catch(() => resolve(''));
  });
}

export const qzTrayService = {
  /** Opens the WebSocket to the local QZ Tray app (no-op if already connected). */
  async connect(): Promise<void> {
    const qz = await getQz();
    if (qz.websocket.isActive()) return;
    await qz.websocket.connect();
  },

  async disconnect(): Promise<void> {
    const qz = await getQz();
    if (qz.websocket.isActive()) {
      await qz.websocket.disconnect();
    }
  },

  async isConnected(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const qz = await getQz();
    return qz.websocket.isActive();
  },

  /** Lists installed printers (connects first if needed). */
  async listPrinters(): Promise<string[]> {
    const qz = await getQz();
    await this.connect();
    const found = await qz.printers.find();
    return Array.isArray(found) ? found : [found];
  },

  /**
   * Sends a raw ESC/POS job to the given printer (or the system default when
   * the target is blank/"default").
   *
   * Every plain string is made printable ASCII first (`toPrinterText`) — the one
   * place that rule is enforced, so no caller can forget it. ISO-8859-1 then
   * sends each character as exactly one byte; UTF-8 would turn anything above
   * 0x7F into two, which a thermal printer reads as a Chinese character or
   * garbage. Bytes that must not be touched (a drawer kick) come in as `hex`
   * elements (`rawBytes`) and pass through as they are.
   */
  async printRaw(printerTarget: string, data: PrintData[]): Promise<void> {
    const qz = await getQz();
    await this.connect();
    const printer =
      printerTarget && printerTarget.toLowerCase() !== 'default'
        ? printerTarget
        : await qz.printers.getDefault();
    const config = qz.configs.create(printer, { encoding: 'ISO-8859-1' });
    await qz.print(config, data.map((d) => (typeof d === 'string' ? toPrinterText(d) : d)));
  },
};
