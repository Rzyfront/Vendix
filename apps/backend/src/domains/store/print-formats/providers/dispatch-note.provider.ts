import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';

@Injectable()
export class DispatchNoteDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'dispatch_note';

  constructor(private readonly prisma: StorePrismaService) {}

  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    const id = Number(documentId);
    if (isNaN(id)) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    const note = await this.prisma.dispatch_notes.findFirst({
      where: { id, store_id: storeId },
      include: {
        stores: {
          include: {
            addresses: { take: 1 },
            organizations: true,
          },
        },
        orders: {
          include: {
            order_items: true,
            users: true,
          },
        },
      },
    });

    if (!note) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    const store = note.stores || {};
    const order = note.orders || ({} as any);
    const user = order.users || {};
    const storeAddr = store.addresses?.[0] || {};

    let customerAddress = '';
    if (note.customer_address) {
      if (typeof note.customer_address === 'string') {
        customerAddress = note.customer_address;
      } else if (typeof note.customer_address === 'object') {
        const a = note.customer_address as any;
        customerAddress = [a.address_line1, a.address_line2, a.city, a.state_province].filter(Boolean).join(', ');
      }
    }

    const items = (order.order_items || []).map((it: any, idx: number) => ({
      index: idx + 1,
      product_name: it.product_name,
      variant_sku: it.variant_sku || undefined,
      quantity: Number(it.quantity || 1),
      unit_price: Number(it.unit_price || 0),
      total_price: Number(it.total_price || 0),
    }));

    return {
      store: {
        name: store.name || 'Vendix Logistics',
        legal_name: store.legal_name,
        tax_id: store.organizations?.tax_id,
        phone: store.phone,
        email: store.email,
        address: storeAddr.address_line1,
        city: storeAddr.city,
      },
      customer: {
        name: (note as any).customer_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Destinatario',
        phone: (note as any).customer_phone || user.phone,
        address: customerAddress,
      },
      document: {
        id: note.id,
        number: note.dispatch_number,
        date: note.created_at ? new Date(note.created_at).toISOString() : new Date().toISOString(),
        date_formatted: note.created_at ? new Date(note.created_at).toLocaleDateString('es-CO') : new Date().toLocaleDateString('es-CO'),
        state: note.state,
        state_label: note.state,
        shipping_carrier: note.carrier_name || undefined,
        shipping_tracking_number: note.tracking_number || undefined,
        notes: note.notes || undefined,
      },
      items,
      taxes: [],
      totals: {
        subtotal: Number(order.subtotal_amount || 0),
        subtotal_formatted: `$${Number(order.subtotal_amount || 0).toLocaleString('es-CO')}`,
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: Number(order.grand_total || 0),
        grand_total_formatted: `$${Number(order.grand_total || 0).toLocaleString('es-CO')}`,
      },
    };
  }

  async getSampleData(storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: {
        name: 'Vendix Centro de Distribución',
        legal_name: 'Logística Vendix S.A.S.',
        tax_id: '900.111.222-3',
        phone: '+57 601 789 0011',
        address: 'Autopista Medellín Km 3.5, Parque Industrial',
        city: 'Cota, Cundinamarca',
      },
      customer: {
        name: 'Comercializadora Eléctrica del Norte S.A.S.',
        tax_id: '800.999.777-5',
        phone: '+57 320 555 7788',
        address: 'Calle 45 # 28-14, Barrio El Prado, Barranquilla',
      },
      document: {
        id: 301,
        number: 'REM-2026-00452',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        state: 'shipped',
        state_label: 'Despachado',
        shipping_carrier: 'Servientrega Express',
        shipping_tracking_number: 'GUIA-889922001',
        notes: 'Entregar en horario de oficina. Solicitar sello y firma.',
      },
      items: [
        {
          index: 1,
          product_name: 'Panel LED 60x60cm 40W Luz Blanca',
          variant_sku: 'PAN-LED-60-40W',
          quantity: 20,
          unit_price: 45000,
          total_price: 900000,
        },
        {
          index: 2,
          product_name: 'Cable UTP Categoría 6 Bobina 305m',
          variant_sku: 'CAB-UTP-CAT6-305M',
          quantity: 2,
          unit_price: 320000,
          total_price: 640000,
        },
      ],
      taxes: [],
      totals: {
        subtotal: 1540000,
        subtotal_formatted: '$1.540.000',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: 1540000,
        grand_total_formatted: '$1.540.000',
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{document.number}}', path: 'document.number', description: 'Número de remisión / guía', example: 'REM-0012' },
      { token: '{{document.shipping_carrier}}', path: 'document.shipping_carrier', description: 'Nombre de la transportadora', example: 'Coordinadora' },
      { token: '{{document.shipping_tracking_number}}', path: 'document.shipping_tracking_number', description: 'Número de guía de tracking', example: '77221144' },
      { token: '{{customer.address}}', path: 'customer.address', description: 'Dirección de destino de entrega', example: 'Calle 10 # 5-20' },
    ];
  }

  /**
   * [print-editor-dsk P3.1] — Remisiones: ordenamos por `emission_date`
   * (no `created_at`) porque la columna de emisión es la fecha operativa
   * que el usuario ve en la remisión; `created_at` puede divergir por
   * correcciones posteriores a la emisión.
   */
  async listRecent(
    storeId: number,
    limit: number,
  ): Promise<RecentDocumentSummary[]> {
    const rows = await this.prisma.dispatch_notes.findMany({
      where: { store_id: storeId },
      orderBy: { emission_date: 'desc' },
      take: limit,
      select: {
        id: true,
        dispatch_number: true,
        emission_date: true,
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
      number: String(r.dispatch_number),
      date_formatted: r.emission_date ? fmt.format(new Date(r.emission_date)) : '',
      total_formatted: cop.format(Number(r.grand_total || 0)),
    }));
  }
}
