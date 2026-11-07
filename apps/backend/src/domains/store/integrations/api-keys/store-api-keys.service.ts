import { Injectable } from '@nestjs/common';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { MAX_ACTIVE_API_KEYS } from './api-key.constants';
import { generateApiKey, isApiKeyScope } from './api-key.util';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

/** Never select the hash: nothing but the guard's lookup may ever read it. */
const PUBLIC_SELECT = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  created_by_user_id: true,
  acting_user_id: true,
  last_used_at: true,
  last_used_ip: true,
  expires_at: true,
  revoked_at: true,
  created_at: true,
} as const;

const DAY_MS = 86_400_000;

/** Management of the store's API keys (JWT, `store:integrations:api_keys`). */
@Injectable()
export class StoreApiKeysService {
  constructor(private readonly prisma: StorePrismaService) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id || !c.user_id) {
      throw new VendixHttpException(ErrorCodes.API_KEY_NOT_FOUND);
    }
    return {
      store_id: c.store_id,
      organization_id: c.organization_id,
      user_id: c.user_id,
    };
  }

  private activeWhere(store_id: number, now: Date) {
    return {
      store_id,
      revoked_at: null,
      OR: [{ expires_at: null }, { expires_at: { gt: now } }],
    };
  }

  async list() {
    const { store_id } = this.ctx();
    return this.prisma.store_api_keys.findMany({
      where: { store_id },
      select: PUBLIC_SELECT,
      orderBy: { created_at: 'desc' },
    });
  }

  /** Returns the secret exactly once, alongside the stored (public) fields. */
  async create(dto: CreateApiKeyDto, now = new Date()) {
    const { store_id, organization_id, user_id } = this.ctx();

    const scopes = [...new Set(dto.scopes ?? [])];
    if (scopes.length === 0 || !scopes.every(isApiKeyScope)) {
      throw new VendixHttpException(ErrorCodes.API_KEY_SCOPE_INVALID);
    }

    // A key ALWAYS acts as the user who creates it. Server-side only: no input
    // can choose another identity.
    const acting_user_id = user_id;

    const generated = generateApiKey();
    // Count + insert under a lock on the store row, so two concurrent creations
    // cannot both pass the cap (same pattern as the workflow reference generator).
    const row = await this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM stores WHERE id = ${store_id} FOR NO KEY UPDATE`;
      const active = await tx.store_api_keys.count({
        where: this.activeWhere(store_id, now),
      });
      if (active >= MAX_ACTIVE_API_KEYS) {
        throw new VendixHttpException(ErrorCodes.API_KEY_LIMIT_REACHED);
      }
      return tx.store_api_keys.create({
        data: {
          organization_id,
          store_id,
          name: dto.name.trim(),
          prefix: generated.prefix,
          key_hash: generated.key_hash,
          scopes,
          created_by_user_id: user_id,
          acting_user_id,
          expires_at: dto.expires_in_days
            ? new Date(now.getTime() + dto.expires_in_days * DAY_MS)
            : null,
        },
        select: PUBLIC_SELECT,
      });
    });

    return { ...row, secret: generated.secret };
  }

  /** Idempotent: revoking an already revoked key keeps its original `revoked_at`. */
  async revoke(id: number, now = new Date()) {
    const { store_id } = this.ctx();
    const row = await this.prisma.store_api_keys.findFirst({
      where: { id, store_id },
      select: PUBLIC_SELECT,
    });
    if (!row) throw new VendixHttpException(ErrorCodes.API_KEY_NOT_FOUND);
    if (row.revoked_at) return row;
    await this.prisma.store_api_keys.updateMany({
      where: { id, store_id, revoked_at: null },
      data: { revoked_at: now },
    });
    return this.prisma.store_api_keys.findFirst({
      where: { id, store_id },
      select: PUBLIC_SELECT,
    });
  }
}
