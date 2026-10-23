import { Injectable, Logger } from '@nestjs/common';
import { entity_type_enum, order_items, Prisma } from '@prisma/client';
import { filter } from 'rxjs';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { FullTaxRow, resolveFullTaxRowsByProductId } from '../taxes/utils/product-tax-rows.util';
import { resolveLineUnits, roundMoney2 } from '../taxes/utils/final-price.util';
import { resolveLineTotals } from '../taxes/utils/tax-inclusive-math.util';
import { RequestContextService } from '../../../common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { resolveStoreTimezone } from '../../../common/utils/store-timezone.util';
import { BusinessHoursService } from '../reservations/business-hours/business-hours.service';
import { ServiceAllocationCoordinator } from '../reservations/service-allocation-coordinator.service';
import { NotificationsSseService } from '../notifications/notifications-sse.service';
import { ServiceSessionAccessService } from '../../ecommerce/service-sessions/service-session-access.service';
import { EmailService } from '../../../email/email.service';
import { SettingsService } from '../settings/settings.service';
import { AddSessionItemDto, OpenServiceSessionDto, ServiceIntakeValueDto, ServiceSessionTransitionDto } from './dto/service-session.dto';
import { TemplatesService } from '../data-collection/templates.service';
import { buildEntityQueries, EntityContext, resolveEntityId } from '../data-collection/utils/entity-resolver.util';
import { ReissueServiceSessionLinkDto } from './dto/reissue-service-session-link.dto';

const ACTIVE_ALLOCATIONS = ['held', 'payment_pending', 'confirmed', 'in_service'];
const ACTIVE_SESSION_STATUSES = ['open', 'paused'];
const ITEM_SESSION_STATUSES = ['open', 'in_progress', 'paused'];

type IntakeField = {
  id: number;
  store_id: number;
  entity_type: string;
  field_type: string;
  label: string;
  is_active: boolean;
};
type IntakeItem = { metadata_field_id: number; is_required: boolean; sort_order: number; metadata_field: IntakeField };
type IntakeTemplate = { id: number; name: string; sections?: IntakeSection[]; tabs?: Array<{ sections?: IntakeSection[] }> };
type IntakeSection = { items?: IntakeItem[]; child_sections?: IntakeSection[] };
type IntakeValueColumns = { value_text: string | null; value_number: number | null; value_date: Date | null; value_bool: boolean | null };
type PreparedIntake = { templateId: number; entries: Array<{ field: IntakeField; columns: IntakeValueColumns }> } | null;
type StoredMetadataValue = { field_id: number; entity_type: string; value_text: string | null; value_number: Prisma.Decimal | null; value_date: Date | null; value_bool: boolean | null; value_json: Prisma.JsonValue | null };

type PriceRow = { sale_price?: Prisma.Decimal | number | null; is_on_sale?: boolean | null };

/**
 * Precio publicado con la misma escalera que la mesa y el POS: oferta de la variante →
 * precio propio de la variante → oferta del producto → precio base.
 */
function catalogUnitPrice(
  product: PriceRow & { base_price: Prisma.Decimal | number | null },
  variant?: (PriceRow & { price_override?: Prisma.Decimal | number | null }) | null,
): number {
  const variantSale = variant?.is_on_sale === true ? Number(variant.sale_price ?? 0) : 0;
  if (variantSale > 0) return variantSale;
  const override = Number(variant?.price_override ?? NaN);
  if (Number.isFinite(override) && override > 0) return override;
  const sale = product.is_on_sale === true ? Number(product.sale_price ?? 0) : 0;
  return sale > 0 ? sale : Number(product.base_price ?? 0);
}

/**
 * Columnas de precio/impuesto de una línea de la cuenta SVC, igual que `addItems` de la
 * mesa: el precio publicado se despeja una vez con las tasas del producto (incluidas →
 * se extrae la base; sumadas → se agregan encima) y se persiste la BASE. `tax_amount_item`
 * es por unidad; `order_item_taxes` lleva el total de línea por tasa.
 */
function buildTaxedLine(publishedUnitPrice: number, quantity: number, rows: FullTaxRow[]) {
  const lineUnits = resolveLineUnits({ quantity, price_unit_quantity: null });
  const resolved = resolveLineTotals(publishedUnitPrice, rows);
  return {
    unit_price: new Prisma.Decimal(roundMoney2(resolved.base)),
    total_price: new Prisma.Decimal(roundMoney2(resolved.base * lineUnits)),
    tax_rate: new Prisma.Decimal(Math.round((resolved.total_rate + Number.EPSILON) * 100000) / 100000),
    tax_amount_item: new Prisma.Decimal(roundMoney2(resolved.total_tax_amount)),
    final_unit_price: new Prisma.Decimal(roundMoney2(resolved.total)),
    ...(rows.length > 0
      ? {
          order_item_taxes: {
            create: rows.map((row, index) => ({
              tax_rate_id: row.tax_rate_id,
              tax_name: row.name,
              tax_rate: Math.round((row.rate + Number.EPSILON) * 100000) / 100000,
              tax_amount: roundMoney2(resolved.taxes[index].amount * lineUnits),
              tax_type: row.tax_type,
              is_compound: false,
              is_inclusive: row.is_inclusive,
            })),
          },
        }
      : {}),
  };
}

