import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { filter } from 'rxjs';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { RequestContextService } from '../../../common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { resolveStoreTimezone } from '../../../common/utils/store-timezone.util';
import { BusinessHoursService } from '../reservations/business-hours/business-hours.service';
import { ServiceAllocationCoordinator } from '../reservations/service-allocation-coordinator.service';
import { NotificationsSseService } from '../notifications/notifications-sse.service';
import { ServiceSessionAccessService } from '../../ecommerce/service-sessions/service-session-access.service';
import { EmailService } from '../../../email/email.service';
import { SettingsService } from '../settings/settings.service';
import { OpenServiceSessionDto, ServiceSessionTransitionDto } from './dto/service-session.dto';
import { ReissueServiceSessionLinkDto } from './dto/reissue-service-session-link.dto';

const ACTIVE_ALLOCATIONS = ['held', 'payment_pending', 'confirmed', 'in_service'];
const ACTIVE_SESSION_STATUSES = ['open', 'paused'];

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
      this.prisma.products.findFirst({ where: { id: productId, store_id: storeId }, select: { id: true, product_type: true, booking_mode: true, service_duration_minutes: true, buffer_minutes: true } }),
    ]);
    if (!station || !stationService || product?.product_type !== 'service') {
      throw new VendixHttpException(ErrorCodes.STATION_001);
    }
    if (providerId) {
      const [stationProvider, providerService, provider] = await Promise.all([
        this.prisma.service_station_providers.findFirst({ where: { store_id: storeId, station_id: stationId, provider_id: providerId } }),
        this.prisma.provider_services.findFirst({ where: { provider_id: providerId, product_id: productId } }),
        this.prisma.service_providers.findFirst({ where: { id: providerId, store_id: storeId, is_active: true } }),
      ]);
      if (!stationProvider || !providerService || !provider) throw new VendixHttpException(ErrorCodes.STATION_001);
    } else if (product.booking_mode === 'provider_required') {
      throw new VendixHttpException(ErrorCodes.STATION_001, 'Selecciona un proveedor compatible.');
    }

    const startAt = now;
    const minimumWalkInEnd = product.service_duration_minutes
      ? new Date(now.getTime() + (product.service_duration_minutes + (product.buffer_minutes ?? 0)) * 60_000)
      : null;
    const plannedEnd = bookingAllocation?.end_at ?? (dto.planned_end_at ? new Date(dto.planned_end_at) : minimumWalkInEnd);
    if (!plannedEnd || plannedEnd <= startAt || (!bookingAllocation && plannedEnd <= now)) {
      throw new VendixHttpException(ErrorCodes.STATION_009);
    }
    if (!bookingAllocation && (!minimumWalkInEnd || plannedEnd < minimumWalkInEnd)) {
      throw new VendixHttpException(ErrorCodes.STATION_009, 'El horizonte walk-in no puede ser menor a la duración del servicio.');
    }

    if (!bookingAllocation) {
      const timezone = await resolveStoreTimezone(this.prisma, storeId);
      const localParts = (date: Date) => {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
        return Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>;
      };
      const localStart = localParts(startAt);
      const localEnd = localParts(plannedEnd);
      const localDate = `${localStart.year}-${localStart.month}-${localStart.day}`;
      if (localEnd.year !== localStart.year || localEnd.month !== localStart.month || localEnd.day !== localStart.day) {
        throw new VendixHttpException(ErrorCodes.STATION_009, 'El walk-in debe terminar el mismo día local.');
      }
      const weekday = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
      const startMinutes = Number(localStart.hour) * 60 + Number(localStart.minute);
      const endMinutes = Number(localEnd.hour) * 60 + Number(localEnd.minute);
      const inside = (windows: Array<{ start_time: string; end_time: string }>) => windows.some((window) => {
        const [sh, sm] = window.start_time.split(':').map(Number);
        const [eh, em] = window.end_time.split(':').map(Number);
        return startMinutes >= sh * 60 + sm && endMinutes <= eh * 60 + em;
      });
      const [stationSchedules, stationException, storeWindows] = await Promise.all([
        this.prisma.service_station_schedules.findMany({ where: { store_id: storeId, station_id: stationId, weekday, is_active: true }, select: { start_time: true, end_time: true } }),
        this.prisma.service_station_exceptions.findFirst({ where: { store_id: storeId, station_id: stationId, start_at: { lt: plannedEnd }, end_at: { gt: startAt } }, select: { id: true } }),
        this.businessHours.loadStoreWindows(storeId),
      ]);
      if (!inside(stationSchedules) || stationException) throw new VendixHttpException(ErrorCodes.STATION_002);
      const storeHours = storeWindows.get(weekday) ?? [];
      if (storeWindows.size > 0) {
        if (!inside(storeHours)) throw new VendixHttpException(ErrorCodes.STATION_002);
      } else {
        const storeSettings = await this.prisma.store_settings.findUnique({ where: { store_id: storeId }, select: { settings: true } });
        const workingDays = (storeSettings?.settings as any)?.availability?.working_days;
        const openDays = Array.isArray(workingDays) && workingDays.length > 0 && workingDays.every((day: unknown) => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6)
          ? workingDays as number[]
          : [1, 2, 3, 4, 5];
        if (!openDays.includes(weekday) || startMinutes < 480 || endMinutes > 1080) {
          throw new VendixHttpException(ErrorCodes.STATION_002);
        }
      }
      if (providerId) {
        const [providerSchedule, providerException] = await Promise.all([
          this.prisma.provider_schedules.findMany({ where: { provider_id: providerId, day_of_week: weekday, is_active: true }, select: { start_time: true, end_time: true } }),
          this.prisma.provider_exceptions.findFirst({ where: { provider_id: providerId, date: new Date(`${localDate}T00:00:00.000Z`) }, select: { is_unavailable: true, custom_start_time: true, custom_end_time: true } }),
        ]);
        const windows = providerException?.custom_start_time && providerException.custom_end_time
          ? [{ start_time: providerException.custom_start_time, end_time: providerException.custom_end_time }]
          : providerSchedule;
        if (!windows.length || providerException?.is_unavailable || !inside(windows)) throw new VendixHttpException(ErrorCodes.STATION_003);
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
            customer_id: booking?.customer_id ?? dto.customer_id ?? null,
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
    const [subjects, allocations, recentEvents] = await Promise.all([
      this.prisma.service_subjects.findMany({ where: { store_id: storeId, session_id: id }, orderBy: { created_at: 'asc' } }),
      this.prisma.service_allocations.findMany({ where: { store_id: storeId, session_id: id }, orderBy: { created_at: 'asc' } }),
      this.prisma.service_progress_events.findMany({
        where: { store_id: storeId, session_id: id },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: 101,
      }),
    ]);
    const eventsHaveOlder = recentEvents.length > 100;
    const progressEvents = recentEvents.slice(0, 100).reverse();
    return { ...session, subjects, allocations, progress_events: progressEvents, events_have_older: eventsHaveOlder };
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
    const [stations, products, subjects, allocations] = await Promise.all([
      this.prisma.service_stations.findMany({ where: { store_id: storeId, id: { in: stationIds } }, select: { id: true, name: true } }),
      this.prisma.products.findMany({ where: { store_id: storeId, id: { in: productIds } }, select: { id: true, name: true } }),
      this.prisma.service_subjects.findMany({ where: { store_id: storeId, session_id: { in: ids } }, orderBy: { created_at: 'asc' } }),
      this.prisma.service_allocations.findMany({ where: { store_id: storeId, session_id: { in: ids }, state: { in: ACTIVE_ALLOCATIONS } }, orderBy: { created_at: 'desc' } }),
    ]);
    const stationById = new Map(stations.map((row) => [row.id, row.name]));
    const productById = new Map(products.map((row) => [row.id, row.name]));
    const items = sessions.map((session) => ({
      ...session,
      station_name: stationById.get(session.station_id) ?? 'Estación',
      product_name: productById.get(session.product_id) ?? 'Servicio',
      subject: subjects.find((row) => row.session_id === session.id) ?? null,
      allocation: allocations.find((row) => row.session_id === session.id) ?? null,
    }));
    return { items, next_cursor: hasMore ? sessions[sessions.length - 1].id : null };
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
