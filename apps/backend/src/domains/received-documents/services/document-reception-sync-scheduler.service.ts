import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { SubscriptionAccessService } from '../../store/subscriptions/services/subscription-access.service';
import { DocumentReceptionSyncLeaseService } from './document-reception-sync-lease.service';
import { DocumentReceptionSyncQueueService } from './document-reception-sync-queue.service';
import type { ReceivedDocumentsContext } from '../received-documents.service';

const MAX_RECOVERY_BATCH = 100;
const MAX_DUE_BATCH = 100;
const RETRYABLE_RUN_STATUSES = ['pending', 'queued'] as const;

type OperationalConnection = {
  id: number;
  organization_id: number;
  store_id: number | null;
  accounting_entity_id: number;
  version: number;
  enabled: boolean;
  connection_type?: string;
  endpoint?: string | null;
  encrypted_secret?: string | null;
  lease_token?: string | null;
  lease_expires_at?: Date | null;
  next_sync_at?: Date | null;
};

type RecoverableRun = {
  id: number;
  status: string;
  connection_version: number | null;
  lease_token: string | null;
  created_at: Date;
  connection: OperationalConnection;
};

/** Recovers the durable reception outbox and claims due API polls; no provider calls happen here. */
@Injectable()
export class DocumentReceptionSyncSchedulerService {
  private readonly logger = new Logger(DocumentReceptionSyncSchedulerService.name);
  private tickInProgress = false;
  private lastRecoveryId = 0;
  private lastDueConnectionId = 0;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly leases: DocumentReceptionSyncLeaseService,
    private readonly queue: DocumentReceptionSyncQueueService,
    private readonly subscriptionAccess: SubscriptionAccessService,
  ) {}

  @Cron('* * * * *')
  async tick(): Promise<void> {
    if (this.tickInProgress) return;
    this.tickInProgress = true;
    const now = new Date();
    try {
      await this.recoverOutbox(now);
      await this.scheduleDueApiPolls(now);
    } catch {
      // Never log global Prisma payloads, contexts, endpoints, or credentials.
      this.logger.warn('Document reception scheduler tick failed safely.');
    } finally {
      this.tickInProgress = false;
    }
  }

  private async recoverOutbox(now: Date): Promise<void> {
    const client = this.prisma.withoutScope();
    let runs: RecoverableRun[];
    try {
      const findBatch = (cursor: number) => client.document_reception_runs.findMany({
          where: {
            id: { gt: cursor },
            connection: { enabled: true },
            OR: [
              { status: { in: [...RETRYABLE_RUN_STATUSES] } },
              { status: 'running', connection: { lease_expires_at: { lte: now } } },
            ],
          },
          include: {
            connection: {
              select: {
                id: true,
                organization_id: true,
                store_id: true,
                accounting_entity_id: true,
                version: true,
                enabled: true,
                lease_token: true,
                lease_expires_at: true,
              },
            },
          },
          orderBy: { id: 'asc' },
          take: MAX_RECOVERY_BATCH,
        }) as Promise<RecoverableRun[]>;
      runs = await findBatch(this.lastRecoveryId);
      if (!runs.length && this.lastRecoveryId !== 0) {
        this.lastRecoveryId = 0;
        runs = await findBatch(0);
      }
      this.lastRecoveryId = runs.length ? runs[runs.length - 1].id : 0;
    } catch {
      this.logger.warn('Document reception outbox discovery failed safely.');
      return;
    }

    for (const run of runs) {
      const connection = run.connection;
      if (!connection?.enabled || !this.isRecoverable(run, connection, now)) continue;
      const context = await this.contextIfAllowed(connection);
      if (!context) continue;
      try {
        await this.queue.enqueue(run.id);
      } catch {
        // The DB run remains pending/queued/running and is discovered again.
        this.logger.warn(`Document reception outbox enqueue deferred run_id=${run.id} status=${run.status}.`);
      }
    }
  }

  private async scheduleDueApiPolls(now: Date): Promise<void> {
    const client = this.prisma.withoutScope();
    let connections: OperationalConnection[];
    try {
      const findBatch = (cursor: number) => client.document_reception_connections.findMany({
          where: {
            id: { gt: cursor },
            enabled: true,
            connection_type: 'api_poll',
            store_id: { not: null },
            version: { gte: 1 },
            endpoint: { not: null },
            encrypted_secret: { not: null },
            next_sync_at: { lte: now },
          },
          select: {
            id: true,
            organization_id: true,
            store_id: true,
            accounting_entity_id: true,
            version: true,
            enabled: true,
            connection_type: true,
            endpoint: true,
            encrypted_secret: true,
            lease_token: true,
            lease_expires_at: true,
            next_sync_at: true,
          },
          orderBy: { id: 'asc' },
          take: MAX_DUE_BATCH,
        }) as Promise<OperationalConnection[]>;
      connections = await findBatch(this.lastDueConnectionId);
      if (!connections.length && this.lastDueConnectionId !== 0) {
        this.lastDueConnectionId = 0;
        connections = await findBatch(0);
      }
      this.lastDueConnectionId = connections.length ? connections[connections.length - 1].id : 0;
    } catch {
      this.logger.warn('Due document reception connection discovery failed safely.');
      return;
    }

    const utcEpochMinute = Math.floor(now.getTime() / 60_000);
    for (const connection of connections) {
      if (!this.isIntactApiPoll(connection)) continue;
      const context = await this.contextIfAllowed(connection);
      if (!context) continue;
      try {
        const claimed = await this.leases.claim(context, connection.id, {
          trigger: 'scheduler',
          idempotency_key: `scheduler:${connection.id}:${connection.version}:${utcEpochMinute}`,
          expected_version: connection.version,
        });
        try {
          await this.queue.enqueue(claimed.run_id);
        } catch {
          // `claim` committed a durable pending run; the next tick repairs the queue enqueue.
          this.logger.warn(`Due document reception enqueue deferred run_id=${claimed.run_id} status=pending.`);
        }
      } catch {
        // Expected conflicts include an active lease or an unresolved prior run.
        this.logger.warn(`Due document reception claim skipped connection_id=${connection.id} status=due.`);
      }
    }
  }

  private isRecoverable(run: RecoverableRun, connection: OperationalConnection, now: Date): boolean {
    if (run.connection_version == null || run.connection_version !== connection.version) return false;
    if (run.status === 'pending' || run.status === 'queued') return true;
    return run.status === 'running' &&
      run.lease_token != null &&
      connection.lease_token === run.lease_token &&
      connection.lease_expires_at instanceof Date &&
      connection.lease_expires_at <= now;
  }

  private isIntactApiPoll(connection: OperationalConnection): boolean {
    return connection.enabled === true &&
      connection.connection_type === 'api_poll' &&
      Number.isSafeInteger(connection.version) && connection.version >= 1 &&
      typeof connection.store_id === 'number' && Number.isSafeInteger(connection.store_id) && connection.store_id > 0 &&
      typeof connection.endpoint === 'string' && connection.endpoint.length > 0 &&
      typeof connection.encrypted_secret === 'string' && connection.encrypted_secret.length > 0 &&
      connection.next_sync_at instanceof Date;
  }

  private async contextIfAllowed(connection: OperationalConnection): Promise<ReceivedDocumentsContext | null> {
    try {
      const context = await this.leases.getWorkerContext(connection.id);
      if (
        context.organization_id !== connection.organization_id ||
        context.store_id !== connection.store_id ||
        context.accounting_entity_id !== connection.accounting_entity_id ||
        context.store_id == null
      ) return null;
      const access = await this.subscriptionAccess.canUseModule(context.store_id, 'received_documents');
      if (access.reason === 'SUBSCRIPTION_INTERNAL_ERROR' || access.mode === 'block') return null;
      return context;
    } catch {
      // Fail closed. State will remain durable and can be retried after repair.
      return null;
    }
  }
}
