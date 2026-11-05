import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { industryAllowsKey } from '../../../../common/access/module-industries';
import { buildActiveUserRolesWhere } from '../../../../common/utils/role-scope.util';
import { API_KEY_LAST_USED_INTERVAL_MS } from './api-key.constants';
import { effectivePermissions, hashApiKey, hashesEqual } from './api-key.util';

/** What the guard attaches to the request once a key is accepted. */
export interface ApiKeyPrincipal {
  api_key_id: number;
  store_id: number;
  organization_id: number;
  /** The store user the key acts as. */
  user_id: number;
  scopes: string[];
  /** (acting user's permissions) ∩ (scope-allowed permissions). */
  permissions: string[];
}

/**
 * Resolves a presented API key into a principal. Every "this key is not
 * usable" outcome (unknown, malformed, revoked, expired, inactive store or
 * acting user, organization mismatch) throws the SAME `API_KEY_INVALID` 401,
 * so a caller cannot tell them apart. Only a VALID key on a store without the
 * `administration` industry gets the distinct 403, which reveals nothing the
 * key holder did not already own.
 */
@Injectable()
export class ApiKeyAuthService {
  private readonly logger = new Logger(ApiKeyAuthService.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  private invalid(): VendixHttpException {
    return new VendixHttpException(ErrorCodes.API_KEY_INVALID);
  }

  async authenticate(
    secret: string,
    ip: string,
    now = new Date(),
  ): Promise<ApiKeyPrincipal> {
    const hash = hashApiKey(secret);
    const row = await this.prisma.store_api_keys.findUnique({
      where: { key_hash: hash },
    });
    if (
      !row ||
      !hashesEqual(row.key_hash, hash) ||
      row.revoked_at ||
      (row.expires_at && row.expires_at.getTime() <= now.getTime())
    ) {
      throw this.invalid();
    }

    const [store, user] = await Promise.all([
      this.prisma.stores.findUnique({
        where: { id: row.store_id },
        select: {
          id: true,
          is_active: true,
          organization_id: true,
          industries: true,
        },
      }),
      this.prisma.users.findUnique({
        where: { id: row.acting_user_id },
        select: {
          id: true,
          state: true,
          locked_until: true,
          organization_id: true,
        },
      }),
    ]);
    if (
      !store ||
      !store.is_active ||
      store.organization_id !== row.organization_id ||
      !user ||
      user.state !== 'active' ||
      user.organization_id !== row.organization_id ||
      (user.locked_until && user.locked_until.getTime() > now.getTime())
    ) {
      throw this.invalid();
    }

    if (!industryAllowsKey('flows', store.industries)) {
      throw new VendixHttpException(
        ErrorCodes.MODULE_INDUSTRY_001,
        'Este módulo no está disponible para la industria de tu tienda.',
        { key: 'flows' },
      );
    }

    const permissions = effectivePermissions(
      await this.loadUserPermissions(user.id, store.id),
      row.scopes,
    );

    await this.touch(row.id, row.last_used_at, ip, now);

    return {
      api_key_id: row.id,
      store_id: store.id,
      organization_id: row.organization_id,
      user_id: user.id,
      scopes: row.scopes,
      permissions,
    };
  }

  /**
   * Same resolution the JWT strategy does at login: role assignments valid in
   * this store (store-specific or organization-wide), then their ACTIVE
   * permission rows.
   */
  async loadUserPermissions(
    userId: number,
    storeId: number,
  ): Promise<string[]> {
    const userRoles = await this.prisma.user_roles.findMany({
      where: buildActiveUserRolesWhere(userId, storeId),
      include: {
        roles: {
          include: { role_permissions: { include: { permissions: true } } },
        },
      },
    });
    const names = new Set<string>();
    for (const ur of userRoles) {
      for (const rp of ur.roles?.role_permissions ?? []) {
        const p = rp.permissions;
        if (p && p.status === 'active' && p.name) names.add(p.name);
      }
    }
    return [...names];
  }

  /** At most one write per key per minute; the conditional update is atomic. */
  private async touch(
    id: number,
    lastUsedAt: Date | null,
    ip: string,
    now: Date,
  ): Promise<void> {
    const threshold = new Date(now.getTime() - API_KEY_LAST_USED_INTERVAL_MS);
    if (lastUsedAt && lastUsedAt > threshold) return;
    try {
      await this.prisma.store_api_keys.updateMany({
        where: {
          id,
          OR: [{ last_used_at: null }, { last_used_at: { lte: threshold } }],
        },
        data: { last_used_at: now, last_used_ip: ip.slice(0, 64) },
      });
    } catch (err) {
      // Bookkeeping must never fail an otherwise valid request.
      this.logger.warn(
        `api key last_used update failed: ${(err as Error).message}`,
      );
    }
  }
}