@Injectable()
export class ServiceSessionsService {
  private readonly logger = new Logger(ServiceSessionsService.name);
  private eventId = 0;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly notifications: NotificationsSseService,
    private readonly settings: SettingsService,
    private readonly businessHours: BusinessHoursService,
    private readonly sessionAccess: ServiceSessionAccessService,
    private readonly email: EmailService,
    private readonly allocationCoordinator: ServiceAllocationCoordinator,
    private readonly templates: TemplatesService,
  ) {}

  async open(dto: OpenServiceSessionDto) {
    const { storeId, userId } = this.requireContext();
    if (Boolean(dto.booking_id) === Boolean(dto.station_id)) {
      throw new VendixHttpException(ErrorCodes.STATION_009, 'Indica una reserva o una estación para walk-in.');
    }

    const now = new Date();
    const booking = dto.booking_id
      ? await this.prisma.bookings.findFirst({ where: { id: dto.booking_id, store_id: storeId }, include: { customer: { select: { email: true } } } })
      : null;
    if (dto.booking_id && !booking) throw new VendixHttpException(ErrorCodes.STATION_001);
    if (booking && !['confirmed', 'arriving', 'in_progress'].includes(booking.status)) {
      throw new VendixHttpException(ErrorCodes.STATION_006, 'La reserva no está lista para iniciar atención.');
    }

    const bookingAllocation = booking
      ? await this.prisma.service_allocations.findFirst({
          where: { store_id: storeId, booking_id: booking.id, state: { in: ACTIVE_ALLOCATIONS } },
        })
      : null;
    if (booking && await this.prisma.service_sessions.findFirst({
      where: { store_id: storeId, booking_id: booking.id, status: { in: ACTIVE_SESSION_STATUSES } },
      select: { id: true },
    })) {
      throw new VendixHttpException(ErrorCodes.STATION_005);
    }
    if (booking && (!bookingAllocation || !['confirmed', 'in_service'].includes(bookingAllocation.state))) {
      throw new VendixHttpException(ErrorCodes.STATION_001, 'La reserva no tiene una asignación confirmada.');
    }

    const stationId = bookingAllocation?.station_id ?? dto.station_id!;
    const contactEmail = (booking?.customer?.email ?? dto.contact_email)?.trim().toLowerCase() || null;
    const providerId = bookingAllocation?.provider_id ?? dto.provider_id ?? null;
    const productId = booking?.product_id ?? dto.product_id;
    if (!productId) throw new VendixHttpException(ErrorCodes.STATION_001, 'El walk-in requiere un servicio.');
    const station = await this.prisma.service_stations.findFirst({
      where: { id: stationId, store_id: storeId, status: 'active', capacity: 1 },
      select: { id: true },
    });
    const [stationService, product] = await Promise.all([
      this.prisma.service_station_services.findFirst({ where: { store_id: storeId, station_id: stationId, product_id: productId } }),
      this.prisma.products.findFirst({ where: { id: productId, store_id: storeId }, select: { id: true, name: true, base_price: true, sale_price: true, is_on_sale: true, product_type: true, state: true, booking_mode: true, service_duration_minutes: true, buffer_minutes: true } }),
    ]);
    if (!station || product?.product_type !== 'service') {
      throw new VendixHttpException(ErrorCodes.STATION_001);
    }
    // El servicio tiene que estar asignado a la estación (reserva o walk-in) y,
    // para un walk-in, activo en el catálogo.
    if (!stationService || (!bookingAllocation && product.state !== 'active')) {
      throw new VendixHttpException(ErrorCodes.STATION_001, 'El servicio no está activo para esta estación.');
    }
    const customerId = booking?.customer_id ?? dto.customer_id ?? null;
    // Un cliente elegido a mano debe pertenecer a esta tienda (el de la reserva ya viene de ella).
    if (!booking && dto.customer_id) {
      const customer = await this.prisma.users.findFirst({
        where: { id: dto.customer_id, store_users: { some: { store_id: storeId } } },
        select: { id: true },
      });
      if (!customer) throw new VendixHttpException(ErrorCodes.CUST_FIND_001);
    }
    // Required intake items are enforced on walk-in reception (the reservation flow may
    // have collected them earlier through a data-collection submission).
    const intake = await this.prepareIntake(productId, stationId, dto.intake_values, { enforceRequired: Boolean(dto.station_id), customerId, bookingId: booking?.id ?? null });
    if (providerId) {
      if (bookingAllocation) {
        const [stationProvider, providerService, provider] = await Promise.all([
          this.prisma.service_station_providers.findFirst({ where: { store_id: storeId, station_id: stationId, provider_id: providerId } }),
          this.prisma.provider_services.findFirst({ where: { provider_id: providerId, product_id: productId } }),
          this.prisma.service_providers.findFirst({ where: { id: providerId, store_id: storeId, is_active: true } }),
        ]);
        if (!stationProvider || !providerService || !provider) throw new VendixHttpException(ErrorCodes.STATION_001);
      } else {
        const provider = await this.prisma.service_providers.findFirst({
          where: { id: providerId, store_id: storeId, is_active: true },
          select: { id: true },
        });
        if (!provider) throw new VendixHttpException(ErrorCodes.STATION_001);
      }
    } else if (bookingAllocation && product.booking_mode === 'provider_required') {
      throw new VendixHttpException(ErrorCodes.STATION_001, 'Selecciona un proveedor compatible.');
    }

    const startAt = now;
    let plannedEnd: Date;
    if (bookingAllocation) {
      plannedEnd = bookingAllocation.end_at;
      if (!plannedEnd || plannedEnd <= startAt) {
        throw new VendixHttpException(ErrorCodes.STATION_009);
      }
    } else {
      const parsedEnd = dto.planned_end_at ? new Date(dto.planned_end_at) : null;
      if (parsedEnd && !isNaN(parsedEnd.getTime()) && parsedEnd > now) {
        plannedEnd = parsedEnd;
      } else {
        const durationMinutes = product.service_duration_minutes ?? 60;
        plannedEnd = new Date(now.getTime() + durationMinutes * 60_000);
      }
      if (plannedEnd <= now) {
        throw new VendixHttpException(ErrorCodes.STATION_009);
      }
    }

    const currency = await this.settings.getStoreCurrency();
    let result: { id: number; order_id: number | null; station_id: number; booking_id: number | null; status: string; access_token: string; access_token_id: number; access_expires_at: Date; email_delivery_status: string; access_url: string | null };
    try {
      result = await this.prisma.$transaction(async (tx) => {
      let orderId = booking?.order_id ?? null;
      if (orderId) {
        const order = await tx.orders.findFirst({ where: { id: orderId, store_id: storeId }, select: { id: true, state: true, service_session_id: true } });
        if (!order || !['draft', 'processing'].includes(order.state) || order.service_session_id) {
          throw new VendixHttpException(ErrorCodes.STATION_006, 'La orden vinculada no está disponible para esta atención.');
        }
      }

      const session = await tx.service_sessions.create({
        data: { store_id: storeId, station_id: stationId, product_id: productId, booking_id: booking?.id ?? null, order_id: orderId, contact_email: contactEmail, status: 'open', opened_at: now, updated_at: now },
      });

      if (bookingAllocation) {
        await this.allocationCoordinator.transferBookingToSession(tx, {
          storeId,
          bookingId: booking!.id,
          allocationId: bookingAllocation.id,
          sessionId: session.id,
          startAt,
        });
      }

      if (!orderId) {
        const orderNumber = `SVC-${session.id}`;
        const order = await tx.orders.create({
          data: {
            store_id: storeId,
            created_by_user_id: userId ?? null,
            customer_id: customerId,
            order_number: orderNumber,
            state: 'draft',
            channel: booking?.channel ?? 'pos',
            delivery_type: 'direct_delivery',
            currency: currency || 'COP',
            subtotal_amount: 0,
            tax_amount: 0,
            shipping_cost: 0,
            discount_amount: 0,
            grand_total: 0,
            total_paid: 0,
            remaining_balance: 0,
            service_session_id: session.id,
            updated_at: now,
          },
          select: { id: true },
        });
        orderId = order.id;
        await tx.service_sessions.updateMany({ where: { id: session.id, store_id: storeId }, data: { order_id: orderId } });
        if (booking) await tx.bookings.updateMany({ where: { id: booking.id, store_id: storeId }, data: { order_id: orderId } });

        if (product) {
          // El servicio entra con SU impuesto (incluido o sumado según se configuró).
          const taxRows = await resolveFullTaxRowsByProductId(tx, [product.id]);
          await tx.order_items.create({
            data: {
              order_id: orderId,
              service_session_id: session.id,
              product_id: product.id,
              product_name: product.name,
              quantity: 1,
              item_type: 'service',
              updated_at: now,
              ...buildTaxedLine(catalogUnitPrice(product), 1, taxRows.get(product.id) ?? []),
            },
          });
          await this.recalcOrderTotals(tx, orderId, now);
        }
      } else {
        const linked = await tx.orders.updateMany({
          where: { id: orderId, store_id: storeId, state: { in: ['draft', 'processing'] }, service_session_id: null },
          data: { service_session_id: session.id, updated_at: now },
        });
        if (linked.count !== 1) throw new VendixHttpException(ErrorCodes.STATION_006);
      }

      // Tie pre-existing booking lines to this service session as well. The
      // composite FK then prevents a line from being attached to another
      // session than its owning order.
      await tx.order_items.updateMany({
        where: { order_id: orderId, service_session_id: null },
        data: { service_session_id: session.id, updated_at: now },
      });

      if (!bookingAllocation) {
        await this.allocationCoordinator.allocateSession(tx, {
          storeId,
          sessionId: session.id,
          stationId,
          providerId,
          startAt,
          endAt: plannedEnd,
        });
      }

      if (booking) {
        const checkedIn = await tx.bookings.updateMany({
          where: { id: booking.id, store_id: storeId, status: { in: ['confirmed', 'arriving', 'in_progress'] } },
          data: { status: 'in_progress', checked_in_at: booking.checked_in_at ?? now, updated_at: now },
        });
        if (checkedIn.count !== 1) throw new VendixHttpException(ErrorCodes.STATION_006);
      }

      if (dto.subject) {
        await tx.service_subjects.create({ data: { store_id: storeId, session_id: session.id, subject_type: dto.subject.subject_type, label: dto.subject.label, metadata: dto.subject.metadata as Prisma.InputJsonValue | undefined } });
      }
        await this.persistIntake(tx, storeId, intake, { service_session_id: session.id, customer_id: customerId, booking_id: booking?.id ?? null, order_id: orderId });
        await this.writeProgress(tx, storeId, session.id, 'opened', userId ?? null, 'Atención iniciada');
        const access = await this.sessionAccess.createAccessToken(tx, storeId, session.id, new Date(Math.max(plannedEnd.getTime() + 24 * 60 * 60 * 1000, Date.now() + 24 * 60 * 60 * 1000)));
        if (contactEmail) {
          await tx.service_session_email_deliveries.create({
            data: { store_id: storeId, session_id: session.id, token_id: access.token_id, idempotency_key: `service-session-token:${access.token_id}`, recipient: contactEmail, status: 'pending' },
          });
        }
        return { id: session.id, order_id: orderId, station_id: stationId, booking_id: booking?.id ?? null, status: 'open', access_token: access.token, access_token_id: access.token_id, access_expires_at: access.expires_at, email_delivery_status: contactEmail ? 'pending' : 'no_email', access_url: null };
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) throw new VendixHttpException(ErrorCodes.STATION_005);
      throw error;
    }

    if (contactEmail) result.email_delivery_status = await this.sendAccessEmail(storeId, result);
    result.access_url = await this.buildAccessUrl(storeId, result.access_token);

    this.emit(storeId, result.id, 'opened', { status: 'open' });
    delete (result as Partial<typeof result>).access_token_id;
    return result;
  }

  /**
   * Formulario de recepción de la atención: el configurado en la estación manda; si la
   * estación no tiene, el vinculado explícitamente al servicio (sin fallback a la default).
   */
  private async resolveIntakeTemplate(productId: number, stationId?: number | null): Promise<IntakeTemplate | null> {
    const { storeId } = this.requireContext();
    if (stationId) {
      const station = await this.prisma.service_stations.findFirst({
        where: { id: stationId, store_id: storeId },
        select: { intake_template_id: true },
      });
      if (station?.intake_template_id) {
        const template = await this.templates.getActiveTemplateById(station.intake_template_id);
        if (template) return template as unknown as IntakeTemplate;
      }
    }
    return (await this.templates.getLinkedTemplateForProduct(productId)) as IntakeTemplate | null;
  }

  async getIntakeTemplate(productId: number, stationId?: number) {
    this.requireContext();
    return { template: await this.resolveIntakeTemplate(productId, stationId) };
  }

  /** Valores actuales del perfil del cliente para los campos `customer` del formulario de recepción. */
  async getIntakePrefill(productId: number, customerId: number, stationId?: number) {
    const { storeId } = this.requireContext();
    const template = await this.resolveIntakeTemplate(productId, stationId);
    if (!template) return { values: [] };
    const customerFields = this.collectIntakeItems(template)
      .map((item) => item.metadata_field)
      .filter((field) => field.entity_type === 'customer' && field.store_id === storeId);
    if (!customerFields.length) return { values: [] };
    const fieldById = new Map(customerFields.map((field) => [field.id, field]));
    const rows = await this.prisma.entity_metadata_values.findMany({
      where: { store_id: storeId, entity_type: 'customer', entity_id: customerId, field_id: { in: [...fieldById.keys()] } },
      select: { field_id: true, entity_type: true, value_text: true, value_number: true, value_date: true, value_bool: true, value_json: true },
    });
    return {
      values: rows.map((row) => ({ field_id: row.field_id, value: this.readStoredValue(fieldById.get(row.field_id)!.field_type, row) })),
    };
  }

  private collectIntakeItems(template: IntakeTemplate): IntakeItem[] {
    const items: IntakeItem[] = [];
    const walk = (sections?: IntakeSection[]) => {
      for (const section of sections ?? []) {
        items.push(...(section.items ?? []));
        walk(section.child_sections);
      }
    };
    for (const tab of template.tabs ?? []) walk(tab.sections);
    walk(template.sections);
    return items;
  }

  /**
   * Valida `intake_values` contra la plantilla vinculada y los convierte a columnas de
   * entity_metadata_values con el mismo mapeo por field_type del formulario de recolección
   * (number→value_number, checkbox→value_bool, date→value_date, resto→value_text).
   */
  private async prepareIntake(
    productId: number,
    stationId: number,
    values: ServiceIntakeValueDto[] | undefined,
    options: { enforceRequired: boolean; customerId: number | null; bookingId: number | null },
  ): Promise<PreparedIntake> {
    const { storeId } = this.requireContext();
    const submitted = values ?? [];
    const template = await this.resolveIntakeTemplate(productId, stationId);
    if (!template) {
      if (submitted.length) {
        throw new VendixHttpException(ErrorCodes.STATION_013, 'Este servicio no tiene campos de recepción configurados.');
      }
      return null;
    }
    const items = this.collectIntakeItems(template).filter((item) => item.metadata_field?.is_active !== false && item.metadata_field?.store_id === storeId);
    const itemByField = new Map(items.map((item) => [item.metadata_field_id, item]));
    const valueByField = new Map<number, ServiceIntakeValueDto['value']>();
    for (const entry of submitted) {
      if (!itemByField.has(entry.field_id)) {
        throw new VendixHttpException(ErrorCodes.STATION_013, 'La atención incluye campos que no están configurados para el servicio.');
      }
      if (valueByField.has(entry.field_id)) {
        throw new VendixHttpException(ErrorCodes.STATION_013, `El campo "${itemByField.get(entry.field_id)!.metadata_field.label}" está repetido.`);
      }
      valueByField.set(entry.field_id, entry.value ?? null);
    }

    const entries: Array<{ field: IntakeField; columns: IntakeValueColumns }> = [];
    const missingRequired: IntakeItem[] = [];
    for (const item of items) {
      const field = item.metadata_field;
      const columns = this.toValueColumns(field, valueByField.get(field.id));
      if (columns) entries.push({ field, columns });
      // Una casilla obligatoria sin marcar se trata como no respondida.
      const answered = columns !== null && columns.value_bool !== false;
      if (!answered && item.is_required && options.enforceRequired) missingRequired.push(item);
    }

    if (missingRequired.length) {
      // Un campo de cliente/reserva obligatorio ya guardado en el perfil cuenta como respondido.
      const storedRows = await this.findStoredValues(storeId, missingRequired.map((item) => item.metadata_field), {
        customer_id: options.customerId,
        booking_id: options.bookingId,
      });
      const answered = new Set(storedRows.filter((row) => ![null, false].includes(this.readStoredValue(itemByField.get(row.field_id)!.metadata_field.field_type, row) as null | false)).map((row) => row.field_id));
      const firstMissing = missingRequired.find((item) => !answered.has(item.metadata_field_id));
      if (firstMissing) {
        throw new VendixHttpException(ErrorCodes.STATION_007, `El campo "${firstMissing.metadata_field.label}" es obligatorio para este servicio.`);
      }
    }
    return { templateId: template.id, entries };
  }

  private toValueColumns(field: IntakeField, raw: ServiceIntakeValueDto['value'] | undefined): IntakeValueColumns | null {
    const empty: IntakeValueColumns = { value_text: null, value_number: null, value_date: null, value_bool: null };
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'string' && !raw.trim()) return null;
    switch (field.field_type) {
      case 'number': {
        const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim());
        if (typeof raw === 'boolean' || !Number.isFinite(parsed)) {
          throw new VendixHttpException(ErrorCodes.STATION_013, `El campo "${field.label}" debe ser numérico.`);
        }
        return { ...empty, value_number: parsed };
      }
      case 'checkbox': {
        if (raw === true || raw === 'true') return { ...empty, value_bool: true };
        if (raw === false || raw === 'false') return { ...empty, value_bool: false };
        throw new VendixHttpException(ErrorCodes.STATION_013, `El campo "${field.label}" debe ser verdadero o falso.`);
      }
      case 'date': {
        const date = typeof raw === 'string' ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? `${raw.trim()}T00:00:00.000Z` : raw.trim()) : null;
        if (!date || Number.isNaN(date.getTime())) {
          throw new VendixHttpException(ErrorCodes.STATION_013, `El campo "${field.label}" debe ser una fecha válida.`);
        }
        return { ...empty, value_date: date };
      }
      default:
        return { ...empty, value_text: String(raw).trim() };
    }
  }

  private async persistIntake(tx: Prisma.TransactionClient, storeId: number, intake: PreparedIntake, ctx: EntityContext) {
    if (!intake) return;
    const now = new Date();
    for (const { field, columns } of intake.entries) {
      const entityId = resolveEntityId(field.entity_type, ctx);
      if (!entityId) {
        this.logger.warn(`Intake field ${field.id} (${field.entity_type}) skipped: no entity in session ${ctx.service_session_id}`);
        continue;
      }
      const entityType = field.entity_type as entity_type_enum;
      // tx no aplica scope: el campo ya se validó contra la plantilla de esta tienda y
      // store_id se fija explícitamente al crear.
      await tx.entity_metadata_values.upsert({
        where: { field_id_entity_type_entity_id: { field_id: field.id, entity_type: entityType, entity_id: entityId } },
        create: { store_id: storeId, field_id: field.id, entity_type: entityType, entity_id: entityId, ...columns },
        update: { ...columns, updated_at: now },
      });
    }
  }

  private async findStoredValues(storeId: number, fields: IntakeField[], ctx: EntityContext): Promise<StoredMetadataValue[]> {
    const queries = buildEntityQueries(ctx);
    if (!queries.length || !fields.length) return [];
    return this.prisma.entity_metadata_values.findMany({
      where: {
        store_id: storeId,
        field_id: { in: fields.map((field) => field.id) },
        OR: queries.map((q) => ({ entity_type: q.entityType as entity_type_enum, entity_id: q.entityId })),
      },
      select: { field_id: true, entity_type: true, value_text: true, value_number: true, value_date: true, value_bool: true, value_json: true },
    });
  }

  private readStoredValue(fieldType: string, row: StoredMetadataValue): unknown {
    switch (fieldType) {
      case 'number':
        return row.value_number !== null ? Number(row.value_number) : null;
      case 'checkbox':
        return row.value_bool;
      case 'date':
        return row.value_date ? row.value_date.toISOString().slice(0, 10) : null;
      default:
        return row.value_text ?? (row.value_json as unknown) ?? null;
    }
  }

  private async buildIntakeSummary(session: { id: number; station_id: number; product_id: number; booking_id: number | null; order_id: number | null }, customerId: number | null) {
    const { storeId } = this.requireContext();
    const template = await this.resolveIntakeTemplate(session.product_id, session.station_id);
    if (!template) return null;
    const fields = this.collectIntakeItems(template).map((item) => item.metadata_field).filter((field) => field.store_id === storeId);
    const ctx: EntityContext = { service_session_id: session.id, customer_id: customerId, booking_id: session.booking_id, order_id: session.order_id };
    const rows = await this.findStoredValues(storeId, fields, ctx);
    return {
      template_id: template.id,
      template_name: template.name,
      answers: fields.map((field) => {
        const entityId = resolveEntityId(field.entity_type, ctx);
        const row = entityId ? rows.find((r) => r.field_id === field.id && r.entity_type === field.entity_type) : undefined;
        return { field_id: field.id, label: field.label, field_type: field.field_type, entity_type: field.entity_type, value: row ? this.readStoredValue(field.field_type, row) : null };
      }),
    };
  }

  private async buildAccessUrl(storeId: number, token: string): Promise<string | null> {
    try {
      const domain = await this.prisma.domain_settings.findFirst({
        where: { store_id: storeId, app_type: 'STORE_ECOMMERCE', status: 'active' },
        select: { hostname: true },
      }) ?? await this.prisma.domain_settings.findFirst({
        where: { store_id: storeId, is_primary: true, status: 'active' },
        select: { hostname: true },
      });
      return domain?.hostname ? `https://${domain.hostname}/seguimiento-servicio/${encodeURIComponent(token)}` : null;
    } catch {
      return null;
    }
  }

  private async sendAccessEmail(storeId: number, issued: { id: number; access_token_id: number; access_token: string }): Promise<string> {
    try {
      return await this.sendAccessEmailAttempt(storeId, issued);
    } catch (error) {
      // Opening an attention must remain successful if the mail provider or
      // delivery bookkeeping is unavailable after the session transaction.
      try {
        await this.prisma.service_session_email_deliveries.updateMany({
          where: { store_id: storeId, session_id: issued.id, token_id: issued.access_token_id, status: { in: ['pending', 'sending'] } },
          data: {
            status: 'failed',
            last_error: (error instanceof Error ? error.message : 'Email delivery failed').slice(0, 500),
            updated_at: new Date(),
          },
        });
      } catch {
        this.logger.error(`Failed to persist service-session email failure state (store ${storeId}, session ${issued.id}); token and recipient omitted.`);
      }
      return 'failed';
    }
  }

  private async sendAccessEmailAttempt(storeId: number, issued: { id: number; access_token_id: number; access_token: string }): Promise<string> {
    const claimed = await this.prisma.service_session_email_deliveries.updateMany({
      where: { store_id: storeId, session_id: issued.id, token_id: issued.access_token_id, status: 'pending' },
      data: { status: 'sending', attempt_count: { increment: 1 }, updated_at: new Date() },
    });
    if (claimed.count !== 1) return 'already_attempted';
    const delivery = await this.prisma.service_session_email_deliveries.findFirst({
      where: { store_id: storeId, session_id: issued.id, token_id: issued.access_token_id },
      select: { id: true, recipient: true },
    });
    if (!delivery) return 'failed';
    const url = await this.buildAccessUrl(storeId, issued.access_token);
    if (!url) {
      await this.prisma.service_session_email_deliveries.updateMany({ where: { id: delivery.id, store_id: storeId }, data: { status: 'failed', last_error: 'No active ecommerce domain', updated_at: new Date() } });
      return 'failed';
    }
    const store = await this.prisma.stores.findFirst({ where: { id: storeId }, select: { name: true } });
    const name = store?.name || 'el servicio técnico';
    const safeName = name.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
    let result: Awaited<ReturnType<EmailService['sendEmail']>>;
    try {
      result = await this.email.sendEmail(
      delivery.recipient,
      `Seguimiento de tu servicio en ${name}`,
      `<p>Tu atención en <strong>${safeName}</strong> ya está en curso.</p><p><a href="${url}">Consultar progreso y aprobar cambios</a></p><p>Este enlace es privado y temporal. No lo compartas con otras personas.</p>`,
      `Tu atención en ${name} ya está en curso. Consulta el progreso y aprueba cambios en: ${url}\nEste enlace es privado y temporal.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Email provider failed';
      this.logger.warn(`Service-session email delivery failed (store ${storeId}, session ${issued.id}); token and recipient omitted.`);
      await this.prisma.service_session_email_deliveries.updateMany({ where: { id: delivery.id, store_id: storeId, status: 'sending' }, data: { status: 'failed', last_error: message.slice(0, 500), updated_at: new Date() } });
      return 'failed';
    }
    if (!result.success) this.logger.warn(`Service-session email provider returned failure (store ${storeId}, session ${issued.id}); token and recipient omitted.`);
    await this.prisma.service_session_email_deliveries.updateMany({
      where: { id: delivery.id, store_id: storeId, status: 'sending' },
      data: { status: result.success ? 'sent' : 'failed', provider_message_id: result.messageId ?? null, last_error: result.success ? null : (result.error || 'Email provider failed').slice(0, 500), sent_at: result.success ? new Date() : null, updated_at: new Date() },
    });
    return result.success ? 'sent' : 'failed';
  }

  async reissueAccessLink(id: number, dto: ReissueServiceSessionLinkDto) {
    const { storeId, userId } = this.requireContext();
    if (dto.identity_verified !== true) throw new VendixHttpException(ErrorCodes.STATION_009, 'Confirma la verificación de identidad antes de reemitir.');
    const session = await this.findOne(id);
    if (!ACTIVE_SESSION_STATUSES.includes(session.status) || !session.contact_email) {
      throw new VendixHttpException(ErrorCodes.STATION_006, 'La atención debe estar activa y tener email de contacto guardado.');
    }
    const existing = await this.prisma.service_session_email_deliveries.findFirst({
      where: { store_id: storeId, session_id: id, idempotency_key: dto.idempotency_key },
      select: { status: true },
    });
    if (existing) return { id, email_delivery_status: existing.status, idempotent_replay: true };

    const allocation = await this.prisma.service_allocations.findFirst({
      where: { store_id: storeId, session_id: id, state: 'in_service' },
      select: { end_at: true },
    });
    const expiresAt = new Date(Math.max((allocation?.end_at?.getTime() ?? Date.now()) + 24 * 60 * 60 * 1000, Date.now() + 24 * 60 * 60 * 1000));
    let issued!: { token: string; token_id: number };
    try {
      await this.prisma.$transaction(async (tx) => {
        const access = await this.sessionAccess.createAccessToken(tx, storeId, id, expiresAt);
        issued = { token: access.token, token_id: access.token_id };
        await tx.service_session_email_deliveries.create({
          data: {
            store_id: storeId,
            session_id: id,
            token_id: access.token_id,
            idempotency_key: dto.idempotency_key,
            recipient: session.contact_email!,
            status: 'pending',
          },
        });
        const proof = { verification_method: dto.verification_method, verification_note: dto.verification_note.trim(), verified_by: userId ?? null, token_id: access.token_id } as Prisma.InputJsonValue;
        await tx.service_progress_events.create({
          data: { store_id: storeId, session_id: id, event_type: 'access_link_reissued', actor_user_id: userId ?? null, public_text: null, order_event_id: null, metadata: proof },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        const replay = await this.prisma.service_session_email_deliveries.findFirst({
          where: { store_id: storeId, session_id: id, idempotency_key: dto.idempotency_key },
          select: { status: true },
        });
        if (replay) return { id, email_delivery_status: replay.status, idempotent_replay: true };
      }
      throw error;
    }
    const emailStatus = await this.sendAccessEmail(storeId, { id, access_token_id: issued.token_id, access_token: issued.token });
    return { id, access_token: issued.token, access_url: await this.buildAccessUrl(storeId, issued.token), access_expires_at: expiresAt, email_delivery_status: emailStatus, idempotent_replay: false };
  }


  async transition(id: number, dto: ServiceSessionTransitionDto) {
    const { storeId, userId } = this.requireContext();
    const existing = await this.findOne(id);
    if (dto.action === 'change_provider') return this.changeProvider(id, dto.provider_id);
    const terminal = ['close', 'cancel', 'no_show'].includes(dto.action);
    const nextStatus = dto.action === 'pause' ? 'paused' : dto.action === 'resume' ? 'open' : dto.action === 'close' ? 'closed' : dto.action === 'cancel' ? 'cancelled' : 'no_show';
    const allowed = dto.action === 'pause' ? existing.status === 'open'
      : dto.action === 'resume' ? existing.status === 'paused'
      : terminal && ACTIVE_SESSION_STATUSES.includes(existing.status);
    if (!allowed) throw new VendixHttpException(ErrorCodes.STATION_006);

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.service_sessions.updateMany({
        where: { id, store_id: storeId, status: existing.status },
        data: { status: nextStatus, closed_at: terminal ? new Date() : null, updated_at: new Date() },
      });
      if (claimed.count !== 1) throw new VendixHttpException(ErrorCodes.STATION_006);
      if (terminal) {
        await tx.service_allocations.updateMany({ where: { store_id: storeId, session_id: id, state: { in: ACTIVE_ALLOCATIONS } }, data: { state: dto.action === 'cancel' ? 'cancelled' : 'released', expires_at: null, updated_at: new Date() } });
        await tx.service_session_tokens.updateMany({ where: { store_id: storeId, session_id: id, revoked_at: null }, data: { revoked_at: new Date() } });
        if (dto.action === 'close' && existing.order_id) {
          await this.ensureChargeBudget(tx, storeId, id, existing.order_id);
        }
        if (existing.booking_id) {
          const bookingStatus = dto.action === 'no_show' ? 'no_show' : dto.action === 'cancel' ? 'cancelled' : 'completed';
          await tx.bookings.updateMany({ where: { id: existing.booking_id, store_id: storeId, status: { in: ['confirmed', 'arriving', 'in_progress', 'attending'] } }, data: { status: bookingStatus, updated_at: new Date() } });
        }
      }
      const eventType = dto.action === 'close' ? 'closed' : dto.action === 'cancel' ? 'cancelled' : dto.action === 'no_show' ? 'no_show' : dto.action === 'pause' ? 'paused' : 'resumed';
      await this.writeProgress(tx, storeId, id, eventType, userId ?? null, dto.public_text ?? null);
      return { id, status: nextStatus, closed_at: terminal ? new Date() : null };
    });
    this.emit(storeId, id, dto.action === 'resume' ? 'resumed' : dto.action === 'pause' ? 'paused' : nextStatus, { status: nextStatus });
    return updated;
  }

  /**
   * El cobro (`flow/pay`) exige un presupuesto vigente que cubra el total. Una atención
   * sin presupuesto pactado (walk-in sin tope) recibe como base el total de su cuenta:
   * no hay un tope del cliente que respetar. Un presupuesto existente NUNCA se sube aquí,
   * porque es el límite que el cliente autorizó; devuelve si cubre o no el total.
   */
  private async ensureChargeBudget(tx: Prisma.TransactionClient, storeId: number, sessionId: number, orderId: number) {
    const [order, budget] = await Promise.all([
      tx.orders.findFirst({ where: { id: orderId, store_id: storeId }, select: { grand_total: true, tip_amount: true, currency: true } }),
      tx.service_budgets.findFirst({ where: { store_id: storeId, session_id: sessionId }, orderBy: { version: 'desc' }, select: { amount: true, currency: true } }),
    ]);
    if (!order) return { covered: false };
    const authorized = new Prisma.Decimal(order.grand_total).minus(order.tip_amount ?? 0);
    if (!budget) {
      await tx.service_budgets.create({
        data: { store_id: storeId, session_id: sessionId, version: 1, amount: authorized, currency: order.currency ?? 'COP', approved_at: null },
      });
      return { covered: true };
    }
    return { covered: budget.currency === order.currency && !authorized.greaterThan(budget.amount) };
  }

  /** Deja la cuenta lista para "Registrar pago" sin cerrar la atención. */
  async prepareCharge(id: number) {
    const { storeId } = this.requireContext();
    const session = await this.findOne(id);
    if (!session.order_id) throw new VendixHttpException(ErrorCodes.STATION_006, 'La atención aún no tiene cuenta para cobrar.');
    const { covered } = await this.prisma.$transaction((tx) => this.ensureChargeBudget(tx, storeId, id, session.order_id!));
    if (!covered) {
      throw new VendixHttpException(
        ErrorCodes.SERVICE_BUDGET_001,
        'El total de la cuenta supera el presupuesto que autorizó el cliente. Ajusta el presupuesto antes de cobrar.',
        { session_id: id, order_id: session.order_id },
      );
    }
    return { order_id: session.order_id };
  }

  private async changeProvider(id: number, providerId?: number) {
    const { storeId, userId } = this.requireContext();
    if (!providerId) throw new VendixHttpException(ErrorCodes.STATION_001, 'Selecciona un proveedor.');
    const session = await this.findOne(id);
    if (!ACTIVE_SESSION_STATUSES.includes(session.status)) throw new VendixHttpException(ErrorCodes.STATION_006);
    const allocation = await this.prisma.service_allocations.findFirst({ where: { store_id: storeId, session_id: id, state: 'in_service' } });
    if (!allocation) throw new VendixHttpException(ErrorCodes.STATION_006);
    const timezone = await resolveStoreTimezone(this.prisma, storeId);
    const [compatible, activeProvider, schedule, exceptionRows] = await Promise.all([
      this.prisma.service_station_providers.findFirst({ where: { store_id: storeId, station_id: allocation.station_id, provider_id: providerId } }),
      this.prisma.service_providers.findFirst({ where: { id: providerId, store_id: storeId, is_active: true } }),
      this.prisma.provider_schedules.findMany({ where: { provider_id: providerId, is_active: true }, select: { day_of_week: true, start_time: true, end_time: true } }),
      this.prisma.provider_exceptions.findMany({ where: { provider_id: providerId }, select: { date: true, is_unavailable: true, custom_start_time: true, custom_end_time: true } }),
    ]);
    const serviceCompatibility = await this.prisma.provider_services.findFirst({ where: { provider_id: providerId, product_id: session.product_id } });
    const localParts = (date: Date) => {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
      return Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>;
    };
    const localNow = localParts(new Date());
    const localEnd = localParts(new Date(allocation.end_at));
    const localDate = `${localNow.year}-${localNow.month}-${localNow.day}`;
    const exception = exceptionRows.find((row) => row.date.toISOString().slice(0, 10) === localDate);
    const weekday = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
    const providerWindows = exception?.custom_start_time && exception.custom_end_time
      ? [{ start_time: exception.custom_start_time, end_time: exception.custom_end_time }]
      : schedule.filter((window) => window.day_of_week === weekday);
    const nowMinutes = Number(localNow.hour) * 60 + Number(localNow.minute);
    const endMinutes = Number(localEnd.hour) * 60 + Number(localEnd.minute);
    const insideSchedule = localEnd.year === localNow.year && localEnd.month === localNow.month && localEnd.day === localNow.day && providerWindows.some((window) => {
      const [startHour, startMinute] = window.start_time.split(':').map(Number);
      const [endHour, endMinute] = window.end_time.split(':').map(Number);
      return nowMinutes >= startHour * 60 + startMinute && endMinutes <= endHour * 60 + endMinute;
    });
    if (!compatible || !activeProvider || !serviceCompatibility || exception?.is_unavailable || !insideSchedule) {
      throw new VendixHttpException(ErrorCodes.STATION_001, 'El proveedor no está habilitado para este servicio y horario.');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      try {
        const updated = await tx.service_allocations.updateMany({
          where: { id: allocation.id, store_id: storeId, session_id: id, provider_id: allocation.provider_id },
          data: { provider_id: providerId, updated_at: new Date() },
        });
        if (updated.count !== 1) throw new VendixHttpException(ErrorCodes.STATION_006);
        if (session.booking_id) {
          await tx.bookings.updateMany({ where: { id: session.booking_id, store_id: storeId }, data: { provider_id: providerId, updated_at: new Date() } });
        }
      } catch (error) {
        if (this.isExclusionConflict(error)) throw new VendixHttpException(ErrorCodes.STATION_003);
        throw error;
      }
      await this.writeProgress(tx, storeId, id, 'provider_changed', userId ?? null, 'Proveedor de atención actualizado');
      return { id, provider_id: providerId };
    });
    this.emit(storeId, id, 'provider_changed', result);
    return result;
  }

  async extend(id: number, plannedEndAt: Date) {
    const { storeId, userId } = this.requireContext();
    const session = await this.findOne(id);
    if (!ACTIVE_SESSION_STATUSES.includes(session.status) || Number.isNaN(plannedEndAt.getTime())) throw new VendixHttpException(ErrorCodes.STATION_006);
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.service_sessions.updateMany({
        where: { id, store_id: storeId, status: { in: ACTIVE_SESSION_STATUSES } },
        data: { updated_at: now },
      });
      if (claimed.count !== 1) throw new VendixHttpException(ErrorCodes.STATION_006);
      const allocation = await tx.service_allocations.findFirst({ where: { store_id: storeId, session_id: id, state: 'in_service' } });
      if (!allocation || plannedEndAt <= allocation.end_at || plannedEndAt <= now) throw new VendixHttpException(ErrorCodes.STATION_009);
      const conflict = await tx.service_allocations.findFirst({
        where: { store_id: storeId, id: { not: allocation.id }, state: { in: ACTIVE_ALLOCATIONS }, start_at: { lt: plannedEndAt }, end_at: { gt: allocation.start_at }, OR: [{ station_id: allocation.station_id }, ...(allocation.provider_id ? [{ provider_id: allocation.provider_id }] : [])] },
        select: { id: true },
      });
      if (conflict) throw new VendixHttpException(allocation.provider_id ? ErrorCodes.STATION_003 : ErrorCodes.STATION_002);
      try {
        await tx.service_allocations.updateMany({ where: { id: allocation.id, store_id: storeId, session_id: id }, data: { end_at: plannedEndAt, updated_at: now } });
      } catch (error) {
        if (this.isExclusionConflict(error)) throw new VendixHttpException(ErrorCodes.STATION_008);
        throw error;
      }
      await tx.service_session_tokens.updateMany({
        where: { store_id: storeId, session_id: id, revoked_at: null, expires_at: { gt: now } },
        data: { expires_at: new Date(plannedEndAt.getTime() + 24 * 60 * 60 * 1000) },
      });
      await this.writeProgress(tx, storeId, id, 'extended', userId ?? null, 'Tiempo de atención extendido');
      return { id, planned_end_at: plannedEndAt };
    });
    this.emit(storeId, id, 'extended', result);
    return result;
  }

  async findOne(id: number) {
    const { storeId } = this.requireContext();
    const session = await this.prisma.service_sessions.findFirst({
      where: { id, store_id: storeId },
    });
    if (!session) throw new VendixHttpException(ErrorCodes.STATION_006);
    const [subjects, allocations, recentEvents, order] = await Promise.all([
      this.prisma.service_subjects.findMany({ where: { store_id: storeId, session_id: id }, orderBy: { created_at: 'asc' } }),
      this.prisma.service_allocations.findMany({ where: { store_id: storeId, session_id: id }, orderBy: { created_at: 'asc' } }),
      this.prisma.service_progress_events.findMany({
        where: { store_id: storeId, session_id: id },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: 101,
      }),
      session.order_id
        ? this.prisma.orders.findFirst({
            where: { id: session.order_id, store_id: storeId },
            include: {
              order_items: {
                orderBy: { id: 'asc' },
              },
              users: {
                select: { id: true, first_name: true, last_name: true, email: true, phone: true, document_number: true },
              },
            },
          })
        : null,
    ]);
    const eventsHaveOlder = recentEvents.length > 100;
    const progressEvents = recentEvents.slice(0, 100).reverse();
    const normalizedOrder = order
      ? (({ users, ...orderData }) => ({
          ...orderData,
          customer: users
            ? (({ document_number, ...customer }) => ({ ...customer, identification_number: document_number }))(users)
            : null,
        }))(order)
      : null;
    const intake = await this.buildIntakeSummary(session, order?.customer_id ?? null);
    return { ...session, subjects, allocations, progress_events: progressEvents, events_have_older: eventsHaveOlder, order: normalizedOrder, intake };
  }

  async listActive(cursor?: number) {
    const { storeId } = this.requireContext();
    const page = await this.prisma.service_sessions.findMany({
      where: {
        store_id: storeId,
        status: { in: ACTIVE_SESSION_STATUSES as any },
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: 101,
    });
    const hasMore = page.length > 100;
    const sessions = page.slice(0, 100);
    if (!sessions.length) return { items: [], next_cursor: null };
    const ids = sessions.map((session) => session.id);
    const stationIds = [...new Set(sessions.map((session) => session.station_id))];
    const productIds = [...new Set(sessions.map((session) => session.product_id))];
    const [stations, products, subjects, allocations, orders] = await Promise.all([
      this.prisma.service_stations.findMany({ where: { store_id: storeId, id: { in: stationIds } }, select: { id: true, name: true } }),
      this.prisma.products.findMany({ where: { store_id: storeId, id: { in: productIds } }, select: { id: true, name: true } }),
      this.prisma.service_subjects.findMany({ where: { store_id: storeId, session_id: { in: ids } }, orderBy: { created_at: 'asc' } }),
      this.prisma.service_allocations.findMany({ where: { store_id: storeId, session_id: { in: ids }, state: { in: ACTIVE_ALLOCATIONS } }, orderBy: { created_at: 'desc' } }),
      this.prisma.orders.findMany({
        where: { store_id: storeId, service_session_id: { in: ids } },
        select: { id: true, service_session_id: true, order_number: true, grand_total: true, subtotal_amount: true, remaining_balance: true },
      }),
    ]);
    const stationById = new Map(stations.map((row) => [row.id, row.name]));
    const productById = new Map(products.map((row) => [row.id, row.name]));
    const orderBySessionId = new Map<number | null, (typeof orders)[number]>(orders.map((o) => [o.service_session_id, o]));
    const items = sessions.map((session) => {
      const ord = orderBySessionId.get(session.id);
      return {
        ...session,
        station_name: stationById.get(session.station_id) ?? 'Estación',
        product_name: productById.get(session.product_id) ?? 'Servicio',
        subject: subjects.find((row) => row.session_id === session.id) ?? null,
        allocation: allocations.find((row) => row.session_id === session.id) ?? null,
        order: ord
          ? {
              id: ord.id,
              order_number: ord.order_number,
              grand_total: Number(ord.grand_total),
              subtotal_amount: Number(ord.subtotal_amount),
              remaining_balance: Number(ord.remaining_balance),
            }
          : null,
      };
    });
    return { items, next_cursor: hasMore ? sessions[sessions.length - 1].id : null };
  }

  async addItem(sessionId: number, dto: AddSessionItemDto) {
    const result = await this.addItems(sessionId, [dto]);
    return { item: result.items[0], order_id: result.order_id, grand_total: result.grand_total };
  }

  /** Carga varias líneas a la cuenta de la atención en UNA transacción (botón "Cargar a estación" del POS). */
  async addItemsBulk(sessionId: number, items: AddSessionItemDto[]) {
    return this.addItems(sessionId, items);
  }

  private async addItems(sessionId: number, dtos: AddSessionItemDto[]) {
    const { storeId, userId } = this.requireContext();
    const found = await this.prisma.service_sessions.findFirst({
      where: { id: sessionId, store_id: storeId },
      select: { id: true, status: true, order_id: true },
    });
    if (!found || !ITEM_SESSION_STATUSES.includes(found.status)) {
      throw new VendixHttpException(ErrorCodes.STATION_006, 'La atención no está activa.');
    }
    const session = { id: found.id, order_id: found.order_id };
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const items: order_items[] = [];
      for (const dto of dtos) {
        items.push(await this.addItemTx(tx, storeId, userId ?? null, session, dto, now));
      }
      const orderId = session.order_id!;
      const totals = await this.recalcOrderTotals(tx, orderId, now);
      return { order_id: orderId, grand_total: totals.grand_total, items };
    });

    this.emit(storeId, sessionId, 'item_added', { order_id: result.order_id, grand_total: result.grand_total, items_count: result.items.length });
    return result;
  }

  /**
   * Agrega una línea dentro de una transacción abierta. Crea la orden SVC-{id} si la
   * atención aún no tiene una (muta `session.order_id`). No recalcula totales: lo hace el llamador.
   */
  private async addItemTx(
    tx: Prisma.TransactionClient,
    storeId: number,
    userId: number | null,
    session: { id: number; order_id: number | null },
    dto: AddSessionItemDto,
    now: Date,
  ) {
    const product = await tx.products.findFirst({
      where: { id: dto.product_id, store_id: storeId },
    });
    if (!product) {
      throw new VendixHttpException(ErrorCodes.PROD_FIND_001, 'Producto no encontrado.');
    }
    const qty = Math.max(1, Number(dto.quantity || 1));
    // Variante: debe ser del producto, y un producto con variantes exige elegir una.
    const variant = dto.product_variant_id
      ? await tx.product_variants.findFirst({
          where: { id: dto.product_variant_id, product_id: product.id },
          select: { id: true, name: true, sku: true, price_override: true, is_on_sale: true, sale_price: true, track_inventory_override: true },
        })
      : null;
    if (dto.product_variant_id && !variant) {
      throw new VendixHttpException(ErrorCodes.PRODUCT_VARIANT_MISMATCH, 'La variante no pertenece al producto.');
    }
    if (!variant && (await tx.product_variants.count({ where: { product_id: product.id } })) > 0) {
      throw new VendixHttpException(ErrorCodes.PRODUCT_VARIANT_MISMATCH, `Elige la variante de ${product.name}.`);
    }
    // Un precio escrito a mano se trata como el precio publicado del producto: el
    // impuesto se despeja o se suma según la configuración de ESE producto.
    const unitPrice = dto.unit_price != null ? Number(dto.unit_price) : catalogUnitPrice(product, variant);
    const lineName = variant ? `${product.name} - ${variant.name || variant.sku}` : product.name;
    const tracksInventory = variant?.track_inventory_override ?? product.track_inventory;
    const taxRows = await resolveFullTaxRowsByProductId(tx, [product.id]);

    if (!session.order_id) {
      const newOrder = await tx.orders.create({
        data: {
          store_id: storeId,
          created_by_user_id: userId,
          order_number: `SVC-${session.id}`,
          state: 'draft',
          channel: 'pos',
          delivery_type: 'direct_delivery',
          currency: 'COP',
          subtotal_amount: 0,
          tax_amount: 0,
          shipping_cost: 0,
          discount_amount: 0,
          grand_total: 0,
          total_paid: 0,
          remaining_balance: 0,
          service_session_id: session.id,
          updated_at: now,
        },
        select: { id: true },
      });
      session.order_id = newOrder.id;
      await tx.service_sessions.updateMany({ where: { id: session.id, store_id: storeId }, data: { order_id: newOrder.id } });
    }
    const orderId = session.order_id;

    if (tracksInventory && product.product_type === 'physical') {
      const stockLevel = await tx.stock_levels.findFirst({
        where: { product_id: product.id, product_variant_id: variant?.id ?? null },
        orderBy: { quantity_available: 'desc' },
      });
      if (stockLevel && stockLevel.quantity_available < qty) {
        throw new VendixHttpException(ErrorCodes.INV_STOCK_INSUFFICIENT_LINES, `Stock insuficiente para ${lineName}`);
      }
      if (stockLevel) {
        const store = await tx.stores.findUnique({ where: { id: storeId }, select: { organization_id: true } });
        if (store?.organization_id) {
          await tx.stock_reservations.create({
            data: {
              organization_id: store.organization_id,
              product_id: product.id,
              product_variant_id: variant?.id ?? null,
              location_id: stockLevel.location_id,
              quantity: qty,
              reserved_for_type: 'order',
              reserved_for_id: orderId,
              status: 'active',
            },
          });
          await tx.stock_levels.update({
            where: { id: stockLevel.id },
            data: {
              quantity_reserved: { increment: qty },
              quantity_available: { decrement: qty },
              updated_at: now,
            },
          });
        }
      }
    }

    const item = await tx.order_items.create({
      data: {
        order_id: orderId,
        service_session_id: session.id,
        product_id: product.id,
        product_variant_id: variant?.id ?? null,
        product_name: lineName,
        description: dto.description || null,
        quantity: qty,
        item_type: product.product_type === 'physical' ? 'physical' : 'service',
        is_price_overridden: dto.unit_price != null,
        updated_at: now,
        ...buildTaxedLine(unitPrice, qty, taxRows.get(product.id) ?? []),
      },
    });

    await this.writeProgress(tx, storeId, session.id, 'item_added', userId, `Se agregó ${qty}x ${lineName} a la cuenta`);
    return item;
  }

  /**
   * Totales de la cuenta SVC con el mismo criterio que la cuenta de mesa:
   * subtotal = suma de bases, IVA = suma de `order_item_taxes` (o `tax_amount_item`
   * por unidad si la línea no tiene desglose), total = subtotal + IVA.
   */
  private async recalcOrderTotals(tx: Prisma.TransactionClient, orderId: number, now: Date) {
    const [items, order] = await Promise.all([
      tx.order_items.findMany({
        where: { order_id: orderId, cancelled_at: null },
        select: {
          total_price: true,
          tax_amount_item: true,
          quantity: true,
          weight: true,
          price_unit_quantity: true,
          order_item_taxes: { select: { tax_amount: true } },
        },
      }),
      tx.orders.findUnique({ where: { id: orderId }, select: { total_paid: true } }),
    ]);
    const subtotal = roundMoney2(items.reduce((acc, it) => acc + Number(it.total_price), 0));
    const tax = roundMoney2(items.reduce((acc, it) => {
      if (it.order_item_taxes.length > 0) {
        return acc + it.order_item_taxes.reduce((sum, t) => sum + Number(t.tax_amount || 0), 0);
      }
      const units = resolveLineUnits({ quantity: it.quantity, weight: it.weight, price_unit_quantity: it.price_unit_quantity });
      return acc + Number(it.tax_amount_item ?? 0) * units;
    }, 0));
    const grandTotal = roundMoney2(subtotal + tax);
    const remaining = roundMoney2(Math.max(0, grandTotal - Number(order?.total_paid ?? 0)));
    await tx.orders.update({
      where: { id: orderId },
      data: { subtotal_amount: subtotal, tax_amount: tax, grand_total: grandTotal, remaining_balance: remaining, updated_at: now },
    });
    return { subtotal, tax_amount: tax, grand_total: grandTotal };
  }

  async removeItem(sessionId: number, itemId: number) {
    const { storeId, userId } = this.requireContext();
    const session = await this.prisma.service_sessions.findFirst({
      where: { id: sessionId, store_id: storeId },
    });
    if (!session || !session.order_id) {
      throw new VendixHttpException(ErrorCodes.STATION_006, 'Atención no encontrada.');
    }
    const item = await this.prisma.order_items.findFirst({
      where: { id: itemId, order_id: session.order_id },
    });
    if (!item) {
      throw new VendixHttpException(ErrorCodes.ORD_ITEM_NOTES_NOT_FOUND_001, 'Ítem no encontrado en la orden.');
    }
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      if (item.product_id) {
        const reservation = await tx.stock_reservations.findFirst({
          where: { reserved_for_type: 'order', reserved_for_id: session.order_id!, product_id: item.product_id, product_variant_id: item.product_variant_id ?? null, status: 'active' },
        });
        if (reservation) {
          await tx.stock_reservations.update({ where: { id: reservation.id }, data: { status: 'cancelled', updated_at: now } });
          await tx.stock_levels.updateMany({
            where: { product_id: item.product_id, product_variant_id: item.product_variant_id ?? null, location_id: reservation.location_id },
            data: {
              quantity_reserved: { decrement: reservation.quantity },
              quantity_available: { increment: reservation.quantity },
              updated_at: now,
            },
          });
        }
      }

      // order_item_taxes cae en cascada con la línea.
      await tx.order_items.delete({ where: { id: itemId } });
      const totals = await this.recalcOrderTotals(tx, session.order_id!, now);

      await this.writeProgress(tx, storeId, session.id, 'item_removed', userId ?? null, `Se eliminó ${item.product_name} de la cuenta`);
      return { deleted: true, itemId, grand_total: totals.grand_total };
    });

    this.emit(storeId, sessionId, 'item_removed', { item_id: itemId, grand_total: result.grand_total });
    return result;
  }

  async publicProgress(id: number) {
    const { storeId } = this.requireContext();
    const session = await this.prisma.service_sessions.findFirst({
      where: { id, store_id: storeId },
      select: { id: true, status: true },
    });
    if (!session) throw new VendixHttpException(ErrorCodes.STATION_006);
    const recentEvents = await this.prisma.service_progress_events.findMany({
      where: { store_id: storeId, session_id: id },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: 101,
      select: { id: true, event_type: true, public_text: true, created_at: true },
    });
    const hasOlderEvents = recentEvents.length > 100;
    const events = recentEvents.slice(0, 100).reverse();
    return {
      session_id: session.id,
      status: session.status,
      events: events.map((event) => ({ type: event.event_type, text: event.public_text, created_at: event.created_at })),
      events_have_older: hasOlderEvents,
    };
  }

  streamForStore(storeId: number) {
    const subject = this.notifications.getOrCreate(storeId);
    return {
      observable: subject.asObservable().pipe(filter((event) => event.type === 'service_session.progress')),
      unsubscribe: () => this.notifications.unsubscribe(storeId),
    };
  }

  private async writeProgress(tx: Prisma.TransactionClient, storeId: number, sessionId: number, type: string, actorUserId: number | null, publicText: string | null) {
    await tx.service_progress_events.create({ data: { store_id: storeId, session_id: sessionId, event_type: type, actor_user_id: actorUserId, public_text: publicText } });
  }

  private emit(storeId: number, sessionId: number, type: string, data: Record<string, unknown>) {
    this.notifications.push(storeId, {
      id: ++this.eventId,
      type: 'service_session.progress',
      title: 'Atención actualizada',
      body: type,
      data: { session_id: sessionId, event_type: type, ...data },
      created_at: new Date().toISOString(),
    });
  }

  private isExclusionConflict(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const value = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { code?: string } } }; cause?: { code?: string } };
    return value.code === '23P01' || value.meta?.code === '23P01' || value.meta?.driverAdapterError?.cause?.code === '23P01' || value.cause?.code === '23P01';
  }

  private isUniqueConflict(error: unknown) {
    return !!error && typeof error === 'object' && (error as { code?: string }).code === 'P2002';
  }

  private requireContext() {
    const context = RequestContextService.getContext();
    if (!context?.store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return { storeId: context.store_id, userId: context.user_id };
  }
}
