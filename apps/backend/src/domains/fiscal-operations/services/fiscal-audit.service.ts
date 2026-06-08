import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { FiscalHistoryQueryDto } from '../dto/fiscal-operations.dto';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';

interface FiscalAuditResource {
  id?: number;
  organization_id: number;
  store_id?: number | null;
  accounting_entity_id: number;
  status?: string;
}

interface FiscalAuditEventParams {
  event_type: string;
  resource_type: string;
  resource_id?: number | null;
  obligation_id?: number | null;
  declaration_id?: number | null;
  close_session_id?: number | null;
  evidence_id?: number | null;
  previous_status?: string | null;
  new_status?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class FiscalAuditService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async logEvent(
    context: Pick<
      FiscalOperationsContext,
      'organization_id' | 'store_id' | 'accounting_entity_id'
    >,
    params: FiscalAuditEventParams,
  ) {
    return this.prisma.fiscal_operation_events.create({
      data: this.buildEventData(context, params),
    });
  }

  async logForResource(
    resource: FiscalAuditResource,
    params: FiscalAuditEventParams,
  ) {
    return this.logEvent(
      {
        organization_id: resource.organization_id,
        store_id: resource.store_id ?? null,
        accounting_entity_id: resource.accounting_entity_id,
      },
      {
        ...params,
        resource_id: params.resource_id ?? resource.id,
        new_status: params.new_status ?? resource.status,
      },
    );
  }

  async list(
    contexts: FiscalOperationsContext[],
    query: FiscalHistoryQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where: Prisma.fiscal_operation_eventsWhereInput = {
      ...this.whereForContexts(contexts),
      ...(query.event_type ? { event_type: query.event_type } : {}),
      ...(query.resource_type ? { resource_type: query.resource_type } : {}),
      ...(query.resource_id ? { resource_id: query.resource_id } : {}),
      ...(query.obligation_id ? { obligation_id: query.obligation_id } : {}),
      ...(query.declaration_id ? { declaration_id: query.declaration_id } : {}),
      ...(query.close_session_id
        ? { close_session_id: query.close_session_id }
        : {}),
      ...(query.evidence_id ? { evidence_id: query.evidence_id } : {}),
      ...(query.store_id ? { store_id: query.store_id } : {}),
      ...(query.accounting_entity_id
        ? { accounting_entity_id: query.accounting_entity_id }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.fiscal_operation_events.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        include: {
          actor_user: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          accounting_entity: {
            select: {
              id: true,
              legal_name: true,
              name: true,
              tax_id: true,
            },
          },
          store: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      this.prisma.fiscal_operation_events.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  private buildEventData(
    context: Pick<
      FiscalOperationsContext,
      'organization_id' | 'store_id' | 'accounting_entity_id'
    >,
    params: FiscalAuditEventParams,
  ): Prisma.fiscal_operation_eventsUncheckedCreateInput {
    return {
      organization_id: context.organization_id,
      store_id: context.store_id ?? undefined,
      accounting_entity_id: context.accounting_entity_id,
      event_type: params.event_type,
      resource_type: params.resource_type,
      resource_id: params.resource_id ?? undefined,
      obligation_id: params.obligation_id ?? undefined,
      declaration_id: params.declaration_id ?? undefined,
      close_session_id: params.close_session_id ?? undefined,
      evidence_id: params.evidence_id ?? undefined,
      previous_status: params.previous_status ?? undefined,
      new_status: params.new_status ?? undefined,
      actor_user_id: RequestContextService.getUserId(),
      metadata: this.buildMetadata(params.metadata),
    };
  }

  private buildMetadata(
    metadata?: Record<string, unknown>,
  ): Prisma.InputJsonObject {
    const requestId = RequestContextService.getRequestId();
    const compacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata ?? {})) {
      if (value !== undefined) compacted[key] = value;
    }
    if (requestId) compacted.request_id = requestId;
    return JSON.parse(JSON.stringify(compacted)) as Prisma.InputJsonObject;
  }

  private whereForContexts(
    contexts: FiscalOperationsContext[],
  ): Prisma.fiscal_operation_eventsWhereInput {
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
