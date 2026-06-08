import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';
import {
  AttachFiscalEvidenceDto,
  FiscalListQueryDto,
} from '../dto/fiscal-operations.dto';
import { FiscalAuditService } from './fiscal-audit.service';

@Injectable()
export class FiscalEvidenceService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly audit: FiscalAuditService,
  ) {}

  async list(contexts: FiscalOperationsContext[], query: FiscalListQueryDto) {
    const evidences = await this.prisma.fiscal_evidences.findMany({
      where: {
        ...this.whereForContexts(contexts),
        ...(query.store_id ? { store_id: query.store_id } : {}),
        ...(query.accounting_entity_id
          ? { accounting_entity_id: query.accounting_entity_id }
          : {}),
      },
      orderBy: { created_at: 'desc' },
      take: query.limit ?? 50,
    });

    return evidences.map((evidence) => {
      const metadata =
        evidence.metadata &&
        typeof evidence.metadata === 'object' &&
        !Array.isArray(evidence.metadata)
          ? (evidence.metadata as Record<string, unknown>)
          : {};
      return {
        ...evidence,
        source_type: metadata.source_type,
        source_id: metadata.source_id,
      };
    });
  }

  async attach(context: FiscalOperationsContext, dto: AttachFiscalEvidenceDto) {
    return this.createEvidence(context, dto, {
      event_type: 'fiscal.evidence.attached',
      resource_type: 'fiscal_evidence',
    });
  }

  async attachToObligation(
    contexts: FiscalOperationsContext[],
    obligationId: number,
    dto: AttachFiscalEvidenceDto,
  ) {
    const obligation = await this.prisma.fiscal_obligations.findFirst({
      where: { ...this.obligationWhereForContexts(contexts), id: obligationId },
    });
    if (!obligation) throw new NotFoundException('Fiscal obligation not found');

    const evidence = await this.createEvidence(
      this.contextFromResource(obligation),
      {
        ...dto,
        source_type: 'fiscal_obligation',
        source_id: obligation.id,
      },
      {
        event_type: 'fiscal.obligation.evidence_attached',
        resource_type: 'fiscal_obligation',
        resource_id: obligation.id,
        obligation_id: obligation.id,
        previous_status: obligation.status,
        new_status: obligation.status,
      },
    );

    await this.prisma.fiscal_obligations.update({
      where: { id: obligation.id },
      data: { evidence_id: evidence.id },
    });

    return evidence;
  }

  async attachToDeclaration(
    contexts: FiscalOperationsContext[],
    declarationId: number,
    dto: AttachFiscalEvidenceDto,
  ) {
    const declaration = await this.prisma.tax_declaration_drafts.findFirst({
      where: {
        ...this.declarationWhereForContexts(contexts),
        id: declarationId,
      },
    });
    if (!declaration) {
      throw new NotFoundException('Tax declaration draft not found');
    }

    const evidence = await this.createEvidence(
      this.contextFromResource(declaration),
      {
        ...dto,
        source_type: 'tax_declaration_draft',
        source_id: declaration.id,
      },
      {
        event_type: 'fiscal.declaration.evidence_attached',
        resource_type: 'tax_declaration_draft',
        resource_id: declaration.id,
        declaration_id: declaration.id,
        obligation_id: declaration.obligation_id,
        previous_status: declaration.status,
        new_status: declaration.status,
      },
    );

    await this.prisma.tax_declaration_drafts.update({
      where: { id: declaration.id },
      data: { evidence_id: evidence.id },
    });

    return evidence;
  }

  async attachToCloseSession(
    contexts: FiscalOperationsContext[],
    closeSessionId: number,
    dto: AttachFiscalEvidenceDto,
  ) {
    const closeSession = await this.prisma.fiscal_close_sessions.findFirst({
      where: { ...this.closeWhereForContexts(contexts), id: closeSessionId },
    });
    if (!closeSession)
      throw new NotFoundException('Fiscal close session not found');

    return this.createEvidence(
      this.contextFromResource(closeSession),
      {
        ...dto,
        source_type: 'fiscal_close_session',
        source_id: closeSession.id,
      },
      {
        event_type: 'fiscal.close.evidence_attached',
        resource_type: 'fiscal_close_session',
        resource_id: closeSession.id,
        close_session_id: closeSession.id,
        previous_status: closeSession.status,
        new_status: closeSession.status,
      },
    );
  }

  private async createEvidence(
    context: Pick<
      FiscalOperationsContext,
      'organization_id' | 'store_id' | 'accounting_entity_id'
    >,
    dto: AttachFiscalEvidenceDto,
    event: {
      event_type: string;
      resource_type: string;
      resource_id?: number;
      obligation_id?: number | null;
      declaration_id?: number | null;
      close_session_id?: number | null;
      previous_status?: string | null;
      new_status?: string | null;
    },
  ) {
    const evidence = await this.prisma.fiscal_evidences.create({
      data: {
        organization_id: context.organization_id,
        store_id: context.store_id ?? undefined,
        accounting_entity_id: context.accounting_entity_id,
        evidence_type: dto.evidence_type,
        storage_key: dto.storage_key,
        content_hash: dto.content_hash,
        metadata: this.buildMetadata(dto),
        created_by_user_id: RequestContextService.getUserId(),
      },
    });

    await this.audit.logForResource(evidence, {
      ...event,
      evidence_id: evidence.id,
      metadata: {
        evidence_type: evidence.evidence_type,
        source_type: dto.source_type,
        source_id: dto.source_id,
        has_storage_key: Boolean(dto.storage_key),
        has_content_hash: Boolean(dto.content_hash),
      },
    });

    return evidence;
  }

  private buildMetadata(dto: AttachFiscalEvidenceDto): Prisma.InputJsonObject {
    const metadata: Record<string, unknown> = {
      ...(dto.metadata ?? {}),
      source_type: dto.source_type,
      source_id: dto.source_id,
    };
    return JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonObject;
  }

  private contextFromResource(resource: {
    organization_id: number;
    store_id?: number | null;
    accounting_entity_id: number;
  }) {
    return {
      organization_id: resource.organization_id,
      store_id: resource.store_id ?? null,
      accounting_entity_id: resource.accounting_entity_id,
    };
  }

  private whereForContexts(
    contexts: FiscalOperationsContext[],
  ): Prisma.fiscal_evidencesWhereInput {
    if (contexts.length === 1) {
      return {
        organization_id: contexts[0].organization_id,
        accounting_entity_id: contexts[0].accounting_entity_id,
      };
    }

    return {
      organization_id: contexts[0].organization_id,
      accounting_entity_id: {
        in: contexts.map((context) => context.accounting_entity_id),
      },
    };
  }

  private obligationWhereForContexts(
    contexts: FiscalOperationsContext[],
  ): Prisma.fiscal_obligationsWhereInput {
    if (contexts.length === 1) {
      return {
        organization_id: contexts[0].organization_id,
        accounting_entity_id: contexts[0].accounting_entity_id,
      };
    }

    return {
      organization_id: contexts[0].organization_id,
      accounting_entity_id: {
        in: contexts.map((context) => context.accounting_entity_id),
      },
    };
  }

  private declarationWhereForContexts(
    contexts: FiscalOperationsContext[],
  ): Prisma.tax_declaration_draftsWhereInput {
    if (contexts.length === 1) {
      return {
        organization_id: contexts[0].organization_id,
        accounting_entity_id: contexts[0].accounting_entity_id,
      };
    }

    return {
      organization_id: contexts[0].organization_id,
      accounting_entity_id: {
        in: contexts.map((context) => context.accounting_entity_id),
      },
    };
  }

  private closeWhereForContexts(
    contexts: FiscalOperationsContext[],
  ): Prisma.fiscal_close_sessionsWhereInput {
    if (contexts.length === 1) {
      return {
        organization_id: contexts[0].organization_id,
        accounting_entity_id: contexts[0].accounting_entity_id,
      };
    }

    return {
      organization_id: contexts[0].organization_id,
      accounting_entity_id: {
        in: contexts.map((context) => context.accounting_entity_id),
      },
    };
  }
}
