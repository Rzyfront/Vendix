import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import { CancelDocumentReceptionRunDto } from '../dto/document-reception-run-resolution.dto';

const CANCELLABLE_STATUSES = ['pending', 'queued', 'failed', 'partial'];

@Injectable()
export class DocumentReceptionRunResolutionService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly receivedDocuments: ReceivedDocumentsService,
  ) {}

  async cancel(
    context: ReceivedDocumentsContext,
    connectionId: number,
    runId: number,
    dto: CancelDocumentReceptionRunDto,
  ): Promise<{ run_id: number; status: 'cancelled'; duplicate: boolean }> {
    this.assertPositiveId(connectionId, 'connection_id');
    this.assertPositiveId(runId, 'run_id');
    const reason = this.reason(dto?.reason);
    if (typeof context?.actor_id !== 'number' || !Number.isSafeInteger(context.actor_id) || context.actor_id <= 0) {
      throw new ForbiddenException('Se requiere un usuario autorizado para resolver la ejecución.');
    }
    if (typeof context.store_id !== 'number' || !Number.isSafeInteger(context.store_id) || context.store_id <= 0) {
      throw new BadRequestException('Debe seleccionarse una tienda operativa.');
    }
    await this.receivedDocuments.assertContext(context);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "document_reception_connections"
        WHERE "id" = ${connectionId}
          AND "organization_id" = ${context.organization_id}
          AND "accounting_entity_id" = ${context.accounting_entity_id}
          AND "store_id" = ${context.store_id}
        FOR UPDATE
      `);
      const connection = await tx.document_reception_connections.findFirst({
        where: {
          id: connectionId,
          organization_id: context.organization_id,
          accounting_entity_id: context.accounting_entity_id,
          store_id: context.store_id,
        },
        select: {
          id: true,
          version: true,
          connection_type: true,
          lease_token: true,
          lease_expires_at: true,
        },
      });
      if (!connection) throw new NotFoundException('Ejecución de recepción no encontrada.');

      await tx.$queryRaw(Prisma.sql`
        SELECT r."id"
        FROM "document_reception_runs" AS r
        INNER JOIN "document_reception_connections" AS c ON c."id" = r."connection_id"
        WHERE r."id" = ${runId}
          AND r."connection_id" = ${connectionId}
          AND c."organization_id" = ${context.organization_id}
          AND c."accounting_entity_id" = ${context.accounting_entity_id}
          AND c."store_id" = ${context.store_id}
        FOR UPDATE OF r
      `);
      const run = await tx.document_reception_runs.findFirst({
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
          received_count: true,
          duplicate_count: true,
          error_count: true,
          cursor_before: true,
          cursor_after: true,
          input_payload: true,
          payload_sha256: true,
        },
      });
      if (!run) throw new NotFoundException('Ejecución de recepción no encontrada.');
      if (run.status === 'cancelled') return { run_id: run.id, status: 'cancelled', duplicate: true };
      if (run.status === 'completed') throw new ConflictException('Una ejecución completada no se puede cancelar.');

      const now = new Date();
      const ownsConnectionLease = run.lease_token != null && connection.lease_token === run.lease_token;
      if (run.status === 'running') {
        if (!ownsConnectionLease || !connection.lease_expires_at || connection.lease_expires_at.getTime() > now.getTime()) {
          throw new ConflictException('La ejecución activa no se puede cancelar mientras su lease siga vigente.');
        }
      } else if (!CANCELLABLE_STATUSES.includes(run.status)) {
        throw new ConflictException('El estado de la ejecución no permite cancelación.');
      }

      const oldSnapshot = this.auditSnapshot(run.status, run, run.connection_version);
      const changedRun = await tx.document_reception_runs.updateMany({
        where: {
          id: runId,
          connection_id: connectionId,
          status: run.status,
          connection_version: run.connection_version,
          connection: {
            organization_id: context.organization_id,
            accounting_entity_id: context.accounting_entity_id,
            store_id: context.store_id,
          },
        },
        data: {
          status: 'cancelled',
          finished_at: now,
          input_payload: Prisma.DbNull,
        },
      });
      if (changedRun.count !== 1) throw new ConflictException('La ejecución cambió durante la cancelación.');

      const changedConnection = await tx.document_reception_connections.updateMany({
        where: {
          id: connectionId,
          organization_id: context.organization_id,
          accounting_entity_id: context.accounting_entity_id,
          store_id: context.store_id,
          version: connection.version,
        },
        data: {
          ...(ownsConnectionLease ? { lease_token: null, lease_expires_at: null } : {}),
          next_sync_at: null,
        },
      });
      if (changedConnection.count !== 1) throw new ConflictException('La conexión cambió durante la cancelación.');

      try {
        await tx.audit_logs.create({
          data: {
            user_id: context.actor_id,
            organization_id: context.organization_id,
            store_id: context.store_id,
            action: 'UPDATE',
            resource: 'document_reception_runs',
            resource_id: run.id,
            old_values: oldSnapshot,
            new_values: this.auditSnapshot('cancelled', run, run.connection_version),
            metadata: { cancellation_reason: reason },
          },
        });
      } catch {
        throw new ServiceUnavailableException('No fue posible registrar de forma segura la cancelación.');
      }

      return { run_id: run.id, status: 'cancelled', duplicate: false };
    });
  }

  private auditSnapshot(status: string, run: {
    connection_version: number | null;
    received_count: number;
    duplicate_count: number;
    error_count: number;
  }, connectionVersion: number | null) {
    return {
      status,
      received_count: run.received_count,
      duplicate_count: run.duplicate_count,
      error_count: run.error_count,
      connection_version: connectionVersion,
    };
  }

  private reason(value: unknown): string {
    if (typeof value !== 'string') throw new BadRequestException('Debe indicar el motivo de cancelación.');
    const reason = value.trim();
    if (reason.length < 10 || reason.length > 500 || /[\x00-\x1f\x7f]/.test(reason)) {
      throw new BadRequestException('El motivo debe tener entre 10 y 500 caracteres sin controles.');
    }
    return reason;
  }

  private assertPositiveId(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new BadRequestException(`${field} debe ser un entero positivo.`);
    }
  }
}
