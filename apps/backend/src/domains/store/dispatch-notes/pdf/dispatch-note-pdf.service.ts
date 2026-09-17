import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { S3Service } from '../../../../common/services/s3.service';
import {
  DispatchNotePdfBuilder,
  DispatchNotePdfData,
  DispatchNotePdfItem,
  DispatchNoteTransporter,
} from './dispatch-note-pdf.builder';
// F-101 (CP-pos-exclusive-tax-double-charge, unificación 2026-09-14) — este
// PDF (riel B, `POST /store/dispatch-notes/:id/pdf`) imprimía la fila "IVA:"
// sin ningún gate fiscal, mientras el otro riel de la remisión
// (`print-formats/providers/dispatch-note.provider.ts`, riel A) SÍ la
// gatea con `resolvePrintsVatBreakdownForPrint`. Se reutiliza la MISMA
// función (no se duplica el predicado) para que ambos rieles coincidan en
// si el papel muestra el desglose de IVA.
import { resolvePrintsVatBreakdownForPrint } from '../../print-formats/services/print-vat-breakdown.resolver';
// Hallazgo 1b — discriminante bruto-vs-base compartido (misma función que el
// riel A): sin aritmética propia para que los dos motores no diverjan.
import { resolveDispatchNoteLinePrintedGross } from '../../taxes/utils/final-price.util';

/**
 * Dedicated include for the remisión PDF. It is intentionally separate from the
 * shared DISPATCH_NOTE_INCLUDE in dispatch-notes.service.ts: the PDF needs the
 * full emisor (organization), the physical origin address, the delivery-address
 * cascade sources, and the active route (transportador) — none of which the
 * standard detail view loads.
 */
const DISPATCH_NOTE_PDF_INCLUDE = {
  dispatch_note_items: {
    include: {
      product: { select: { id: true, name: true, sku: true } },
      product_variant: { select: { id: true, sku: true, name: true } },
    },
  },
  customer: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      email: true,
      phone: true,
    },
  },
  // Physical origin of the dispatch (warehouse) + its full address.
  dispatch_location: {
    select: {
      id: true,
      name: true,
      code: true,
      addresses: true,
    },
  },
  // Delivery-address cascade source #2: order snapshot + relation.
  order: {
    select: {
      id: true,
      order_number: true,
      shipping_address_snapshot: true,
      addresses_orders_shipping_address_idToaddresses: true,
    },
  },
  // Delivery-address cascade source #2 (alt): sales order relation.
  sales_order: {
    select: {
      id: true,
      order_number: true,
      addresses: true,
    },
  },
  // Emisor (legal entity) via store -> organization.
  store: {
    select: {
      id: true,
      // F-101 — settings para `resolvePrintsVatBreakdownForPrint` (misma
      // forma que usa `dispatch-note.provider.ts`, riel A).
      store_settings: { select: { settings: true } },
      organizations: {
        select: {
          id: true,
          name: true,
          legal_name: true,
          tax_id: true,
          phone: true,
          email: true,
          logo_url: true,
          fiscal_scope: true,
          organization_settings: { select: { settings: true } },
          addresses: { take: 1 },
        },
      },
    },
  },
  // Transportador: route stops history -> route + vehicle + driver.
  dispatch_route_stops: {
    orderBy: { id: 'desc' as const },
    select: {
      id: true,
      status: true,
      route: {
        select: {
          id: true,
          route_number: true,
          status: true,
          vehicle: { select: { plate: true } },
          driver_user: { select: { first_name: true, last_name: true } },
          external_driver_name: true,
        },
      },
    },
  },
};

@Injectable()
export class DispatchNotePdfService {
  private readonly logger = new Logger(DispatchNotePdfService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3_service: S3Service,
  ) {}

