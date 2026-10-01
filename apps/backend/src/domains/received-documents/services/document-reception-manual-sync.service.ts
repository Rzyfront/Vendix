import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { SubscriptionAccessService } from '../../store/subscriptions/services/subscription-access.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import { ManualDocumentReceptionSyncDto } from '../dto/document-reception-sync.dto';
import { DocumentReceptionSyncLeaseService } from './document-reception-sync-lease.service';
import { DocumentReceptionSyncQueueService } from './document-reception-sync-queue.service';

const INTERNAL_SUBSCRIPTION_FAILURE = 'SUBSCRIPTION_INTERNAL_ERROR';

@Injectable()
export class DocumentReceptionManualSyncService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly receivedDocuments: ReceivedDocumentsService,
    private readonly subscriptionAccess: SubscriptionAccessService,
    private readonly leases: DocumentReceptionSyncLeaseService,
    private readonly queue: DocumentReceptionSyncQueueService,
  ) {}

  async request(
    context: ReceivedDocumentsContext,
    connectionId: number,
    dto: ManualDocumentReceptionSyncDto,
  ): Promise<{ run_id: number; duplicate: boolean; queued: boolean }> {
    this.assertManualInput(connectionId, dto);
    await this.assertAuthorizedContext(context);
    await this.assertSubscription(context);

    const claim = await this.leases.claim(context, connectionId, {
      trigger: 'manual',
      idempotency_key: `manual:${dto.idempotency_key}`,
      expected_version: dto.expected_version,
    });

    try {
      await this.queue.enqueue(claim.run_id);
      return { run_id: claim.run_id, duplicate: claim.duplicate, queued: true };
    } catch {
      // The DB run is durable; scheduler/outbox recovery can enqueue it later.
      return { run_id: claim.run_id, duplicate: claim.duplicate, queued: false };
    }
  }

  async retry(
    context: ReceivedDocumentsContext,
    connectionId: number,
    runId: number,
  ): Promise<{ run_id: number; queued: true }> {
    this.assertPositiveId(connectionId, 'connection_id');
    this.assertPositiveId(runId, 'run_id');
    await this.assertAuthorizedContext(context);
    await this.assertSubscription(context);

    const run = await this.prisma.withoutScope().document_reception_runs.findFirst({
      where: {
        id: runId,
        connection_id: connectionId,
        connection: {
          organization_id: context.organization_id,
          accounting_entity_id: context.accounting_entity_id,
          store_id: context.store_id,
        },
      },
      select: {
        id: true,
        status: true,
        connection_version: true,
        lease_token: true,
        connection: {
          select: {
            enabled: true,
            version: true,
            lease_token: true,
            lease_expires_at: true,
          },
        },
      },
    });
    if (!run) throw new NotFoundException('Ejecución de recepción no encontrada.');
    if (run.status !== 'failed' && run.status !== 'partial') {
      throw new ConflictException('Solo se pueden reintentar ejecuciones fallidas o parciales.');
    }
    if (!run.connection.enabled || run.connection_version == null ||
        run.connection_version !== run.connection.version) {
      throw new ConflictException('La conexión o su versión ya no están disponibles para reintento.');
    }
    const now = Date.now();
    if (run.connection.lease_token != null && run.connection.lease_expires_at != null &&
        run.connection.lease_expires_at.getTime() > now) {
      throw new ConflictException('La conexión ya tiene una ejecución activa.');
    }

    try {
      await this.queue.enqueue(run.id);
    } catch {
      throw new ServiceUnavailableException('No se pudo programar el reintento.');
    }
    return { run_id: run.id, queued: true };
  }

  private async assertAuthorizedContext(context: ReceivedDocumentsContext): Promise<void> {
    if (!context || typeof context.actor_id !== 'number' ||
        !Number.isSafeInteger(context.actor_id) || context.actor_id <= 0) {
      throw new ForbiddenException('Se requiere un usuario autorizado para ejecutar la sincronización.');
    }
    if (typeof context.store_id !== 'number' || !Number.isSafeInteger(context.store_id) || context.store_id <= 0) {
      throw new BadRequestException('Debe seleccionarse una tienda operativa.');
    }
    await this.receivedDocuments.assertContext(context);
  }

  private async assertSubscription(context: ReceivedDocumentsContext): Promise<void> {
    let access: Awaited<ReturnType<SubscriptionAccessService['canUseModule']>>;
    try {
      access = await this.subscriptionAccess.canUseModule(context.store_id!, 'received_documents');
    } catch {
      throw new ServiceUnavailableException('No fue posible validar el acceso a la recepción de documentos.');
    }
    if (access.reason === INTERNAL_SUBSCRIPTION_FAILURE) {
      throw new ServiceUnavailableException('No fue posible validar el acceso a la recepción de documentos.');
    }
    if (!access.allowed || access.mode === 'block') {
      throw new ForbiddenException('La recepción de documentos no está disponible para esta tienda.');
    }
  }

  private assertManualInput(connectionId: number, dto: ManualDocumentReceptionSyncDto): void {
    this.assertPositiveId(connectionId, 'connection_id');
    if (!dto || !Number.isSafeInteger(dto.expected_version) || dto.expected_version <= 0) {
      throw new BadRequestException('expected_version debe ser un entero positivo.');
    }
    if (typeof dto.idempotency_key !== 'string' || !isUUID(dto.idempotency_key, '4')) {
      throw new BadRequestException('idempotency_key debe ser un UUID v4 válido.');
    }
  }

  private assertPositiveId(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new BadRequestException(`${field} debe ser un entero positivo.`);
    }
  }
}
