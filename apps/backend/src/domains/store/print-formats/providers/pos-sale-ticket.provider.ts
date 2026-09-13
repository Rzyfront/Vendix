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
import { mapUserAddress } from '../lib/customer-address';
import { formatFiscalMoney } from './fiscal-document-print.mapper';
import {
  ORDER_PAYMENT_MEANS_INCLUDE,
  resolveOrderPaymentLabel,
} from '../../payments/order-payment-means.contract';

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
            organizations: true,
          },
        },
        // C.3 QUI-733 — mesa + mesero en el recibo POS. Se une la sesión
        // ABIERTA (closed_at IS NULL, la más reciente) para derivar
        // `document.table_number` / `document.waiter_name` igual que el
        // proveedor de ticket de cocina. Sin sesión (venta de mostrador)
        // el array queda vacío y el recibo sale sin mesa/mesero.
        table_sessions: {
          where: { closed_at: null },
          orderBy: { opened_at: 'desc' },
          take: 1,
          include: {
            table: {
              select: {
                id: true,
                name: true,
                zone: true,
                // mesero asignado vía table_waiters, prioridad sobre opener
                table_waiters: {
                  select: {
                    user: { select: { first_name: true, last_name: true } },
                  },
                },
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
    const model = this.mapOrderToStandardModel(order, signedLogoUrl);
    // A.3 (F-047): si la orden ya tiene factura, el desglose y los totales
    // salen del snapshot fiscal. Nunca lanza: ver el método.
    await this.overrideWithInvoiceSnapshot(storeId, orderId, model);
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
      if (Number.isFinite(subtotal)) {
        model.totals.subtotal = subtotal;
        model.totals.subtotal_formatted = formatFiscalMoney(subtotal);
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
   * Agrega `invoice_taxes` por `(tax_name, tax_rate)` sumando importes YA
   * truncados — igual que `aggregateHeaderTaxes` del calculador.
   *
   * A diferencia de `aggregateTaxes` (filas de orden, donde la base se DERIVA
   * como `tax/rate`), acá la base es CONOCIDA (`taxable_amount` persistido) y
   * se suma directa: derivarla reintroduciría el céntimo que el truncado
   * quiere evitar. La escala cruda de `rate` se preserva igual que allá
   * (`invoice_taxes.tax_rate` es `Decimal(5,2)` en porcentaje).
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
        tax_regime: 'Responsable de IVA',
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
      },
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
   * Efectivo entregado y vuelto, leídos del pago en efectivo de la orden.
   *
   * El POS los escribe dentro de `payments.gateway_response`
   * (`metadata.amount_received` y `change`), que es `Json?` en Prisma: puede
   * llegar `null`, una cadena, un arreglo o un objeto sin esas claves. Por eso
   * se comprueba la FORMA antes de leer: asumirla reventaría el tiquete entero
   * por un pago viejo con otro contenido.
   *
   * Ambos valores salen del MISMO pago —el primer cobro que traiga alguno— y no
   * de una búsqueda independiente por campo: son las dos mitades de un único
   * acto de entrega de efectivo, y cruzar el recibido de un pago con el vuelto
   * de otro imprimiría una cuenta que nunca ocurrió.
   *
   * Una venta con tarjeta no tiene ninguno de los dos y ambos quedan
   * `undefined`: el compositor no emite las filas (no hay vuelto que inventar).
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

  private mapOrderToStandardModel(order: any, signedLogoUrl?: string): StandardPrintDataModel {
    const store = order.stores || {};
    const org = store.organizations || {};
    const addr = store.addresses?.[0] || {};
    const user = order.users || {};

    // C.3 QUI-733 — mesa + mesero derivados de la sesión ABIERTA. El mesero
    // asignado (table_waiters) manda sobre el opener. Sin sesión (venta de
    // mostrador) ambos quedan vacíos y el recibo no muestra bloque de mesa.
    const session = (order.table_sessions || [])[0];
    const table = session?.table;
    const opener = session?.opener;
    const assignedWaiter = table?.table_waiters?.[0]?.user;
    const waiterName =
      assignedWaiter && (assignedWaiter.first_name || assignedWaiter.last_name)
        ? `${assignedWaiter.first_name || ''} ${assignedWaiter.last_name || ''}`.trim()
        : opener
        ? `${opener.first_name || ''} ${opener.last_name || ''}`.trim()
        : '';
    const tableName = table?.name ? `Mesa ${table.name}` : '';

    const items = (order.order_items || []).map((it: any, i: number) => ({
      index: i + 1,
      product_name: it.product_name,
      variant_sku: it.variant_sku || undefined,
      // CP-POLLO-ARABE-727 ADR-7: la variante del recibo POS viaja por
      // `StandardPrintItem.variant_attributes` (column `order_items.variant_attributes`,
      // snapshot al crear la línea), no por un campo nuevo del modelo.
      variant_attributes: it.variant_attributes || undefined,
      quantity: Number(it.quantity || 1),
      unit_price: Number(it.unit_price || 0),
      unit_price_formatted: `$${Number(it.unit_price || 0).toLocaleString('es-CO')}`,
      discount_amount: Number(it.discount_amount || 0),
      discount_formatted: it.discount_amount ? `-$${Number(it.discount_amount).toLocaleString('es-CO')}` : undefined,
      total_price: Number(it.total_price || 0),
      total_price_formatted: `$${Number(it.total_price || 0).toLocaleString('es-CO')}`,
    }));

    const taxes = this.aggregateTaxes(order.order_items);

    // Etiqueta del método de pago — la resuelve el contrato compartido, no
    // este archivo: soporta pago mixto («Efectivo + Tarjeta»), respeta el
    // alias que la tienda le puso al método y devuelve `undefined` cuando no
    // hay ningún cobro con nombre. Ese `undefined` se propaga tal cual: la
    // fila no se emite. Un tiquete que dice «Efectivo» por defecto afirma una
    // entrada de caja que nadie hizo.
    const paymentMethod = resolveOrderPaymentLabel(order.payments);
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
        address: addr.address_line1 ? `${addr.address_line1} ${addr.address_line2 || ''}`.trim() : undefined,
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
        date_formatted: order.created_at ? new Date(order.created_at).toLocaleDateString('es-CO') : new Date().toLocaleDateString('es-CO'),
        time: order.created_at ? new Date(order.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : undefined,
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
   * NO recalculamos la base con `base × tarifa` — eso introduce un céntimo
   * de más por redondeo y descuadra contra `order.tax_amount`. La base se
   * DERIVA de la línea (`tax_amount / tax_rate` cuando `tax_rate > 0`,
   * 0 en otro caso) y se suma dentro del grupo. La suma de bases dentro
   * del grupo no es igual a `tax_amount_total / tax_rate` porque la base
   * de cada línea arrastra su propio redondeo — pero es la forma
   * contablemente honesta: cada línea aporta lo que aportó.
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
      for (const t of item.order_item_taxes || []) {
        const name = t.tax_name || 'IVA';
        const rate = Number(t.tax_rate || 0);
        const taxAmount = Number(t.tax_amount || 0);
        const key = `${name}|${rate}`;

        const lineBase = rate > 0 ? taxAmount / rate : 0;
        const existing = grouped.get(key);
        if (existing) {
          existing.tax_amount += taxAmount;
          existing.base_amount += lineBase;
        } else {
          grouped.set(key, {
            name,
            rate,
            tax_amount: taxAmount,
            base_amount: lineBase,
          });
        }
      }
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
