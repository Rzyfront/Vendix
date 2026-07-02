import { Inject, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import {
  Prisma,
  gym_access_result_enum,
  gym_membership_status_enum,
} from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { REDIS_CLIENT } from 'src/common/redis/redis.module';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  ValidateAccessDto,
  CreateCredentialDto,
  UpdateCredentialDto,
  CredentialQueryDto,
  AccessLogQueryDto,
} from './dto';

export interface AccessValidationResult {
  granted: boolean;
  result: gym_access_result_enum;
  reason: string | null;
  customer_id: number | null;
  membership_id: number | null;
}

/**
 * GymAccessService
 *
 * Store-scoped access control for the Gym Suite:
 *   - `validate`: resolve a member by their active credential, evaluate the
 *     current membership, enforce an optional per-period access quota, ALWAYS
 *     write a `gym_access_logs` row, and return grant/deny + reason.
 *   - Credentials CRUD (`gym_access_credentials`).
 *   - Access logs listing (`gym_access_logs`).
 *
 * Quota ("N accesses / month"): mirrors the AI quota pattern
 * (`subscription-access.service`) — read-only check BEFORE granting, atomic
 * dedup+increment AFTER granting. Keyed per member:
 *   counter: gym:quota:{storeId}:{customerId}:access:{YYYYMM}
 *   dedup  : gym:quota:dedup:{storeId}:{customerId}:access:{YYYYMM}
 *
 * Tenant scope: `gym_*` models use `withoutScope()` + explicit `store_id`
 * (see GymMembershipsService note) until the scoped getters are exposed on
 * `StorePrismaService`.
 */
@Injectable()
export class GymAccessService {
  private readonly logger = new Logger(GymAccessService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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
    return this.prisma.withoutScope().gym_access_credentials;
  }

  private get accessLogs() {
    return this.prisma.withoutScope().gym_access_logs;
  }

  private get gymMemberships() {
    return this.prisma.withoutScope().gym_memberships;
  }

  private get gymPlans() {
    return this.prisma.withoutScope().gym_plans;
  }

  // ------------------------------------------------------------------ Validate

  async validate(dto: ValidateAccessDto): Promise<AccessValidationResult> {
    const storeId = this.requireStoreId();
    const now = new Date();

    // 1. Resolve the active credential → member.
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
        result: gym_access_result_enum.denied_no_membership,
        reason: 'Credencial no encontrada o inactiva',
        customer_id: null,
        membership_id: null,
        credential_id: null,
        device_id: dto.device_id,
      });
    }

    const customerId = credential.customer_id;

    // 2. Current, non-expired active membership.
    const active = await this.gymMemberships.findFirst({
      where: {
        store_id: storeId,
        customer_id: customerId,
        status: gym_membership_status_enum.active,
        period_end: { gte: now },
      },
      orderBy: { period_end: 'desc' },
      select: { id: true, gym_plan_id: true },
    });

    if (!active) {
      const latest = await this.gymMemberships.findFirst({
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
      });
    }

    // 3. Optional per-period access quota.
    const plan = await this.gymPlans.findFirst({
      where: { id: active.gym_plan_id, store_id: storeId },
      select: { access_limit_per_period: true },
    });
    const limit = plan?.access_limit_per_period ?? 0;
    if (limit && limit > 0) {
      const used = await this.getQuotaUsed(storeId, customerId);
      if (used >= limit) {
        return this.logAndReturn(storeId, {
          result: gym_access_result_enum.denied_quota_exceeded,
          reason: `Límite de accesos del período alcanzado (${limit})`,
          customer_id: customerId,
          membership_id: active.id,
          credential_id: credential.id,
          device_id: dto.device_id,
        });
      }
    }

    // 4. Grant → consume quota (dedup) after the decision.
    if (limit && limit > 0) {
      await this.consumeQuota(storeId, customerId);
    }

    return this.logAndReturn(storeId, {
      result: gym_access_result_enum.granted,
      reason: null,
      customer_id: customerId,
      membership_id: active.id,
      credential_id: credential.id,
      device_id: dto.device_id,
    });
  }

  private diagnoseDenied(
    latest: { status: gym_membership_status_enum; period_end: Date | null } | null,
    now: Date,
  ): { result: gym_access_result_enum; reason: string } {
    if (!latest) {
      return {
        result: gym_access_result_enum.denied_no_membership,
        reason: 'El socio no tiene membresía',
      };
    }
    switch (latest.status) {
      case gym_membership_status_enum.suspended:
        return {
          result: gym_access_result_enum.denied_suspended,
          reason: 'Membresía suspendida',
        };
      case gym_membership_status_enum.frozen:
        return {
          result: gym_access_result_enum.denied_frozen,
          reason: 'Membresía congelada',
        };
      case gym_membership_status_enum.expired:
        return {
          result: gym_access_result_enum.denied_expired,
          reason: 'Membresía vencida',
        };
      case gym_membership_status_enum.active:
        // Active but failed the period_end >= now filter above → expired window.
        return {
          result: gym_access_result_enum.denied_expired,
          reason: 'Período de la membresía vencido',
        };
      case gym_membership_status_enum.pending_payment:
        return {
          result: gym_access_result_enum.denied_no_membership,
          reason: 'Membresía pendiente de pago',
        };
      case gym_membership_status_enum.cancelled:
      default:
        return {
          result: gym_access_result_enum.denied_no_membership,
          reason: 'Membresía cancelada o no vigente',
        };
    }
  }

  private async logAndReturn(
    storeId: number,
    entry: {
      result: gym_access_result_enum;
      reason: string | null;
      customer_id: number | null;
      membership_id: number | null;
      credential_id: number | null;
      device_id?: string;
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
        `gym_access_logs write failed for store=${storeId}: ${(err as Error).message}`,
      );
    }

    return {
      granted: entry.result === gym_access_result_enum.granted,
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

    const where: Prisma.gym_access_credentialsWhereInput = {
      store_id: storeId,
      ...(customer_id !== undefined && { customer_id }),
      ...(is_active !== undefined && { is_active }),
    };

    const [data, total] = await Promise.all([
      this.credentials.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'desc' },
      }),
      this.credentials.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
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

    const data: Prisma.gym_access_credentialsUpdateInput = {
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

    const where: Prisma.gym_access_logsWhereInput = {
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
    return `gym:quota:${storeId}:${customerId}:access:${this.periodKey()}`;
  }

  private dedupKey(storeId: number, customerId: number): string {
    return `gym:quota:dedup:${storeId}:${customerId}:access:${this.periodKey()}`;
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
        `gym access quota consume failed store=${storeId} customer=${customerId}: ${(err as Error).message}`,
      );
    }
  }
}
