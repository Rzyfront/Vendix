import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  INBOUND_DEFAULT_RATE_PER_MINUTE,
  INBOUND_PUBLIC_PATH,
  declaresTrigger,
  generateInboundPublicId,
  generateInboundSecret,
} from './workflow-inbound.rules';

/** Never select `secret_enc`: only the receiver reads it. */
const STATE_SELECT = {
  id: true,
  public_id: true,
  is_active: true,
  rate_limit_per_minute: true,
  last_used_at: true,
  created_at: true,
} as const;

/** Admin side of the per-flow inbound webhook (`store:workflows:design`). */
@Injectable()
export class WorkflowInboundHooksService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id || !c.user_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    }
    return { store_id: c.store_id, organization_id: c.organization_id, user_id: c.user_id };
  }

  /** Foreign or unknown definition → 404. */
  private async loadDefinition(storeId: number, id: number) {
    const def = await this.prisma.workflow_definitions.findFirst({
      where: { id, store_id: storeId },
      select: { id: true, status: true, published_version_id: true },
    });
    if (!def) throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    return def;
  }

  private async assertDeclaresWebhook(
    storeId: number,
    def: { status: string; published_version_id: number | null },
  ) {
    const unavailable = (message: string) =>
      new VendixHttpException(ErrorCodes.WORKFLOW_INBOUND_UNAVAILABLE, message);
    if (def.status !== 'active' || !def.published_version_id) {
      throw unavailable('Publica el flujo antes de activar su webhook de entrada.');
    }
    const version = await this.prisma.workflow_versions.findFirst({
      where: { id: def.published_version_id, store_id: storeId },
      select: { definition: true },
    });
    const published = version?.definition as WorkflowDefinitionV1 | undefined;
    if (!published || !declaresTrigger(published, 'webhook')) {
      throw unavailable(
        'La versión publicada no tiene el disparador "Webhook de entrada". Agrégalo en Disparadores y publica de nuevo.',
      );
    }
  }

  /** Scoped `updateMany` (the store filter is part of the write) + re-read. */
  private async change(storeId: number, id: number, data: Record<string, unknown>) {
    await this.prisma.workflow_inbound_hooks.updateMany({
      where: { id, store_id: storeId },
      data,
    });
    const hook = await this.prisma.workflow_inbound_hooks.findFirst({
      where: { id, store_id: storeId },
      select: STATE_SELECT,
    });
    if (!hook) throw new VendixHttpException(ErrorCodes.WORKFLOW_INBOUND_NOT_ACTIVATED);
    return hook;
  }

  private async view(
    storeId: number,
    hook: {
      id: number;
      public_id: string;
      is_active: boolean;
      rate_limit_per_minute: number;
      last_used_at: Date | null;
      created_at: Date;
    },
  ) {
    const recent_requests_24h = await this.prisma.workflow_inbound_requests.count({
      where: {
        store_id: storeId,
        hook_id: hook.id,
        created_at: { gte: new Date(Date.now() - 24 * 3_600_000) },
      },
    });
    return {
      public_id: hook.public_id,
      path: `${INBOUND_PUBLIC_PATH}/${hook.public_id}`,
      is_active: hook.is_active,
      rate_limit_per_minute: hook.rate_limit_per_minute,
      last_used_at: hook.last_used_at,
      created_at: hook.created_at,
      recent_requests_24h,
    };
  }

  /** State of the hook, or null when never activated. The secret is never recoverable. */
  async state(definitionId: number) {
    const c = this.ctx();
    await this.loadDefinition(c.store_id, definitionId);
    const hook = await this.prisma.workflow_inbound_hooks.findFirst({
      where: { store_id: c.store_id, definition_id: definitionId },
      select: STATE_SELECT,
    });
    return hook ? this.view(c.store_id, hook) : null;
  }

  /** Creates the hook or reactivates a deactivated one with a fresh secret (returned once). */
  async create(definitionId: number) {
    const c = this.ctx();
    const def = await this.loadDefinition(c.store_id, definitionId);
    await this.assertDeclaresWebhook(c.store_id, def);
    const existing = await this.prisma.workflow_inbound_hooks.findFirst({
      where: { store_id: c.store_id, definition_id: definitionId },
      select: { id: true, is_active: true },
    });
    if (existing?.is_active) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_INBOUND_ALREADY_ACTIVE);
    }
    const secret = generateInboundSecret();
    const secret_enc = this.encryption.encrypt(secret);
    const hook = existing
      ? await this.change(c.store_id, existing.id, { secret_enc, is_active: true })
      : await this.prisma.workflow_inbound_hooks.create({
          data: {
            organization_id: c.organization_id,
            store_id: c.store_id,
            definition_id: definitionId,
            public_id: generateInboundPublicId(),
            secret_enc,
            is_active: true,
            rate_limit_per_minute: INBOUND_DEFAULT_RATE_PER_MINUTE,
            created_by_user_id: c.user_id,
          },
          select: STATE_SELECT,
        });
    return { ...(await this.view(c.store_id, hook)), secret };
  }

  /** New secret (returned once); the previous one stops working immediately. */
  async rotate(definitionId: number) {
    const c = this.ctx();
    await this.loadDefinition(c.store_id, definitionId);
    const existing = await this.prisma.workflow_inbound_hooks.findFirst({
      where: { store_id: c.store_id, definition_id: definitionId },
      select: { id: true },
    });
    if (!existing) throw new VendixHttpException(ErrorCodes.WORKFLOW_INBOUND_NOT_ACTIVATED);
    const secret = generateInboundSecret();
    const hook = await this.change(c.store_id, existing.id, {
      secret_enc: this.encryption.encrypt(secret),
    });
    return { ...(await this.view(c.store_id, hook)), secret };
  }

  async update(
    definitionId: number,
    patch: { is_active?: boolean; rate_limit_per_minute?: number },
  ) {
    const c = this.ctx();
    const def = await this.loadDefinition(c.store_id, definitionId);
    const existing = await this.prisma.workflow_inbound_hooks.findFirst({
      where: { store_id: c.store_id, definition_id: definitionId },
      select: { id: true, is_active: true },
    });
    if (!existing) throw new VendixHttpException(ErrorCodes.WORKFLOW_INBOUND_NOT_ACTIVATED);
    // Switching it back on needs the same conditions as creating it.
    if (patch.is_active === true && !existing.is_active) {
      await this.assertDeclaresWebhook(c.store_id, def);
    }
    const hook = await this.change(c.store_id, existing.id, {
      ...(patch.is_active !== undefined ? { is_active: patch.is_active } : {}),
      ...(patch.rate_limit_per_minute !== undefined
        ? { rate_limit_per_minute: patch.rate_limit_per_minute }
        : {}),
    });
    return this.view(c.store_id, hook);
  }
}
