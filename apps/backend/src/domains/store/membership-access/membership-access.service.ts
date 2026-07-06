import { Inject, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import {
  Prisma,
  membership_access_result_enum,
  membership_credential_type_enum,
  membership_status_enum,
} from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { REDIS_CLIENT } from 'src/common/redis/redis.module';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { MenuAvailabilityCheckerService } from '../menus/menu-availability-checker.service';
import { NotificationsSseService } from '../notifications/notifications-sse.service';
import { SseNotificationPayload } from '../notifications/interfaces/notification-events.interface';
import { mergeStoreSettingsWithDefaults } from '../settings/defaults/default-store-settings';
import {
  ValidateAccessDto,
  CreateCredentialDto,
  UpdateCredentialDto,
  CredentialQueryDto,
  AccessLogQueryDto,
  RegisterExitDto,
} from './dto';

/**
 * Live SSE event pushed on EVERY access decision (granted or denied) so an
 * ambient-access screen can react in real time. Reuses the per-store hub
 * (`NotificationsSseService`); it does not conform to the bell's
 * `SseNotificationPayload` shape (this is a domain event), so it is cast at the
 * push site — the hub only `JSON.stringify`s the payload.
 */
export interface MembershipAccessSseEvent {
  type: 'membership-access';
  granted: boolean;
  result: membership_access_result_enum;
  customer_name: string | null;
  status: membership_status_enum | null;
  days_remaining: number | null;
  period_end: string | null;
  membership_id: number | null;
  at: string;
}

export interface AccessValidationResult {
  granted: boolean;
  result: membership_access_result_enum;
  reason: string | null;
  customer_id: number | null;
  membership_id: number | null;
}

/**
 * Live SSE event pushed on EVERY occupancy (aforo) change — grant increment,
 * exit, manual adjust, cron reset, or cron leveling. Rides the SAME per-store
 * hub as the `membership-access` decision event; the `type: 'occupancy'`
 * discriminator lets the frontend branch. Cast at the push site (the hub only
 * `JSON.stringify`s the payload).
 */
export interface MembershipOccupancySseEvent {
  type: 'occupancy';
  store_id: number;
  current_count: number;
  max_capacity: number;
  capacity_control_enabled: boolean;
  updated_at: string;
}

/**
 * Occupancy snapshot returned by the occupancy read/mutation endpoints
 * (get / exit / adjust / reset). Shared, stable contract consumed by the
 * ambient-access UI.
 */
export interface OccupancySnapshot {
  current_count: number;
  max_capacity: number;
  capacity_control_enabled: boolean;
  turnstile_mode: boolean;
  business_date: string | null;
  updated_at: string;
}

/** Store capacity (aforo) configuration resolved from store settings. */
export interface CapacityConfig {
  enabled: boolean;
  maxCapacity: number;
  turnstile: boolean;
  autoLeveling: boolean;
  intervalHours: 1 | 2;
}

/** Raw occupancy row shape used by the leveling/reset cron (internal). */
export interface OccupancyRow {
  current_count: number;
  business_date: Date | null;
  last_leveled_at: Date | null;
}

/**
 * MembershipAccessService
 *
 * Store-scoped access control for the membership core:
 *   - `validate`: resolve a member by their active credential, evaluate the
 *     current membership, enforce an optional per-period access quota, ALWAYS
 *     write a `membership_access_logs` row, and return grant/deny + reason.
 *   - Credentials CRUD (`membership_access_credentials`).
 *   - Access logs listing (`membership_access_logs`).
 *
 * Quota ("N accesses / month"): mirrors the AI quota pattern
 * (`subscription-access.service`) — read-only check BEFORE granting, atomic
 * dedup+increment AFTER granting. The cap lives in the plan's `features` Json
 * (`features.access_limit_per_period`), not a dedicated column. Keyed per
 * member:
 *   counter: membership:quota:{storeId}:{customerId}:access:{YYYYMM}
 *   dedup  : membership:quota:dedup:{storeId}:{customerId}:access:{YYYYMM}
 *
 * Tenant scope: membership models use `withoutScope()` + explicit `store_id`.
 */
@Injectable()
export class MembershipAccessService {
  private readonly logger = new Logger(MembershipAccessService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly availabilityChecker: MenuAvailabilityCheckerService,
    private readonly sseService: NotificationsSseService,
  ) {}

  // ------------------------------------------------------------------ Helpers

  private requireStoreId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return storeId;
  }

  private get credentials() {
    return this.prisma.withoutScope().membership_access_credentials;
  }

  private get accessLogs() {
    return this.prisma.withoutScope().membership_access_logs;
  }

  private get memberships() {
    return this.prisma.withoutScope().memberships;
  }

  private get membershipPlans() {
    return this.prisma.withoutScope().membership_plans;
  }

  private get occupancy() {
    return this.prisma.withoutScope().membership_access_occupancy;
  }

  // ------------------------------------------------------------------ Validate

  async validate(dto: ValidateAccessDto): Promise<AccessValidationResult> {
    const storeId = this.requireStoreId();
    const now = new Date();

    // 1. Resolve the active credential → member. Match is by EXACT raw value
    //    (the value is only masked on the listing read, never here).
    const credential = await this.credentials.findFirst({
      where: {
        store_id: storeId,
        credential_type: dto.credential_type,
        credential_value: dto.credential_value,
        is_active: true,
      },
      select: { id: true, customer_id: true },
    });

    if (!credential) {
      return this.logAndReturn(storeId, {
        result: membership_access_result_enum.denied_no_membership,
        reason: 'Credencial no encontrada o inactiva',
        customer_id: null,
        membership_id: null,
        credential_id: null,
        device_id: dto.device_id,
      });
    }

    const customerId = credential.customer_id;

    // Resolve store timezone + member name ONCE — reused by the schedule
    // window check, the `days_remaining` computation, and the SSE enrichment.
    const timezone = await this.availabilityChecker.getStoreTimezone(storeId);
    const customerName = await this.resolveCustomerName(customerId);

    // 2. Current, non-expired active membership.
    const active = await this.memberships.findFirst({
      where: {
        store_id: storeId,
        customer_id: customerId,
        status: membership_status_enum.active,
        period_end: { gte: now },
      },
      orderBy: { period_end: 'desc' },
      select: { id: true, plan_id: true, status: true, period_end: true },
    });

    if (!active) {
      const latest = await this.memberships.findFirst({
        where: { store_id: storeId, customer_id: customerId },
        orderBy: { period_end: 'desc' },
        select: { id: true, status: true, period_end: true },
      });
      const { result, reason } = this.diagnoseDenied(latest, now);
      return this.logAndReturn(storeId, {
        result,
        reason,
        customer_id: customerId,
        membership_id: latest?.id ?? null,
        credential_id: credential.id,
        device_id: dto.device_id,
        customer_name: customerName,
        status: latest?.status ?? null,
        period_end: latest?.period_end ?? null,
        days_remaining: this.daysRemaining(latest?.period_end ?? null, timezone),
      });
    }

    // Load the plan ONCE — carries both the optional access schedule
    // (`features.access_schedule`) and the optional quota cap
    // (`features.access_limit_per_period`).
    const plan = await this.membershipPlans.findFirst({
      where: { id: active.plan_id, store_id: storeId },
      select: { features: true },
    });
    const features = plan?.features as Record<string, any> | null | undefined;

    // 3. Optional per-plan access schedule (opening hours). Evaluated with the
    //    SAME timezone math as menu availability windows. This check comes
    //    AFTER the "membership vigente" validations — it never pre-empts
    //    "no membership"/"expired". No windows = no restriction (current
    //    behavior).
    const rawSchedule = features?.['access_schedule'];
    const windows = Array.isArray(rawSchedule)
      ? (rawSchedule as Array<{
          day_of_week: number;
          start_time: string;
          end_time: string;
        }>)
      : [];
    if (windows.length > 0) {
      const { day, hours, minutes } =
        this.availabilityChecker.getDateInTimezone(timezone);
      const nowMinutes = hours * 60 + minutes;
      const withinSchedule = windows.some((w) =>
        this.availabilityChecker.isWindowActive(w, day, nowMinutes),
      );
      if (!withinSchedule) {
        return this.logAndReturn(storeId, {
          result: membership_access_result_enum.denied_outside_schedule,
          reason: 'Fuera del horario de acceso permitido por el plan',
          customer_id: customerId,
          membership_id: active.id,
          credential_id: credential.id,
          device_id: dto.device_id,
          customer_name: customerName,
          status: active.status,
          period_end: active.period_end,
          days_remaining: this.daysRemaining(active.period_end, timezone),
        });
      }
    }

    // 4. Optional per-period access quota — the cap lives in
    //    `features.access_limit_per_period`, not a column.
    const rawLimit = features?.['access_limit_per_period'];
    const limit = Number(rawLimit) > 0 ? Number(rawLimit) : 0;
    if (limit && limit > 0) {
      const used = await this.getQuotaUsed(storeId, customerId);
      if (used >= limit) {
        return this.logAndReturn(storeId, {
          result: membership_access_result_enum.denied_quota_exceeded,
          reason: `Límite de accesos del período alcanzado (${limit})`,
          customer_id: customerId,
          membership_id: active.id,
          credential_id: credential.id,
          device_id: dto.device_id,
          customer_name: customerName,
          status: active.status,
          period_end: active.period_end,
          days_remaining: this.daysRemaining(active.period_end, timezone),
        });
      }
    }

    // 4.5 Capacity (aforo) gate — read the store capacity config ONCE and, when
    //     control is enabled with a positive cap, DENY before granting if the
    //     area is already full (no quota consume, no increment). A stale
    //     (previous-day) count reads as 0. `max_capacity <= 0` is treated as
    //     "no cap configured" (never blocks) so enabling control without a cap
    //     does not lock everyone out.
    const capacityConfig = await this.getCapacityConfig(storeId);
    if (capacityConfig.enabled && capacityConfig.maxCapacity > 0) {
      const effective = await this.getEffectiveOccupancy(storeId, timezone);
      if (effective >= capacityConfig.maxCapacity) {
        return this.logAndReturn(storeId, {
          result: membership_access_result_enum.denied_capacity_full,
          reason: `Aforo completo (${capacityConfig.maxCapacity})`,
          customer_id: customerId,
          membership_id: active.id,
          credential_id: credential.id,
          device_id: dto.device_id,
          customer_name: customerName,
          status: active.status,
          period_end: active.period_end,
          days_remaining: this.daysRemaining(active.period_end, timezone),
        });
      }
    }

    // 5. Grant → consume quota (dedup) + increment occupancy (day-aware) after
    //    the decision. Occupancy is only tracked when capacity control is on.
    if (limit && limit > 0) {
      await this.consumeQuota(storeId, customerId);
    }
    if (capacityConfig.enabled) {
      await this.incrementOccupancyOnGrant(storeId, timezone);
      await this.publishOccupancy(storeId, capacityConfig);
    }

    return this.logAndReturn(storeId, {
      result: membership_access_result_enum.granted,
      reason: null,
      customer_id: customerId,
      membership_id: active.id,
      credential_id: credential.id,
      device_id: dto.device_id,
      customer_name: customerName,
      status: active.status,
      period_end: active.period_end,
      days_remaining: this.daysRemaining(active.period_end, timezone),
    });
  }

  /** Resolve the member's display name from `users`. Null when not found. */
  private async resolveCustomerName(
    customerId: number | null,
  ): Promise<string | null> {
    if (!customerId) return null;
    try {
      const user = await this.prisma.users.findFirst({
        where: { id: customerId },
        select: { first_name: true, last_name: true },
      });
      if (!user) return null;
      const name = [user.first_name, user.last_name]
        .filter((p) => !!p && p.trim().length > 0)
        .join(' ')
        .trim();
      return name.length > 0 ? name : null;
    } catch {
      return null;
    }
  }

  /**
   * Whole days left until `period_end`, computed on the CALENDAR date in the
   * store timezone (so a membership ending "today" reads 0, never -1 from a
   * UTC/local skew). Null when there is no `period_end`; never negative.
   */
  private daysRemaining(
    periodEnd: Date | null,
    timezone: string,
  ): number | null {
    if (!periodEnd) return null;
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayStr = fmt.format(new Date()); // YYYY-MM-DD in store tz
    const endStr = fmt.format(periodEnd); // YYYY-MM-DD in store tz
    const msPerDay = 24 * 60 * 60 * 1000;
    const diff = Math.round(
      (Date.parse(`${endStr}T00:00:00Z`) - Date.parse(`${todayStr}T00:00:00Z`)) /
        msPerDay,
    );
    return diff > 0 ? diff : 0;
  }

  private diagnoseDenied(
    latest: { status: membership_status_enum; period_end: Date | null } | null,
    now: Date,
  ): { result: membership_access_result_enum; reason: string } {
    if (!latest) {
      return {
        result: membership_access_result_enum.denied_no_membership,
        reason: 'El socio no tiene membresía',
      };
    }
    switch (latest.status) {
      case membership_status_enum.suspended:
        return {
          result: membership_access_result_enum.denied_suspended,
          reason: 'Membresía suspendida',
        };
      case membership_status_enum.frozen:
        return {
          result: membership_access_result_enum.denied_frozen,
          reason: 'Membresía congelada',
        };
      case membership_status_enum.expired:
        return {
          result: membership_access_result_enum.denied_expired,
          reason: 'Membresía vencida',
        };
      case membership_status_enum.active:
        // Active but failed the period_end >= now filter above → expired window.
        return {
          result: membership_access_result_enum.denied_expired,
          reason: 'Período de la membresía vencido',
        };
      case membership_status_enum.pending_payment:
        return {
          result: membership_access_result_enum.denied_no_membership,
          reason: 'Membresía pendiente de pago',
        };
      case membership_status_enum.cancelled:
      default:
        return {
          result: membership_access_result_enum.denied_no_membership,
          reason: 'Membresía cancelada o no vigente',
        };
    }
  }

  private async logAndReturn(
    storeId: number,
    entry: {
      result: membership_access_result_enum;
      reason: string | null;
      customer_id: number | null;
      membership_id: number | null;
      credential_id: number | null;
      device_id?: string;
      // SSE enrichment (optional — absent on the no-credential path).
      customer_name?: string | null;
      status?: membership_status_enum | null;
      period_end?: Date | null;
      days_remaining?: number | null;
    },
  ): Promise<AccessValidationResult> {
    try {
      await this.accessLogs.create({
        data: {
          store_id: storeId,
          customer_id: entry.customer_id,
          membership_id: entry.membership_id,
          credential_id: entry.credential_id,
          result: entry.result,
          reason: entry.reason,
          device_id: entry.device_id ?? null,
        },
      });
    } catch (err) {
      // The access decision must not fail because the audit write failed.
      this.logger.warn(
        `membership_access_logs write failed for store=${storeId}: ${(err as Error).message}`,
      );
    }

    const granted = entry.result === membership_access_result_enum.granted;

    // Live SSE fan-out — ALWAYS (granted or denied) so an ambient-access screen
    // reacts in real time. Never fail the access decision if the push errors;
    // the hub only broadcasts to currently-connected clients (live-only).
    try {
      const event: MembershipAccessSseEvent = {
        type: 'membership-access',
        granted,
        result: entry.result,
        customer_name: entry.customer_name ?? null,
        status: entry.status ?? null,
        days_remaining: entry.days_remaining ?? null,
        period_end: entry.period_end ? entry.period_end.toISOString() : null,
        membership_id: entry.membership_id,
        at: new Date().toISOString(),
      };
      this.sseService.push(storeId, event as unknown as SseNotificationPayload);
    } catch (err) {
      this.logger.warn(
        `membership-access SSE push failed for store=${storeId}: ${(err as Error).message}`,
      );
    }

    return {
      granted,
      result: entry.result,
      reason: entry.reason,
      customer_id: entry.customer_id,
      membership_id: entry.membership_id,
    };
  }

  // ------------------------------------------------------------ Credentials

  async createCredential(dto: CreateCredentialDto) {
    const storeId = this.requireStoreId();

    const customer = await this.prisma.users.findFirst({
      where: { id: dto.customer_id },
      select: { id: true },
    });
    if (!customer) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'El cliente (socio) no existe',
      );
    }

    // Unique (store_id, credential_type, credential_value).
    const dup = await this.credentials.findFirst({
      where: {
        store_id: storeId,
        credential_type: dto.credential_type,
        credential_value: dto.credential_value,
      },
      select: { id: true },
    });
    if (dup) {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        'Ya existe una credencial con ese valor y tipo en esta tienda',
      );
    }

    try {
      return await this.credentials.create({
        data: {
          store_id: storeId,
          customer_id: dto.customer_id,
          credential_type: dto.credential_type,
          credential_value: dto.credential_value,
          is_active: dto.is_active ?? true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          'Ya existe una credencial con ese valor y tipo en esta tienda',
        );
      }
      throw error;
    }
  }

  async listCredentials(query: CredentialQueryDto) {
    const storeId = this.requireStoreId();
    const { page = 1, limit = 10, customer_id, is_active } = query ?? {};
    const skip = (page - 1) * limit;

    const where: Prisma.membership_access_credentialsWhereInput = {
      store_id: storeId,
      ...(customer_id !== undefined && { customer_id }),
      ...(is_active !== undefined && { is_active }),
    };

    const [rows, total] = await Promise.all([
      this.credentials.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'desc' },
      }),
      this.credentials.count({ where }),
    ]);

    // Privacy: NEVER expose the raw credential value on read. Strip it out and
    // surface only a masked fingerprint (`credential_value_masked`). The raw
    // value is still matched by exact equality inside `validate()`.
    const data = rows.map(({ credential_value, ...rest }) => ({
      ...rest,
      credential_value_masked: this.maskCredentialValue(
        rest.credential_type,
        credential_value,
      ),
    }));

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Mask a credential value for listing (fingerprint, never the raw value).
   * Mirrors the payment `maskConfig` pattern:
   *   - `qr` / `external_ref` → '****' + last 4 chars
   *   - `pin`                 → '****' (digits are never revealed)
   *   - value with 4 chars or fewer → '****' (fully masked)
   * Note: the biometric template is never stored — the fingerprint is the
   * `external_ref` type.
   */
  private maskCredentialValue(
    type: membership_credential_type_enum,
    value: string | null | undefined,
  ): string {
    if (type === membership_credential_type_enum.pin) return '****';
    if (!value || value.length <= 4) return '****';
    return '****' + value.slice(-4);
  }

  async updateCredential(id: number, dto: UpdateCredentialDto) {
    const storeId = this.requireStoreId();
    const existing = await this.credentials.findFirst({
      where: { id, store_id: storeId },
    });
    if (!existing) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Credencial no encontrada',
      );
    }

    const data: Prisma.membership_access_credentialsUpdateInput = {
      ...(dto.credential_value !== undefined && {
        credential_value: dto.credential_value,
      }),
      ...(dto.is_active !== undefined && { is_active: dto.is_active }),
    };

    await this.credentials.updateMany({
      where: { id, store_id: storeId },
      data,
    });
    return this.credentials.findFirst({ where: { id, store_id: storeId } });
  }

  /** Soft "baja" of a credential (is_active=false). */
  async deactivateCredential(id: number) {
    const storeId = this.requireStoreId();
    const existing = await this.credentials.findFirst({
      where: { id, store_id: storeId },
      select: { id: true },
    });
    if (!existing) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Credencial no encontrada',
      );
    }
    await this.credentials.updateMany({
      where: { id, store_id: storeId },
      data: { is_active: false },
    });
    return { deactivated: true };
  }

  // ------------------------------------------------------------------ Logs

  async listLogs(query: AccessLogQueryDto) {
    const storeId = this.requireStoreId();
    const { page = 1, limit = 20, customer_id, result, date_from, date_to } =
      query ?? {};
    const skip = (page - 1) * limit;

    const where: Prisma.membership_access_logsWhereInput = {
      store_id: storeId,
      ...(customer_id !== undefined && { customer_id }),
      ...(result !== undefined && { result }),
      ...((date_from || date_to) && {
        access_at: {
          ...(date_from && { gte: new Date(date_from) }),
          ...(date_to && { lte: new Date(date_to) }),
        },
      }),
    };

    const [data, total] = await Promise.all([
      this.accessLogs.findMany({
        where,
        skip,
        take: limit,
        orderBy: { access_at: 'desc' },
      }),
      this.accessLogs.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ------------------------------------------------------------- Quota (Redis)

  private periodKey(): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${y}${m}`;
  }

  private quotaKey(storeId: number, customerId: number): string {
    return `membership:quota:${storeId}:${customerId}:access:${this.periodKey()}`;
  }

  private dedupKey(storeId: number, customerId: number): string {
    return `membership:quota:dedup:${storeId}:${customerId}:access:${this.periodKey()}`;
  }

  private async getQuotaUsed(
    storeId: number,
    customerId: number,
  ): Promise<number> {
    try {
      const raw = await this.redis.get(this.quotaKey(storeId, customerId));
      const current = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(current) ? current : 0;
    } catch {
      // Fail-open on infra errors: do not block a paying member because Redis
      // is unavailable. The read is observational.
      return 0;
    }
  }

  /**
   * Atomic dedup-then-increment. Same request id (X-Request-Id) across retries
   * counts once — a reader that double-scans a QR/PIN on retry does not consume
   * two accesses.
   *
   * KEYS[1] = quota counter, KEYS[2] = dedup set.
   * ARGV[1] = request id, ARGV[2] = ttl seconds.
   */
  private readonly consumeQuotaLua = `
    if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then return 0 end
    redis.call('SADD', KEYS[2], ARGV[1])
    redis.call('EXPIRE', KEYS[2], ARGV[2])
    local v = redis.call('INCR', KEYS[1])
    redis.call('EXPIRE', KEYS[1], ARGV[2])
    return v
  `;

  private async consumeQuota(
    storeId: number,
    customerId: number,
  ): Promise<void> {
    const requestId =
      RequestContextService.getRequestId() ?? crypto.randomUUID();
    const ttl = 40 * 24 * 60 * 60; // 40d (monthly period, over-provisioned)
    try {
      await this.redis.eval(
        this.consumeQuotaLua,
        2,
        this.quotaKey(storeId, customerId),
        this.dedupKey(storeId, customerId),
        requestId,
        ttl,
      );
    } catch (err) {
      // Quota is observational — never fail the access decision on Redis error.
      this.logger.warn(
        `membership access quota consume failed store=${storeId} customer=${customerId}: ${(err as Error).message}`,
      );
    }
  }

  // -------------------------------------------------------- Occupancy (aforo)

  /**
   * Read the store's capacity (aforo) config from `store_settings.membership`.
   * Uses `withoutScope()` + explicit `store_id` so it works both under an HTTP
   * request context and from the leveling/reset cron. Never throws — a settings
   * read failure falls back to "control disabled".
   */
  private async getCapacityConfig(storeId: number): Promise<CapacityConfig> {
    try {
      const row = await this.prisma
        .withoutScope()
        .store_settings.findFirst({
          where: { store_id: storeId },
          select: { settings: true },
        });
      const settings = mergeStoreSettingsWithDefaults(row?.settings);
      const m = settings.membership;
      const maxCapacity = Number(m?.max_capacity ?? 0);
      return {
        enabled: m?.capacity_control_enabled === true,
        maxCapacity: Number.isFinite(maxCapacity) && maxCapacity > 0 ? maxCapacity : 0,
        turnstile: m?.turnstile_mode === true,
        autoLeveling: m?.auto_leveling_enabled === true,
        intervalHours: Number(m?.auto_leveling_interval_hours) === 1 ? 1 : 2,
      };
    } catch {
      return {
        enabled: false,
        maxCapacity: 0,
        turnstile: false,
        autoLeveling: false,
        intervalHours: 2,
      };
    }
  }

  /** Local calendar day 'YYYY-MM-DD' in the store timezone. */
  private localDay(timezone: string): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  /** A 'YYYY-MM-DD' day as a UTC-midnight Date (round-trips for `@db.Date`). */
  private dateOnlyUtc(day: string): Date {
    return new Date(`${day}T00:00:00.000Z`);
  }

  /** Date part 'YYYY-MM-DD' of a `@db.Date` value (stored at UTC midnight). */
  private formatDatePart(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /**
   * Effective current occupancy for the gate. If the stored count belongs to a
   * PREVIOUS local day (stale — not yet reset by the cron) it reads as 0, so the
   * first grant of a new day never sees yesterday's leftover as "full".
   */
  private async getEffectiveOccupancy(
    storeId: number,
    timezone: string,
  ): Promise<number> {
    const row = await this.occupancy.findFirst({
      where: { store_id: storeId },
      select: { current_count: true, business_date: true },
    });
    if (!row) return 0;
    const storedDay = row.business_date
      ? this.formatDatePart(row.business_date)
      : null;
    if (storedDay !== null && storedDay < this.localDay(timezone)) return 0;
    return row.current_count;
  }

  /**
   * Day-aware +1 on grant. The common (same-day) path uses an ATOMIC Prisma
   * `increment: 1`. When the row belongs to a previous local day (stale, no cron
   * reset yet) it starts fresh at 1 and stamps today — so a lingering count from
   * a prior day never carries over into the new day's session.
   */
  private async incrementOccupancyOnGrant(
    storeId: number,
    timezone: string,
  ): Promise<void> {
    const localDay = this.localDay(timezone);
    const localDayDate = this.dateOnlyUtc(localDay);
    const row = await this.occupancy.findFirst({
      where: { store_id: storeId },
      select: { current_count: true, business_date: true },
    });
    if (!row) {
      await this.occupancy.create({
        data: { store_id: storeId, current_count: 1, business_date: localDayDate },
      });
      return;
    }
    const storedDay = row.business_date
      ? this.formatDatePart(row.business_date)
      : null;
    if (storedDay !== null && storedDay < localDay) {
      await this.occupancy.update({
        where: { store_id: storeId },
        data: { current_count: 1, business_date: localDayDate, last_leveled_at: null },
      });
    } else {
      await this.occupancy.update({
        where: { store_id: storeId },
        data: { current_count: { increment: 1 }, business_date: localDayDate },
      });
    }
  }

  private buildSnapshot(
    row: { current_count: number; business_date: Date | null; updated_at: Date } | null,
    config: CapacityConfig,
  ): OccupancySnapshot {
    return {
      current_count: row?.current_count ?? 0,
      max_capacity: config.maxCapacity,
      capacity_control_enabled: config.enabled,
      turnstile_mode: config.turnstile,
      business_date: row?.business_date
        ? this.formatDatePart(row.business_date)
        : null,
      updated_at: (row?.updated_at ?? new Date()).toISOString(),
    };
  }

  /** Fan out an `occupancy` SSE event on the per-store hub. Never throws. */
  private pushOccupancy(
    storeId: number,
    row: { current_count: number; updated_at: Date } | null,
    config: CapacityConfig,
  ): void {
    try {
      const event: MembershipOccupancySseEvent = {
        type: 'occupancy',
        store_id: storeId,
        current_count: row?.current_count ?? 0,
        max_capacity: config.maxCapacity,
        capacity_control_enabled: config.enabled,
        updated_at: (row?.updated_at ?? new Date()).toISOString(),
      };
      this.sseService.push(storeId, event as unknown as SseNotificationPayload);
    } catch (err) {
      this.logger.warn(
        `occupancy SSE push failed for store=${storeId}: ${(err as Error).message}`,
      );
    }
  }

  /** Re-read the current row and push an `occupancy` SSE event (post-grant). */
  private async publishOccupancy(
    storeId: number,
    config?: CapacityConfig,
  ): Promise<void> {
    const cfg = config ?? (await this.getCapacityConfig(storeId));
    const row = await this.occupancy.findFirst({
      where: { store_id: storeId },
      select: { current_count: true, updated_at: true },
    });
    this.pushOccupancy(storeId, row, cfg);
  }

  /** Current occupancy snapshot for the store. */
  async getOccupancy(storeId: number): Promise<OccupancySnapshot> {
    const config = await this.getCapacityConfig(storeId);
    const row = await this.occupancy.findFirst({ where: { store_id: storeId } });
    return this.buildSnapshot(row, config);
  }

  /** Register an exit → occupancy −1 (floored at 0). */
  async registerExit(
    storeId: number,
    _dto?: RegisterExitDto,
  ): Promise<OccupancySnapshot> {
    return this.applyDelta(storeId, -1);
  }

  /** Manual adjustment → occupancy += delta (floored at 0). */
  async adjustOccupancy(
    storeId: number,
    delta: number,
  ): Promise<OccupancySnapshot> {
    return this.applyDelta(storeId, delta);
  }

  /**
   * Atomically apply a signed delta to the per-store occupancy row (created if
   * missing) and floor the result at 0. The increment itself is atomic (Prisma
   * `increment`); the floor is a rare corrective clamp. Publishes an `occupancy`
   * SSE event and returns the fresh snapshot.
   */
  private async applyDelta(
    storeId: number,
    delta: number,
  ): Promise<OccupancySnapshot> {
    const config = await this.getCapacityConfig(storeId);
    let row = await this.occupancy.upsert({
      where: { store_id: storeId },
      create: { store_id: storeId, current_count: Math.max(delta, 0) },
      update: { current_count: { increment: delta } },
    });
    if (row.current_count < 0) {
      row = await this.occupancy.update({
        where: { store_id: storeId },
        data: { current_count: 0 },
      });
    }
    const snapshot = this.buildSnapshot(row, config);
    this.pushOccupancy(storeId, row, config);
    return snapshot;
  }

  /**
   * Reset occupancy to 0 for a new business day: sets `current_count = 0`,
   * `business_date` to today's local calendar day, and clears `last_leveled_at`.
   * Publishes an `occupancy` SSE event. Used by the hourly aforo cron.
   */
  async resetOccupancy(storeId: number): Promise<OccupancySnapshot> {
    const config = await this.getCapacityConfig(storeId);
    const timezone = await this.availabilityChecker.getStoreTimezone(storeId);
    const businessDate = this.dateOnlyUtc(this.localDay(timezone));
    const row = await this.occupancy.upsert({
      where: { store_id: storeId },
      create: {
        store_id: storeId,
        current_count: 0,
        business_date: businessDate,
        last_leveled_at: null,
      },
      update: {
        current_count: 0,
        business_date: businessDate,
        last_leveled_at: null,
      },
    });
    const snapshot = this.buildSnapshot(row, config);
    this.pushOccupancy(storeId, row, config);
    return snapshot;
  }

  /**
   * Raw occupancy row read for the leveling/reset cron (internal). Returns null
   * when no one has been counted yet.
   */
  async peekOccupancy(storeId: number): Promise<OccupancyRow | null> {
    const row = await this.occupancy.findFirst({
      where: { store_id: storeId },
      select: {
        current_count: true,
        business_date: true,
        last_leveled_at: true,
      },
    });
    return row ?? null;
  }

  /**
   * Silent metadata update (no count change, no SSE) used by the cron to stamp
   * the day baseline (`business_date`) or advance the leveling clock
   * (`last_leveled_at`).
   */
  async updateOccupancyMeta(
    storeId: number,
    data: { business_date?: Date | null; last_leveled_at?: Date | null },
  ): Promise<void> {
    await this.occupancy.updateMany({ where: { store_id: storeId }, data });
  }
}
