import { Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { randomBytes, randomInt } from 'crypto';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import * as QRCode from 'qrcode';
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
import { EmailService } from '../../../email/email.service';
import { EmailBrandingService } from '../../../email/services/email-branding.service';
import { MembershipAccessEmailTemplates } from '../../../email/templates/membership-access-emails';
import {
  ValidateAccessDto,
  CreateCredentialDto,
  UpdateCredentialDto,
  CredentialQueryDto,
  AccessLogQueryDto,
  RegisterExitDto,
} from './dto';

/**
 * Live SSE events pushed to the per-store hub. Reuses
 * (`NotificationsSseService`); they do not conform to the bell's
 * `SseNotificationPayload` shape (these are domain events), so they are cast at
 * the push site — the hub only `JSON.stringify`s the payload.
 *
 *   - `membership-access`: pushed on EVERY access decision (granted or denied).
 *   - `enrollment`: fanned out when the biometric device (or stub integration)
 *     reads a raw fingerprint via `POST /store/memberships/access/enrollment-ping`.
 *     No validation against credentials — this is live enrollment only, the
 *     credential-creation modal captures the `external_ref` in real time.
 */
export type MembershipAccessSseEvent =
  | {
      type: 'membership-access';
      granted: boolean;
      result: membership_access_result_enum;
      customer_name: string | null;
      status: membership_status_enum | null;
      days_remaining: number | null;
      period_end: string | null;
      membership_id: number | null;
      at: string;
      // Re-entry detection (optional): `warning` is true when access is GRANTED
      // but a re-entry was detected (`re_entry_mode = 'warn'`). `re_entry_minutes`
      // is the minutes since the last `granted` access — present on a warn-grant
      // AND on a `denied_re_entry`.
      warning?: boolean;
      re_entry_minutes?: number;
    }
  | {
      type: 'enrollment';
      external_ref: string;
      device_id: string | null;
      at: string;
    };

export interface AccessValidationResult {
  granted: boolean;
  result: membership_access_result_enum;
  reason: string | null;
  customer_id: number | null;
  membership_id: number | null;
  // Re-entry detection (optional). `warning` = granted despite a re-entry within
  // the window (`re_entry_mode = 'warn'`). `re_entry_minutes` = minutes since the
  // last `granted` access; present on a warn-grant AND on a `denied_re_entry`.
  warning?: boolean;
  re_entry_minutes?: number;
}

/** Re-entry policy resolved from `store_settings.membership`. */
export interface ReEntryConfig {
  mode: 'off' | 'warn' | 'block';
  windowHours: number;
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
    private readonly emailService: EmailService,
    private readonly emailBrandingService: EmailBrandingService,
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

  /**
   * Attach a `customer` snapshot to each row. Membership access models use
   * SCALAR fks (no Prisma relations), so we batch-fetch the referenced users
   * manually — mirrors `memberships.service.ts::attachRelations`. Rows whose
   * `customer_id` is null or unknown resolve to `customer: null`.
   */
  private async attachCustomer<T extends { customer_id: number | null }>(
    rows: T[],
  ): Promise<Array<T & { customer: { id: number; first_name: string | null; last_name: string | null; email: string | null } | null }>> {
    if (rows.length === 0) return rows as Array<T & { customer: null }>;

    const customerIds = [
      ...new Set(
        rows
          .map((r) => r.customer_id)
          .filter((id): id is number => id !== null && id !== undefined),
      ),
    ];

    if (customerIds.length === 0) {
      return rows.map((r) => ({ ...r, customer: null }));
    }

    const customers = await this.prisma.users.findMany({
      where: { id: { in: customerIds } },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
      },
    });

    const customerMap = new Map(customers.map((c) => [c.id, c]));

    return rows.map((r) => ({
      ...r,
      customer: r.customer_id != null ? customerMap.get(r.customer_id) ?? null : null,
    }));
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

    // 4.6 Re-entry detection — configurable per gym. Runs AFTER the membership
    //     is confirmed active and BEFORE the grant side-effects (quota consume +
    //     aforo increment). Looks for the member's most recent `granted` access
    //     within the configured window:
    //       - `block` → deny (`denied_re_entry`), no aforo/quota mutation.
    //       - `warn`  → still grant, flagged (`warning: true` + `re_entry_minutes`),
    //                   and SKIP the aforo/quota side-effects (same session — the
    //                   member is presumed already counted, so re-entry must not
    //                   double count nor re-consume the period quota). It also
    //                   bypasses the capacity gate for the same reason.
    //       - `off` / no prior access → normal flow continues untouched.
    const reEntry = await this.getReEntryConfig(storeId);
    if (reEntry.mode !== 'off' && customerId != null) {
      const windowStart = new Date(
        now.getTime() - reEntry.windowHours * 60 * 60 * 1000,
      );
      let lastGranted: { access_at: Date } | null = null;
      try {
        lastGranted = await this.accessLogs.findFirst({
          where: {
            store_id: storeId,
            customer_id: customerId,
            result: membership_access_result_enum.granted,
            access_at: { gte: windowStart },
          },
          orderBy: { access_at: 'desc' },
          select: { access_at: true },
        });
      } catch (err) {
        // Fail-open: a log-read failure must never break the access decision.
        this.logger.warn(
          `membership access re-entry lookup failed store=${storeId} customer=${customerId}: ${(err as Error).message}`,
        );
        lastGranted = null;
      }

      if (lastGranted) {
        const reEntryMinutes = Math.floor(
          (now.getTime() - lastGranted.access_at.getTime()) / 60000,
        );

        if (reEntry.mode === 'block') {
          return this.logAndReturn(storeId, {
            result: membership_access_result_enum.denied_re_entry,
            reason: `Reingreso hace ${reEntryMinutes} min`,
            customer_id: customerId,
            membership_id: active.id,
            credential_id: credential.id,
            device_id: dto.device_id,
            customer_name: customerName,
            status: active.status,
            period_end: active.period_end,
            days_remaining: this.daysRemaining(active.period_end, timezone),
            re_entry_minutes: reEntryMinutes,
          });
        }

        // warn → grant but flag it and skip the grant side-effects.
        return this.logAndReturn(storeId, {
          result: membership_access_result_enum.granted,
          reason: 're_entry',
          customer_id: customerId,
          membership_id: active.id,
          credential_id: credential.id,
          device_id: dto.device_id,
          customer_name: customerName,
          status: active.status,
          period_end: active.period_end,
          days_remaining: this.daysRemaining(active.period_end, timezone),
          warning: true,
          re_entry_minutes: reEntryMinutes,
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
      // Re-entry detection (optional).
      warning?: boolean;
      re_entry_minutes?: number;
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
        ...(entry.warning !== undefined && { warning: entry.warning }),
        ...(entry.re_entry_minutes !== undefined && {
          re_entry_minutes: entry.re_entry_minutes,
        }),
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
      ...(entry.warning !== undefined && { warning: entry.warning }),
      ...(entry.re_entry_minutes !== undefined && {
        re_entry_minutes: entry.re_entry_minutes,
      }),
    };
  }

  // ------------------------------------------------------------ Credentials

  /**
   * Auto-generate a unique credential value for `qr` or `pin`. The total
   * space is huge (16 bytes hex = 2^128 for QR, 10^6 for PIN) so a collision
   * is statistically unlikely — we still cap the loop at `MAX_ATTEMPTS` to
   * guarantee termination and surface an `InternalServerErrorException` if
   * the store somehow already has 5 active credentials sharing the value.
   *
   * `external_ref` is NEVER auto-generated (the operator supplies the device
   * reference) — the caller short-circuits before reaching this helper.
   */
  private static readonly MAX_GEN_ATTEMPTS = 5;

  private async generateCredentialValue(
    storeId: number,
    type: 'qr' | 'pin',
  ): Promise<string> {
    for (let attempt = 0; attempt < MembershipAccessService.MAX_GEN_ATTEMPTS; attempt++) {
      const value =
        type === 'qr'
          ? randomBytes(16).toString('hex') // 32 chars
          : randomInt(0, 1_000_000).toString().padStart(6, '0'); // 6 digits

      // Check against ALL rows (not just active): the DB constraint
      // `membership_access_cred_uq` is on (store_id, credential_type,
      // credential_value) regardless of `is_active`/`deleted_at`, so an
      // inactive/archived credential still occupies the value. Filtering by
      // `is_active` here would let the loop return a value that then collides
      // with an archived row on insert (P2002).
      const existing = await this.credentials.findFirst({
        where: {
          store_id: storeId,
          credential_type: type,
          credential_value: value,
        },
        select: { id: true },
      });
      if (!existing) return value;
    }
    throw new InternalServerErrorException(
      'No se pudo generar un valor único de credencial tras 5 intentos',
    );
  }

  /**
   * Send the credential to the member. NEVER blocks creation: any error is
   * logged and the function returns `false`. Returns `false` (without trying)
   * when the customer has no email on file.
   *
   * The biometric (`external_ref`) email NEVER includes the device reference —
   * the template is an enrollment notice only, in compliance with Ley 1581.
   */
  /**
   * Detects placeholder emails used when a member is created without a real
   * email (empty/null, or the `@noemail.local` / `@placeholder.vendix.com`
   * placeholders emitted by the bulk-import scanner). Operators must update
   * the customer's ficha with a real email before a credential can be created
   * or resent.
   */
  private isPlaceholderEmail(email: string | null | undefined): boolean {
    const e = (email ?? '').trim().toLowerCase();
    if (!e) return true; // empty counts as missing
    return e.endsWith('@noemail.local') || e.endsWith('@placeholder.vendix.com');
  }

  private async sendCredentialEmail(args: {
    storeId: number;
    customer: { id: number; first_name: string | null; last_name: string | null; email: string | null };
    credentialType: 'qr' | 'pin' | 'external_ref';
    credentialValue: string;
  }): Promise<{ sent: boolean; error?: string }> {
    const { storeId, customer, credentialType, credentialValue } = args;
    const to = customer.email?.trim();
    if (!to) {
      this.logger.warn(
        `membership-access: no email for customer_id=${customer.id} (store=${storeId}); skipping credential email`,
      );
      return { sent: false, error: 'El socio no tiene email' };
    }

    const { storeName, organizationName } =
      await this.emailBrandingService.getNames(undefined, storeId);
    const customerName = [customer.first_name, customer.last_name]
      .filter((p): p is string => !!p && p.trim().length > 0)
      .join(' ')
      .trim();
    const storeLabel = storeName ?? organizationName ?? 'tu tienda';

    try {
      if (credentialType === 'qr') {
        const qrCid = 'credencial-qr@vendix';
        const buffer = await QRCode.toBuffer(credentialValue, {
          type: 'png',
          width: 300,
          errorCorrectionLevel: 'M',
        });
        const { subject, html, text } =
          MembershipAccessEmailTemplates.credentialQrCreated({
            customerName,
            storeName: storeLabel,
            qrCid,
          });
        const result = await this.emailService.sendEmailWithAttachments(
          to,
          subject,
          html,
          [
            {
              filename: 'credencial-qr.png',
              content: buffer,
              contentType: 'image/png',
              cid: qrCid,
            },
          ],
          text,
        );
        return { sent: result.success, error: result.success ? undefined : result.error };
      }

      if (credentialType === 'pin') {
        const { subject, html, text } =
          MembershipAccessEmailTemplates.credentialPinCreated({
            customerName,
            storeName: storeLabel,
            pin: credentialValue,
          });
        const result = await this.emailService.sendEmail(to, subject, html, text);
        return { sent: result.success, error: result.success ? undefined : result.error };
      }

      // external_ref (fingerprint) — enrollment notice ONLY. No value leaked.
      const { subject, html, text } =
        MembershipAccessEmailTemplates.credentialFingerprintEnrolled({
          customerName,
          storeName: storeLabel,
        });
      const result = await this.emailService.sendEmail(to, subject, html, text);
      return { sent: result.success, error: result.success ? undefined : result.error };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(
        `membership-access: credential email failed (store=${storeId}, customer=${customer.id}, type=${credentialType}): ${message}`,
      );
      return { sent: false, error: message };
    }
  }

  /**
   * Create a credential for a member. Generation policy (Anotación 2b):
   *   - `qr`         → auto-generate 32-char hex; uniqueness checked against
   *     the active-credential partial index (`membership_access_cred_active_uq`).
   *   - `pin`        → auto-generate 6-digit zero-padded numeric PIN.
   *   - `external_ref` → operator-supplied reference; REQUIRED.
   *
   * The active-credential uniqueness is enforced with an explicit pre-check so
   * the error is a friendly 409 with a clear message instead of a Prisma
   * `P2002` race. The DB index is the authoritative guard under concurrency.
   *
   * After a successful insert we send the credential by email to the member.
   * Email delivery is best-effort (logged + skipped on error) — a member
   * without email or a transient provider failure MUST NOT block creation.
   *
   * The response includes the raw `credential_value` (one-shot, so the
   * frontend can surface the PIN / confirm the QR) and `email_sent: boolean`
   * so the operator gets immediate feedback when the email did not go out.
   */
  async createCredential(dto: CreateCredentialDto) {
    const storeId = this.requireStoreId();

    // 1. Validate member exists — expand the select so we can send the email.
    const customer = await this.prisma.users.findUnique({
      where: { id: dto.customer_id },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
      },
    });
    if (!customer) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'El cliente (socio) no existe',
      );
    }

    // 1b. Reject placeholder/missing emails BEFORE creating the credential.
    //     Members can be created with `email = null` (CustomersService.create
    //     allows optional email) or with a `@noemail.local` placeholder from
    //     the bulk-import scanner. Without this guard the credential is
    //     created but the email silently never arrives, leaving the operator
    //     with no way to know why.
    if (this.isPlaceholderEmail(customer.email)) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        customer.email
          ? 'El socio tiene un correo de marcador (sin email real). Actualiza su ficha de cliente con un correo válido antes de crear la credencial.'
          : 'El socio no tiene correo electrónico. Agrégalo en su ficha de cliente antes de crear la credencial.',
      );
    }

    // 2. Resolve / generate the credential value.
    let credentialValue: string;
    if (dto.credential_type === membership_credential_type_enum.external_ref) {
      // Required for external_ref (also enforced by the DTO's @ValidateIf).
      const supplied = dto.credential_value?.trim();
      if (!supplied) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'Para una credencial de tipo huella (external_ref) debes ingresar el identificador del dispositivo',
        );
      }
      credentialValue = supplied;
    } else {
      credentialValue = await this.generateCredentialValue(
        storeId,
        dto.credential_type as 'qr' | 'pin',
      );
    }

    // 3. Active-uniqueness pre-check (the partial unique index is the
    //    authoritative guard under concurrency; this is the friendly 409).
    const activeDup = await this.credentials.findFirst({
      where: {
        store_id: storeId,
        customer_id: dto.customer_id,
        credential_type: dto.credential_type,
        is_active: true,
      },
      select: { id: true },
    });
    if (activeDup) {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        'Ya existe una credencial activa de este tipo para este socio',
      );
    }

    // 4. Persist. Catch Prisma P2002 to translate race-condition duplicates
    //    (two concurrent creates) into a clean 409.
    let created;
    try {
      created = await this.credentials.create({
        data: {
          store_id: storeId,
          customer_id: dto.customer_id,
          credential_type: dto.credential_type,
          credential_value: credentialValue,
          is_active: dto.is_active ?? true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Disambiguate WHICH unique constraint was violated so the operator
        // gets a precise message. Prisma's `meta.target` is the constraint/
        // index name (string) or the column list (array) depending on driver.
        const target = (error.meta as { target?: unknown } | undefined)?.target;
        const targetStr = Array.isArray(target)
          ? target.join(',')
          : String(target ?? '');

        // Partial active-uniqueness index (store_id, customer_id, type) WHERE
        // is_active = true → same member already has an active credential of
        // this type.
        if (targetStr.includes('membership_access_cred_active_uq')) {
          throw new VendixHttpException(
            ErrorCodes.SYS_CONFLICT_001,
            'Ya existe una credencial activa de este tipo para este socio',
          );
        }

        // Global value-uniqueness index (store_id, credential_type,
        // credential_value) → the generated/supplied value already exists in
        // this store (active OR archived).
        if (
          targetStr.includes('membership_access_cred_uq') ||
          targetStr.includes('credential_value')
        ) {
          throw new VendixHttpException(
            ErrorCodes.SYS_CONFLICT_001,
            'Ya existe una credencial con ese valor en esta tienda',
          );
        }

        // Unknown target → keep the previous (safe) message.
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          'Ya existe una credencial activa de este tipo para este socio',
        );
      }
      throw error;
    }

    // 5. Best-effort email. The credential is ALREADY created; if email
    //    fails, the operator still sees the returned `email_sent: false`
    //    and can re-share the value manually (it is the only time it is
    //    exposed in clear text).
    const emailResult = await this.sendCredentialEmail({
      storeId,
      customer,
      credentialType: dto.credential_type as 'qr' | 'pin' | 'external_ref',
      credentialValue,
    });

    // Privacy: mask the raw `credential_value` for `external_ref` (biometric
    // device fingerprint ref) so it NEVER leaks in the HTTP response. The DB
    // row keeps the value untouched. For `qr` and `pin` the raw value is
    // intentionally returned ONE-SHOT so the operator can confirm/display
    // it on the same screen (per DTO Anotación 2b). The masking policy
    // mirrors `maskCredentialValue()` used by `listCredentials`.
    let responseCredentialValue: string | null = created.credential_value;
    if (dto.credential_type === membership_credential_type_enum.external_ref) {
      responseCredentialValue = this.maskCredentialValue(
        dto.credential_type,
        created.credential_value,
      );
    }

    return {
      ...created,
      credential_value: responseCredentialValue,
      // The raw value is one-shot — the list endpoint masks it. Frontend
      // uses it to confirm/display the generated QR/PIN or the fingerprint
      // reference on the same screen.
      email_sent: emailResult.sent,
      email_error: emailResult.error ?? null,
    };
  }

  /**
   * Re-send the credential email for an existing credential row. Used by the
   * operator when the original create email never arrived (provider outage,
   * transient failure) or when the member's email was fixed after the
   * credential was created. Reuses `sendCredentialEmail`, which for
   * `external_ref` (biometric) sends the enrollment notice ONLY — the device
   * reference is never leaked.
   *
   * Permission: same `store:membership_access:create` as the create endpoint
   * (a re-send is a re-issuance of the credential notification).
   */
  async resendCredentialEmail(credentialId: number) {
    const storeId = this.requireStoreId();

    const credential = await this.credentials.findFirst({
      where: { id: credentialId, store_id: storeId },
      select: {
        id: true,
        credential_type: true,
        credential_value: true,
        customer_id: true,
      },
    });
    if (!credential) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'La credencial no existe',
      );
    }

    const customer = await this.prisma.users.findUnique({
      where: { id: credential.customer_id },
      select: { id: true, first_name: true, last_name: true, email: true },
    });
    if (!customer) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'El cliente (socio) no existe',
      );
    }
    if (this.isPlaceholderEmail(customer.email)) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        customer.email
          ? 'El socio tiene un correo de marcador (sin email real). Actualiza su ficha de cliente con un correo válido.'
          : 'El socio no tiene correo electrónico. Agrégalo en su ficha de cliente.',
      );
    }

    const result = await this.sendCredentialEmail({
      storeId,
      customer,
      credentialType: credential.credential_type as 'qr' | 'pin' | 'external_ref',
      credentialValue: credential.credential_value,
    });
    return { email_sent: result.sent, email_error: result.error ?? null };
  }

  async listCredentials(query: CredentialQueryDto) {
    const storeId = this.requireStoreId();
    const {
      page = 1,
      limit = 10,
      customer_id,
      is_active,
      search,
      credential_type,
    } = query ?? {};
    const skip = (page - 1) * limit;

    // Server-side search: pre-fetch users matching the term in any of the
    // canonical contact fields, then restrict credentials to that set.
    // Mirrors `memberships.service.ts::findAll` (lines 200-233).
    const term = (search ?? '').trim();
    let customerFilter:
      | Prisma.membership_access_credentialsWhereInput['customer_id']
      | undefined;

    if (term) {
      const matched = await this.prisma.users.findMany({
        where: {
          OR: [
            { first_name: { contains: term, mode: 'insensitive' } },
            { last_name: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
            { phone: { contains: term, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
        take: 5000,
      });
      const matchedIds = matched.map((u) => u.id);

      // Intersect with an explicit customer_id if provided; otherwise use all
      // matches. An empty set is forced to [-1] so the query returns 0 rows
      // instead of the entire store credentials list.
      const customerIdsFilter =
        customer_id !== undefined
          ? matchedIds.filter((id) => id === customer_id)
          : matchedIds;

      customerFilter = {
        in: customerIdsFilter.length ? customerIdsFilter : [-1],
      };
    } else if (customer_id !== undefined) {
      customerFilter = customer_id;
    }

    const where: Prisma.membership_access_credentialsWhereInput = {
      store_id: storeId,
      deleted_at: null,
      ...(customerFilter !== undefined && { customer_id: customerFilter }),
      ...(is_active !== undefined && { is_active }),
      ...(credential_type !== undefined && { credential_type }),
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
    // Order matters: clone the row, attach `customer` (batch-fetch), then
    // strip `credential_value` — so the masked value lands on a row that
    // already carries the `customer` snapshot.
    const data = (
      await this.attachCustomer(rows)
    ).map(({ credential_value, ...rest }) => ({
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

  /**
   * Soft-archive a credential (HIDE from listings + free the partial unique
   * slot for re-use). Atomic single UPDATE that flips BOTH:
   *   - `deleted_at = now()`  → excluded from `listCredentials` (filters
   *                              `deleted_at IS NULL`) and excluded from any
   *                              future "not archived" partial index.
   *   - `is_active = false`   → excluded from the partial unique index
   *                              `membership_access_cred_active_uq`
   *                              (WHERE is_active = true), freeing the slot
   *                              so the operator can re-issue a credential with
   *                              the same `(store, customer, type)` tuple
   *                              without manual DB cleanup.
   *
   * Both changes ride the same `updateMany` so they commit atomically — there
   * is no observable state where the credential is half-archived.
   *
   * The `deleted_at: null` predicate in the where clause makes the operation
   * IDEMPOTENT: archiving an already-archived credential returns NOT_FOUND
   * instead of silently re-stamping `deleted_at`.
   */
  async archiveCredential(id: number) {
    const storeId = this.requireStoreId();
    const result = await this.credentials.updateMany({
      where: { id, store_id: storeId, deleted_at: null },
      data: { deleted_at: new Date(), is_active: false },
    });
    if (result.count === 0) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Credencial no encontrada o ya archivada',
      );
    }
    return { archived: true, id };
  }

  // ------------------------------------------------------------------ Logs

  async listLogs(query: AccessLogQueryDto) {
    const storeId = this.requireStoreId();
    const {
      page = 1,
      limit = 20,
      customer_id,
      result,
      date_from,
      date_to,
      search,
    } = query ?? {};
    const skip = (page - 1) * limit;

    // Server-side search: pre-fetch users matching the term in any of the
    // canonical contact fields, then restrict logs to that set.
    // Mirrors `memberships.service.ts::findAll` (lines 200-233).
    const term = (search ?? '').trim();
    let customerFilter:
      | Prisma.membership_access_logsWhereInput['customer_id']
      | undefined;

    if (term) {
      const matched = await this.prisma.users.findMany({
        where: {
          OR: [
            { first_name: { contains: term, mode: 'insensitive' } },
            { last_name: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
            { phone: { contains: term, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
        take: 5000,
      });
      const matchedIds = matched.map((u) => u.id);

      // Intersect with an explicit customer_id if provided; otherwise use all
      // matches. An empty set is forced to [-1] so the query returns 0 rows
      // instead of the entire store logs list.
      const customerIdsFilter =
        customer_id !== undefined
          ? matchedIds.filter((id) => id === customer_id)
          : matchedIds;

      customerFilter = {
        in: customerIdsFilter.length ? customerIdsFilter : [-1],
      };
    } else if (customer_id !== undefined) {
      customerFilter = customer_id;
    }

    const where: Prisma.membership_access_logsWhereInput = {
      store_id: storeId,
      ...(customerFilter !== undefined && { customer_id: customerFilter }),
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

    const dataWithCustomer = await this.attachCustomer(data);

    return {
      data: dataWithCustomer,
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

  /**
   * Read the store's re-entry policy from `store_settings.membership`. Mirrors
   * `getCapacityConfig`: `withoutScope()` + explicit `store_id`, never throws.
   * Defaults are `mode = 'warn'` and `windowHours = 2` (per the contract), also
   * applied when the settings read fails or the stored values are invalid.
   */
  private async getReEntryConfig(storeId: number): Promise<ReEntryConfig> {
    try {
      const row = await this.prisma
        .withoutScope()
        .store_settings.findFirst({
          where: { store_id: storeId },
          select: { settings: true },
        });
      const settings = mergeStoreSettingsWithDefaults(row?.settings);
      const m = settings.membership;
      const rawMode = m?.re_entry_mode;
      const mode: 'off' | 'warn' | 'block' =
        rawMode === 'off' || rawMode === 'block' ? rawMode : 'warn';
      const rawWindow = Number(m?.re_entry_window_hours);
      const windowHours =
        Number.isFinite(rawWindow) && rawWindow > 0 ? rawWindow : 2;
      return { mode, windowHours };
    } catch {
      return { mode: 'warn', windowHours: 2 };
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

  /**
   * Fan out an `enrollment` SSE event so a listening credential-creation modal
   * can capture a live fingerprint `external_ref` from the biometric device.
   *
   * Enrollment is intentionally NOT validated against any credential — it is a
   * raw read, the user decides later which credential receives it. Never
   * throws: a broken hub must not block the device's enrollment pings.
   */
  async publishEnrollment(
    storeId: number,
    externalRef: string,
    deviceId?: string,
  ): Promise<void> {
    try {
      const event: MembershipAccessSseEvent = {
        type: 'enrollment',
        external_ref: externalRef,
        device_id: deviceId ?? null,
        at: new Date().toISOString(),
      };
      this.sseService.push(storeId, event as unknown as SseNotificationPayload);
    } catch (err) {
      this.logger.warn(
        `membership-access enrollment SSE push failed for store=${storeId}: ${(err as Error).message}`,
      );
    }
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
