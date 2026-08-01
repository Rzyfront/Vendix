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

/**
 * Regime label printed on the ticket. Mirrors `TAX_REGIME_LABELS` in
 * invoice-pdf.service.ts so both documents word the same fact identically.
 */
const TAX_REGIME_LABELS: Record<string, string> = {
  COMUN: 'Responsable de IVA',
  SIMPLIFICADO: 'No responsable de IVA',
  SIMPLE: 'Regimen Simple de Tributacion (RST)',
  GRAN_CONTRIBUYENTE: 'Gran contribuyente',
  NO_RESPONSABLE: 'No responsable de IVA',
};

/**
 * Tickets rendered before handing the main thread back. Rendering is pure string
 * building, so a 300-order batch never awaits anything and the browser paints
 * nothing — including the progress bar — until it finishes. Yielding every N
 * tickets costs one macrotask per chunk and keeps the UI alive.
 */
const BATCH_YIELD_EVERY = 20;

/**
 * Upper bound for the iframe's `load` event. `document.write` + `close()` fires
 * it, but an engine that does not must not hang the print behind it.
 */
const DOCUMENT_READY_TIMEOUT_MS = 3_000;

/**
 * Upper bound for image decoding. A logo whose request never settles would
 * otherwise leave `img.decode()` pending forever and no dialog would ever open.
 */
const IMAGE_DECODE_TIMEOUT_MS = 15_000;

/**
 * Backstop for removing the print iframe when `afterprint` never fires (it does
 * not on every engine, nor when the user dismisses the dialog with the window
 * chrome). Long on purpose: the previous 1 s could tear the document down while
 * the print dialog was still reading it.
 */
const PRINT_CLEANUP_FALLBACK_MS = 60_000;

/** Bounded wait for a currency load already in flight (see `ensureCurrencyLoaded`). */
const CURRENCY_WAIT_TIMEOUT_MS = 1_000;
const CURRENCY_WAIT_STEP_MS = 50;

/**
 * Store/organization data carried by the browser session (`localStorage`), kept
 * apart from `TicketData` so it can be resolved once per batch and then merged
 * into every ticket WITHOUT mutating either the caller's payload or this
 * service's own `storeConfig`.
 */
