import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import type { ReceivedDocumentQueryDto } from '../dto/received-document.dto';
import { INBOX_STATES, inboxBaseWhere, inboxStateWhere, ReceivedDocumentInboxScope } from './received-document-inbox-projection';
import type { ReceivedDocumentsReadContext } from './received-documents-context.service';

export interface ReceivedDocumentInboxSummary {
  new: number;
  requires_review: number;
  accepted: number;
  reclaimed: number;
  total: number;
  as_of: Date;
}

export interface ReceivedDocumentReceptionStatus {
  dian_active: boolean;
  configured: boolean;
  active_connections: number;
  channels: Array<'api_poll' | 'webhook'>;
  last_received_at: Date | null;
  last_synced_at: Date | null;
  next_sync_at: Date | null;
  last_run: {
    status: string;
    received_count: number;
    duplicate_count: number;
    error_count: number;
    finished_at: Date | null;
  } | null;
  error_code: 'RECEPTION_CONNECTION_ERROR' | null;
  requires_operational_store: boolean;
}

const RUN_STATUSES = new Set(['pending', 'queued', 'running', 'completed', 'partial', 'failed', 'cancelled']);
const safeCount = (value: number): number => Number.isSafeInteger(value) && value >= 0 ? value : 0;

/** Receives an already-authorized scope; never resolves/creates entities or loads connection secrets. */
@Injectable()
export class ReceivedDocumentInboxStatusService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async summary(scope: ReceivedDocumentInboxScope, query: ReceivedDocumentQueryDto): Promise<ReceivedDocumentInboxSummary> {
    if (scope.accounting_entity_id == null) {
      return { new: 0, requires_review: 0, accepted: 0, reclaimed: 0, total: 0, as_of: new Date() };
    }
    const base = inboxBaseWhere(scope, query);
    return this.prisma.$transaction(async (tx) => {
      const as_of = new Date();
      const counts = await Promise.all(INBOX_STATES.map((state) => tx.received_documents.count({
        where: { AND: [base, inboxStateWhere(state)] },
      })));
      return {
        new: counts[0], requires_review: counts[1], accepted: counts[2], reclaimed: counts[3],
        total: counts.reduce((sum, count) => sum + count, 0), as_of,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async receptionStatus(
    scope: ReceivedDocumentInboxScope,
    context: ReceivedDocumentsReadContext,
  ): Promise<ReceivedDocumentReceptionStatus> {
    const empty: ReceivedDocumentReceptionStatus = {
      dian_active: false, configured: false, active_connections: 0, channels: [],
      last_received_at: null, last_synced_at: null, next_sync_at: null,
      last_run: null, error_code: null,
      requires_operational_store: context.is_organization && context.store_id == null,
    };
    if (scope.accounting_entity_id == null) return empty;
    const connectionWhere: Prisma.document_reception_connectionsWhereInput = {
      organization_id: scope.organization_id,
      accounting_entity_id: scope.accounting_entity_id,
      ...(scope.store_id != null ? { store_id: scope.store_id } : {}),
    };
    const eligibleWhere: Prisma.document_reception_connectionsWhereInput = {
      AND: [connectionWhere, {
        enabled: true,
        connection_type: { in: ['api_poll', 'webhook'] },
        store_id: { gt: 0 },
        created_by: { gt: 0 },
        store: { is: { organization_id: scope.organization_id, is_active: true } },
        creator: { is: { organization_id: scope.organization_id, state: 'active' } },
      }],
    };
    return this.prisma.$transaction(async (tx) => {
      const [dian, configured, activeChannels, synced, nextSync, received, lastRun, connectionErrors] = await Promise.all([
        tx.dian_configurations.findFirst({
          where: {
            organization_id: scope.organization_id,
            accounting_entity_id: scope.accounting_entity_id!,
            configuration_type: 'invoicing', environment: 'production', enablement_status: 'enabled',
          },
          select: { id: true },
        }),
        tx.document_reception_connections.count({ where: connectionWhere }),
        tx.document_reception_connections.groupBy({ by: ['connection_type'], where: eligibleWhere, _count: { _all: true } }),
        tx.document_reception_connections.aggregate({ where: connectionWhere, _max: { last_synced_at: true } }),
        tx.document_reception_connections.aggregate({ where: { AND: [eligibleWhere, { connection_type: 'api_poll' }] }, _min: { next_sync_at: true } }),
        tx.received_documents.aggregate({ where: inboxBaseWhere(scope, {}), _max: { created_at: true } }),
        tx.document_reception_runs.findFirst({
          where: { connection: { is: connectionWhere } },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          select: { status: true, received_count: true, duplicate_count: true, error_count: true, finished_at: true },
        }),
        tx.document_reception_connections.count({ where: { AND: [connectionWhere, { last_error: { not: null } }] } }),
      ]);
      const channels: Array<'api_poll' | 'webhook'> = [];
      let active_connections = 0;
      for (const group of activeChannels) {
        if (group.connection_type === 'api_poll' || group.connection_type === 'webhook') {
          channels.push(group.connection_type);
          active_connections += group._count._all;
        }
      }
      return {
        ...empty,
        dian_active: dian != null,
        configured: configured > 0,
        active_connections,
        channels: channels.sort(),
        last_received_at: received._max.created_at,
        last_synced_at: synced._max.last_synced_at,
        next_sync_at: nextSync._min.next_sync_at,
        last_run: lastRun ? {
          status: RUN_STATUSES.has(lastRun.status) ? lastRun.status : 'unknown',
          received_count: safeCount(lastRun.received_count),
          duplicate_count: safeCount(lastRun.duplicate_count),
          error_count: safeCount(lastRun.error_count),
          finished_at: lastRun.finished_at,
        } : null,
        error_code: connectionErrors > 0 || (lastRun && (lastRun.error_count > 0 || ['failed', 'partial'].includes(lastRun.status)))
          ? 'RECEPTION_CONNECTION_ERROR' : null,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
