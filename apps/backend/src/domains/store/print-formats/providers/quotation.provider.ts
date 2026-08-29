import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';

@Injectable()
export class QuotationDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'quotation';

  constructor(private readonly prisma: StorePrismaService) {}

  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    const id = Number(documentId);
    if (isNaN(id)) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    const quot = await this.prisma.quotations.findFirst({
      where: { id, store_id: storeId },
      include: {
        stores: {
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

    const store = quot.stores || {};
    const storeAddr = store.addresses?.[0] || {};
    const itemsRaw = (quot as any).items || [];

    const items = itemsRaw.map((it: any, idx: number) => ({
      index: idx + 1,
      product_name: it.product_name || it.name || 'Ítem',
      variant_sku: it.sku || undefined,
      quantity: Number(it.quantity || 1),
      unit_price: Number(it.unit_price || 0),
      unit_price_formatted: `$${Number(it.unit_price || 0).toLocaleString('es-CO')}`,
      total_price: Number(it.total_price || (it.quantity * it.unit_price) || 0),
      total_price_formatted: `$${Number(it.total_price || (it.quantity * it.unit_price) || 0).toLocaleString('es-CO')}`,
    }));

    const total = Number(quot.total_amount || 0);

    return {
      store: {
        name: store.name || 'Vendix',
        legal_name: store.legal_name,
        tax_id: store.organizations?.tax_id,
        phone: store.phone,
        email: store.email,
        address: storeAddr.address_line1,
        city: storeAddr.city,
      },
      customer: {
        name: (quot as any).customer_name || 'Cliente Prospecto',
        tax_id: (quot as any).customer_tax_id,
        phone: (quot as any).customer_phone,
        email: (quot as any).customer_email,
      },
      document: {
        id: quot.id,
        number: (quot as any).quotation_number || `COT-${quot.id}`,
        date: quot.created_at ? new Date(quot.created_at).toISOString() : new Date().toISOString(),
        date_formatted: quot.created_at ? new Date(quot.created_at).toLocaleDateString('es-CO') : new Date().toLocaleDateString('es-CO'),
        valid_until: quot.valid_until ? new Date(quot.valid_until).toISOString() : undefined,
        valid_until_formatted: quot.valid_until ? new Date(quot.valid_until).toLocaleDateString('es-CO') : undefined,
        state: quot.status,
        state_label: quot.status,
        notes: quot.notes || undefined,
      },
      items,
      taxes: [],
      totals: {
        subtotal: total,
        subtotal_formatted: `$${total.toLocaleString('es-CO')}`,
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: total,
        grand_total_formatted: `$${total.toLocaleString('es-CO')}`,
      },
    };
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
      { token: '{{totals.grand_total}}', path: 'totals.grand_total_formatted', description: 'Monto total cotizado', example: '$16.500.000' },
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
