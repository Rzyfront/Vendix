import { Injectable, Logger } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { S3Service } from '../../../../common/services/s3.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';
import { signStoreLogoUrl } from '../lib/print-logo.util';
import {
  DEFAULT_STORE_TIMEZONE,
  formatStoreDate,
  formatStoreTime,
  resolveStoreTimezone,
} from '../../../../common/utils/store-timezone.util';
import {
  resolveFiscalIssuerForPrint,
  resolveFiscalQualitiesLine,
} from '../services/fiscal-issuer-identity';

/** Descargo no fiscal del tiquete POS: texto único real + muestra (ADR-2). */
const NON_FISCAL_DISCLAIMER = 'Este documento no es factura electrónica de venta.';
import { mapUserAddress } from '../lib/customer-address';
import { formatFiscalMoney } from './fiscal-document-print.mapper';
import { ORDER_PAYMENT_MEANS_INCLUDE } from '../../payments/order-payment-means.contract';
// C.2 (CP-pos-exclusive-tax-double-charge, ADR-12) — el tiquete declara
// `money_basis: 'gross'` (G-01) y propaga el gate fiscal que C.1 resolvió,
// usando las filas `org`/`store` que el `include` de C.1 ya trae en memoria.
import { resolvePrintsVatBreakdownForPrint } from '../services/print-vat-breakdown.resolver';
// C.7 / V-5 (ADR-12 G-01) — el bruto por línea sale de UNA definición
// compartida que lee el desglose persistido; no se recalcula acá.
import {
  resolveOrderLinePrintedGross,
  resolveOrderLineTaxTotal,
} from '../../taxes/utils/final-price.util';
// B6 — el impuesto del envío vive en la copia de la orden, no en
// `order_item_taxes`: el recibo pre-fiscal lo pinta desde esta definición.
import { buildShippingTaxBreakdownRow } from '../../shipping/utils/shipping-tax.util';

