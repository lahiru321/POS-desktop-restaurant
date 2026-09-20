import { hardwareService } from './hardwareService';
import { qzTrayService } from './qzTrayService';
import { buildReceiptCommands } from './escposBuilder';
import { format } from 'date-fns';

export interface ReceiptItem {
  name: string;
  quantity: number;
  price: number; // unit price
  total: number; // line total (qty * price)
  /**
   * True for an add-on line, which prints indented beneath the dish it belongs
   * to. Kept as a flag rather than nesting, so both the HTML receipt and the
   * ESC/POS builder walk one flat list in the order the cashier rang it.
   */
  isAddon?: boolean;
  /** "no chilli" — printed under the line it applies to. */
  notes?: string;
}

export interface ReceiptData {
  tenantName: string;
  /** Store logo as a data URI, rendered above the store name when provided. */
  logoUrl?: string;
  tenantAddressLine1?: string;
  tenantAddressLine2?: string;
  tenantPhone?: string;
  branchName: string;
  /** Hide the Branch line when the tenant only has one branch. */
  showBranch?: boolean;
  cashierName: string;
  transactionId: string;
  createdAt?: Date;
  items: ReceiptItem[];
  subtotal: number;
  tax: number;
  /** e.g. "VAT 15%" — rendered inside the Tax line parentheses when provided. */
  taxLabel?: string;
  discount: number;
  /** Post-tax bill reduction from redeemed loyalty points (0/undefined when none). */
  loyaltyDiscount?: number;
  /** True if prices are VAT-inclusive: the receipt breaks the tax out of the
   *  total instead of adding it as a separate line. */
  taxInclusive?: boolean;
  total: number;
  paymentMethod: string;
  tendered: number;
  change: number;
  receiptFooter?: string;
  /** Points earned on this sale (shown in the loyalty footer when a customer is attached). */
  pointsEarned?: number;
  /** Points redeemed on this sale. */
  pointsRedeemed?: number;
  /** Customer's points balance after this sale. */
  pointsBalance?: number;
}

const ITEM_NAME_MAX = 18;

const escape = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const truncate = (s: string, max = ITEM_NAME_MAX) =>
  s.length > max ? s.slice(0, max - 1) + '…' : s;

const money = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(2);

/**
 * Enterprise ESC/POS and Thermal Browser Printing Engine.
 */
