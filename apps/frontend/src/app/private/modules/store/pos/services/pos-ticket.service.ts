import { Injectable, inject } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { delay, map, switchMap } from 'rxjs/operators';
import {
  TicketData,
  PrinterConfig,
  PrintOptions,
} from '../models/ticket.model';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { PrintFormat } from '../../../../../core/models/store-settings.interface';

/**
 * Physical page per configurable format. `width_mm` drives the ticket's CSS
 * width; `page_size` is the `@page size` rule, without which the browser prints
 * a roll ticket centred on whatever paper the driver defaults to.
 */
const TICKET_PAGE: Record<
  PrintFormat,
  { width_mm: number; page_size: string; type: PrinterConfig['type'] }
> = {
  thermal_80: { width_mm: 80, page_size: '80mm auto', type: 'thermal' },
  thermal_58: { width_mm: 58, page_size: '58mm auto', type: 'thermal' },
  letter: { width_mm: 216, page_size: 'letter', type: 'standard' },
  half_letter: { width_mm: 216, page_size: '216mm 140mm', type: 'standard' },
};

@Injectable({
  providedIn: 'root',
})
export class PosTicketService {
  private currencyService = inject(CurrencyFormatService);
  private storeSettings = inject(StoreSettingsFacade);
  private authFacade = inject(AuthFacade);

  private defaultPrinterConfig: PrinterConfig = {
    name: 'Default Thermal Printer',
    type: 'thermal',
    paperWidth: 80,
    format: 'thermal_80',
    copies: 1,
    autoPrint: true,
    printHeader: true,
    printFooter: true,
    printBarcode: true,
  };

  /**
   * Printer config resolved from the store's settings, falling back to the
   * historical 80 mm / 1 copy defaults when the store has none.
   */
  private currentPrinterConfig(formatOverride?: PrintFormat): PrinterConfig {
    const receipts = this.storeSettings.receipts();
    const requested = formatOverride ?? receipts?.pos_ticket_format;
    const format: PrintFormat =
      requested && TICKET_PAGE[requested] ? requested : 'thermal_80';
    const page = TICKET_PAGE[format];

    return {
      ...this.defaultPrinterConfig,
      type: page.type,
      paperWidth: page.width_mm,
      format,
      // 0 copies means "do not print"; the callers that ask for an explicit
      // print still get one, so clamp to at least 1 here.
      copies: Math.max(1, receipts?.pos_ticket_copies ?? 1),
      // `pos.auto_print_receipt` already models this and is already editable in
      // the POS settings form; a second key under `receipts` would be a second
      // source of truth for the same fact. The Recibos section edits this one.
      autoPrint: this.storeSettings.pos()?.auto_print_receipt ?? false,
    };
  }

  /**
   * Whether the tax breakdown belongs on this ticket.
   *
   * The POS ticket is not the fiscal document when the sale already produced an
   * electronic invoice — repeating the breakdown on an informative copy invites
   * the buyer to treat the ticket as the invoice. And a merchant that is not
   * VAT-responsible has no tax to break down at all.
   *
   * It is NOT dropped unconditionally: the electronic POS equivalent document
   * (Res. 000165/2023) does grant the buyer IVA descontable when it identifies
   * them, and that requires the tax to be stated.
   */
  private shouldShowTaxes(ticketData: TicketData): boolean {
    if (ticketData.electronicInvoice) return false;
    return this.authFacade.isVatResponsible() !== false;
  }

  private storeConfig = {
    name: 'Vendix Store',
    address: '123 Main St, City, State 12345',
    phone: '+1 (555) 123-4567',
    email: 'info@vendix.com',
    taxId: 'TAX-123456789',
    id: 0,
    logo: '',
  };

  printTicket(
    ticketData: TicketData,
    options: PrintOptions = {},
  ): Observable<boolean> {
    const printOptions = { ...this.getDefaultPrintOptions(), ...options };

    return of(ticketData).pipe(
      delay(1500),
      switchMap(async () => {
        if (printOptions.printReceipt) {
          const html = await this.generateTicketHTML(ticketData);
          this.printHTML(html, printOptions.copies);
        }

        if (printOptions.openCashDrawer) {
          this.openCashDrawer();
        }

        if (printOptions.emailReceipt && ticketData.customer?.email) {
          this.emailTicket(ticketData, ticketData.customer.email);
        }

        if (printOptions.smsReceipt && ticketData.customer?.phone) {
          this.smsTicket(ticketData, ticketData.customer.phone);
        }

        return true;
      }),
    );
  }

