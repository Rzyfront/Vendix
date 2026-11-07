import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowTx } from '../engine/workflow-engine.types';
import {
  PUBLIC_FORM_UNAVAILABLE_MESSAGES,
  newPublicToken,
  publicFormAvailability,
} from './workflow-public-link.rules';

/** Design-side management of the public link of a flow (one active per flow). */
@Injectable()
export class WorkflowPublicLinksService {
  constructor(private readonly prisma: StorePrismaService) {}

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
    const link = await this.prisma.workflow_public_links.findFirst({
      where: { store_id: c.store_id, definition_id: definitionId, is_active: true },
      orderBy: { id: 'desc' },
    });
    return {
      active: !!link,
      created_at: link?.created_at ?? null,
      expires_at: link?.expires_at ?? null,
      last_used_at: link?.last_used_at ?? null,
    };
  }

  /** Creates the link (revoking the previous one). The raw token is returned once. */
  async create(definitionId: number) {
    const c = this.ctx();
    return this.prisma.$transaction(async (tx: WorkflowTx) => {
      const { published } = await this.loadDefinition(tx, c.store_id, definitionId);
      const availability = publicFormAvailability(published);
      if (!availability.available) {
        throw new VendixHttpException(
          ErrorCodes.WORKFLOW_PUBLIC_LINK_UNAVAILABLE,
          PUBLIC_FORM_UNAVAILABLE_MESSAGES[availability.reason],
          { reason: availability.reason },
        );
      }
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
          created_by_user_id: c.user_id,
        },
      });
      return { url_path: `/flujos/${token}`, token };
    });
  }

  async revoke(definitionId: number) {
    const c = this.ctx();
    await this.loadDefinition(this.prisma, c.store_id, definitionId, false);
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
