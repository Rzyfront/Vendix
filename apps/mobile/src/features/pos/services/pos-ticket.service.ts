import { useAuthStore } from '@/core/store/auth.store';
import {
  DocumentPrintService,
  type PrintFormat,
  type PrintResult,
  type ShareResult,
} from '@/shared/print';
import {
  formatStoreMoney,
  resolveStoreCurrency,
  type StoreCurrency,
} from '@/shared/utils/store-currency';
import type { ReceiptsSettings } from '@/features/store/types/settings.types';
import { formatSaleQuantity } from '@/features/store/pricing';

/**
 * POS ticket renderer for the mobile app.
 *
 * Deliberate twin of the desktop renderer
 * (`apps/frontend/src/app/private/modules/store/pos/services/pos-ticket.service.ts`):
 * same header, same blocks, same tax breakdown, same footer, same paper —
 * because QUI-665's acceptance criterion is that the phone's ticket and the
 * desktop's ticket ARE the same document for the same order and the same store.
 *
 * It is a re-implementation and not an import: `mobile-dev` RULE 4 forbids
 * cross-app imports and no shared library owns this today. Everything that can
 * drift is therefore pinned to the same sources of truth the desktop reads —
 * `receipts.printing.pos_ticket` for the paper, `fiscal_data` for the issuer,
 * the currency catalogue for the amounts, `receipts.receipt_*` for the copy.
 */

/**
 * Regime label printed on the ticket. Mirrors `TAX_REGIME_LABELS` in the web
 * ticket service (itself a mirror of the backend invoice PDF) so both documents
 * word the same fact identically.
 */
const TAX_REGIME_LABELS: Record<string, string> = {
  COMUN: 'Responsable de IVA',
  SIMPLIFICADO: 'No responsable de IVA',
  SIMPLE: 'Regimen Simple de Tributacion (RST)',
  GRAN_CONTRIBUYENTE: 'Gran contribuyente',
  NO_RESPONSABLE: 'No responsable de IVA',
};

const VAT_RESPONSIBLE_CODE = 'O-48';
const VAT_NOT_RESPONSIBLE_CODE = 'O-49';

/**
 * Footer used when the store never customised `receipts.receipt_footer`. It is
 * the same string the backend seeds as that setting's default AND the one the
 * desktop ticket hardcodes, so a store on defaults keeps printing exactly what
 * it printed before.
 */
const DEFAULT_RECEIPT_FOOTER = '¡Gracias por su compra!';

/**
 * Ticket-specific CSS. The `@page` rule is NOT here on purpose: paper geometry
 * belongs to `DocumentPrintService`, which resolves it from
 * `receipts.printing.pos_ticket`.
 *
 * The web sheet styles a card for the screen and flattens it under
 * `@media print`. Here the base rule is already the flattened one: expo-print
 * has no screen pass, and a `#f5f5f5` background that survived into the render
 * would come out as grey toner over the whole ticket.
 */
const TICKET_PRINT_STYLES = `
      body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; background: #fff; }
      .ticket { background: #fff; border: none; border-radius: 0; box-shadow: none; }`;

export interface PosTicketItem {
  id?: string;
  name: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  discount?: number;
  /** Tax the sale actually persisted for this line. Absent = untaxed line. */
  tax?: number;
  weight?: number;
  weight_unit?: string;
  appliedPriceTierName?: string | null;
  isPackageUnit?: boolean;
  unitsPerPackage?: number | null;
  /**
   * QUI-648 — unidad en la que se capturó la línea ("m", "kg"). El papel
   * imprime "3 m", no "3000": el cliente audita lo que pidió, no la unidad
   * mínima del inventario. `null`/ausente ⇒ se imprime la cantidad tal cual.
   */
  saleUnitCode?: string | null;
  /** Unidades mínimas por unidad de captura (1000 mm por metro). */
  stockUnitsPerSaleUnit?: number | null;
  serials?: string[];
  /** Line is packed to go, even inside a table order (QUI-653). */
  isTakeaway?: boolean;
}