  /**
   * `formatOverride` lets the settings preview render a format the merchant is
   * still choosing, before it is saved to `receipts.pos_ticket_format`.
   */
  async generateTicketHTML(
    ticketData: TicketData,
    formatOverride?: PrintFormat,
  ): Promise<string> {
    const printer = this.currentPrinterConfig(formatOverride);
    const showTaxes = this.shouldShowTaxes(ticketData);
    let store = ticketData.store || this.storeConfig;
    let organization = ticketData.organization;

    // Try to get from localStorage
    try {
      const authState = localStorage.getItem('vendix_auth_state');
      if (authState) {
        const parsedState = JSON.parse(authState);
        const parsedUser = parsedState.user;
        if (parsedUser) {
          if (parsedUser.store) {
            store = { ...store, ...parsedUser.store };
          }
          if (parsedUser.organizations) {
            organization = parsedUser.organizations;
          }
          if (parsedUser.addresses && parsedUser.addresses.length > 0) {
            const addr = parsedUser.addresses[0];
            store.address = `${addr.address_line1}${addr.address_line2 ? ', ' + addr.address_line2 : ''}, ${addr.city}`;
          }
        }
      }
      const appConfig = localStorage.getItem('vendix_app_config');
      if (appConfig) {
        const parsedConfig = JSON.parse(appConfig);
        if (parsedConfig.branding?.logo?.url) {
          store.logo = parsedConfig.branding.logo.url;
        }
      }
    } catch (e) {
      console.error('Error getting data from localStorage:', e);
    }

    const date = new Date(ticketData.date).toLocaleString();

    let html = `
      <div class="ticket" style="font-family: monospace; max-width: ${printer.paperWidth}mm; margin: 0 auto; padding: 10px; background: white; border: 1px solid #ccc; border-radius: 8px;">
    `;

    if (printer.printHeader) {
      html += `
        <div style="text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px;">
      `;
      if (store.logo) {
        html += `<img src="${store.logo}" style="max-width: 100px; margin-bottom: 10px;" alt="Logo" />`;
      }
      html += `
          <h2 style="margin: 0; font-size: 18px; font-weight: bold;">${store.name}</h2>
      `;
      if (organization && organization.name) {
        html += `<p style="margin: 2px 0; font-size: 12px;">${organization.name}</p>`;
      }
      html += `
          <p style="margin: 2px 0; font-size: 12px;">${store.address}</p>
      `;
      if (organization && organization.taxId) {
        html += `<p style="margin: 2px 0; font-size: 12px;">${organization.taxId}</p>`;
      }
      html += `
          <p style="margin: 2px 0; font-size: 12px;">CIIU: ${store.id}</p>
        </div>
      `;
    }

    html += `
      <div style="margin-bottom: 15px;">
        <p style="margin: 2px 0; font-size: 12px;"><strong>Ticket:</strong> #${ticketData.id}</p>
        <p style="margin: 2px 0; font-size: 12px;"><strong>Fecha:</strong> ${date}</p>
        <p style="margin: 2px 0; font-size: 12px;"><strong>Cajero:</strong> ${ticketData.cashier || 'N/A'}</p>
        ${ticketData.transactionId ? `<p style="margin: 2px 0; font-size: 12px;"><strong>Transacción:</strong> ${ticketData.transactionId}</p>` : ''}
      </div>
      <hr style="border: 1px dashed #000; margin: 10px 0;">
    `;

    if (ticketData.customer) {
      // Show customer name, or "Consumidor Final" if empty/undefined (anonymous sale)
      const displayName = ticketData.customer.name || 'Consumidor Final';
      // For anonymous sales (empty name), show "000" as tax ID
      const displayTaxId = ticketData.customer.name
        ? ticketData.customer.taxId || ''
        : '000';
      // Delivery address line, only rendered when present (counter POS sales
      // have no shipping address and must not show an empty line).
      const shippingAddress = ticketData.customer.shippingAddress;
      html += `
        <div style="margin-bottom: 15px;">
          <p style="margin: 2px 0; font-size: 12px;"><strong>Cliente:</strong> ${displayName}</p>
          ${displayTaxId ? `<p style="margin: 2px 0; font-size: 12px;"><strong>Cédula:</strong> ${displayTaxId}</p>` : ''}
          ${shippingAddress ? `<p style="margin: 2px 0; font-size: 12px;"><strong>Dirección de entrega:</strong> ${shippingAddress}</p>` : ''}
        </div>
        <hr style="border: 1px dashed #000; margin: 10px 0;">
      `;
    }

    html += `
      <div style="margin-bottom: 15px;">
        <table style="width: 100%; font-size: 11px; border-collapse: collapse;">
          <tbody>
    `;

    ticketData.items.forEach((item: any) => {
      const isWeightItem = item.weight && item.weight > 0;
      const qtyDisplay = isWeightItem
        ? `${item.weight} ${item.weight_unit || 'kg'}`
        : `${item.quantity}`;
      const tierLine = item.appliedPriceTierName
        ? `<br><span style="font-size: 10px; color: #92400e;">Tarifa: ${item.appliedPriceTierName}</span>`
        : '';
      const packageLine =
        item.isPackageUnit && item.unitsPerPackage
          ? `<br><span style="font-size: 10px; color: #1d4ed8;">x ${item.unitsPerPackage} unid c/u</span>`
          : '';
      const serialLine =
        Array.isArray(item.serials) && item.serials.length
          ? `<br><span style="font-size: 10px; color: #6b7280;">Serial: ${item.serials.join(', ')}</span>`
          : '';
      html += `
        <tr>
          <td style="padding: 2px; vertical-align: top;">${item.name}${tierLine}${packageLine}${serialLine}</td>
          <td style="text-align: center; padding: 2px;">${qtyDisplay}</td>
          <td style="text-align: right; padding: 2px;">${this.currencyService.format(item.unitPrice)}${isWeightItem ? '/' + (item.weight_unit || 'kg') : ''}</td>
          <td style="text-align: right; padding: 2px;">${this.currencyService.format(item.totalPrice)}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>
      <hr style="border: 1px dashed #000; margin: 10px 0;">
    `;

    // Taxes breakdown — omitted on informative copies of an electronic invoice
    // and for merchants that are not VAT-responsible (see shouldShowTaxes).
    if (showTaxes) {
      ticketData.items.forEach((item, index) => {
        const calculatedTax = item.totalPrice - item.unitPrice * item.quantity;
        const taxAmount = item.tax || calculatedTax;
        const taxPercent = taxAmount
          ? ((taxAmount / item.totalPrice) * 100).toFixed(2)
          : '0.00';
        html += `<p style="margin: 2px 0; font-size: 11px;">A${index + 1}. ${item.name} - Imp: ${taxPercent}% - ${this.currencyService.format(taxAmount)}</p>`;
      });

      html += `<hr style="border: 1px dashed #000; margin: 10px 0;">`;
    }

    html += `
      <div style="margin-bottom: 15px;">
        <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
          <tr>
            <td style="text-align: left; padding: 2px;">Subtotal:</td>
            <td style="text-align: right; padding: 2px;">${this.currencyService.format(ticketData.subtotal)}</td>
          </tr>
          ${
            ticketData.discount > 0
              ? `
          <tr>
            <td style="text-align: left; padding: 2px;">Descuento:</td>
            <td style="text-align: right; padding: 2px;">-${this.currencyService.format(ticketData.discount)}</td>
          </tr>
          `
              : ''
          }
          ${
            showTaxes
              ? `
          <tr>
            <td style="text-align: left; padding: 2px;">Impuesto:</td>
            <td style="text-align: right; padding: 2px;">${this.currencyService.format(ticketData.tax)}</td>
          </tr>
          `
              : ''
          }
          <tr style="font-weight: bold; border-top: 1px solid #000;">
            <td style="text-align: left; padding: 2px;">TOTAL:</td>
            <td style="text-align: right; padding: 2px;">${this.currencyService.format(ticketData.total)}</td>
          </tr>
        </table>
      </div>
    `;

    html += `
      <div style="margin-bottom: 15px;">
        <p style="margin: 2px 0; font-size: 12px;"><strong>Método de pago:</strong> ${ticketData.paymentMethod}</p>
        ${
          ticketData.cashReceived
            ? `
        <p style="margin: 2px 0; font-size: 12px;"><strong>Efectivo recibido:</strong> ${this.currencyService.format(ticketData.cashReceived)}</p>
        <p style="margin: 2px 0; font-size: 12px;"><strong>Cambio:</strong> ${this.currencyService.format(ticketData.change ?? 0)}</p>
        `
            : ''
        }
      </div>
    `;

    // QR Code for retroactive invoicing (Consumidor Final sales)
    if (ticketData.invoiceDataToken && ticketData.invoiceDataQrUrl) {
      const qrUrl = ticketData.invoiceDataQrUrl;
      try {
        const QRCode = await import('qrcode');
        const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 200, margin: 1 });
        html += `
          <hr style="border: 1px dashed #000; margin: 10px 0;">
          <div style="text-align: center; margin: 10px 0;">
            <p style="margin: 2px 0; font-size: 11px; font-weight: bold;">Solicite su factura electrónica</p>
            <img src="${qrDataUrl}" style="width: 160px; height: 160px; margin: 8px auto;" />
            <p style="margin: 2px 0; font-size: 10px;">Escanee el código QR o visite:</p>
            <p style="margin: 4px 0; font-size: 9px; word-break: break-all;">${qrUrl}</p>
          </div>
        `;
      } catch (err) {
        // Fallback: just show URL without QR image
        html += `
          <hr style="border: 1px dashed #000; margin: 10px 0;">
          <div style="text-align: center; margin: 10px 0;">
            <p style="margin: 2px 0; font-size: 11px; font-weight: bold;">Solicite su factura electrónica</p>
            <p style="margin: 2px 0; font-size: 10px;">Visite:</p>
            <p style="margin: 4px 0; font-size: 9px; word-break: break-all;">${qrUrl}</p>
          </div>
        `;
      }
    }

    if (printer.printFooter) {
      // The old footer always warned "esta factura electrónica no está avalada
      // por la DIAN", which is false when the sale did produce a validated
      // invoice: then the ticket is an informative copy and must point at it.
      const legalNotice = ticketData.electronicInvoice
        ? `<p style="margin: 5px 0; font-size: 11px; font-weight: bold;">Copia informativa. Factura electrónica No. ${ticketData.electronicInvoice.number} validada por la DIAN</p>
           ${ticketData.electronicInvoice.cufe ? `<p style="margin: 2px 0; font-size: 8px; word-break: break-all;">CUFE: ${ticketData.electronicInvoice.cufe}</p>` : ''}`
        : `<p style="margin: 5px 0; font-size: 11px; font-weight: bold;">Este documento no es una factura electrónica</p>`;

      html += `
        <hr style="border: 1px dashed #000; margin: 10px 0;">
        <div style="text-align: center; margin-top: 20px;">
          ${legalNotice}
          <p style="margin: 5px 0; font-size: 11px;">¡Gracias por su compra!</p>
          <p style="margin: 5px 0; font-size: 10px;">Vuelva pronto</p>
          <p style="margin: 10px 0 0 0; font-size: 9px; color: #666;">
            ${new Date().toLocaleString()}
          </p>
        </div>
      `;
    }

    html += `</div>`;
    return html;
  }

