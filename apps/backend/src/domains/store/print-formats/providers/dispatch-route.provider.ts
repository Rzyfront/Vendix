import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';

/**
 * [print-editor-dsk P8] — Planilla de ruta DSD (`dispatch_route`).
 *
 * Lector de `dispatch_routes` (esquema: `dispatch_routes`, `dispatch_route_stops`,
 * `vehicles`, `suppliers` como carrier externo, `dispatch_notes` como destino).
 *
 * A diferencia del resto de formatos logísticos (remisión, tiquete), la
 * planilla de ruta es OPERATIVA y no transaccional: no factura, no es firma de
 * recepción — es la guía que el auxiliar lleva al vehículo. La selección de
 * columnas está pensada para ese papel: vehículo, conductor, transportista
 * externo si lo hay, número de ruta y la secuencia de paradas con su cliente y
 * dirección.
 *
 * Cast explícito en `formatType` mientras `prisma generate` no haya regenerado
 * `@prisma/client` con el valor del enum — mismo patrón que
 * `DispatchTicketDataProvider` aplicó para `dispatch_ticket`.
 */
@Injectable()
export class DispatchRouteDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum =
    'dispatch_route' as unknown as print_format_type_enum;

  constructor(private readonly prisma: StorePrismaService) {}

  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    const id = Number(documentId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001,
        `Invalid route id: ${documentId}`,
      );
    }

    const route = await this.prisma.dispatch_routes.findFirst({
      where: { id, store_id: storeId },
      include: {
        vehicles: { select: { plate: true, type: true, brand: true, model_name: true } },
        driver_user: {
          select: { first_name: true, last_name: true, document_number: true },
        },
        // `external_carrier` apunta a `suppliers` (sin modelo `carriers`).
        external_carrier: { select: { name: true, code: true, contact_person: true } },
        origin_location: { select: { name: true, code: true } },
        stops: {
          orderBy: { stop_sequence: 'asc' },
          include: {
            // dispatch_note → order → user (cliente). Mismo camino que
            // dispatch-note.provider.ts pero con un nivel menos de include.
            dispatch_note: {
              select: {
                id: true,
                dispatch_number: true,
                customer_name: true,
                customer_phone: true,
                customer_address: true,
                order: {
                  select: {
                    user: { select: { first_name: true, last_name: true, phone: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!route) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001,
        `Dispatch route ${id} not found in store ${storeId}`,
      );
    }

    return this.mapRouteToPrintData(route);
  }

  async getSampleData(_storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: {
        name: 'Vendix Logística DSD',
        legal_name: 'Distribuidora Vendix S.A.S.',
        tax_id: '901.222.333-4',
        phone: '+57 601 770 0099',
        address: 'Centro Logístico Calle 80, Bodega 14',
        city: 'Bogotá D.C.',
      },
      document: {
        id: 0,
        number: 'PLANILLA-2026-0001',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        time: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
        state: 'dispatched',
        state_label: 'Despachada',
        notes: 'Planilla demo con 4 paradas y 1 anulada.',
      },
      items: [],
      taxes: [],
      totals: {
        subtotal: 0,
        subtotal_formatted: '$0',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: 0,
        grand_total_formatted: '$0',
      },
      custom_variables: {
        vehicle_plate: 'WXB-987',
        vehicle_description: 'Camión Furgón',
        driver_name: 'Carlos Pérez',
        carrier_name: '',
        origin_location: 'Bodega Central Calle 80',
        planned_date: new Date().toISOString(),
        total_to_collect: 0,
        total_collected: 0,
        total_prepaid: 0,
        total_changes: 0,
        total_withholdings: 0,
        total_credit: 0,
        stops: [
          { sequence: 1, dispatch_number: 'REM-2026-00452', customer: 'Cliente Demo 1', address: 'Calle 100 # 15-20', city: 'Bogotá D.C.', status: 'pending' },
          { sequence: 2, dispatch_number: 'REM-2026-00453', customer: 'Cliente Demo 2', address: 'Cra 15 # 93-50', city: 'Bogotá D.C.', status: 'pending' },
          { sequence: 3, dispatch_number: 'REM-2026-00454', customer: 'Cliente Demo 3', address: 'Av 19 # 120-30', city: 'Bogotá D.C.', status: 'pending' },
        ],
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{ document.number }}', path: 'document.number', description: 'Número de la ruta', example: 'PLANILLA-0001' },
      { token: '{{ vehicle_plate }}', path: 'custom_variables.vehicle_plate', description: 'Placa del vehículo', example: 'WXB-987' },
      { token: '{{ driver_name }}', path: 'custom_variables.driver_name', description: 'Nombre del conductor', example: 'Carlos Pérez' },
      { token: '{{ carrier_name }}', path: 'custom_variables.carrier_name', description: 'Transportista externo (si aplica)', example: 'Transportes XYZ' },
      { token: '{{ stops_count }}', path: 'custom_variables.stops.length', description: 'Cantidad de paradas', example: '4' },
      { token: '{{ stops[].customer }}', path: 'custom_variables.stops[].customer', description: 'Cliente por parada', example: 'Cliente Demo 1' },
      { token: '{{ stops[].address }}', path: 'custom_variables.stops[].address', description: 'Dirección de entrega', example: 'Calle 100 # 15-20' },
      { token: '{{ total_to_collect }}', path: 'custom_variables.total_to_collect', description: 'Total a cobrar en la ruta', example: '1.250.000' },
    ];
  }

  /**
   * [print-editor-dsk P8] — Picker de rutas recientes. Ordena por
   * `planned_date desc` (la fecha operativa, no `created_at` que puede
   * divergir por correcciones previas al despacho).
   */
  async listRecent(
    storeId: number,
    limit: number,
  ): Promise<RecentDocumentSummary[]> {
    const rows = await this.prisma.dispatch_routes.findMany({
      where: { store_id: storeId },
      orderBy: { planned_date: 'desc' },
      take: limit,
      select: {
        id: true,
        route_number: true,
        planned_date: true,
        total_to_collect: true,
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
      number: String(r.route_number),
      date_formatted: r.planned_date ? fmt.format(new Date(r.planned_date)) : '',
      total_formatted: cop.format(Number(r.total_to_collect || 0)),
    }));
  }

  // ============================================================
  // Mapeo interno
  // ============================================================

  private mapRouteToPrintData(route: any): StandardPrintDataModel {
    const vehicle = route.vehicles || {};
    const driver = route.driver_user || {};
    const carrier = route.external_carrier || {};
    const origin = route.origin_location || {};

    const driverName =
      `${driver.first_name || ''} ${driver.last_name || ''}`.trim() ||
      route.external_driver_name ||
      '';

    const stops = (route.stops || []).map((s: any) => {
      const note = s.dispatch_note || {};
      const user = note.order?.user || {};
      const customerName =
        note.customer_name ||
        `${user.first_name || ''} ${user.last_name || ''}`.trim() ||
        'Cliente';
      const phone = note.customer_phone || user.phone || '';
      const address = this.formatAddress(note.customer_address);

      return {
        sequence: Number(s.stop_sequence || 0),
        dispatch_note_id: note.id,
        dispatch_number: note.dispatch_number ? String(note.dispatch_number) : '',
        customer: customerName,
        phone,
        address,
        status: s.status,
        result: s.result,
        collected_amount: Number(s.collected_amount || 0),
        withholding_amount: Number(s.withholding_amount || 0),
        is_prepaid: Boolean(s.is_prepaid),
      };
    });

    return {
      store: {
        name: '',
        tax_id: '',
      },
      document: {
        id: route.id,
        number: String(route.route_number),
        date: route.created_at
          ? new Date(route.created_at).toISOString()
          : new Date().toISOString(),
        date_formatted: route.planned_date
          ? new Date(route.planned_date).toLocaleDateString('es-CO')
          : new Date().toLocaleDateString('es-CO'),
        state: route.status,
        state_label: route.status,
        notes: route.notes || undefined,
      },
      items: [],
      taxes: [],
      totals: {
        subtotal: 0,
        subtotal_formatted: '$0',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: Number(route.total_to_collect || 0),
        grand_total_formatted: `$${Number(route.total_to_collect || 0).toLocaleString('es-CO')}`,
      },
      custom_variables: {
        vehicle_plate: vehicle.plate || '',
        vehicle_description: [vehicle.brand, vehicle.model_name].filter(Boolean).join(' '),
        driver_name: driverName,
        driver_document: driver.document_number || route.external_driver_id_number || '',
        carrier_name: carrier.name || '',
        origin_location: origin.name || '',
        planned_date: route.planned_date ? new Date(route.planned_date).toISOString() : '',
        total_to_collect: Number(route.total_to_collect || 0),
        total_collected: Number(route.total_collected || 0),
        total_prepaid: Number(route.total_prepaid || 0),
        total_changes: Number(route.total_changes || 0),
        total_withholdings: Number(route.total_withholdings || 0),
        total_credit: Number(route.total_credit || 0),
        stops,
      },
    };
  }

  private formatAddress(addr: any): string {
    if (!addr) return '';
    if (typeof addr === 'string') return addr;
    if (typeof addr === 'object') {
      const parts = [
        addr.address_line1,
        addr.address_line2,
        addr.city,
        addr.state_province,
      ].filter(Boolean);
      return parts.join(', ');
    }
    return '';
  }
}