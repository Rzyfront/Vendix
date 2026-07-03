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
import {
  ValidateAccessDto,
  CreateCredentialDto,
  UpdateCredentialDto,
  CredentialQueryDto,
  AccessLogQueryDto,
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

    // 5. Grant → consume quota (dedup) after the decision.
    if (limit && limit > 0) {
      await this.consumeQuota(storeId, customerId);
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
}
