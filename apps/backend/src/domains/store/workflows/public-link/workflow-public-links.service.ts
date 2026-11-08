import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowAccessPolicy } from '../access/workflow-access.policy';
import { WorkflowTx } from '../engine/workflow-engine.types';
import {
  PUBLIC_FORM_UNAVAILABLE_MESSAGES,
  newPublicToken,
  publicFormAvailability,
  publicStoreOrigin,
} from './workflow-public-link.rules';

/**
 * Design-side management of the public link of a flow (one active per flow).
 * The state follows "Quién ve" and every change follows "Quién diseña" (P7.3).
 */
@Injectable()
export class WorkflowPublicLinksService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly access: WorkflowAccessPolicy,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id || !c.user_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    }
    return { store_id: c.store_id, organization_id: c.organization_id, user_id: c.user_id };
  }

  /** State of the link; the raw token is never recoverable. */
  async status(definitionId: number) {
    const c = this.ctx();
    await this.loadDefinition(this.prisma, c.store_id, definitionId, false);
    await this.access.assertCanView(definitionId);
    const link = await this.prisma.workflow_public_links.findFirst({
      where: { store_id: c.store_id, definition_id: definitionId, is_active: true },
      orderBy: { id: 'desc' },
    });
    return {
      active: !!link,
      created_at: link?.created_at ?? null,
      expires_at: link?.expires_at ?? null,
      captcha_required: link?.captcha_required ?? false,
      last_used_at: link?.last_used_at ?? null,
    };
  }

  /** Expiry and captcha of the active link. An expired or inactive link answers 404 publicly. */
  async updateSettings(
    definitionId: number,
    input: { captcha_required?: boolean; expires_at?: string | null },
  ) {
    const c = this.ctx();
    await this.loadDefinition(this.prisma, c.store_id, definitionId, false);
    await this.access.assertCanDesign(definitionId);
    const expiresAt =
      input.expires_at === undefined
        ? undefined
        : input.expires_at === null
          ? null
          : new Date(input.expires_at);
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new VendixHttpException(
        ErrorCodes.WORKFLOW_PUBLIC_LINK_UNAVAILABLE,
        'La fecha de vencimiento debe ser futura.',
      );
    }
    const link = await this.prisma.workflow_public_links.findFirst({
      where: { store_id: c.store_id, definition_id: definitionId, is_active: true },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    if (!link) throw new VendixHttpException(ErrorCodes.WORKFLOW_PUBLIC_NOT_FOUND);
    await this.prisma.workflow_public_links.updateMany({
      where: { id: link.id, store_id: c.store_id },
      data: {
        ...(input.captcha_required !== undefined ? { captcha_required: input.captcha_required } : {}),
        ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
      },
    });
    return this.status(definitionId);
  }

  /** Creates the link (revoking the previous one). The raw token is returned once. */
  async create(definitionId: number) {
    const c = this.ctx();
    await this.access.assertCanDesign(definitionId);
    const created = await this.prisma.$transaction(async (tx: WorkflowTx) => {
      const { published } = await this.loadDefinition(tx, c.store_id, definitionId);
      const availability = publicFormAvailability(published);
      if (!availability.available) {
        throw new VendixHttpException(
          ErrorCodes.WORKFLOW_PUBLIC_LINK_UNAVAILABLE,
          PUBLIC_FORM_UNAVAILABLE_MESSAGES[availability.reason],
          { reason: availability.reason },
        );
      }
      // Rotating replaces the token only: the new link keeps the captcha and
      // the expiry of the one it replaces (a first link starts without them).
      const previous = await tx.workflow_public_links.findFirst({
        where: { store_id: c.store_id, definition_id: definitionId, is_active: true },
        select: { captcha_required: true, expires_at: true },
      });
      await tx.workflow_public_links.updateMany({
        where: { store_id: c.store_id, definition_id: definitionId, is_active: true },
        data: { is_active: false },
      });
      const { token, hash } = newPublicToken();
      await tx.workflow_public_links.create({
        data: {
          organization_id: c.organization_id,
          store_id: c.store_id,
          definition_id: definitionId,
          token_hash: hash,
          is_active: true,
          captcha_required: previous?.captcha_required ?? false,
          expires_at: previous?.expires_at ?? null,
          created_by_user_id: c.user_id,
        },
      });
      return {
        url_path: `/flujos/${token}`,
        token,
        captcha_required: previous?.captcha_required ?? false,
        expires_at: previous?.expires_at ?? null,
      };
    });
    // Full URL on the store's public domain (for the QR); null without a domain.
    const origin = await publicStoreOrigin(this.prisma.withoutScope() as never, c.store_id);
    return { ...created, url: origin ? `${origin}${created.url_path}` : null };
  }

  async revoke(definitionId: number) {
    const c = this.ctx();
    await this.loadDefinition(this.prisma, c.store_id, definitionId, false);
    await this.access.assertCanDesign(definitionId);
    const res = await this.prisma.workflow_public_links.updateMany({
      where: { store_id: c.store_id, definition_id: definitionId, is_active: true },
      data: { is_active: false },
    });
    return { revoked: res.count };
  }

  private async loadDefinition(
    db: WorkflowTx,
    storeId: number,
    id: number,
    requirePublished = true,
  ): Promise<{ published: WorkflowDefinitionV1 }> {
    const def = await db.workflow_definitions.findFirst({
      where: { id, store_id: storeId },
      select: { id: true, status: true, published_version_id: true },
    });
    if (!def) throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    if (!requirePublished) return { published: undefined as unknown as WorkflowDefinitionV1 };
    if (def.status !== 'active' || !def.published_version_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_ACTIVE);
    }
    const version = await db.workflow_versions.findFirst({
      where: { id: def.published_version_id, store_id: storeId },
      select: { definition: true },
    });
    if (!version) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_ACTIVE);
    return { published: version.definition as WorkflowDefinitionV1 };
  }
}