export interface PosTicketData {
  id: string;
  date: Date | string | number;
  items: PosTicketItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paymentMethod: string;
  cashReceived?: number;
  change?: number;
  customer?: {
    name: string;
    email?: string;
    phone?: string;
    taxId?: string;
    shippingAddress?: string;
  };
  store?: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    taxId?: string;
    id?: number;
    logo?: string;
  };
  organization?: { name?: string; taxId?: string };
  cashier?: string;
  transactionId?: string;
  invoiceDataToken?: string;
  invoiceDataQrUrl?: string;
  /**
   * Set when the sale already produced a validated electronic invoice. Turns
   * the ticket into an informative copy: it points at the invoice instead of
   * repeating its tax breakdown.
   */
  electronicInvoice?: { number: string; cufe?: string };
}

export interface PosTicketOptions {
  /** Renders a format the merchant is still choosing (settings preview only). */
  formatOverride?: PrintFormat;
  /** Copies from a source fresher than the persisted auth snapshot. */
  copiesOverride?: number;
  /** `automatic` honours a configured `copies: 0` as "do not print". */
  trigger?: 'explicit' | 'automatic';
}

/**
 * Escape user-controlled values before interpolating into the ticket HTML.
 * expo-print renders the string in a WebView; without escaping, a customer
 * name like `</td><script>…</script>` breaks the layout or injects markup.
 */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface SessionSnapshot {
  receipts: ReceiptsSettings | null;
  fiscal: Record<string, any>;
  fiscalStatus: Record<string, any> | null;
  organization: { name?: string; legal_name?: string; tax_id?: string } | null;
  store: { name?: string; address?: string; logo?: string };
  cashier: string;
}

/**
 * Everything the ticket needs out of the session, read ONCE.
 *
 * Mobile equivalent of the web's `resolveSessionStore()` + the fiscal
 * selectors: `store_settings` is persisted flat at the root of
 * `vendix_auth_state` with one key per settings section, and `fiscal_data` /
 * `fiscal_status` are resolved by `fiscal_scope` — ORGANIZATION reads the
 * organization's settings, anything else reads the store's. Same criterion the
 * signed XML uses, so the paper cannot state a NIT the DIAN never validated.
 */
