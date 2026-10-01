import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { ErrorCodes } from '../../../common/errors/error-codes';
import { FiscalScopeService } from '../../../common/services/fiscal-scope.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import {
  ClaimDocumentReceptionRunInput,
  ClaimDocumentReceptionRunResult,
  DocumentReceptionConnectionRecord,
  FinishDocumentReceptionRunInput,
  StartDocumentReceptionRunResult,
} from '../interfaces/document-reception-sync.interface';

// Worker orchestration should heartbeat every 30s; each confirmed heartbeat
// renews this lease for another two minutes.
const LEASE_TTL_MS = 120_000;
const MAX_CURSOR_LENGTH = 1000;
const MAX_SUMMARY_IDS = 100;
const RUN_TRIGGERS = new Set(['manual', 'scheduler', 'webhook']);
const REGISTERED_ERROR_CODES: Set<string> = new Set<string>(
  Object.values(ErrorCodes).map((entry) => entry.code),
);
const DEFAULT_SAFE_ERROR = ErrorCodes.SYS_INTERNAL_001.code;

class LostLeaseError extends Error {}

/**
 * Transactional worker lease and run lifecycle. It performs no network calls,
 * queue operations, document writes, or cursor advancement outside finish().
 */
@Injectable()
export class DocumentReceptionSyncLeaseService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly fiscalScope: FiscalScopeService,
    private readonly receivedDocuments: ReceivedDocumentsService,
  ) {}

  /** Builds a technical context from persisted ownership, never from request ALS. */
  async getWorkerContext(
    connectionOrId: number | Pick<DocumentReceptionConnectionRecord, 'id'>,
  ): Promise<ReceivedDocumentsContext> {
    const id = typeof connectionOrId === 'number' ? connectionOrId : connectionOrId?.id;
    if (!this.isPositiveId(id)) throw this.forbiddenContext();
    const client = this.prisma.withoutScope();
    const connection = await client.document_reception_connections.findUnique({
      where: { id },
    });
    if (!connection) throw this.forbiddenContext();
    return this.resolveWorkerContext(connection, client, true);
  }

  async claim(
    context: ReceivedDocumentsContext,
    connectionId: number,
    input: ClaimDocumentReceptionRunInput,
  ): Promise<ClaimDocumentReceptionRunResult> {
    if (!this.isPositiveId(connectionId)) throw new BadRequestException('connection_id debe ser un entero positivo.');
    this.assertClaimInput(input);
    this.assertContextIds(context, input.trigger === 'manual');
    await this.receivedDocuments.assertContext(context);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockConnection(tx, connectionId, context);
        const connection = await tx.document_reception_connections.findFirst({
          where: { id: connectionId, ...this.connectionWhere(context) },
        });
        if (!connection) throw new NotFoundException('Conexión de recepción no encontrada.');

        const workerContext = await this.resolveWorkerContext(connection, tx, false);
        this.assertSameOperationalContext(context, workerContext);

        const runWhere: Prisma.document_reception_runsWhereInput = {
          connection_id: connectionId,
          idempotency_key: input.idempotency_key,
          connection: this.connectionRelationWhere(context),
        };
        const existingRun = await tx.document_reception_runs.findFirst({ where: runWhere });
        if (existingRun) {
          if (existingRun.trigger !== input.trigger) {
            throw new ConflictException('La clave de idempotencia ya pertenece a otro tipo de ejecución.');
          }
          if (input.trigger === 'webhook' &&
              existingRun.payload_sha256?.toLowerCase() !== input.payload_sha256?.toLowerCase()) {
            throw new ConflictException('La clave de idempotencia del webhook ya se usó con otro contenido.');
          }
          if (existingRun.status !== 'completed' && existingRun.connection_version !== connection.version) {
            throw new ConflictException('La ejecución idempotente pertenece a otra versión de configuración.');
          }
          return { run_id: existingRun.id, duplicate: true };
        }

        if (!connection.enabled) {
          throw new ConflictException('La conexión está deshabilitada.');
        }
        if (input.expected_version != null && input.expected_version !== connection.version) {
          throw new ConflictException('La conexión cambió; vuelva a cargarla antes de ejecutar.');
        }
        if (input.trigger === 'webhook' && connection.connection_type !== 'webhook') {
          throw new BadRequestException('El disparador webhook requiere una conexión webhook.');
        }
        if (input.trigger !== 'webhook' && connection.connection_type !== 'api_poll') {
          throw new BadRequestException('La conexión webhook solo admite disparos webhook.');
        }

        const now = new Date();
        let leaseToken: string | null = null;
        if (input.trigger !== 'webhook') {
          const incompleteRun = await tx.document_reception_runs.findFirst({
            where: {
              connection_id: connectionId,
              status: { in: ['pending', 'queued', 'running', 'failed', 'partial'] },
              connection: this.connectionRelationWhere(context),
            },
          });
          if (incompleteRun) {
            throw new ConflictException('Debe recuperarse la ejecución anterior antes de iniciar otra.');
          }
          if (this.hasActiveLease(connection, now)) {
            throw new ConflictException('La conexión ya tiene una ejecución activa.');
          }
          leaseToken = randomUUID();
          const leaseExpiresAt = new Date(now.getTime() + LEASE_TTL_MS);
          const leased = await tx.document_reception_connections.updateMany({
            where: {
              id: connectionId,
              ...this.connectionWhere(context),
              version: connection.version,
              OR: [
                { lease_token: null },
                { lease_expires_at: { lte: now } },
              ],
            },
            data: { lease_token: leaseToken, lease_expires_at: leaseExpiresAt },
          });
          if (leased.count !== 1) {
            throw new ConflictException('La conexión ya no está disponible para ejecutar.');
          }
        }

        const summary = this.safeRequestedBy(context.actor_id);
        const run = await tx.document_reception_runs.create({
          data: {
            connection_id: connectionId,
            connection_version: connection.version,
            lease_token: leaseToken,
            status: 'pending',
            trigger: input.trigger,
            idempotency_key: input.idempotency_key,
            cursor_before: connection.cursor,
            ...(input.trigger === 'webhook'
              ? { input_payload: input.input_payload, payload_sha256: input.payload_sha256?.toLowerCase() }
              : {}),
            summary,
          },
        });
        return { run_id: run.id, duplicate: false };
      });
    } catch (error) {
      throw error;
    }
  }

  /** Claims a run for one worker; returns null for already terminal runs. */
  async start(runId: number): Promise<StartDocumentReceptionRunResult | null> {
    if (!this.isPositiveId(runId)) throw new BadRequestException('run_id debe ser un entero positivo.');
    const db = this.prisma.withoutScope();
    const initialRun = await db.document_reception_runs.findUnique({
      where: { id: runId },
      include: { connection: true },
    });
    if (!initialRun) throw new NotFoundException('Ejecución de recepción no encontrada.');
    if (initialRun.status === 'completed' || initialRun.status === 'cancelled') return null;

    const initialContext = await this.getWorkerContext(initialRun.connection);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockConnection(tx, initialRun.connection_id, initialContext);
        const connection = await tx.document_reception_connections.findFirst({
          where: { id: initialRun.connection_id, ...this.connectionWhere(initialContext) },
        });
        if (!connection) throw this.forbiddenContext();
        const context = await this.resolveWorkerContext(connection, tx, false);
        this.assertSameOperationalContext(initialContext, context);

        await this.lockRun(tx, runId, connection.id, context);
        const run = await tx.document_reception_runs.findFirst({
          where: {
            id: runId,
            connection_id: connection.id,
            connection: this.connectionRelationWhere(context),
          },
        });
        if (!run) throw new NotFoundException('Ejecución de recepción no encontrada.');
        if (run.status === 'completed' || run.status === 'cancelled') return null;
        if (!connection.enabled) throw new ConflictException('La conexión está deshabilitada.');
        if ((run.trigger === 'webhook' && connection.connection_type !== 'webhook') ||
            (run.trigger !== 'webhook' && connection.connection_type !== 'api_poll')) {
          throw new ConflictException('El disparador de la ejecución ya no coincide con el tipo de conexión.');
        }
        if (run.connection_version == null || run.connection_version !== connection.version) {
          throw new ConflictException('La configuración de la conexión cambió desde que se creó la ejecución.');
        }
        const now = new Date();
        const leaseActive = this.hasActiveLease(connection, now);
        if (!['pending', 'queued', 'running', 'failed', 'partial'].includes(run.status)) {
          throw new ConflictException('El estado de la ejecución no permite iniciar el procesamiento.');
        }
        const previouslyAttempted = run.started_at != null ||
          run.status === 'running' || run.status === 'failed' || run.status === 'partial';
        if (previouslyAttempted && run.cursor_before !== connection.cursor) {
          throw new ConflictException('El cursor cambió desde el último intento; no se puede reanudar ni retroceder.');
        }
        if (leaseActive && connection.lease_token !== run.lease_token) {
          throw new ConflictException('La conexión ya tiene otra ejecución activa.');
        }
        if (run.status === 'running' && leaseActive) {
          throw new ConflictException('La ejecución ya está siendo procesada.');
        }
        if (previouslyAttempted && connection.lease_token != null && connection.lease_token !== run.lease_token) {
          throw new ConflictException('La ejecución ya no posee el lease de la conexión.');
        }
        if (
          connection.lease_token != null &&
          connection.lease_token !== run.lease_token &&
          connection.lease_expires_at != null &&
          connection.lease_expires_at.getTime() <= now.getTime()
        ) {
          const olderRun = await tx.document_reception_runs.findFirst({
            where: {
              connection_id: connection.id,
              lease_token: connection.lease_token,
              status: { in: ['pending', 'queued', 'running', 'failed', 'partial'] },
              connection: this.connectionRelationWhere(context),
            },
          });
          if (olderRun && olderRun.id !== run.id) {
            throw new ConflictException('Debe recuperarse la ejecución anterior antes de iniciar esta.');
          }
        }

        // Pending/queued can renew their own initial claim. Running can only be
        // reclaimed after its matching connection lease has expired.
        const leaseToken = randomUUID();
        const leaseExpiresAt = new Date(now.getTime() + LEASE_TTL_MS);
        const connectionChanged = await tx.document_reception_connections.updateMany({
          where: {
            id: connection.id,
            ...this.connectionWhere(context),
            version: run.connection_version,
            OR: [
              { lease_token: null },
              { lease_expires_at: { lte: now } },
              ...(leaseActive && connection.lease_token === run.lease_token
                ? [{ lease_token: run.lease_token }]
                : []),
            ],
          },
          data: { lease_token: leaseToken, lease_expires_at: leaseExpiresAt },
        });
        if (connectionChanged.count !== 1) throw new LostLeaseError();

        const runChanged = await tx.document_reception_runs.updateMany({
          where: {
            id: run.id,
            connection_id: connection.id,
            connection_version: run.connection_version,
            lease_token: run.lease_token,
            status: run.status,
            connection: this.connectionRelationWhere(context),
          },
          data: {
            lease_token: leaseToken,
            status: 'running',
            started_at: run.started_at ?? now,
            ...(previouslyAttempted ? {} : { cursor_before: connection.cursor }),
          },
        });
        if (runChanged.count !== 1) throw new LostLeaseError();

        const freshConnection = await tx.document_reception_connections.findFirst({
          where: { id: connection.id, ...this.connectionWhere(context) },
        });
        if (!freshConnection) throw new LostLeaseError();
        return {
          run_id: run.id,
          connection_id: connection.id,
          connection_version: run.connection_version,
          lease_token: leaseToken,
          connection: freshConnection,
          context,
          cursor_before: previouslyAttempted ? run.cursor_before : connection.cursor,
          input_payload: run.input_payload,
          payload_sha256: run.payload_sha256,
        };
      });
    } catch (error) {
      if (error instanceof LostLeaseError) {
        throw new ConflictException('La ejecución perdió la propiedad de su lease.');
      }
      throw error;
    }
  }

  async heartbeat(runId: number, leaseToken: string): Promise<boolean> {
    if (!this.isPositiveId(runId) || !this.validLeaseToken(leaseToken)) return false;
    const initialRun = await this.prisma.withoutScope().document_reception_runs.findUnique({
      where: { id: runId },
      include: { connection: true },
    });
    if (!initialRun) return false;
    let initialContext: ReceivedDocumentsContext;
    try {
      initialContext = await this.getWorkerContext(initialRun.connection);
    } catch {
      return false;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockConnection(tx, initialRun.connection_id, initialContext);
        const connection = await tx.document_reception_connections.findFirst({
          where: { id: initialRun.connection_id, ...this.connectionWhere(initialContext) },
        });
        if (!connection || !connection.enabled) return false;
        const context = await this.resolveWorkerContext(connection, tx, false);
        if (!this.sameOperationalContext(initialContext, context)) return false;
        await this.lockRun(tx, runId, connection.id, context);
        const run = await tx.document_reception_runs.findFirst({
          where: {
            id: runId,
            connection_id: connection.id,
            connection: this.connectionRelationWhere(context),
          },
        });
        const now = new Date();
        if (
          !run ||
          run.status !== 'running' ||
          run.lease_token !== leaseToken ||
          run.connection_version == null ||
          run.connection_version !== connection.version ||
          connection.lease_token !== leaseToken ||
          !connection.lease_expires_at ||
          connection.lease_expires_at.getTime() <= now.getTime()
        ) {
          return false;
        }
        const result = await tx.document_reception_connections.updateMany({
          where: {
            id: connection.id,
            ...this.connectionWhere(context),
            version: run.connection_version,
            lease_token: leaseToken,
            lease_expires_at: { gt: now },
          },
          data: { lease_expires_at: new Date(now.getTime() + LEASE_TTL_MS) },
        });
        return result.count === 1;
      });
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) return false;
      throw error;
    }
  }

  async finish(
    runId: number,
    leaseToken: string,
    input: FinishDocumentReceptionRunInput,
  ): Promise<boolean> {
    this.assertFinishInput(input);
    if (!this.isPositiveId(runId) || !this.validLeaseToken(leaseToken)) return false;
    const initialRun = await this.prisma.withoutScope().document_reception_runs.findUnique({
      where: { id: runId },
      include: { connection: true },
    });
    if (!initialRun) return false;
    let initialContext: ReceivedDocumentsContext;
    try {
      initialContext = await this.getWorkerContext(initialRun.connection);
    } catch {
      return false;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockConnection(tx, initialRun.connection_id, initialContext);
        const connection = await tx.document_reception_connections.findFirst({
          where: { id: initialRun.connection_id, ...this.connectionWhere(initialContext) },
        });
        if (!connection || !connection.enabled) return false;
        const context = await this.resolveWorkerContext(connection, tx, false);
        if (!this.sameOperationalContext(initialContext, context)) return false;
        await this.lockRun(tx, runId, connection.id, context);
        const run = await tx.document_reception_runs.findFirst({
          where: {
            id: runId,
            connection_id: connection.id,
            connection: this.connectionRelationWhere(context),
          },
        });
        const now = new Date();
        if (
          !run ||
          run.status !== 'running' ||
          run.lease_token !== leaseToken ||
          run.connection_version == null ||
          run.connection_version !== connection.version ||
          connection.lease_token !== leaseToken ||
          !connection.lease_expires_at ||
          connection.lease_expires_at.getTime() <= now.getTime()
        ) {
          return false;
        }

        const succeeded = !input.failed && input.error_count === 0;
        const safeCodes = this.safeErrorCodes(input.error_codes ?? []);
        if (!succeeded && safeCodes.length === 0) safeCodes.push(DEFAULT_SAFE_ERROR);
        const requestedBy = this.safeRequestedByFromSummary(run.summary);
        const summary = this.finishSummary(input, safeCodes, requestedBy);
        const nextSyncAt = connection.enabled
          ? new Date(now.getTime() + connection.poll_interval_minutes * 60_000)
          : null;
        const updatedRun = await tx.document_reception_runs.updateMany({
          where: {
            id: run.id,
            connection_id: connection.id,
            connection_version: run.connection_version,
            lease_token: leaseToken,
            status: 'running',
            connection: this.connectionRelationWhere(context),
          },
          data: {
            status: succeeded ? 'completed' : input.failed ? 'failed' : 'partial',
            received_count: input.received_count,
            duplicate_count: input.duplicate_count,
            error_count: input.error_count,
            cursor_after: succeeded ? input.next_cursor : null,
            summary,
            finished_at: now,
            ...(succeeded ? { input_payload: Prisma.DbNull } : {}),
          },
        });
        if (updatedRun.count !== 1) throw new LostLeaseError();

        const updatedConnection = await tx.document_reception_connections.updateMany({
          where: {
            id: connection.id,
            ...this.connectionWhere(context),
            version: run.connection_version,
            lease_token: leaseToken,
            lease_expires_at: { gt: now },
          },
          data: {
            ...(succeeded ? {
              cursor: input.next_cursor,
              last_synced_at: now,
              last_error: null,
              next_sync_at: connection.connection_type === 'api_poll'
                ? (input.continue_immediately ? now : nextSyncAt)
                : null,
            } : {
              last_error: safeCodes[0] ?? DEFAULT_SAFE_ERROR,
              next_sync_at: connection.connection_type === 'api_poll' ? nextSyncAt : null,
            }),
            lease_token: null,
            lease_expires_at: null,
          },
        });
        if (updatedConnection.count !== 1) throw new LostLeaseError();
        return true;
      });
    } catch (error) {
      if (error instanceof LostLeaseError) return false;
      if (error instanceof ForbiddenException || error instanceof NotFoundException) return false;
      throw error;
    }
  }

  private async resolveWorkerContext(
    connection: DocumentReceptionConnectionRecord,
    client: any,
    assertReceivedContext: boolean,
  ): Promise<ReceivedDocumentsContext> {
    try {
      if (!this.isPositiveId(connection.organization_id) ||
          !this.isPositiveId(connection.store_id) ||
          !this.isPositiveId(connection.accounting_entity_id)) {
        throw this.forbiddenContext();
      }
      const [organization, store, entity] = await Promise.all([
        client.organizations.findFirst({
          where: { id: connection.organization_id, state: 'active' },
          select: { id: true, state: true, operating_scope: true, fiscal_scope: true },
        }),
        client.stores.findFirst({
          where: { id: connection.store_id, organization_id: connection.organization_id, is_active: true },
          select: { id: true, organization_id: true, is_active: true },
        }),
        client.accounting_entities.findFirst({
          where: { id: connection.accounting_entity_id, organization_id: connection.organization_id, is_active: true },
          select: { id: true, organization_id: true, store_id: true, scope: true, fiscal_scope: true, is_active: true },
        }),
      ]);
      if (organization) {
        this.fiscalScope.assertValidScopeCombination(
          organization.operating_scope,
          organization.fiscal_scope,
        );
      }
      if (!organization || !store || !entity ||
          organization.id !== connection.organization_id ||
          store.id !== connection.store_id ||
          store.organization_id !== connection.organization_id ||
          entity.id !== connection.accounting_entity_id ||
          entity.organization_id !== connection.organization_id) {
        throw this.forbiddenContext();
      }

      const expectedEntityId = await this.fiscalScope.findFiscalAccountingEntityId({
        organization_id: organization.id,
        store_id: store.id,
        tx: client,
      });
      if (expectedEntityId !== connection.accounting_entity_id) throw this.forbiddenContext();

      const canonicalShapeMatches = organization.fiscal_scope === 'STORE'
        ? entity.store_id === store.id && entity.scope === 'STORE' && entity.fiscal_scope === 'STORE'
        : organization.fiscal_scope === 'ORGANIZATION'
          ? entity.store_id === null && entity.scope === 'ORGANIZATION' && entity.fiscal_scope === 'ORGANIZATION'
          : false;
      if (!canonicalShapeMatches) throw this.forbiddenContext();

      const context: ReceivedDocumentsContext = {
        organization_id: organization.id,
        accounting_entity_id: entity.id,
        store_id: store.id,
        actor_id: undefined,
        is_organization: true,
      };
      if (assertReceivedContext) await this.receivedDocuments.assertContext(context);
      return context;
    } catch {
      throw this.forbiddenContext();
    }
  }

  private async lockConnection(
    tx: Prisma.TransactionClient,
    connectionId: number,
    context: ReceivedDocumentsContext,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT "id"
      FROM "document_reception_connections"
      WHERE "id" = ${connectionId}
        AND "organization_id" = ${context.organization_id}
        AND "accounting_entity_id" = ${context.accounting_entity_id}
        AND "store_id" = ${context.store_id}
      FOR UPDATE
    `);
    if (rows.length !== 1) throw new NotFoundException('Conexión de recepción no encontrada.');
  }

  private async lockRun(
    tx: Prisma.TransactionClient,
    runId: number,
    connectionId: number,
    context: ReceivedDocumentsContext,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
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
    if (rows.length !== 1) throw new NotFoundException('Ejecución de recepción no encontrada.');
  }

  private connectionWhere(context: ReceivedDocumentsContext) {
    return {
      organization_id: context.organization_id,
      accounting_entity_id: context.accounting_entity_id,
      store_id: context.store_id,
    };
  }

  private connectionRelationWhere(context: ReceivedDocumentsContext): Prisma.document_reception_connectionsWhereInput {
    return this.connectionWhere(context);
  }

  private assertClaimInput(input: ClaimDocumentReceptionRunInput): void {
    if (!input || !RUN_TRIGGERS.has(input.trigger)) {
      throw new BadRequestException('El disparador de ejecución no es válido.');
    }
    if (typeof input.idempotency_key !== 'string' ||
        input.idempotency_key.length < 1 ||
        input.idempotency_key.length > 160 ||
        /[\x00-\x1f\x7f]/.test(input.idempotency_key)) {
      throw new BadRequestException('La clave de idempotencia debe tener entre 1 y 160 caracteres válidos.');
    }
    if (input.expected_version != null && !this.isPositiveId(input.expected_version)) {
      throw new BadRequestException('expected_version debe ser un entero positivo.');
    }
    if (input.trigger === 'webhook') {
      if (input.input_payload === undefined || !this.validPayloadHash(input.payload_sha256)) {
        throw new BadRequestException('El disparo webhook requiere payload y hash SHA-256.');
      }
    } else if (input.input_payload !== undefined || input.payload_sha256 !== undefined) {
      throw new BadRequestException('Solo las ejecuciones webhook admiten un payload de entrada.');
    }
  }

  private assertFinishInput(input: FinishDocumentReceptionRunInput): void {
    if (!input || !this.validCount(input.received_count) ||
        !this.validCount(input.duplicate_count) || !this.validCount(input.error_count)) {
      throw new BadRequestException('Los conteos de ejecución deben ser enteros no negativos.');
    }
    if (input.next_cursor !== null &&
        (typeof input.next_cursor !== 'string' || input.next_cursor.length > MAX_CURSOR_LENGTH)) {
      throw new BadRequestException('El cursor de recepción no es válido.');
    }
    if (input.failed != null && typeof input.failed !== 'boolean') {
      throw new BadRequestException('El estado failed debe ser booleano.');
    }
    if (input.continue_immediately !== undefined && typeof input.continue_immediately !== 'boolean') {
      throw new BadRequestException('continue_immediately debe ser booleano.');
    }
    if (input.document_ids != null && !Array.isArray(input.document_ids)) {
      throw new BadRequestException('document_ids debe ser una lista.');
    }
    if (input.error_codes != null && !Array.isArray(input.error_codes)) {
      throw new BadRequestException('error_codes debe ser una lista.');
    }
  }

  private finishSummary(
    input: FinishDocumentReceptionRunInput,
    safeCodes: string[],
    requestedBy?: number,
  ): Prisma.InputJsonObject {
    const ids = (input.document_ids ?? [])
      .filter((id) => this.isPositiveId(id))
      .slice(0, MAX_SUMMARY_IDS);
    return {
      counts: {
        received: input.received_count,
        duplicates: input.duplicate_count,
        errors: input.error_count,
      },
      ...(ids.length > 0 ? { document_ids: ids } : {}),
      ...(safeCodes.length > 0 ? { error_codes: safeCodes.slice(0, MAX_SUMMARY_IDS) } : {}),
      ...(requestedBy ? { requested_by: requestedBy } : {}),
    };
  }

  private safeErrorCodes(values: string[]): string[] {
    return [...new Set(values
      .filter((value): value is string => typeof value === 'string' && REGISTERED_ERROR_CODES.has(value)))]
      .slice(0, MAX_SUMMARY_IDS);
  }

  private safeRequestedBy(actorId?: number): Prisma.InputJsonObject {
    return this.isPositiveId(actorId) ? { requested_by: actorId } : {};
  }

  private safeRequestedByFromSummary(value: unknown): number | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const requestedBy = (value as Record<string, unknown>).requested_by;
    return this.isPositiveId(requestedBy) ? requestedBy : undefined;
  }

  private hasActiveLease(
    connection: Pick<DocumentReceptionConnectionRecord, 'lease_token' | 'lease_expires_at'>,
    now: Date,
  ): boolean {
    return connection.lease_token != null &&
      (connection.lease_expires_at == null || connection.lease_expires_at.getTime() > now.getTime());
  }

  private assertContextIds(context: ReceivedDocumentsContext, requireActor: boolean): void {
    if (!context || !this.isPositiveId(context.organization_id) ||
        !this.isPositiveId(context.accounting_entity_id) || !this.isPositiveId(context.store_id) ||
        (requireActor && !this.isPositiveId(context.actor_id))) {
      throw this.forbiddenContext();
    }
  }

  private assertSameOperationalContext(
    supplied: ReceivedDocumentsContext,
    resolved: ReceivedDocumentsContext,
  ): void {
    if (!this.sameOperationalContext(supplied, resolved)) throw this.forbiddenContext();
  }

  private sameOperationalContext(
    left: ReceivedDocumentsContext,
    right: ReceivedDocumentsContext,
  ): boolean {
    return left.organization_id === right.organization_id &&
      left.accounting_entity_id === right.accounting_entity_id &&
      left.store_id === right.store_id;
  }

  private validCount(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
  }

  private validPayloadHash(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
  }

  private validLeaseToken(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 64 && !/[\x00-\x1f\x7f]/.test(value);
  }

  private isPositiveId(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) > 0;
  }

  private forbiddenContext(): ForbiddenException {
    return new ForbiddenException('No se pudo validar el contexto fiscal de recepción.');
  }
}