export const receiptPrinterService = {

  /**
   * Generates a thermal-friendly HTML receipt and opens the browser's print dialog.
   * Handles 80mm & 58mm widths per hardware config.
   */
  printBrowserReceipt(data: ReceiptData) {
    const config = hardwareService.getConfig();
    const widthPixels = config.paperWidth === '80mm' ? '300px' : '200px';

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      console.error('Failed to open print window. Pop-up blocker might be active.');
      return;
    }

    const created = data.createdAt ?? new Date();
    const firstName = data.cashierName?.split(' ')[0] ?? 'Staff';
    const isCash = data.paymentMethod?.toUpperCase() === 'CASH';
    const isSplit = data.paymentMethod?.toUpperCase() === 'SPLIT';

    const itemRows = data.items.map(item => `
      <tr>
        <td class="col-item">${escape(truncate(item.name))}</td>
        <td class="col-num">${item.quantity}</td>
        <td class="col-num">${money(item.price)}</td>
        <td class="col-num">${money(item.total)}</td>
      </tr>
    `).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Receipt - ${escape(data.transactionId)}</title>
          <style>
            @page { margin: 0; }
            body {
              font-family: 'Courier New', Courier, monospace;
              width: ${widthPixels};
              margin: 0;
              padding: 10px;
              font-size: 12px;
              line-height: 1.3;
              color: black;
              font-variant-numeric: tabular-nums;
            }
            .center { text-align: center; }
            .right { text-align: right; }
            .bold { font-weight: bold; }
            .uppercase { text-transform: uppercase; }
            .store-name { font-size: 16px; letter-spacing: 1px; }
            .logo { display: block; margin: 0 auto 4px; max-height: 64px; max-width: 100%; height: auto; object-fit: contain; }
            .sep { border-top: 1px dashed black; margin: 8px 0; }
            .row { display: flex; justify-content: space-between; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 1px 0; }
            th { text-align: left; }
            .col-item { text-align: left; }
            .col-num { text-align: right; white-space: nowrap; }
            th.col-num { text-align: right; }
            .total-row { font-size: 15px; font-weight: bold; }
            .footer { margin-top: 6px; font-size: 11px; }
            .small { font-size: 10px; }
          </style>
        </head>
        <body>
          <!-- Header -->
          ${data.logoUrl ? `<img class="logo" src="${escape(data.logoUrl)}" alt="${escape(data.tenantName)}" />` : ''}
          <div class="center bold uppercase store-name">${escape(data.tenantName)}</div>
          ${data.tenantAddressLine1 ? `<div class="center">${escape(data.tenantAddressLine1)}</div>` : ''}
          ${data.tenantAddressLine2 ? `<div class="center">${escape(data.tenantAddressLine2)}</div>` : ''}
          ${data.tenantPhone ? `<div class="center">Phone: ${escape(data.tenantPhone)}</div>` : ''}

          <div class="sep"></div>

          <!-- Meta -->
          <div>Invoice No: ${escape(data.transactionId)}</div>
          <div>Date: ${format(created, 'dd-MM-yyyy')}</div>
          <div>Time: ${format(created, 'HH:mm')}</div>
          <div>Cashier: ${escape(firstName)}</div>
          ${data.showBranch && data.branchName ? `<div>Branch: ${escape(data.branchName)}</div>` : ''}

          <div class="sep"></div>

          <!-- Items -->
          <table>
            <thead>
              <tr class="bold">
                <th class="col-item">Item</th>
                <th class="col-num">Qty</th>
                <th class="col-num">Price</th>
                <th class="col-num">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemRows}
            </tbody>
          </table>

          <div class="sep"></div>

          <!-- Summary -->
          <div class="row"><span>Subtotal:</span><span>${money(data.subtotal)}</span></div>
          ${data.discount > 0 ? `<div class="row"><span>Discount:</span><span>${money(data.discount)}</span></div>` : ''}
          ${data.taxInclusive ? '' : `<div class="row">
            <span>Tax${data.taxLabel ? ` (${escape(data.taxLabel)})` : ''}:</span>
            <span>${money(data.tax)}</span>
          </div>`}
          ${data.loyaltyDiscount && data.loyaltyDiscount > 0
            ? `<div class="row"><span>Points redeemed:</span><span>-${money(data.loyaltyDiscount)}</span></div>`
            : ''}

          <div class="sep"></div>

          <div class="row total-row">
            <span>TOTAL:</span>
            <span>${money(data.total)}</span>
          </div>
          ${data.taxInclusive ? `
          <div class="row"><span>Taxable value:</span><span>${money(data.total - data.tax)}</span></div>
          <div class="row"><span>${data.taxLabel ? escape(data.taxLabel) : 'VAT'} (incl.):</span><span>${money(data.tax)}</span></div>
          ` : ''}

          ${isCash ? `
            <div class="row"><span>Cash:</span><span>${money(data.tendered)}</span></div>
            <div class="row"><span>Change:</span><span>${money(data.change)}</span></div>
          ` : isSplit ? `
            <div class="row"><span>Cash:</span><span>${money(data.tendered)}</span></div>
            <div class="row"><span>Card:</span><span>${money(Math.max(0, data.total - data.tendered))}</span></div>
          ` : `
            <div class="row"><span>Paid:</span><span>${escape(data.paymentMethod)}</span></div>
          `}

          <div class="sep"></div>

          ${(data.pointsEarned ?? 0) > 0 || (data.pointsBalance ?? null) !== null && data.pointsBalance !== undefined
            ? `<div class="sep"></div>
               <div class="center">
                 ${(data.pointsEarned ?? 0) > 0 ? `<div>Points earned: ${data.pointsEarned}</div>` : ''}
                 ${data.pointsBalance !== undefined ? `<div>Points balance: ${data.pointsBalance}</div>` : ''}
               </div>`
            : ''}

          <!-- Footer -->
          <div class="footer center">
            <div class="bold">Thank You For Shopping!</div>
            ${data.receiptFooter
              ? `<div>${escape(data.receiptFooter)}</div>`
              : '<div>Return within 7 days with receipt.</div>'
            }
            <div class="small" style="margin-top:6px;">Powered by Lumora Tech</div>
          </div>

          <script>
            window.onload = function() {
              // Wait for images (e.g. the logo data URI) to finish decoding before
              // printing — otherwise the logo prints blank. Fallback timeout guards
              // against an image that never fires load/error.
              var imgs = Array.prototype.slice.call(document.images);
              var done = false;
              var go = function() {
                if (done) return;
                done = true;
                window.print();
                setTimeout(function() { window.close(); }, 500);
              };
              Promise.all(imgs.map(function(img) {
                return img.complete ? Promise.resolve()
                  : new Promise(function(r) { img.onload = img.onerror = r; });
              })).then(go);
              setTimeout(go, 2000);
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  },

  /**
   * Final checkout trigger — handles drawer kick + print in one call.
   *
   * In `qz_tray` mode this prints native ESC/POS (logo + drawer kick + paper cut
   * in a single job). Any QZ failure (not installed, not connected) falls back to
   * browser printing so a completed sale is never blocked.
   */
  async processHardwareCheckoutActions(data: ReceiptData) {
    const config = hardwareService.getConfig();

    if (config.printerMode === 'qz_tray') {
      try {
        const commands = buildReceiptCommands(data, {
          paperWidth: config.paperWidth,
          drawerKick: config.cashDrawerKick,
          kickCode: config.kickCode,
        });
        await qzTrayService.printRaw(config.printerTarget, commands);
        return;
      } catch (err) {
        console.error('QZ Tray print failed — falling back to browser print.', err);
        // fall through to the browser path below
      }
    }

    // browser_print (and the qz fallback): the drawer kick can only be simulated.
    if (config.cashDrawerKick) {
      hardwareService.kickCashDrawer();
    }

    this.printBrowserReceipt(data);
  },
};
