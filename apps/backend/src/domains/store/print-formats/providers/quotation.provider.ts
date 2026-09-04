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

/**
 * Etiquetas de `quotation_status_enum` en español. Mismo diccionario de siete
 * estados que pinta el detalle en pantalla
 * (`quotation-print.service.ts:statusLabels`): sin él el papel salía con el
 * valor crudo del enum ("sent"), que es lenguaje de base de datos, no de
 * cliente.
 */
const QUOTATION_STATE_LABELS: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired: 'Expirada',
  converted: 'Convertida',
  cancelled: 'Cancelada',
};

@Injectable()
export class QuotationDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'quotation';
  private readonly logger = new Logger(QuotationDataProvider.name);

  // `s3Service` opcional por la misma razón que en
  // `sales-order-invoice.provider.ts`: los specs instancian el proveedor con
  // un solo argumento; Nest siempre lo inyecta en runtime.
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3Service?: S3Service,
  ) {}

  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    const id = Number(documentId);
    if (isNaN(id)) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    // Las tres relaciones son las que nombra `model quotations` en
    // `schema.prisma`: `store` (SINGULAR), `customer` y `quotation_items`.
    // Antes de este fix el include pedía `stores` y no pedía ítems ni
    // cliente, así que TODA cotización moría en
    // `PrismaClientValidationError` → el gateway devolvía 500 y el navegador
    // caía al fallback local. El papel del gateway nunca se había visto.
    const quot = await this.prisma.quotations.findFirst({
      where: { id, store_id: storeId },
      include: {
        quotation_items: { orderBy: { id: 'asc' } },
        // CP-print-token-flow A.3 — dirección del cliente (igual que POS).
        customer: { include: { addresses: { take: 1 } } },
        store: {
          include: {
            addresses: { take: 1 },
            organizations: true,
          },
        },
      },
    });

    if (!quot) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    const store = quot.store || ({} as any);
    const org = store.organizations || ({} as any);
    const storeAddr = store.addresses?.[0] || ({} as any);
    const customer = quot.customer;

    const items = (quot.quotation_items || []).map((it: any, idx: number) => ({
      index: idx + 1,
      product_name: it.product_name || 'Ítem',
      variant_sku: it.variant_sku || undefined,
      quantity: Number(it.quantity || 1),
      unit_price: Number(it.unit_price || 0),
      unit_price_formatted: `$${Number(it.unit_price || 0).toLocaleString('es-CO')}`,
      discount_amount: Number(it.discount_amount || 0),
      discount_formatted: it.discount_amount
        ? `-$${Number(it.discount_amount).toLocaleString('es-CO')}`
        : undefined,
      tax_rate: it.tax_rate !== null && it.tax_rate !== undefined ? Number(it.tax_rate) : undefined,
      tax_amount: it.tax_amount_item !== null && it.tax_amount_item !== undefined
        ? Number(it.tax_amount_item)
        : undefined,
      // `total_price` se toma tal como quedó guardado: la línea ya viene
      // resuelta por `quotations.service.ts` incluyendo `price_unit_quantity`
      // (precio por empaque). Recalcularlo aquí desbarataría las tarifas por
      // unidad de venta.
      total_price: Number(it.total_price || 0),
      total_price_formatted: `$${Number(it.total_price || 0).toLocaleString('es-CO')}`,
      notes: it.notes || undefined,
    }));

    const subtotal = Number(quot.subtotal_amount || 0);
    const discount = Number(quot.discount_amount || 0);
    const tax = Number(quot.tax_amount || 0);
    const shipping = Number(quot.shipping_cost || 0);
    const grandTotal = Number(quot.grand_total || subtotal - discount + tax + shipping);
    const signedLogoUrl = await signStoreLogoUrl(this.s3Service, store.logo_url, this.logger);

    return {
      store: {
        name: store.name || 'Vendix',
        legal_name: store.legal_name || org.legal_name,
        tax_id: org.tax_id,
        phone: store.phone,
        email: store.email,
        address: storeAddr.address_line1
          ? `${storeAddr.address_line1} ${storeAddr.address_line2 || ''}`.trim()
          : undefined,
        city: storeAddr.city,
        logo_url: signedLogoUrl,
      },
      customer: customer
        ? {
            name:
              `${customer.first_name || ''} ${customer.last_name || ''}`.trim() ||
              customer.legal_name ||
              'Cliente Prospecto',
            legal_name: customer.legal_name || undefined,
            tax_id: customer.document_number || undefined,
            phone: customer.phone || undefined,
            email: customer.email || undefined,
            ...mapUserAddress(customer.addresses?.[0]),
          }
        : undefined,
      document: {
        id: quot.id,
        number: quot.quotation_number || `COT-${quot.id}`,
        date: quot.created_at ? new Date(quot.created_at).toISOString() : new Date().toISOString(),
        date_formatted: quot.created_at ? new Date(quot.created_at).toLocaleDateString('es-CO') : new Date().toLocaleDateString('es-CO'),
        valid_until: quot.valid_until ? new Date(quot.valid_until).toISOString() : undefined,
        valid_until_formatted: quot.valid_until ? new Date(quot.valid_until).toLocaleDateString('es-CO') : undefined,
        state: quot.status,
        state_label: QUOTATION_STATE_LABELS[quot.status] || quot.status,
        channel: quot.channel || undefined,
        notes: quot.notes || undefined,
        // `internal_notes` NO se expone: es la nota interna del vendedor y el
        // papel va al cliente. `terms_and_conditions` sí, porque es la letra
        // pequeña de la oferta.
        terms_and_conditions: quot.terms_and_conditions || undefined,
      },
      items,
      taxes: this.aggregateTaxes(quot.quotation_items),
      totals: {
        subtotal,
        subtotal_formatted: `$${subtotal.toLocaleString('es-CO')}`,
        discount_total: discount,
        discount_total_formatted: `$${discount.toLocaleString('es-CO')}`,
        shipping_total: shipping,
        shipping_total_formatted: `$${shipping.toLocaleString('es-CO')}`,
        tax_total: tax,
        tax_total_formatted: `$${tax.toLocaleString('es-CO')}`,
        grand_total: grandTotal,
        grand_total_formatted: `$${grandTotal.toLocaleString('es-CO')}`,
      },
    };
  }

  /**
   * Agrega el impuesto de las líneas en filas por tarifa para
   * `fiscal_tax_breakdown`.
   *
   * A diferencia de `orders`, `quotation_items` no tiene tabla de impuestos
   * por línea: sólo `tax_rate` (fracción, `Decimal(6,5)` ⇒ 0.19) y
   * `tax_amount_item`. Como la fila NO guarda el tributo, la etiqueta es
   * "Impuesto" y no "IVA": una cotización puede llevar INC o IBUA, y nombrar
   * un tributo que el dato no afirma es inventar clasificación fiscal.
   *
   * La base se deriva `tax_amount / tax_rate` —no `total × tarifa`— igual que
   * en los demás proveedores, para que la base impresa cuadre con el impuesto
   * impreso aunque la línea traiga descuento.
   */
  private aggregateTaxes(quotationItems: any[]): Array<{
    name: string;
    rate: number;
    base_amount: number;
    tax_amount: number;
    base_formatted: string;
    tax_formatted: string;
  }> {
    const grouped = new Map<
      number,
      { rate: number; base_amount: number; tax_amount: number }
    >();

    for (const item of quotationItems || []) {
      const rate = Number(item.tax_rate || 0);
      const taxAmount = Number(item.tax_amount_item || 0);
      if (rate <= 0 || taxAmount <= 0) continue;

      const lineBase = taxAmount / rate;
      const existing = grouped.get(rate);
      if (existing) {
        existing.tax_amount += taxAmount;
        existing.base_amount += lineBase;
      } else {
        grouped.set(rate, { rate, base_amount: lineBase, tax_amount: taxAmount });
      }
    }

    return Array.from(grouped.values()).map((g) => ({
      name: 'Impuesto',
      rate: g.rate,
      base_amount: g.base_amount,
      tax_amount: g.tax_amount,
      base_formatted: `$${g.base_amount.toLocaleString('es-CO')}`,
      tax_formatted: `$${g.tax_amount.toLocaleString('es-CO')}`,
    }));
  }

  async getSampleData(storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: {
        name: 'Vendix Soluciones Tecnológicas',
        legal_name: 'Vendix Tech S.A.S.',
        tax_id: '901.888.777-4',
        phone: '+57 300 999 8877',
        email: 'cotizaciones@vendix.com',
        address: 'Calle 127 # 19-45',
        city: 'Bogotá D.C.',
      },
      customer: {
        name: 'Constructora Bolívar & Asociados S.A.',
        tax_id: '860.000.111-2',
        phone: '+57 601 321 0000',
        email: 'proyectos@bolivar.com.co',
        // CP-print-token-flow A.3 — paridad muestra/real (ADR-2).
        address: 'Calle 127 # 15-46, Bogotá D.C.',
        address_line1: 'Calle 127 # 15-46',
        city: 'Bogotá D.C.',
      },
      document: {
        id: 701,
        number: 'COT-2026-00120',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        valid_until: new Date(Date.now() + 15 * 86400000).toISOString(),
        valid_until_formatted: new Date(Date.now() + 15 * 86400000).toLocaleDateString('es-CO'),
        state: 'sent',
        state_label: 'Enviada',
        notes: 'Precios válidos por 15 días calendario. Incluye entrega en obra en Bogotá.',
        terms_and_conditions:
          'Forma de pago: 50% anticipado, 50% contra entrega.\nTiempo de entrega: 10 días hábiles después de la orden de compra.\nGarantía: 12 meses por defectos de fábrica.',
      },
      items: [
        {
          index: 1,
          product_name: 'Servidor Rack 1U Intel Xeon 32GB RAM 2TB SSD',
          variant_sku: 'SRV-RACK-1U-XEON',
          quantity: 2,
          unit_price: 6800000,
          unit_price_formatted: '$6.800.000',
          total_price: 13600000,
          total_price_formatted: '$13.600.000',
        },
        {
          index: 2,
          product_name: 'Licencia Sistema Operativo Server 16 Cores',
          variant_sku: 'LIC-OS-SRV-16C',
          quantity: 2,
          unit_price: 1450000,
          unit_price_formatted: '$1.450.000',
          total_price: 2900000,
          total_price_formatted: '$2.900.000',
        },
      ],
      taxes: [],
      totals: {
        subtotal: 16500000,
        subtotal_formatted: '$16.500.000',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: 16500000,
        grand_total_formatted: '$16.500.000',
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{document.number}}', path: 'document.number', description: 'Número de cotización', example: 'COT-2026-001' },
      { token: '{{document.valid_until}}', path: 'document.valid_until_formatted', description: 'Fecha límite de validez de la oferta', example: '30/09/2026' },
      { token: '{{customer.name}}', path: 'customer.name', description: 'Nombre del prospecto o cliente', example: 'Constructora XYZ' },
      { token: '{{customer.address}}', path: 'customer.address', description: 'Dirección del cliente', example: 'Calle 127 # 15-46, Bogotá D.C.' },
      { token: '{{totals.grand_total}}', path: 'totals.grand_total_formatted', description: 'Monto total cotizado', example: '$16.500.000' },
      { token: '{{document.state}}', path: 'document.state_label', description: 'Estado de la cotización en español', example: 'Enviada' },
      { token: '{{document.notes}}', path: 'document.notes', description: 'Nota de la cotización dirigida al cliente', example: 'Incluye entrega en obra' },
      { token: '{{document.terms}}', path: 'document.terms_and_conditions', description: 'Términos y condiciones de la oferta', example: 'Pago 50% anticipado' },
    ];
  }

  /**
   * [print-editor-dsk P3.1] — Cotizaciones sobre `quotations`. La columna
   * `quotation_number` es el número visible (no `id`). Ordenamos por
   * `created_at desc` igual que `fetchDocumentData` para que el picker
   * muestre el orden temporal esperado por el usuario.
   */
  async listRecent(
    storeId: number,
    limit: number,
  ): Promise<RecentDocumentSummary[]> {
    const rows = await this.prisma.quotations.findMany({
      where: { store_id: storeId },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true,
        quotation_number: true,
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
      number: String(r.quotation_number),
      date_formatted: r.created_at ? fmt.format(new Date(r.created_at)) : '',
      total_formatted: cop.format(Number(r.grand_total || 0)),
    }));
  }
}