interface TicketSessionOverlay {
  store?: Partial<NonNullable<TicketData['store']>>;
  organization?: TicketData['organization'];
}

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
   * the buyer to treat the ticket as the invoice.
   *
   * Beyond that, `printsVatBreakdown` requires the merchant to have ACTIVATED
   * the `invoicing` fiscal area and not be a non-VAT-responsible merchant. The
   * previous condition only tested VAT responsibility, and its indeterminate
   * branch resolves to `true`, so a merchant that never started the fiscal
   * wizard (no `fiscal_data` at all) still printed a breakdown it cannot back.
   *
   * It is NOT dropped unconditionally: the electronic POS equivalent document
   * (Res. 000165/2023) does grant the buyer IVA descontable when it identifies
   * them, and that requires the tax to be stated.
   */
  private shouldShowTaxes(ticketData: TicketData): boolean {
    if (ticketData.electronicInvoice) return false;
    return this.authFacade.printsVatBreakdown();
  }

  /**
   * Last-resort shape when neither the ticket nor the session carries the store.
   * Deliberately empty instead of the sample values it used to hold: a ticket the
   * buyer may keep as support for a purchase must never print an invented
   * address or NIT, and the header omits whatever is missing.
   */
  private storeConfig = {
    name: '',
    address: '',
    phone: '',
    email: '',
    taxId: '',
    id: 0,
    logo: '',
  };

  /**
   * Legal identity of whoever issues this ticket, mirroring the backend's
   * `resolveIssuer` (invoice-pdf.service.ts) so the paper cannot state a razón
   * social or NIT different from the one the DIAN validated.
   *
   * `fiscalData()` is already resolved by `fiscal_scope`, the same criterion the
   * signed XML uses: the habilitación may belong to the store or to the
   * organization. The header used to print `stores.name` and the raw store id
   * labelled as CIIU, so a POS equivalent document went out with a commercial
   * name, no NIT and a bogus economic-activity code.
   */
  private resolveIssuer(fallbackOrganization?: any): {
    legal_name: string;
    nit: string;
    address: string;
    tax_regime: string;
    ciiu: string;
  } {
    const fiscal = (this.authFacade.fiscalData() ?? {}) as Record<string, any>;
    // The session copy is the fallback for a print issued before the NgRx state
    // rehydrates; `tax_id` is the real column name — the header used to read a
    // camelCase `taxId` that never existed, which is why no NIT was printed.
    const organization = this.authFacade.userOrganization() ?? fallbackOrganization;

    // The check digit must come from the same field as the base it verifies:
    // `fiscal_data` can carry both `nit`/`nit_dv` and `tax_id`/`tax_id_dv` with
    // different values, and pairing a base with the other's DV prints an
    // arithmetically invalid NIT.
    const [nit_base, dv] = fiscal['nit']
      ? [fiscal['nit'], fiscal['nit_dv']]
      : fiscal['tax_id']
        ? [fiscal['tax_id'], fiscal['tax_id_dv']]
        : [organization?.tax_id, undefined];

    return {
      legal_name:
        fiscal['legal_name'] || organization?.legal_name || organization?.name || '',
      nit: nit_base ? (dv ? `${nit_base}-${dv}` : `${nit_base}`) : '',
      address: [fiscal['fiscal_address'], fiscal['city'], fiscal['department']]
        .filter(Boolean)
        .join(', '),
      tax_regime:
        TAX_REGIME_LABELS[String(fiscal['tax_regime'] ?? '').toUpperCase()] ||
        fiscal['tax_regime'] ||
        '',
      ciiu: fiscal['ciiu_code'] || fiscal['ciiu'] || '',
    };
  }

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
          // Awaited so the emitted `true` means "the document reached the print
          // dialog with its images decoded", not "the iframe was created".
          await this.printHTML(html, printOptions.copies);
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
   *
   * Thin wrapper over `renderTicketBody`, kept with its original signature
   * because the POS confirmation, the order detail page and the receipts
   * settings preview all call it. A batch must NOT loop over this method:
   * `printTicketsBatch` resolves the printer, the session overlay and the
   * currency once and then calls `renderTicketBody` per ticket.
   */
  async generateTicketHTML(
    ticketData: TicketData,
    formatOverride?: PrintFormat,
  ): Promise<string> {
    await this.ensureCurrencyLoaded();

    return this.renderTicketBody(
      ticketData,
      this.currentPrinterConfig(formatOverride),
      this.resolveSessionStore(),
    );
  }

  /**
   * Reads the session's store/organization/logo from `localStorage` ONCE.
   *
   * Two `JSON.parse` calls per ticket was invisible for a single POS sale and is
   * 600 parses on the main thread for a 300-order batch, so the batch resolves
   * this once and reuses the result.
   *
   * It returns an overlay instead of a merged store on purpose: the previous
   * code did `let store = ticketData.store || this.storeConfig` and then wrote
   * `store.address = …` / `store.logo = …` on it. With no `ticketData.store`
   * that mutated `this.storeConfig` — state of a `providedIn: 'root'` service —
   * so the first ticket's address and logo leaked into every later ticket of the
   * batch and into the rest of the session; with a `ticketData.store` it mutated
   * the caller's own object.
   */
  private resolveSessionStore(): TicketSessionOverlay {
    const overlay: TicketSessionOverlay = {};

    try {
      const authState = localStorage.getItem('vendix_auth_state');
      if (authState) {
        const parsedState = JSON.parse(authState);
        const parsedUser = parsedState.user;
        if (parsedUser) {
          if (parsedUser.store) {
            overlay.store = { ...parsedUser.store };
          }
          if (parsedUser.organizations) {
            overlay.organization = parsedUser.organizations;
          }
          if (
            Array.isArray(parsedUser.addresses) &&
            parsedUser.addresses.length > 0
          ) {
            const addr = parsedUser.addresses[0];
            // Applied after the session store so it keeps winning over
            // `parsedUser.store.address`, exactly as the old order of writes did.
            overlay.store = {
              ...overlay.store,
              address: `${addr.address_line1}${addr.address_line2 ? ', ' + addr.address_line2 : ''}, ${addr.city}`,
            };
          }
        }
      }
      const appConfig = localStorage.getItem('vendix_app_config');
      if (appConfig) {
        const parsedConfig = JSON.parse(appConfig);
        if (parsedConfig.branding?.logo?.url) {
          overlay.store = {
            ...overlay.store,
            logo: parsedConfig.branding.logo.url,
          };
        }
      }
    } catch (e) {
      console.error('Error getting data from localStorage:', e);
    }

    return overlay;
  }

  /**
   * The ticket itself (the `.ticket` element), without the page wrapper. Every
   * consumer goes through here — single sale, settings preview and batch — so
   * the three documents cannot drift apart.
   */
  private async renderTicketBody(
    ticketData: TicketData,
    printer: PrinterConfig,
    overlay: TicketSessionOverlay,
  ): Promise<string> {
    const showTaxes = this.shouldShowTaxes(ticketData);
    // Without the breakdown, a `Subtotal` row that does not add up to `TOTAL`
    // leaves the difference orphaned on paper: `subtotal` arrives from the
    // backend as the tax-free base and `total` as the taxed amount. A merchant
    // that does not itemise VAT prints the final price, not a broken sum.
    const showSubtotal = showTaxes || !(ticketData.tax > 0);
    // Composed, never mutated: `this.storeConfig` is service state and
    // `ticketData.store` belongs to the caller. Precedence is the historical
    // one — session overlay beats the ticket's own store, which beats the empty
    // fallback.
    const store = {
      ...this.storeConfig,
      ...(ticketData.store ?? {}),
      ...(overlay.store ?? {}),
    };
    const organization = overlay.organization ?? ticketData.organization;

    const date = new Date(ticketData.date).toLocaleString();

    let html = `
      <div class="ticket" style="font-family: monospace; max-width: ${printer.paperWidth}mm; margin: 0 auto; padding: 10px; background: white; border: 1px solid #ccc; border-radius: 8px;">
    `;

    if (printer.printHeader) {
      const issuer = this.resolveIssuer(organization);
      // Razón social leads the header; the commercial name only repeats when it
      // actually differs, so a store trading under its own legal name does not
      // print the same line twice.
      const heading = issuer.legal_name || store.name;
      const trade_name =
        store.name && store.name !== heading ? store.name : '';
      // The fiscal address is the one bound to the NIT; the session address is
      // only a fallback for stores with no fiscal block captured yet.
      const address = issuer.address || store.address;

      const lines = [
        trade_name,
        issuer.nit ? `NIT ${issuer.nit}` : '',
        address,
        issuer.tax_regime,
        // Never the store id: that was printed as a CIIU code and is not one.
        issuer.ciiu ? `CIIU: ${issuer.ciiu}` : '',
      ].filter(Boolean);

      html += `
        <div style="text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px;">
      `;
      if (store.logo) {
        html += `<img src="${store.logo}" style="max-width: 100px; margin-bottom: 10px;" alt="Logo" />`;
      }
      if (heading) {
        html += `
          <h2 style="margin: 0; font-size: 18px; font-weight: bold;">${heading}</h2>
        `;
      }
      html += lines
        .map(
          (line) =>
            `<p style="margin: 2px 0; font-size: 12px;">${line}</p>`,
        )
        .join('');
      html += `
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
    // and for merchants with no active fiscal invoicing (see shouldShowTaxes).
    if (showTaxes) {
      // Only the tax the sale actually persisted. The old fallback derived it
      // from `totalPrice - unitPrice * quantity`, which is not a tax at all but
      // the line's leftover: with a line discount it goes negative, and with no
      // tax it printed a bogus `Imp: 0.00%` row per item. An item with no tax
      // now produces no line.
      const taxedItems = ticketData.items.filter((item) => (item.tax ?? 0) > 0);

      taxedItems.forEach((item, index) => {
        const taxAmount = item.tax ?? 0;
        const taxPercent = item.totalPrice
          ? ((taxAmount / item.totalPrice) * 100).toFixed(2)
          : '0.00';
        html += `<p style="margin: 2px 0; font-size: 11px;">A${index + 1}. ${item.name} - Imp: ${taxPercent}% - ${this.currencyService.format(taxAmount)}</p>`;
      });

      if (taxedItems.length) {
        html += `<hr style="border: 1px dashed #000; margin: 10px 0;">`;
      }
    }

    html += `
      <div style="margin-bottom: 15px;">
        <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
          ${
            showSubtotal
              ? `
          <tr>
            <td style="text-align: left; padding: 2px;">Subtotal:</td>
            <td style="text-align: right; padding: 2px;">${this.currencyService.format(ticketData.subtotal)}</td>
          </tr>
          `
              : ''
          }
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

  /**
   * Prints N tickets as ONE document, in one dialog.
   *
   * Copies are contiguous per ticket (order1 ×C, order2 ×C, …) rather than the
   * whole batch repeated C times, so the operator splits the stack by order
   * instead of collating 600 sheets by hand.
   *
   * A single `@page size` governs the document: a batch cannot mix stores —
   * `orders` is a store-scoped Prisma model, so an id from another store never
   * comes back — and therefore cannot mix paper formats.
   *
   * @returns `rendered` tickets and `pages` sheets (`rendered × copies`).
   */
  async printTicketsBatch(
    tickets: readonly TicketData[],
    options?: {
      formatOverride?: PrintFormat;
      /**
       * Copies per ticket, canonical from the DB. Same reason as
       * `formatOverride`: `receipts.pos_ticket_copies` reaches this service
       * through the `vendix_auth_state` snapshot, which only rehydrates on
       * re-login, so a merchant who changes the copy count without logging out
       * would keep printing the old number. Clamped to at least 1 — whoever
       * asked to print explicitly wants paper.
       */
      copiesOverride?: number;
      onProgress?: (done: number, total: number) => void;
    },
  ): Promise<{ rendered: number; pages: number }> {
    const total = tickets.length;
    if (!total) {
      return { rendered: 0, pages: 0 };
    }

    // Before the first `currencyService.format()` call, or every amount on every
    // ticket prints with the en-US `$` fallback.
    await this.ensureCurrencyLoaded();

    // Resolved once for the whole batch: the format/copies come from the store's
    // settings (or the override the backend read from the DB) and the session
    // overlay from localStorage.
    const printer = this.currentPrinterConfig(options?.formatOverride);
    const overlay = this.resolveSessionStore();
    const copies = Math.max(
      1,
      Math.trunc(options?.copiesOverride ?? printer.copies) || 1,
    );

    const blocks: string[] = [];
    let rendered = 0;

    for (const ticket of tickets) {
      const body = await this.renderTicketBody(ticket, printer, overlay);
      for (let copy = 0; copy < copies; copy++) {
        blocks.push(this.asPageBlock(body, blocks.length === 0));
      }

      rendered++;
      options?.onProgress?.(rendered, total);

      // Rendering is synchronous string work; without this the main thread never
      // gets a frame and the progress bar stays frozen at 0 for seconds.
      if (rendered % BATCH_YIELD_EVERY === 0 && rendered < total) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    await this.printDocument(
      this.wrapPrintDocument(
        blocks.join(''),
        printer.format ?? 'thermal_80',
        { title: total === 1 ? 'Ticket' : `Tiquetes (${total})` },
      ),
    );

    return { rendered, pages: rendered * copies };
  }

  private async printHTML(html: string, copies?: number): Promise<void> {
    const printer = this.currentPrinterConfig();
    const total_copies = Math.max(1, copies ?? printer.copies);

    // Browsers expose no copy count to window.print(), so extra copies are
    // extra pages: repeat the markup and force a break between copies.
    const body = Array.from({ length: total_copies }, (_, i) =>
      this.asPageBlock(html, i === 0),
    ).join('');

    await this.printDocument(
      this.wrapPrintDocument(body, printer.format ?? 'thermal_80'),
    );
  }

  /**
   * One page of the document. Every block but the first opens a new sheet — the
   * same rule for extra copies of one ticket and for the next ticket of a batch.
   */
  private asPageBlock(html: string, isFirst: boolean): string {
    return isFirst
      ? html
      : `<div style="break-before: page; page-break-before: always;">${html}</div>`;
  }

  /**
   * The full print document around one or more ticket bodies.
   *
   * Single source of the `@page` rule and the print stylesheet, which used to be
   * copy-pasted in three places (`printHTML`, `buildSampleTicketHTML` and the
   * order detail page) with the preview's copy missing the `@media print` block
   * entirely — so the merchant reviewed a bordered card on grey and the printer
   * received something else.
   */
  private wrapPrintDocument(
    bodyHtml: string,
    format: PrintFormat,
    opts?: { title?: string },
  ): string {
    const page_size = TICKET_PAGE[format]?.page_size ?? '80mm auto';

    return `
      <html>
        <head>
          <title>${opts?.title ?? 'Ticket'}</title>
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
        <body>${bodyHtml}</body>
      </html>
    `;
  }

  /**
   * Writes a full print document into a hidden iframe and sends it to the
   * printer, waiting for the document and its images first.
   */
  private async printDocument(documentHtml: string): Promise<void> {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.opacity = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      return;
    }

    doc.open();
    doc.write(documentHtml);
    doc.close();

    await this.awaitDocumentReady(iframe, doc);

    const view = iframe.contentWindow;
    // Registered BEFORE print() because print() blocks on the dialog and
    // `afterprint` can fire the moment it returns.
    this.removeAfterPrint(iframe, view);
    view?.focus();
    view?.print();
  }

  /**
   * Blocks until the document is parsed and every image is decoded.
   *
   * `print()` used to run right after `doc.close()`, which is before the logo has
   * been fetched: the preview showed it (it kept living long enough) while the
   * paper came out without it, and a 300-ticket batch made that the normal case.
   * Both waits are capped — a broken or hanging image must not make the document
   * unprintable.
   */
  private async awaitDocumentReady(
    iframe: HTMLIFrameElement,
    doc: Document,
  ): Promise<void> {
    if (doc.readyState !== 'complete') {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        iframe.addEventListener('load', done, { once: true });
        setTimeout(done, DOCUMENT_READY_TIMEOUT_MS);
      });
    }

    const images = Array.from(doc.images);
    if (!images.length) return;

    await Promise.race([
      Promise.all(images.map((img) => this.awaitImage(img))),
      new Promise<void>((resolve) =>
        setTimeout(resolve, IMAGE_DECODE_TIMEOUT_MS),
      ),
    ]);
  }

  /**
   * Resolves when an image is fetched AND decoded — or when it has definitively
   * failed. Never rejects: a broken logo must degrade to a ticket without a logo,
   * not cancel a 600-page job.
   */
  private awaitImage(img: HTMLImageElement): Promise<void> {
    const fetched = img.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        });

    return fetched.then(() =>
      typeof img.decode === 'function'
        ? img.decode().catch(() => undefined)
        : undefined,
    );
  }

  /**
   * Tears the iframe down once printing is over. The old fixed 1 s timeout could
   * remove the document while the dialog was still rendering from it, which on a
   * long batch means a blank or truncated job.
   */
  private removeAfterPrint(
    iframe: HTMLIFrameElement,
    view: Window | null,
  ): void {
    let fallback: ReturnType<typeof setTimeout> | undefined;
    let removed = false;

    const remove = () => {
      if (removed) return;
      removed = true;
      if (fallback !== undefined) clearTimeout(fallback);
      iframe.remove();
    };

    // `afterprint` does not fire on every engine, so it is the fast path and the
    // timeout is the guarantee.
    view?.addEventListener('afterprint', remove, { once: true });
    fallback = setTimeout(remove, PRINT_CLEANUP_FALLBACK_MS);
  }

  /**
   * Makes the printed currency deterministic.
   *
   * `CurrencyFormatService.format()` falls back to an en-US `$` while
   * `currentCurrency()` is null (`currency.pipe.ts:275-305`), and the load is
   * only triggered by the `currency` pipe's constructor — which neither
   * `/admin/orders/bulk` nor `/admin/settings/general` instantiates. Without this
   * the symbol on the paper depended on which screen the operator had visited
   * before, and the settings preview could disagree with the batch.
   */
  private async ensureCurrencyLoaded(): Promise<void> {
    if (this.currencyService.currentCurrency()) return;

    try {
      await this.currencyService.loadCurrency();
    } catch {
      // A ticket with the fallback symbol still prints; a rejection here would
      // abort the whole batch instead.
    }

    // `loadCurrency()` returns null immediately when another load is already in
    // flight, so give that one a bounded window to land rather than racing it.
    for (
      let waited = 0;
      waited < CURRENCY_WAIT_TIMEOUT_MS &&
      !this.currencyService.currentCurrency() &&
      this.currencyService.loading();
      waited += CURRENCY_WAIT_STEP_MS
    ) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, CURRENCY_WAIT_STEP_MS),
      );
    }
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
   * Whether `tiquetes × copias` is the EXACT number of sheets for the configured
   * format, or only a lower bound.
   *
   * `thermal_*` use `size: <w>mm auto`: the sheet grows with the content, so one
   * ticket is always one page no matter how many lines it has. `letter` and
   * `half_letter` have a FIXED height, so a long ticket fragments onto a second
   * sheet — measured on half letter, a 16-line order renders 209 mm tall against
   * a 140 mm page.
   *
   * The bulk-print notice needs this to avoid promising a page count it cannot
   * keep: undercounting paper is exactly the surprise the notice exists to
   * prevent.
   */
  pageCountIsExact(): boolean {
    const { format } = this.currentPrinterConfig();
    // `format` es opcional en `PrinterConfig`, y el fallback de todo el servicio
    // es `thermal_80` (alto `auto`), así que sin formato el conteo SÍ es exacto.
    const page_size = format
      ? TICKET_PAGE[format]?.page_size
      : TICKET_PAGE.thermal_80.page_size;
    return (page_size ?? TICKET_PAGE.thermal_80.page_size).endsWith('auto');
  }

  /**
   * Full HTML document of a SAMPLE ticket in the given format, for the settings
   * preview. Built from the same `generateTicketHTML` the printer uses and
   * wrapped by the same `wrapPrintDocument` as every printed job, so what the
   * merchant reviews is literally what the printer receives — `@page size` and
   * `@media print` rules included.
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

    // Same wrapper the printer receives — including the `@media print` rules the
    // preview's own copy of this block used to omit.
    return this.wrapPrintDocument(ticket, format, {
      title: 'Tiquete de muestra',
    });
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