@Injectable()
export class PosSaleTicketDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'pos_sale_ticket';
  private readonly logger = new Logger(PosSaleTicketDataProvider.name);

  // `s3Service` es opcional en la firma (no `@Optional()`) para no romper los
  // specs que instancian el provider a mano con un solo argumento
  // (`new PosSaleTicketDataProvider(prisma)`); en runtime Nest siempre lo
  // inyecta porque `print-formats.module.ts` ya importa `S3Module`.
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3Service?: S3Service,
  ) {}

  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    const orderId = Number(documentId);
    if (isNaN(orderId)) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    const order = await this.prisma.orders.findFirst({
      where: { id: orderId, store_id: storeId },
      include: {
        // QUI-751 — el impuesto vive a nivel de línea (`order_item_taxes`),
        // no existe la relación `order_taxes`. Antes del fix esto compilaba
        // porque TypeScript no valida nombres de `include` contra Prisma, pero
        // la 1ª llamada runtime hubiera sido `PrismaClientValidationError` 500.
        //
        // [resid-fiscal] — Filtramos líneas canceladas (D2). El
        // `aggregateTaxes` que sigue más abajo sumaba sus impuestos y los
        // imprimía en el breakdown; el `order.tax_amount` ya los excluye,
        // así que el tiquete salía con un desglose que NO cuadraba con el
        // total agregado — inconsistencia visible para el cliente.
        order_items: {
          where: { cancelled_at: null },
          include: { order_item_taxes: true },
        },
        // CP-print-token-flow A.1 — dirección del cliente para el ticket.
        // `take: 1` sobre la relación vigente (misma forma que
        // `stores.addresses` arriba); sin direcciones el array queda vacío.
        users: { include: { addresses: { take: 1 } } },
        stores: {
          include: {
            addresses: { take: 1 },
            // C.1 — settings para el gate fiscal
            // `resolvePrintsVatBreakdownForPrint` (misma forma que
            // `FISCAL_DOCUMENT_PRINT_INCLUDE`).
            store_settings: { select: { settings: true } },
            organizations: {
              include: {
                organization_settings: { select: { settings: true } },
                // Paridad FE: `resolveFiscalIssuerForPrint` lee `org.addresses[0]`
                // (mismo select que `FISCAL_DOCUMENT_PRINT_INCLUDE`).
                addresses: {
                  take: 1,
                  select: {
                    address_line1: true,
                    city: true,
                    state_province: true,
                    municipality_code: true,
                    postal_code: true,
                    phone_number: true,
                  },
                },
              },
            },
          },
        },
        // C.3 QUI-733 / ADR-04 — mesa + mesero en el recibo POS. Se une la
        // última sesión de la orden, aun si ya cerró, para derivar
        // `document.table_number` / `document.waiter_name` igual que el
        // proveedor de ticket de cocina. Sin sesión (venta de mostrador)
        // el array queda vacío y el recibo sale sin mesa/mesero.
        table_sessions: {
          orderBy: { opened_at: 'desc' },
          take: 1,
          include: {
            table: {
              select: {
                id: true,
                name: true,
                zone: true,
              },
            },
            opener: { select: { first_name: true, last_name: true } },
          },
        },
        // El tiquete decía QUÉ se vendió y CUÁNTO, pero nunca CÓMO se pagó:
        // el compositor ya sabía dibujar la fila «Pago (<método>)» y el
        // catálogo de campos ya la declaraba activa, pero esta consulta no
        // traía `payments`, así que `document.payment_method` llegaba
        // `undefined` y la fila se omitía en silencio.
        //
        // Se usa el include CANÓNICO del contrato compartido, no uno propio:
        // filtra `state: 'succeeded'` (cobrar es lo que declara el método,
        // no intentarlo), anida `system_payment_method` para la cascada de
        // nombres y ordena por `paid_at` para que un pago mixto se lea en el
        // orden en que el cliente pagó.
        payments: ORDER_PAYMENT_MEANS_INCLUDE,
      },
    });

    if (!order) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    // El logo se firma acá (única llamada `async` de este flujo) porque
    // `mapOrderToStandardModel` es un mapeador puro y síncrono que también
    // usan otros callers de este provider — no podíamos meterle un `await`
    // sin volverlo async y arrastrar ese cambio a todos sus usos.
    const signedLogoUrl = await signStoreLogoUrl(this.s3Service, order.stores?.logo_url, this.logger);
    // B17 — el ticket mostraba la fecha/hora en la zona del contenedor
    // (UTC), no en la de la tienda. Se resuelve UNA vez por documento y se
    // pasa al mapeador, igual que el logo firmado.
    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const model = this.mapOrderToStandardModel(order, signedLogoUrl, tz);
    // A.3 (F-047): si la orden ya tiene factura, el desglose y los totales
    // salen del snapshot fiscal. Nunca lanza: ver el método.
    await this.overrideWithInvoiceSnapshot(storeId, orderId, model);
    // CP-REFUND-FLOW-REDESIGN paso 9: sección Reembolsos/NC referenciada,
    // ADITIVA en `custom_variables` — los totales originales quedan intactos.
    // Nunca lanza: ver el método.
    await this.attachRefundsSection(storeId, orderId, model);
    return model;
  }

  /**
   * A.3 (F-047) — ALCANCE DE LA TIRILLA POS.
   *
   * La tirilla nace del snapshot de la ORDEN (recibo pre-fiscal: se imprime al
   * cobrar, a menudo antes de que exista factura). Pero cuando la orden YA
   * tiene factura EMITIDA (no borrador), el desglose y los totales se toman
   * del snapshot FISCAL (`invoice_taxes` + cabecera de `invoices`): con
   * impuesto incluido la base absorbida difiere 1–2¢ de la orden y dos papeles
   * del mismo evento no pueden discrepar (venta $5.000 INC 8 %: orden
   * 4629.62/370.36 vs factura 4629.63/370.37).
   *
   * Sin factura emitida, la tirilla sigue siendo recibo pre-fiscal con las
   * filas de la orden — y eso está bien porque todavía no hay documento fiscal
   * contra el que discrepar. Los ÍTEMS (nombres/cantidades) siempre son de la
   * orden: la factura no renombra lo vendido.
   *
   * Nunca lanza: si la lectura fiscal falla por lo que sea, la tirilla sale
   * con las filas de la orden como siempre. Un recibo aproximado vale más que
   * ningún recibo.
   */
  private async overrideWithInvoiceSnapshot(
    storeId: number,
    orderId: number,
    model: StandardPrintDataModel,
  ): Promise<void> {
    try {
      const invoice = await this.prisma.invoices.findFirst({
        where: { order_id: orderId, store_id: storeId },
        orderBy: { id: 'desc' },
        include: { invoice_taxes: true },
      });
      // Solo documento EMITIDO (no borrador): el borrador es trabajo en curso,
      // no el documento contra el que la tirilla debe cuadrar.
      if (!invoice || invoice.status === 'draft') return;

      const taxes = this.aggregateInvoiceTaxes(
        (invoice as any).invoice_taxes ?? [],
      );
      if (taxes.length > 0) model.taxes = taxes;

      // Cabecera fiscal: cada campo solo si es finito, para no pintar `NaN`
      // sobre una fila corrupta.
      const subtotal = Number((invoice as any).subtotal_amount);
      const discount = Number((invoice as any).discount_amount);
      const tax = Number((invoice as any).tax_amount);
      const total = Number((invoice as any).total_amount);
      // El `subtotal_amount` de la factura YA incluye la línea «Envio» (ver
      // `computeOrderInvoiceSubtotal`: Σ bases de ítems + envío). Pintarlo tal
      // cual junto al `shipping_total` de la ORDEN mostraba el envío dos veces
      // —y con INC del domicilio, el bruto de la orden encima de una base que
      // ya lo despejó—. La tirilla separa: productos = subtotal − envío, y la
      // fila Envío = `shipping_amount` de la factura (la base neta cuando el
      // envío lleva impuesto, cuyo tributo ya viaja en `tax_amount`). Así
      // subtotal − descuento + impuestos + envío == total en ambos casos.
      // `shipping_amount` no finito o ausente ⇒ 0: el subtotal queda entero y
      // la fila Envío no duplica nada.
      const rawShipping = Number((invoice as any).shipping_amount);
      const shipping = Number.isFinite(rawShipping) ? rawShipping : 0;
      if (Number.isFinite(subtotal)) {
        // Resta en centavos: dos Decimal(12,2) leídos como double no restan
        // exacto (23888.89 − 13888.89 ≠ 10000).
        const productsSubtotal =
          (Math.round(subtotal * 100) - Math.round(shipping * 100)) / 100;
        model.totals.subtotal = productsSubtotal;
        model.totals.subtotal_formatted = formatFiscalMoney(productsSubtotal);
        model.totals.shipping_total = shipping;
        model.totals.shipping_total_formatted = formatFiscalMoney(shipping);
      }
      if (Number.isFinite(discount)) {
        model.totals.discount_total = discount;
        model.totals.discount_total_formatted = formatFiscalMoney(discount);
      }
      if (Number.isFinite(tax)) {
        model.totals.tax_total = tax;
        model.totals.tax_total_formatted = formatFiscalMoney(tax);
      }
      if (Number.isFinite(total)) {
        model.totals.grand_total = total;
        model.totals.grand_total_formatted = formatFiscalMoney(total);
      }

      // El efectivo recibido y el vuelto NO salen de la factura —son del cobro,
      // y la factura no los conoce— pero sí comparten papel con los totales que
      // acabamos de reformatear. Sin esto la tirilla de una orden ya facturada
      // imprimía «TOTAL: $10.000,00» y justo debajo «Recibido: $10.000»: el
      // mismo peso escrito de dos maneras, que se lee como dos cifras
      // distintas. El formato lo manda el DOCUMENTO, no el origen del dato.
      if (model.document.amount_received !== undefined) {
        model.document.amount_received_formatted = formatFiscalMoney(
          model.document.amount_received,
        );
      }
      if (model.document.change_due !== undefined) {
        model.document.change_due_formatted = formatFiscalMoney(
          model.document.change_due,
        );
      }
    } catch {
      // Ver docblock: la tirilla pre-fiscal con filas de orden es el fallback.
    }
  }

  /**
   * CP-REFUND-FLOW-REDESIGN paso 9 — sección Reembolsos/NC de la reimpresión.
   *
   * Los documentos ORIGINALES son inmutables: esta sección es ADITIVA y vive
   * en `model.custom_variables.refunds` — jamás toca `model.totals`,
   * `model.items` ni `model.taxes`. Sin refunds con dinero comprometido, el
   * modelo sale byte-idéntico al de antes (cero regresión en el papel).
   *
   * Semántica compartida con `RefundCoverageService` (paso 7), re-derivada
   * acá porque el provider no puede inyectar servicios de `order-flow` (el
   * módulo es ajeno a este paso): por línea, `refunded_*` agrega
   * `refund_items` de refunds con dinero comprometido
   * (`completed`/`pending_approval`/`processing` — el mismo conjunto que el
   * techo del paso 1 y las NC sugeribles del paso 7; `requested`/`approved`
   * quedan fuera hasta que un plan los asigne, `failed`/`cancelled` no
   * devolvieron nada); `nc_covered_*` suma el puente estructural
   * `credit_note_refund_items` solo de NC `accepted`, y `notes` lista TODAS
   * las NC del puente para trazabilidad. Ningún UPDATE toca documentos
   * emitidos: lectura pura.
   *
   * Nunca lanza: si la lectura falla por lo que sea, la tirilla sale sin la
   * sección como siempre. Un recibo sin sección vale más que ningún recibo.
   */
  private async attachRefundsSection(
    storeId: number,
    orderId: number,
    model: StandardPrintDataModel,
  ): Promise<void> {
    try {
      // `refunds` está registrado en `StorePrismaService` con scope
      // relacional (`orders.store_id`), así que el `findMany` ya viene
      // anclado al tenant; el `orderId` además salió de una orden verificada
      // con `store_id` más arriba.
      const refunds = await this.prisma.refunds.findMany({
        where: {
          order_id: orderId,
          state: { in: ['completed', 'pending_approval', 'processing'] },
        },
        select: {
          id: true,
          state: true,
          amount: true,
          refund_method: true,
          reason: true,
          requested_at: true,
          processed_at: true,
          refund_items: {
            select: {
              id: true,
              order_item_id: true,
              quantity: true,
              refund_amount: true,
              order_items: { select: { product_name: true } },
            },
          },
        },
        orderBy: { id: 'asc' },
      });
      if (refunds.length === 0) return;

      const refundItemIds = refunds.flatMap((r) =>
        r.refund_items.map((ri) => ri.id),
      );
      // `withoutScope()` + ids ya verificados: el puente no está registrado
      // en `StorePrismaService` y no necesita estarlo — los ids salen de
      // lecturas scopeadas, así que la consulta va anclada al tenant por
      // construcción (mismo criterio que `RefundCoverageService`).
      const bridgeRows =
        refundItemIds.length > 0
          ? await this.prisma
              .withoutScope()
              .credit_note_refund_items.findMany({
                where: { refund_item_id: { in: refundItemIds } },
                include: {
                  credit_note: {
                    select: { id: true, invoice_number: true, status: true },
                  },
                },
              })
          : [];

      const orderItemOf = new Map<number, number>();
      for (const r of refunds) {
        for (const ri of r.refund_items) {
          orderItemOf.set(ri.id, ri.order_item_id);
        }
      }
      const notesByLine = new Map<
        number,
        Array<{
          credit_note_id: number;
          invoice_number: string | null;
          status: string;
          covered_qty: number;
          covered_amount: number;
        }>
      >();
      const coveredByLine = new Map<number, { qty: number; amount: number }>();
      for (const row of bridgeRows) {
        const orderItemId = orderItemOf.get(row.refund_item_id);
        if (orderItemId == null) continue;
        const list = notesByLine.get(orderItemId) ?? [];
        list.push({
          credit_note_id: row.credit_note.id,
          invoice_number: row.credit_note.invoice_number,
          status: row.credit_note.status,
          covered_qty: row.covered_qty,
          covered_amount: Number(row.covered_amount ?? 0),
        });
        notesByLine.set(orderItemId, list);
        // Solo la NC aceptada cubre: el resto se LISTA (trazabilidad) pero
        // no suma (no acreditó nada todavía).
        if (row.credit_note.status === 'accepted') {
          const acc = coveredByLine.get(orderItemId) ?? { qty: 0, amount: 0 };
          acc.qty += row.covered_qty;
          acc.amount += Number(row.covered_amount ?? 0);
          coveredByLine.set(orderItemId, acc);
        }
      }

      const lines = new Map<
        number,
        {
          order_item_id: number;
          product_name: string | null;
          refunded_qty: number;
          refunded_amount: number;
        }
      >();
      for (const r of refunds) {
        for (const ri of r.refund_items) {
          const line = lines.get(ri.order_item_id) ?? {
            order_item_id: ri.order_item_id,
            product_name: ri.order_items?.product_name ?? null,
            refunded_qty: 0,
            refunded_amount: 0,
          };
          line.refunded_qty += ri.quantity;
          line.refunded_amount += Number(ri.refund_amount ?? 0);
          lines.set(ri.order_item_id, line);
        }
      }
      // Refunds sin ítems (patas de cancelación, filas legacy) aportan solo
      // a nivel orden: sin líneas no hay sección que agregar.
      if (lines.size === 0) return;

      const sectionLines = Array.from(lines.values()).map((line) => {
        const nc = coveredByLine.get(line.order_item_id) ?? {
          qty: 0,
          amount: 0,
        };
        return {
          ...line,
          refunded_amount_formatted: this.formatOrderMoney(
            line.refunded_amount,
          ),
          nc_covered_qty: nc.qty,
          nc_covered_amount: nc.amount,
          notes: notesByLine.get(line.order_item_id) ?? [],
        };
      });
      const refundedAmount = sectionLines.reduce(
        (sum, line) => sum + line.refunded_amount,
        0,
      );
      const ncCoveredAmount = sectionLines.reduce(
        (sum, line) => sum + line.nc_covered_amount,
        0,
      );
      model.custom_variables = {
        ...(model.custom_variables ?? {}),
        refunds: {
          lines: sectionLines,
          totals: {
            refunded_amount: refundedAmount,
            refunded_amount_formatted: this.formatOrderMoney(refundedAmount),
            nc_covered_amount: ncCoveredAmount,
            nc_covered_amount_formatted:
              this.formatOrderMoney(ncCoveredAmount),
          },
          refunds: refunds.map((r) => ({
            id: r.id,
            state: r.state,
            amount: Number(r.amount ?? 0),
            amount_formatted: this.formatOrderMoney(Number(r.amount ?? 0)),
            refund_method: r.refund_method,
            reason: r.reason,
            requested_at: r.requested_at
              ? new Date(r.requested_at).toISOString()
              : null,
            processed_at: r.processed_at
              ? new Date(r.processed_at).toISOString()
              : null,
          })),
        },
      };
    } catch {
      // Ver docblock: la tirilla sin sección es el fallback.
    }
  }

  /**
   * Agrega `invoice_taxes` por `(tax_name, tax_rate)` sumando importes YA
   * truncados — igual que `aggregateHeaderTaxes` del calculador.
   *
   * Igual que `aggregateTaxes` (filas de orden, donde desde C.6 la base se
   * LEE de `item.total_price`), acá la base es CONOCIDA (`taxable_amount`
   * persistido) y se suma directa: derivarla reintroduciría el céntimo que
   * el truncado quiere evitar. La escala cruda de `rate` se preserva igual
   * que allá (`invoice_taxes.tax_rate` es `Decimal(5,2)` en porcentaje).
   */
  private aggregateInvoiceTaxes(invoiceTaxes: any[]): Array<{
    name: string;
    rate: number;
    base_amount: number;
    tax_amount: number;
    base_formatted: string;
    tax_formatted: string;
  }> {
    const grouped = new Map<
      string,
      { name: string; rate: number; tax_amount: number; base_amount: number }
    >();

    for (const t of invoiceTaxes || []) {
      const name = t.tax_name || 'IVA';
      const rate = Number(t.tax_rate || 0);
      const taxAmount = Number(t.tax_amount || 0);
      const baseAmount = Number(t.taxable_amount || 0);
      const key = `${name}|${rate}`;

      const existing = grouped.get(key);
      if (existing) {
        existing.tax_amount += taxAmount;
        existing.base_amount += baseAmount;
      } else {
        grouped.set(key, {
          name,
          rate,
          tax_amount: taxAmount,
          base_amount: baseAmount,
        });
      }
    }

    return Array.from(grouped.values()).map((g) => ({
      name: g.name,
      rate: g.rate,
      base_amount: g.base_amount,
      tax_amount: g.tax_amount,
      base_formatted: formatFiscalMoney(g.base_amount),
      tax_formatted: formatFiscalMoney(g.tax_amount),
    }));
  }

  async getSampleData(storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: {
        name: 'Vendix Store Demo',
        legal_name: 'Vendix Comercio S.A.S.',
        tax_id: '901.234.567-8',
        phone: '+57 300 123 4567',
        email: 'ventas@vendix.com',
        address: 'Calle 100 # 15-20, Oficina 401',
        city: 'Bogotá D.C.',
        // Los datos de muestra NO son inocuos: `PrintGatewayService` cae a
        // `getSampleData` dentro de un try/catch cuando la lectura real falla,
        // así que un literal aquí acaba en el papel de un comercio real. Este
        // bloque imprimía «Responsable de IVA» — una leyenda derogada con el
        // art. 506 E.T. La muestra deriva ahora sus calidades de sus PROPIAS
        // responsabilidades con la misma función que el carril real, así que no
        // puede afirmar una calidad que sus códigos no respalden.
        fiscal_responsibilities: ['O-48', 'O-42', 'O-52'],
        fiscal_qualities: resolveFiscalQualitiesLine(['O-48', 'O-42', 'O-52']),
      },
      customer: {
        name: 'Juan Pérez Rodríguez',
        tax_id: '1.020.304.050',
        phone: '+57 311 987 6543',
        email: 'juan.perez@ejemplo.com',
        // CP-print-token-flow A.1 — paridad muestra/real (ADR-2).
        address: 'Carrera 15 # 88-64, Bogotá D.C.',
        address_line1: 'Carrera 15 # 88-64',
        city: 'Bogotá D.C.',
      },
      document: {
        id: 101,
        number: 'POS-00428',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        time: '14:30',
        state: 'finished',
        state_label: 'Completada',
        cashier_name: 'Carlos Gómez',
        pos_terminal: 'Caja 01',
        payment_method: 'Efectivo',
        amount_received: 100000,
        amount_received_formatted: '$100.000',
        change_due: 12500,
        change_due_formatted: '$12.500',
        // Paridad muestra/real (ADR-2): el mismo descargo, sin literales sueltos.
        non_fiscal_disclaimer: NON_FISCAL_DISCLAIMER,
      },
      // C.2 (ADR-12) — muestra en `'gross'`, paridad con `fetchDocumentData`.
      money_basis: 'gross',
      prints_vat_breakdown: true,
      items: [
        {
          index: 1,
          product_name: 'Camisa Oxford Manga Larga',
          variant_sku: 'CAM-OXF-AZ-M',
          variant_attributes: 'Talla: M, Color: Azul',
          quantity: 1,
          unit_price: 65000,
          unit_price_formatted: '$65.000',
          discount_amount: 5000,
          discount_formatted: '-$5.000',
          tax_rate: 19,
          tax_amount: 9580,
          total_price: 60000,
          total_price_formatted: '$60.000',
        },
        {
          index: 2,
          product_name: 'Gorra Deportiva Bordada',
          variant_sku: 'GOR-DEP-NEG',
          quantity: 1,
          unit_price: 27500,
          unit_price_formatted: '$27.500',
          tax_rate: 19,
          tax_amount: 4391,
          total_price: 27500,
          total_price_formatted: '$27.500',
        },
      ],
      taxes: [
        {
          name: 'IVA General',
          rate: 19,
          base_amount: 73529,
          tax_amount: 13971,
          base_formatted: '$73.529',
          tax_formatted: '$13.971',
        },
      ],
      totals: {
        subtotal: 92500,
        subtotal_formatted: '$92.500',
        discount_total: 5000,
        discount_total_formatted: '$5.000',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 13971,
        tax_total_formatted: '$13.971',
        grand_total: 87500,
        grand_total_formatted: '$87.500',
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{store.name}}', path: 'store.name', description: 'Nombre comercial de la tienda', example: 'Mi Tienda' },
      { token: '{{store.tax_id}}', path: 'store.tax_id', description: 'NIT o documento de la tienda', example: '900.123.456-7' },
      { token: '{{order.order_number}}', path: 'document.number', description: 'Número de ticket u orden', example: 'POS-1002' },
      { token: '{{order.cashier_name}}', path: 'document.cashier_name', description: 'Nombre del cajero', example: 'Ana Torres' },
      { token: '{{customer.name}}', path: 'customer.name', description: 'Nombre del cliente', example: 'Consumidor Final' },
      { token: '{{customer.address}}', path: 'customer.address', description: 'Dirección del cliente', example: 'Carrera 15 # 88-64, Bogotá D.C.' },
      { token: '{{order.grand_total}}', path: 'totals.grand_total_formatted', description: 'Total a pagar con formato', example: '$87.500' },
      { token: '{{order.change_due}}', path: 'document.change_due_formatted', description: 'Cambio o vuelto entregado', example: '$12.500' },
      { token: '{{document.non_fiscal_disclaimer}}', path: 'document.non_fiscal_disclaimer', description: 'Leyenda fija: no es factura electrónica', example: 'Este documento no es factura electrónica de venta.' },
    ];
  }

  /**
   * [print-editor-dsk P3.1] — Selector del Hub para el tiquete POS:
   * lee SOLO lo necesario (id, número, fecha, total) sobre `orders`,
   * que es la misma tabla que consume `fetchDocumentData` pero sin los
   * `include` de líneas/tributos. El cap lo pone `DocumentIndexService`,
   * aquí se respeta ciegamente.
   */
  async listRecent(
    storeId: number,
    limit: number,
  ): Promise<RecentDocumentSummary[]> {
    const rows = await this.prisma.orders.findMany({
      where: { store_id: storeId },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true,
        order_number: true,
        created_at: true,
        grand_total: true,
      },
    });
    const fmt = new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
    const cop = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
    return rows.map((r) => ({
      id: r.id,
      number: String(r.order_number),
      date_formatted: r.created_at ? fmt.format(new Date(r.created_at)) : '',
      total_formatted: cop.format(Number(r.grand_total || 0)),
    }));
  }

  /**
   * Formato de moneda de la TIRILLA PRE-FISCAL (filas de la orden): pesos
   * enteros, separador de miles es-CO. Estaba repetido inline en cada total;
   * se nombra una sola vez para que las filas nuevas de pago impriman
   * exactamente igual que el TOTAL que tienen al lado.
   *
   * NO confundir con `formatFiscalMoney` (2 decimales), que es el formato del
   * snapshot de factura y sólo aplica en `overrideWithInvoiceSnapshot`.
   */
  private formatOrderMoney(amount: number): string {
    return `$${Number(amount || 0).toLocaleString('es-CO')}`;
  }

  /**
   * Efectivo entregado y vuelto, leídos del tramo en efectivo de la orden.
   *
   * El POS y `flow/pay` los escriben dentro de `payments.gateway_response`
   * (`metadata.amount_received` y `change`), que es `Json?` en Prisma: puede
   * llegar `null`, una cadena, un arreglo o un objeto sin esas claves. Por eso
   * se comprueba la FORMA antes de leer: asumirla reventaría el tiquete entero
   * por un pago viejo con otro contenido.
   *
   * Se filtra PRIMERO por `system_payment_method.type === 'cash'`: en un cobro
   * multimétodo los tramos no-efectivo también traen claves de tender (el POS
   * escribe `metadata.amount_received` en todos los tramos y ambos carriles
   * escriben `change: 0` en los que no dan vuelto), así que «el primer cobro
   * que traiga alguno» devolvería el recibido de una tarjeta. Sin tramo en
   * efectivo ambos quedan `undefined`: el compositor no emite las filas (no hay
   * vuelto que inventar).
   *
   * Ambos valores salen del MISMO pago y no de una búsqueda independiente por
   * campo: son las dos mitades de un único acto de entrega de efectivo, y
   * cruzar el recibido de un pago con el vuelto de otro imprimiría una cuenta
   * que nunca ocurrió.
   */
  private resolveCashTender(payments: any[]): {
    amount_received?: number;
    change_due?: number;
  } {
    const finite = (value: unknown): number | undefined => {
      if (value === null || value === undefined || value === '') return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const isPlainObject = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value);

    for (const payment of payments || []) {
      if (!payment || payment.state !== 'succeeded') continue;
      // Multimétodo: sólo el tramo en efectivo entrega y devuelve billetes.
      if (payment.store_payment_method?.system_payment_method?.type !== 'cash') {
        continue;
      }

      const gateway = payment.gateway_response;
      if (!isPlainObject(gateway)) continue;

      const metadata = isPlainObject(gateway.metadata) ? gateway.metadata : {};
      const received = finite(metadata.amount_received);
      const change = finite(gateway.change);
      if (received === undefined && change === undefined) continue;

      return { amount_received: received, change_due: change };
    }
    return {};
  }

  /**
   * Desglose del cobro por pago, listo para `document.payment_method`.
   *
   * Un cobro multimétodo une una entrada por pago («Efectivo $20.000 ·
   * Transferencia $80.000»), SIN deduplicar y en el orden en que llegan —que
   * es `paid_at` ascendente porque la consulta usa
   * `ORDER_PAYMENT_MEANS_INCLUDE`—. El monto sale con `formatOrderMoney`, igual
   * que el TOTAL que tiene al lado.
   *
   * Con un solo pago con nombre se devuelve la etiqueta sola, sin monto:
   * idéntico a lo que el contrato compartido devolvía hoy. `undefined` cuando
   * ningún cobro trae nombre: la fila no se emite. El desglose se arma acá y no
   * en el compositor para no tocar su región de totales.
   */
  private resolvePaymentBreakdown(payments: any[]): string | undefined {
    const entries: Array<{ label: string; amount: number }> = [];
    for (const payment of payments || []) {
      if (!payment || payment.state !== 'succeeded') continue;
      const label = this.resolvePaymentLegLabel(payment);
      if (!label) continue;
      entries.push({ label, amount: Number(payment.amount || 0) });
    }
    if (entries.length === 0) return undefined;
    if (entries.length === 1) return entries[0].label;
    return entries
      .map((entry) => `${entry.label} ${this.formatOrderMoney(entry.amount)}`)
      .join(' · ');
  }

  /**
   * Etiqueta de UN pago: la misma cascada de tres niveles del contrato
   * compartido (`order-payment-means.contract.ts`: alias de la tienda, nombre
   * canónico del sistema, clave técnica). Vive acá duplicada a propósito: el
   * contrato no exporta la etiqueta individual y el desglose no deduplica.
   */
  private resolvePaymentLegLabel(payment: any): string | undefined {
    const storeMethod = payment?.store_payment_method;
    const systemMethod = storeMethod?.system_payment_method;
    const candidates = [
      storeMethod?.display_name,
      systemMethod?.display_name,
      systemMethod?.name,
    ];
    for (const candidate of candidates) {
      const label = (candidate ?? '').trim();
      if (label) return label;
    }
    return undefined;
  }

  private mapOrderToStandardModel(
    order: any,
    signedLogoUrl?: string,
    tz: string = DEFAULT_STORE_TIMEZONE,
  ): StandardPrintDataModel {
    const store = order.stores || {};
    const org = store.organizations || {};
    const addr = store.addresses?.[0] || {};
    // Paridad FE: sin fila en `addresses`, la dirección cae a la identidad
    // fiscal (modo permisivo: un ticket nunca falla 422 por datos fiscales).
    const issuer = resolveFiscalIssuerForPrint(org, store, false);
    const user = order.users || {};

    // ADR-04 — mesa + mesero derivados de la última sesión, abierta o cerrada.
    // La asignación estática table_waiters no identifica al mesero de la venta.
    // Sin sesión (venta de mostrador) ambos quedan vacíos.
    const session = (order.table_sessions || [])[0];
    const table = session?.table;
    const opener = session?.opener;
    const waiterName = opener
      ? `${opener.first_name || ''} ${opener.last_name || ''}`.trim()
      : '';
    const tableName = table?.name ? `Mesa ${table.name}` : '';

    // C.7 / V-5 (CP-pos-exclusive-tax-double-charge, ADR-12 G-01) — el tiquete
    // declara `money_basis: 'gross'` más abajo y hasta acá mapeaba
    // `unit_price`/`total_price` directo desde `order_items`, que post-ADR-08
    // son la BASE gravable. Con una tasa EXCLUSIVA el papel real del mostrador
    // salía con «Precio $22.000 / Total $22.000» contra «TOTAL A PAGAR
    // $26.180», y sin filas `Subtotal:`/`Impuestos:` —las suprime la regla
    // anti-huérfana del compositor, precisamente porque se le declaró bruto—,
    // así que nada en el papel explicaba los $4.180. El bruto se compone del
    // desglose PERSISTIDO (`order_item_taxes`, que el `include` de arriba ya
    // trae), no de un recálculo por tasas: ver `resolveOrderLinePrintedGross`.
    const items = (order.order_items || []).map((it: any, i: number) => {
      const { gross_unit_price, gross_total_price } =
        resolveOrderLinePrintedGross(it);
      // Hallazgo 3 (CP-post-QUI-832, ADR-12 G-01) — columnas en bruto, el
      // impuesto habla la misma magnitud: `tax_amount` es el impuesto TOTAL
      // de la línea (`order_item_taxes`, o el escalar por unidad × unidades),
      // no el `tax_amount_item` por unidad (ADR-10) que descuadraba la fila
      // con cantidad mayor que uno.
      const lineTax = resolveOrderLineTaxTotal(it);
      return {
      index: i + 1,
      product_name: it.product_name,
      variant_sku: it.variant_sku || undefined,
      // CP-POLLO-ARABE-727 ADR-7: la variante del recibo POS viaja por
      // `StandardPrintItem.variant_attributes` (column `order_items.variant_attributes`,
      // snapshot al crear la línea), no por un campo nuevo del modelo.
      variant_attributes: it.variant_attributes || undefined,
      quantity: Number(it.quantity || 1),
      unit_price: gross_unit_price,
      unit_price_formatted: `$${gross_unit_price.toLocaleString('es-CO')}`,
      discount_amount: Number(it.discount_amount || 0),
      discount_formatted: it.discount_amount ? `-$${Number(it.discount_amount).toLocaleString('es-CO')}` : undefined,
      // C.2 (ADR-12) — mismo mapeo que `quotation.provider.ts:101-104`: la
      // línea trae su propio `tax_rate`/`tax_amount_item` denormalizado
      // (`order_items`, igual columna que `quotation_items`). Con esto el
      // compositor pinta la sublínea `IVA: r%` (`print-layout-composer
      // .service.ts:793-794`) sin columna nueva — F-100.
      //
      // `order_items.tax_rate` es `Decimal(6,5)` — FRACCIÓN (0.19), no
      // porcentaje. El compositor concatena literal `${item.tax_rate}%`, así
      // que sin este ×100 el papel real imprimía "IVA: 0.19%" en vez de
      // "IVA: 19%". Redondeado a 2 decimales de porcentaje para no arrastrar
      // ruido de punto flotante (`0.19 * 100 = 18.999999999999996`).
      tax_rate:
        it.tax_rate !== null && it.tax_rate !== undefined
          ? Math.round(Number(it.tax_rate) * 10000) / 100
          : undefined,
      tax_amount: lineTax > 0 ? lineTax : undefined,
      total_price: gross_total_price,
      total_price_formatted: `$${gross_total_price.toLocaleString('es-CO')}`,
      };
    });

    const taxes = this.aggregateTaxes(order.order_items);

    // B6 — fila del impuesto del envío en el bloque `taxes` del recibo
    // pre-fiscal: `aggregateTaxes` solo lee `order_item_taxes`, así que sin
    // esto el tributo del domicilio no salía aunque el total sí lo cobró.
    // Fila PROPIA («INC 8% (incl. envío)»), no fusionada con el grupo de
    // productos, para que el comerciante vea de dónde sale. Sin copia ⇒
    // null ⇒ el modelo sale byte-idéntico al de antes. El carril fiscal
    // (`overrideWithInvoiceSnapshot`) no se toca: `invoice_taxes` ya trae
    // el envío y `aggregateInvoiceTaxes` ya lo suma.
    const shippingTaxRow = buildShippingTaxBreakdownRow(order);
    if (shippingTaxRow) {
      taxes.push({
        name: `${shippingTaxRow.tax_type.toUpperCase()} (incl. envío)`,
        // La copia guarda fracción (`Decimal(6,5)` ⇒ 0.08); la fila se pinta
        // como `(${rate}%)`, igual que en `aggregateTaxes`.
        rate: Math.round(shippingTaxRow.tax_rate * 10000) / 100,
        base_amount: shippingTaxRow.taxable_amount,
        tax_amount: shippingTaxRow.tax_amount,
        base_formatted: this.formatOrderMoney(shippingTaxRow.taxable_amount),
        tax_formatted: this.formatOrderMoney(shippingTaxRow.tax_amount),
      });
    }

    // Desglose del cobro por pago («Efectivo $20.000 · Transferencia
    // $80.000», en orden de cobro): lo arma este provider, no el compositor,
    // y con un solo método devuelve la etiqueta sola, igual que hoy. Ese
    // `undefined` se propaga tal cual: la fila no se emite. Un tiquete que dice
    // «Efectivo» por defecto afirma una entrada de caja que nadie hizo.
    const paymentMethod = this.resolvePaymentBreakdown(order.payments);
    const { amount_received, change_due } = this.resolveCashTender(
      order.payments,
    );

    const subtotal = Number(order.subtotal_amount || 0);
    const discount = Number(order.discount_amount || 0);
    const tax = Number(order.tax_amount || 0);
    const shipping = Number(order.shipping_cost || 0);
    const grandTotal = Number(order.grand_total || (subtotal - discount + tax + shipping));

    return {
      store: {
        name: store.name || 'Vendix',
        legal_name: store.legal_name || org.legal_name,
        tax_id: org.tax_id,
        phone: store.phone,
        email: store.email,
        address: addr.address_line1 ? `${addr.address_line1} ${addr.address_line2 || ''}`.trim() : issuer.address_line || issuer.fiscal_address || undefined,
        city: addr.city,
        logo_url: signedLogoUrl,
      },
      // CP-print-token-flow A.1 — dirección del cliente. Sin direcciones
      // queda `undefined` (el compositor no emite fila: invariante 1).
      customer: user.id
        ? {
            name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Cliente',
            tax_id: user.document_number,
            phone: user.phone,
            email: user.email,
            ...mapUserAddress(user.addresses?.[0]),
          }
        : undefined,
      document: {
        id: order.id,
        number: String(order.order_number),
        date: order.created_at ? new Date(order.created_at).toISOString() : new Date().toISOString(),
        // B17 — antes formateaba en la zona del contenedor (`toLocaleDateString`/
        // `toLocaleTimeString` sin `timeZone`); ahora usa la zona de la tienda.
        date_formatted: order.created_at ? formatStoreDate(new Date(order.created_at), tz) : formatStoreDate(new Date(), tz),
        time: order.created_at ? formatStoreTime(new Date(order.created_at), tz) : undefined,
        state: order.state,
        state_label: order.state,
        channel: order.channel,
        notes: order.notes,
        internal_notes: order.internal_notes,
        // C.3 QUI-733 — mesa + mesero en el recibo POS.
        table_number: tableName,
        waiter_name: waiterName,
        // Spread condicional en los tres: el modelo los declara opcionales y
        // el compositor decide por PRESENCIA (`doc.payment_method`,
        // `Number(doc.amount_received) > 0`). Escribir la clave con
        // `undefined` es equivalente para él, pero deja el campo visible en el
        // JSON del editor de formatos como si el dato existiera vacío.
        ...(paymentMethod ? { payment_method: paymentMethod } : {}),
        ...(amount_received !== undefined
          ? {
              amount_received,
              amount_received_formatted: this.formatOrderMoney(amount_received),
            }
          : {}),
        ...(change_due !== undefined
          ? {
              change_due,
              change_due_formatted: this.formatOrderMoney(change_due),
            }
          : {}),
        // Leyenda no fiscal fija (el validador la exige en `pos_sale_ticket`).
        non_fiscal_disclaimer: NON_FISCAL_DISCLAIMER,
        // QUI-737 (B.4) — alias de venta rápida ("Mesa 5"). Va en la CABECERA
        // junto al número de orden, NO bajo el bloque "Datos del Cliente"
        // (`customer`): el alias no es un cliente formal y no debe leerse como
        // identificación fiscal. Se expone sin tocar `customer` (que sigue
        // gateado por `user.id`). Spread condicional para no romper el tipo
        // estricto de `StandardPrintDataModel['document']`.
        ...(order.customer_alias
          ? { customer_alias: order.customer_alias }
          : {}),
      },
      // C.2 (ADR-12) — G-01: el tiquete de mostrador es papel comercial, el
      // cliente ve el bruto. `org`/`store` son las mismas filas que ya trae
      // el `include` de C.1 (`stores.store_settings` /
      // `stores.organizations.organization_settings`).
      money_basis: 'gross',
      prints_vat_breakdown: resolvePrintsVatBreakdownForPrint(org, store),
      items,
      taxes,
      totals: {
        subtotal,
        subtotal_formatted: this.formatOrderMoney(subtotal),
        discount_total: discount,
        discount_total_formatted: this.formatOrderMoney(discount),
        shipping_total: shipping,
        shipping_total_formatted: this.formatOrderMoney(shipping),
        tax_total: tax,
        tax_total_formatted: this.formatOrderMoney(tax),
        grand_total: grandTotal,
        grand_total_formatted: this.formatOrderMoney(grandTotal),
      },
    };
  }

  /**
   * QUI-751 — agrega los impuestos de línea en uno por cabecera.
   *
   * El esquema NO tiene una fila de impuesto a nivel de orden; los tributos
   * viven en `order_item_taxes` (uno por línea, uno por tarifa). Para
   * presentarlos en la sección "Tributos" del tiquete se agrupan por
   * `(tax_name, tax_rate)` y se suman los `tax_amount`.
   *
   * C.6 (R-4, F-105) — la base se LEE de la línea (`item.total_price`, base
   * neta por INV-0: `total_price = unit_price × price_units`), nunca se
   * deriva como `tax_amount / tax_rate`: con truncado DIAN la inversión no
   * es exacta y con tasa 0 inventa base 0. En línea multi-tarifa la base se
   * prorratea por participación de cuota (sólo magnitudes recibidas); si la
   * línea no trae impuesto, su base va a su primera fila por convención.
   *
   * La escala cruda de `rate` se preserva (`Decimal(6,5)` ⇒ 0.19, NO 19).
   */
  private aggregateTaxes(orderItems: any[]): Array<{
    name: string;
    rate: number;
    base_amount: number;
    tax_amount: number;
    base_formatted: string;
    tax_formatted: string;
  }> {
    const grouped = new Map<
      string,
      { name: string; rate: number; tax_amount: number; base_amount: number }
    >();

    for (const item of orderItems || []) {
      const rows = item.order_item_taxes || [];
      const lineBase = Number(item.total_price || 0);
      const lineTax = rows.reduce(
        (sum: number, t: any) => sum + Number(t.tax_amount || 0),
        0,
      );
      rows.forEach((t: any, idx: number) => {
        const name = t.tax_name || 'IVA';
        // `order_item_taxes.tax_rate` es fracción (`Decimal(6,5)` ⇒ 0.19); la
        // fila de impuesto se pinta como `(${rate}%)` — sin este ×100 salía
        // "(0.19%)" en vez de "(19%)". Mismo defecto que el de arriba.
        const rate = Math.round(Number(t.tax_rate || 0) * 10000) / 100;
        const taxAmount = Number(t.tax_amount || 0);
        const key = `${name}|${rate}`;

        const rowBase =
          lineTax > 0 ? (lineBase * taxAmount) / lineTax : idx === 0 ? lineBase : 0;
        const existing = grouped.get(key);
        if (existing) {
          existing.tax_amount += taxAmount;
          existing.base_amount += rowBase;
        } else {
          grouped.set(key, {
            name,
            rate,
            tax_amount: taxAmount,
            base_amount: rowBase,
          });
        }
      });
    }

    return Array.from(grouped.values()).map((g) => ({
      name: g.name,
      rate: g.rate,
      base_amount: g.base_amount,
      tax_amount: g.tax_amount,
      base_formatted: `$${g.base_amount.toLocaleString('es-CO')}`,
      tax_formatted: `$${g.tax_amount.toLocaleString('es-CO')}`,
    }));
  }
}