function readSession(): SessionSnapshot {
  const state = useAuthStore.getState();
  const storeSettings = (state.store_settings ?? {}) as Record<string, any>;
  const user = state.user;
  const organization = user?.organizations ?? user?.store?.organizations ?? null;
  const organizationSettings =
    (organization as any)?.organization_settings?.settings ?? null;

  const fiscalScope =
    (organization as any)?.fiscal_scope ?? (organization as any)?.operating_scope;
  const fromOrganization = fiscalScope === 'ORGANIZATION';

  const address = user?.addresses?.[0];
  const addressLine = address
    ? [
        [address.address_line1, address.address_line2]
          .filter(Boolean)
          .join(', '),
        address.city,
      ]
        .filter(Boolean)
        .join(', ')
    : undefined;

  return {
    receipts: (storeSettings.receipts as ReceiptsSettings) ?? null,
    fiscal:
      ((fromOrganization
        ? organizationSettings?.fiscal_data
        : storeSettings.fiscal_data) as Record<string, any>) ?? {},
    fiscalStatus:
      ((fromOrganization
        ? organizationSettings?.fiscal_status
        : storeSettings.fiscal_status) as Record<string, any>) ?? null,
    organization: organization as SessionSnapshot['organization'],
    store: {
      name: user?.store?.name ?? storeSettings.general?.name,
      // The session address wins over the settings one, same order of
      // precedence the desktop applies when it overlays localStorage.
      address: addressLine ?? storeSettings.general?.address,
      logo:
        storeSettings.app?.logo_url ??
        storeSettings.general?.logo_url ??
        user?.store?.logo_url ??
        undefined,
    },
    cashier:
      [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() ||
      user?.username ||
      user?.email ||
      '',
  };
}

/**
 * `true` when the merchant is VAT-responsible. Exact mirror of the web
 * `resolveIsVatResponsible` (itself a mirror of the backend
 * `vat-responsibility.helper`): O-48 wins, O-49 without O-48 denies, then the
 * regime, and an indeterminate state resolves to NOT responsible
 * (fail-closed, 2026-08-21).
 *
 * Cambio de default (2026-08-21): la rama indeterminada pasó de `true` a
 * `false`. Razón: el 100% de los tenants arrancan con el módulo fiscal
 * apagado y sin responsabilidad declarada; tratarlos como responsables
 * equivalía a permitir cobro de IVA sin estar facultados para facturar
 * electrónicamente. Fail-closed. Para vender con IVA, el tenant debe
 * declarar `tax_responsibilities: ['O-48']` o pasar por el wizard fiscal.
 */
function isVatResponsible(fiscal: Record<string, any>): boolean {
  const responsibilities: string[] = Array.isArray(fiscal?.tax_responsibilities)
    ? (fiscal.tax_responsibilities as unknown[]).filter(
        (c): c is string => typeof c === 'string',
      )
    : [];

  if (responsibilities.includes(VAT_RESPONSIBLE_CODE)) return true;
  if (responsibilities.includes(VAT_NOT_RESPONSIBLE_CODE)) return false;

  const regime =
    typeof fiscal?.tax_regime === 'string' ? fiscal.tax_regime : undefined;
  if (regime === 'COMUN' || regime === 'GRAN_CONTRIBUYENTE') return true;
  if (regime === 'SIMPLIFICADO') return false;

  return false;
}

/**
 * Whether the tax breakdown belongs on this ticket — mirror of the desktop's
 * `shouldShowTaxes` + `printsVatBreakdown`.
 *
 * It requires the merchant to have ACTIVATED the `invoicing` fiscal area and to
 * be VAT-responsible. A merchant that never started the fiscal wizard prints no
 * breakdown, because a printed breakdown it cannot back leaves with the
 * customer and cannot be retracted.
 */
function shouldShowTaxes(
  ticket: PosTicketData,
  session: SessionSnapshot,
): boolean {
  if (ticket.electronicInvoice) return false;
  const invoicingState = session.fiscalStatus?.['invoicing']?.state;
  const invoicingActive =
    invoicingState === 'ACTIVE' || invoicingState === 'LOCKED';
  return invoicingActive && isVatResponsible(session.fiscal);
}

/**
 * Legal identity of whoever issues this ticket, mirroring the backend's
 * `resolveIssuer`. The check digit must come from the same field as the base it
 * verifies: `fiscal_data` can carry both `nit`/`nit_dv` and `tax_id`/`tax_id_dv`
 * with different values, and pairing a base with the other's DV prints an
 * arithmetically invalid NIT.
 */
function resolveIssuer(session: SessionSnapshot, ticket: PosTicketData) {
  const fiscal = session.fiscal;
  const organization = session.organization ?? ticket.organization ?? null;
  const orgTaxId =
    (organization as any)?.tax_id ?? (organization as any)?.taxId ?? undefined;

  const [nitBase, dv] = fiscal['nit']
    ? [fiscal['nit'], fiscal['nit_dv']]
    : fiscal['tax_id']
      ? [fiscal['tax_id'], fiscal['tax_id_dv']]
      : [orgTaxId, undefined];

  return {
    legal_name:
      fiscal['legal_name'] ||
      (organization as any)?.legal_name ||
      organization?.name ||
      '',
    nit: nitBase ? (dv ? `${nitBase}-${dv}` : `${nitBase}`) : '',
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

/**
 * The ticket itself (the `.ticket` element), without the page wrapper. Every
 * consumer goes through here — print, share and any future preview — so the
 * documents cannot drift apart.
 */
export function renderPosTicketBody(
  ticket: PosTicketData,
  ctx: {
    widthMm: number;
    currency: StoreCurrency | null;
    session: SessionSnapshot;
  },
): string {
  const { widthMm, currency, session } = ctx;
  const money = (value: number | null | undefined) =>
    formatStoreMoney(value, currency);

  const showTaxes = shouldShowTaxes(ticket, session);
  // Without the breakdown, a `Subtotal` row that does not add up to `TOTAL`
  // leaves the difference orphaned on paper: `subtotal` is the tax-free base and
  // `total` the taxed amount. A merchant that does not itemise VAT prints the
  // final price, not a broken sum.
  const showSubtotal = showTaxes || !(ticket.tax > 0);

  const store = { ...(ticket.store ?? {}) };
  const storeName = store.name || session.store.name || '';
  const storeAddress = store.address || session.store.address || '';
  const storeLogo = store.logo || session.store.logo || '';

  const date = new Date(ticket.date).toLocaleString();
  const issuer = resolveIssuer(session, ticket);
  const receipts = session.receipts;

  // Razón social leads the header; the commercial name only repeats when it
  // actually differs, so a store trading under its own legal name does not
  // print the same line twice.
  const heading = issuer.legal_name || storeName;
  const tradeName = storeName && storeName !== heading ? storeName : '';
  // The fiscal address is the one bound to the NIT; the session address is only
  // a fallback for stores with no fiscal block captured yet.
  const address = issuer.address || storeAddress;

  const headerLines = [
    tradeName,
    issuer.nit ? `NIT ${issuer.nit}` : '',
    address,
    issuer.tax_regime,
    // Never the store id: that was printed as a CIIU code and is not one.
    issuer.ciiu ? `CIIU: ${issuer.ciiu}` : '',
    // Free-text header the merchant configured. The desktop never printed it —
    // and neither did this app, even though its own settings screen edits it.
    // Default is empty, so a store on defaults prints the same header as before.
    (receipts?.receipt_header ?? '').trim(),
  ].filter(Boolean);

  let html = `<div class="ticket" style="font-family: monospace; max-width: ${widthMm}mm; margin: 0 auto; padding: 10px; background: #fff;">`;

  html += `<div style="text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px;">`;
  if (storeLogo) {
    html += `<img src="${esc(storeLogo)}" style="max-width: 100px; margin-bottom: 10px;" alt="Logo" />`;
  }
  if (heading) {
    html += `<h2 style="margin: 0; font-size: 18px; font-weight: bold;">${esc(heading)}</h2>`;
  }
  html += headerLines
    .map((line) => `<p style="margin: 2px 0; font-size: 12px;">${esc(line)}</p>`)
    .join('');
  html += `</div>`;

  html += `
      <div style="margin-bottom: 15px;">
        <p style="margin: 2px 0; font-size: 12px;"><strong>Ticket:</strong> #${esc(ticket.id)}</p>
        <p style="margin: 2px 0; font-size: 12px;"><strong>Fecha:</strong> ${esc(date)}</p>
        <p style="margin: 2px 0; font-size: 12px;"><strong>Cajero:</strong> ${esc(ticket.cashier || session.cashier || 'N/A')}</p>
        ${ticket.transactionId ? `<p style="margin: 2px 0; font-size: 12px;"><strong>Transacción:</strong> ${esc(ticket.transactionId)}</p>` : ''}
      </div>
      <hr style="border: 1px dashed #000; margin: 10px 0;">`;

  if (ticket.customer) {
    // Anonymous sale: no name prints as "Consumidor Final" with tax id "000".
    const displayName = ticket.customer.name || 'Consumidor Final';
    const displayTaxId = ticket.customer.name
      ? ticket.customer.taxId || ''
      : '000';
    const shippingAddress = ticket.customer.shippingAddress;
    html += `
      <div style="margin-bottom: 15px;">
        <p style="margin: 2px 0; font-size: 12px;"><strong>Cliente:</strong> ${esc(displayName)}</p>
        ${displayTaxId ? `<p style="margin: 2px 0; font-size: 12px;"><strong>Cédula:</strong> ${esc(displayTaxId)}</p>` : ''}
        ${shippingAddress ? `<p style="margin: 2px 0; font-size: 12px;"><strong>Dirección de entrega:</strong> ${esc(shippingAddress)}</p>` : ''}
      </div>
      <hr style="border: 1px dashed #000; margin: 10px 0;">`;
  }

  html += `
      <div style="margin-bottom: 15px;">
        <table style="width: 100%; font-size: 11px; border-collapse: collapse;">
          <tbody>`;

  for (const item of ticket.items) {
    const isWeightItem = !!item.weight && item.weight > 0;
    // QUI-648 — la cantidad se imprime en la unidad en la que el cajero la
    // capturó. `formatSaleQuantity` devuelve la cantidad cruda cuando la línea
    // no trae unidad de captura, que es todo el catálogo por pieza.
    const qtyDisplay = isWeightItem
      ? `${item.weight} ${item.weight_unit || 'kg'}`
      : formatSaleQuantity(item);
    const tierLine = item.appliedPriceTierName
      ? `<br><span style="font-size: 10px; color: #92400e;">Tarifa: ${esc(item.appliedPriceTierName)}</span>`
      : '';
    const packageLine =
      item.isPackageUnit && item.unitsPerPackage
        ? `<br><span style="font-size: 10px; color: #1d4ed8;">x ${Number(item.unitsPerPackage)} unid c/u</span>`
        : '';
    const serialLine =
      Array.isArray(item.serials) && item.serials.length
        ? `<br><span style="font-size: 10px; color: #6b7280;">Serial: ${esc(item.serials.join(', '))}</span>`
        : '';
    const takeawayLine = item.isTakeaway
      ? `<br><span style="font-size: 10px; color: #b45309; font-weight: 600;">** PARA LLEVAR **</span>`
      : '';

    html += `
        <tr>
          <td style="padding: 2px; vertical-align: top;">${esc(item.name)}${tierLine}${packageLine}${serialLine}${takeawayLine}</td>
          <td style="text-align: center; padding: 2px;">${esc(qtyDisplay)}</td>
          <td style="text-align: right; padding: 2px;">${money(item.unitPrice)}${isWeightItem ? '/' + esc(item.weight_unit || 'kg') : item.saleUnitCode ? '/' + esc(item.saleUnitCode) : ''}</td>
          <td style="text-align: right; padding: 2px;">${money(item.totalPrice)}</td>
        </tr>`;
  }

  html += `
          </tbody>
        </table>
      </div>
      <hr style="border: 1px dashed #000; margin: 10px 0;">`;

  // Taxes breakdown — omitted on informative copies of an electronic invoice
  // and for merchants with no active fiscal invoicing (see shouldShowTaxes).
  if (showTaxes) {
    // Only the tax the sale actually persisted. Deriving it from
    // `totalPrice - unitPrice * quantity` is not a tax but the line's leftover:
    // with a line discount it goes negative. An untaxed item produces no line.
    const taxedItems = ticket.items.filter((item) => (item.tax ?? 0) > 0);

    taxedItems.forEach((item, index) => {
      const taxAmount = item.tax ?? 0;
      const taxPercent = item.totalPrice
        ? ((taxAmount / item.totalPrice) * 100).toFixed(2)
        : '0.00';
      html += `<p style="margin: 2px 0; font-size: 11px;">A${index + 1}. ${esc(item.name)} - Imp: ${taxPercent}% - ${money(taxAmount)}</p>`;
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
              ? `<tr>
            <td style="text-align: left; padding: 2px;">Subtotal:</td>
            <td style="text-align: right; padding: 2px;">${money(ticket.subtotal)}</td>
          </tr>`
              : ''
          }
          ${
            ticket.discount > 0
              ? `<tr>
            <td style="text-align: left; padding: 2px;">Descuento:</td>
            <td style="text-align: right; padding: 2px;">-${money(ticket.discount)}</td>
          </tr>`
              : ''
          }
          ${
            showTaxes
              ? `<tr>
            <td style="text-align: left; padding: 2px;">Impuesto:</td>
            <td style="text-align: right; padding: 2px;">${money(ticket.tax)}</td>
          </tr>`
              : ''
          }
          <tr style="font-weight: bold; border-top: 1px solid #000;">
            <td style="text-align: left; padding: 2px;">TOTAL:</td>
            <td style="text-align: right; padding: 2px;">${money(ticket.total)}</td>
          </tr>
        </table>
      </div>`;

  html += `
      <div style="margin-bottom: 15px;">
        <p style="margin: 2px 0; font-size: 12px;"><strong>Método de pago:</strong> ${esc(ticket.paymentMethod)}</p>
        ${
          ticket.cashReceived
            ? `<p style="margin: 2px 0; font-size: 12px;"><strong>Efectivo recibido:</strong> ${money(ticket.cashReceived)}</p>
        <p style="margin: 2px 0; font-size: 12px;"><strong>Cambio:</strong> ${money(ticket.change ?? 0)}</p>`
            : ''
        }
      </div>`;

  // Retroactive-invoicing pointer for Consumidor Final sales. The desktop draws
  // a QR image via the `qrcode` package; mobile has no such dependency, so this
  // renders the desktop's own no-QR fallback branch — the URL, verbatim — rather
  // than pulling a new dependency into the app for one block.
  if (ticket.invoiceDataToken && ticket.invoiceDataQrUrl) {
    html += `
      <hr style="border: 1px dashed #000; margin: 10px 0;">
      <div style="text-align: center; margin: 10px 0;">
        <p style="margin: 2px 0; font-size: 11px; font-weight: bold;">Solicite su factura electrónica</p>
        <p style="margin: 2px 0; font-size: 10px;">Visite:</p>
        <p style="margin: 4px 0; font-size: 9px; word-break: break-all;">${esc(ticket.invoiceDataQrUrl)}</p>
      </div>`;
  }

  // The legal notice must not claim the document is not DIAN-validated when the
  // sale did produce a validated invoice: then the ticket is an informative copy
  // and must point at it.
  const legalNotice = ticket.electronicInvoice
    ? `<p style="margin: 5px 0; font-size: 11px; font-weight: bold;">Copia informativa. Factura electrónica No. ${esc(ticket.electronicInvoice.number)} validada por la DIAN</p>
       ${ticket.electronicInvoice.cufe ? `<p style="margin: 2px 0; font-size: 8px; word-break: break-all;">CUFE: ${esc(ticket.electronicInvoice.cufe)}</p>` : ''}`
    : `<p style="margin: 5px 0; font-size: 11px; font-weight: bold;">Este documento no es una factura electrónica</p>`;

  // The configured farewell, not a hardcoded one. Its seeded default is the very
  // string the desktop hardcodes, so defaults print identically and a merchant
  // who edited the field finally sees the edit on paper.
  const footerText =
    (receipts?.receipt_footer ?? '').trim() || DEFAULT_RECEIPT_FOOTER;

  html += `
      <hr style="border: 1px dashed #000; margin: 10px 0;">
      <div style="text-align: center; margin-top: 20px;">
        ${legalNotice}
        <p style="margin: 5px 0; font-size: 11px;">${esc(footerText)}</p>
        <p style="margin: 10px 0 0 0; font-size: 9px; color: #666;">${esc(new Date().toLocaleString())}</p>
      </div>`;

  html += `</div>`;
  return html;
}

/**
 * Resolves the paper, the session and the currency, then renders the ticket
 * body. Shared by print and share so the two actions cannot build different
 * documents — which is exactly what they did before QUI-665.
 */
async function buildJob(ticket: PosTicketData, options?: PosTicketOptions) {
  const session = readSession();
  const config = DocumentPrintService.resolveConfig(
    'pos_ticket',
    { format: options?.formatOverride, copies: options?.copiesOverride },
    session.receipts,
  );
  // Awaited before the first amount is formatted, or every figure prints with
  // the generic `$` fallback instead of the store's configured symbol.
  const currency = await resolveStoreCurrency();

  return {
    session,
    config,
    body: renderPosTicketBody(ticket, {
      widthMm: config.widthMm,
      currency,
      session,
    }),
  };
}

export const PosTicketService = {
  /** Paper resolved for `pos_ticket`, without printing anything. */
  resolvePaper: (options?: PosTicketOptions) =>
    DocumentPrintService.resolveConfig('pos_ticket', {
      format: options?.formatOverride,
      copies: options?.copiesOverride,
    }),

  /** Whether the POS should send the ticket to the printer without asking. */
  shouldAutoPrint(): boolean {
    const settings = useAuthStore.getState().store_settings as
      | { pos?: { auto_print_receipt?: boolean } }
      | null
      | undefined;
    return settings?.pos?.auto_print_receipt ?? false;
  },

  /** Full print document for the ticket — what the printer literally receives. */
  async buildTicketHtml(
    ticket: PosTicketData,
    options?: PosTicketOptions,
  ): Promise<string> {
    const { config, body } = await buildJob(ticket, options);
    return DocumentPrintService.buildDocumentHtml(config, body, {
      title: 'Tiquete',
      styles: TICKET_PRINT_STYLES,
    });
  },

  async print(
    ticket: PosTicketData,
    options?: PosTicketOptions,
  ): Promise<PrintResult> {
    const { session, config, body } = await buildJob(ticket, options);
    return DocumentPrintService.print({
      document: 'pos_ticket',
      body,
      title: 'Tiquete',
      styles: TICKET_PRINT_STYLES,
      trigger: options?.trigger ?? 'explicit',
      receipts: session.receipts,
      overrides: {
        // Already resolved above, so the render's paper width and the printed
        // `@page` cannot disagree.
        format: config.format,
        copies: options?.copiesOverride,
      },
    });
  },

  async share(
    ticket: PosTicketData,
    options?: PosTicketOptions,
  ): Promise<ShareResult> {
    const { session, config, body } = await buildJob(ticket, options);
    return DocumentPrintService.share({
      document: 'pos_ticket',
      body,
      title: 'Tiquete',
      dialogTitle: 'Compartir recibo',
      styles: TICKET_PRINT_STYLES,
      // Sharing is always somebody tapping "Compartir": a configured `copies: 0`
      // must not produce an empty PDF.
      trigger: 'explicit',
      receipts: session.receipts,
      overrides: { format: config.format, copies: options?.copiesOverride },
    });
  },
};