  generateTicketPDF(ticketData: TicketData): Observable<Blob> {
    return of(ticketData).pipe(
      delay(1000),
      switchMap(async () => {
        const html = await this.generateTicketHTML(ticketData);
        return new Blob([html], { type: 'text/html' });
      }),
    );
  }

  private printHTML(html: string, copies?: number): void {
    const printer = this.currentPrinterConfig();
    const total_copies = Math.max(1, copies ?? printer.copies);
    const page_size =
      TICKET_PAGE[printer.format ?? 'thermal_80']?.page_size ?? '80mm auto';

    // Browsers expose no copy count to window.print(), so extra copies are
    // extra pages: repeat the markup and force a break between copies.
    const body = Array.from({ length: total_copies }, (_, i) =>
      i === 0
        ? html
        : `<div style="break-before: page; page-break-before: always;">${html}</div>`,
    ).join('');

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.opacity = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(`
        <html>
          <head>
            <title>Ticket</title>
            <style>
              /* Without an explicit @page size the driver falls back to its own
                 default paper and centres an 80 mm ticket on a letter sheet. */
              @page { size: ${page_size}; margin: 0; }
              body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
              .ticket { background: white; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              @media print {
                body { padding: 0; background: white; }
                .ticket { border: none; border-radius: 0; box-shadow: none; }
              }
            </style>
          </head>
          <body>
            ${body}
          </body>
        </html>
      `);
      doc.close();

      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }

    setTimeout(() => iframe.remove(), 1000);
  }

  private openCashDrawer(): void {}

  private emailTicket(ticketData: TicketData, email: string): void {}

  private smsTicket(ticketData: TicketData, phone: string): void {}

  private getDefaultPrintOptions(): PrintOptions {
    const printer = this.currentPrinterConfig();
    return {
      printer: printer.name,
      copies: printer.copies,
      openCashDrawer: true,
      printReceipt: true,
      emailReceipt: false,
      smsReceipt: false,
    };
  }

  /**
   * Whether the POS should send the ticket to the printer without asking.
   * Read by the printer component so the setting drives the flow, not the
   * component's own default.
   */
  shouldAutoPrint(): boolean {
    return this.currentPrinterConfig().autoPrint;
  }

  /** Configured POS ticket copies per sale (`receipts.pos_ticket_copies`). */
  configuredCopies(): number {
    return this.currentPrinterConfig().copies;
  }

  /**
   * Full HTML document of a SAMPLE ticket in the given format, for the settings
   * preview. Built from the same `generateTicketHTML` the printer uses and
   * wrapped in the same page rules as `printHTML`, so what the merchant reviews
   * is what the printer receives — including the `@page size`.
   *
   * `asInvoiceCopy` renders it as the informative copy of an electronic invoice,
   * which is what a store already emitting invoices will actually print (no tax
   * breakdown, footer pointing at the invoice).
   */
  async buildSampleTicketHTML(
    format: PrintFormat,
    options: { asInvoiceCopy?: boolean } = {},
  ): Promise<string> {
    const sample: TicketData = {
      id: 'MUESTRA-0001',
      date: new Date(),
      items: [
        {
          id: '1',
          name: 'Producto de ejemplo',
          sku: 'EJ-001',
          quantity: 2,
          unitPrice: 50000,
          totalPrice: 100000,
          discount: 5000,
          tax: 18050,
        },
        {
          id: '2',
          name: 'Servicio de ejemplo',
          sku: 'EJ-002',
          quantity: 1,
          unitPrice: 120000,
          totalPrice: 120000,
          tax: 22800,
        },
      ],
      subtotal: 220000,
      tax: 40850,
      discount: 5000,
      total: 255850,
      paymentMethod: 'Efectivo',
      cashReceived: 300000,
      change: 44150,
      customer: { name: 'Cliente de muestra' },
      cashier: 'Cajero de muestra',
      ...(options.asInvoiceCopy
        ? {
            electronicInvoice: {
              number: 'MUESTRA-0001',
              cufe: 'MUESTRA'.padEnd(96, '0'),
            },
          }
        : {}),
    };

    const ticket = await this.generateTicketHTML(sample, format);
    const page_size = TICKET_PAGE[format]?.page_size ?? '80mm auto';

    return `
      <html>
        <head>
          <style>
            @page { size: ${page_size}; margin: 0; }
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
            .ticket { background: white; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          </style>
        </head>
        <body>${ticket}</body>
      </html>
    `;
  }

  getPrinterConfig(): Observable<PrinterConfig[]> {
    const printers: PrinterConfig[] = [
      this.defaultPrinterConfig,
      {
        name: 'Standard A4 Printer',
        type: 'standard',
        paperWidth: 210,
        copies: 1,
        autoPrint: false,
        printHeader: true,
        printFooter: true,
        printBarcode: false,
      },
      {
        name: 'PDF Generator',
        type: 'pdf',
        paperWidth: 80,
        copies: 1,
        autoPrint: false,
        printHeader: true,
        printFooter: true,
        printBarcode: true,
      },
    ];

    return of(printers).pipe(delay(500));
  }

  updatePrinterConfig(config: PrinterConfig): Observable<PrinterConfig> {
    return of(config).pipe(
      delay(300),
      map(() => config),
    );
  }

  testPrinter(printerName: string): Observable<boolean> {
    return of(printerName).pipe(
      delay(2000),
      map(() => {
        return true;
      }),
    );
  }

  previewTicket(ticketData: TicketData): Observable<string> {
    return from(this.generateTicketHTML(ticketData)).pipe(delay(500));
  }

  saveTicketTemplate(template: string): Observable<boolean> {
    return of(template).pipe(
      delay(300),
      map(() => {
        return true;
      }),
    );
  }

  loadTicketTemplate(): Observable<string> {
    return of('').pipe(
      delay(300),
      map(() => {
        return this.getDefaultTicketTemplate();
      }),
    );
  }

  private getDefaultTicketTemplate(): string {
    return `
<div class="ticket">
  <header>
    <h2>{{store.name}}</h2>
    <p>{{store.address}}</p>
  </header>
  <main>
    <h3>Ticket #{{ticket.id}}</h3>
    <p>Fecha: {{ticket.date}}</p>
    <table>
      <tr ng-repeat="item in ticket.items">
        <td>{{item.name}}</td>
        <td>{{item.quantity}}</td>
        <td>{{item.unitPrice}}</td>
        <td>{{item.totalPrice}}</td>
      </tr>
    </table>
    <p>Total: {{ticket.total}}</p>
  </main>
  <footer>
    <p>¡Gracias por su compra!</p>
  </footer>
</div>
    `.trim();
  }
}