  async generatePdf(id: number): Promise<Buffer> {
    const note = await this.prisma.dispatch_notes.findFirst({
      where: { id },
      include: DISPATCH_NOTE_PDF_INCLUDE,
    });

    if (!note) {
      throw new NotFoundException('Remisión no encontrada');
    }

    const org = note.store?.organizations;

    // F-101 — mismo gate fiscal que usa el riel A del gateway
    // (`dispatch-note.provider.ts`): sin él, esta fila de IVA se imprimía
    // siempre que `tax_amount > 0`, sin mirar si la tienda tiene facturación
    // fiscal activa/responsabilidad de IVA.
    const prints_vat_breakdown = resolvePrintsVatBreakdownForPrint(
      org,
      note.store,
    );

    // Emisor logo (best-effort; never block PDF generation on it).
    let logo_buffer: Buffer | undefined;
    if (org?.logo_url) {
      try {
        logo_buffer = await this.s3_service.downloadImage(org.logo_url);
      } catch {
        this.logger.warn(
          'Could not download organization logo for dispatch note PDF',
        );
      }
    }

    const company_address = this.formatAddress(org?.addresses?.[0]);

    // Dirección de salida: from the dispatch location's address.
    const origin_address = this.formatAddress(note.dispatch_location?.addresses);

    // Dirección de entrega — cascade:
    //   1. order.shipping_address_snapshot (JSON)
    //   2. order / sales_order shipping address relation
    //   3. dispatch_notes.customer_address (JSON)
    const delivery_address =
      this.formatJsonAddress(note.order?.shipping_address_snapshot) ??
      this.formatAddress(
        note.order?.addresses_orders_shipping_address_idToaddresses,
      ) ??
      this.formatAddress(note.sales_order?.addresses) ??
      this.formatJsonAddress(note.customer_address) ??
      undefined;

    // C.7 + hallazgo 1b — la columna "P. Unit." tiene que ser de la MISMA
    // magnitud que la columna "Total", y el total persistido NO siempre es
    // bruto: las filas nuevas lo traen en bruto
    // (`total_price = unit_price × cantidad − descuento + tax_amount`) pero
    // las históricas B lo guardan en base. El discriminante vive en
    // `resolveDispatchNoteLinePrintedGross` (definición única compartida con
    // el riel A): acá sólo se consume, sin aritmética duplicada.
    const items: DispatchNotePdfItem[] = (note.dispatch_note_items || []).map(
      (item) => {
        const dispatched_quantity = Number(item.dispatched_quantity) || 0;
        const gross = resolveDispatchNoteLinePrintedGross({
          unit_price: item.unit_price,
          total_price: item.total_price,
          tax_amount: item.tax_amount,
          discount_amount: item.discount_amount,
          quantity: dispatched_quantity,
        });
        return {
          product_name: item.product?.name || `Producto #${item.product_id}`,
          variant_sku: item.product_variant?.sku ?? null,
          lot_serial: item.lot_serial ?? null,
          ordered_quantity: Number(item.ordered_quantity) || 0,
          dispatched_quantity,
          unit_price: gross.gross_unit_price,
          total_price: gross.gross_total_price,
        };
      },
    );

    const transporter = this.resolveTransporter(note.dispatch_route_stops);

    // Domiciliario: texto libre registrado en deliver(). Trim; ausente si vacío.
    // DISPATCH_NOTE_PDF_INCLUDE no restringe escalares, así que la columna
    // llega por defecto sin necesidad de select explícito.
    const courier_name =
      typeof note.courier_name === 'string' &&
      note.courier_name.trim().length > 0
        ? note.courier_name.trim()
        : undefined;

    const data: DispatchNotePdfData = {
      dispatch_number: note.dispatch_number,
      status: note.status,
      issue_date: this.formatDate(note.emission_date),

      company_name: org?.legal_name || org?.name || 'N/A',
      company_nit: org?.tax_id || 'N/A',
      company_address,
      company_phone: org?.phone || undefined,
      company_email: org?.email || undefined,
      company_logo_buffer: logo_buffer,

      origin_location_name: note.dispatch_location?.name || undefined,
      origin_address: origin_address || undefined,

      customer_name: note.customer_name || 'Consumidor Final',
      customer_tax_id: note.customer_tax_id || undefined,

      delivery_address,

      items,

      subtotal_amount: Number(note.subtotal_amount) || 0,
      discount_amount: Number(note.discount_amount) || 0,
      tax_amount: Number(note.tax_amount) || 0,
      prints_vat_breakdown,
      grand_total: Number(note.grand_total) || 0,
      currency: note.currency || 'COP',

      transporter,

      courier_name,

      notes: note.notes || undefined,
    };

    return DispatchNotePdfBuilder.generate(data);
  }

  // ─── Helpers ────────────────────────────────────────────────────

  /** Formats a Date as DD/MM/YYYY in UTC (date-only display, off-by-one safe). */
  private formatDate(date: Date | null | undefined): string {
    if (!date) return '—';
    const d = new Date(date);
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const year = d.getUTCFullYear();
    return `${day}/${month}/${year}`;
  }

  /** Formats a Prisma `addresses` row into a readable single line. */
  private formatAddress(
    address:
      | {
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          state_province?: string | null;
          postal_code?: string | null;
        }
      | null
      | undefined,
  ): string | undefined {
    if (!address) return undefined;
    const parts = [
      address.address_line1,
      address.address_line2,
      address.city,
      address.state_province,
      address.postal_code,
    ].filter((p): p is string => !!p && p.trim().length > 0);
    return parts.length > 0 ? parts.join(', ') : undefined;
  }

  /**
   * Formats a JSON address blob (order snapshot or dispatch_notes.customer_address)
   * into a readable single line. Tolerant of the different key spellings seen
   * across snapshots (`state` vs `state_province`, `country` vs `country_code`).
   */
  private formatJsonAddress(value: unknown): string | undefined {
    if (!value) return undefined;
    if (typeof value === 'string') {
      return value.trim().length > 0 ? value : undefined;
    }
    if (typeof value !== 'object') return undefined;

    const a = value as Record<string, unknown>;
    const str = (k: string): string | undefined => {
      const v = a[k];
      return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
    };

    const parts = [
      str('address_line1') ?? str('line1') ?? str('address'),
      str('address_line2') ?? str('line2'),
      str('city'),
      str('state_province') ?? str('state'),
      str('postal_code') ?? str('zip'),
    ].filter((p): p is string => !!p);

    return parts.length > 0 ? parts.join(', ') : undefined;
  }

  /**
   * Resolves the transportador section from the dispatch_route_stops history.
   * A dispatch note can have multiple stops over its lifetime (released stops
   * from prior routes), so we pick the first stop whose own status is not
   * `released` and whose route is not `voided`.
   */
  private resolveTransporter(
    stops: Array<{
      status: string;
      route: {
        route_number: string;
        status: string;
        vehicle: { plate: string } | null;
        driver_user: { first_name: string | null; last_name: string | null } | null;
        external_driver_name: string | null;
      } | null;
    }>,
  ): DispatchNoteTransporter | undefined {
    if (!stops || stops.length === 0) return undefined;

    const active = stops.find(
      (s) =>
        s.status !== 'released' &&
        s.route &&
        s.route.status !== 'voided',
    );
    if (!active || !active.route) return undefined;

    const route = active.route;
    const driver_name =
      route.driver_user
        ? `${route.driver_user.first_name || ''} ${route.driver_user.last_name || ''}`.trim()
        : route.external_driver_name || null;

    return {
      route_number: route.route_number,
      vehicle_plate: route.vehicle?.plate ?? null,
      driver_name: driver_name && driver_name.length > 0 ? driver_name : null,
    };
  }
}
