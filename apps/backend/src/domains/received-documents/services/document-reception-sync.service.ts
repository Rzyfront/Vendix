import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { EncryptionService } from '../../../common/services/encryption.service';
import { SubscriptionAccessService } from '../../store/subscriptions/services/subscription-access.service';
import { DocumentReceptionEnvelope } from '../interfaces/document-reception-envelope.interface';
import {
  FinishDocumentReceptionRunInput,
  StartDocumentReceptionRunResult,
} from '../interfaces/document-reception-sync.interface';
import { DocumentReceptionIngestResult, DocumentReceptionIngestService } from './document-reception-ingest.service';
import { DocumentReceptionEnvelopeService } from './document-reception-envelope.service';
import { DocumentReceptionHttpService } from './document-reception-http.service';
import { DocumentReceptionSyncLeaseService } from './document-reception-sync-lease.service';

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_PAGES = 10;
const MAX_DOCUMENTS = 100;
const INTERNAL_SUBSCRIPTION_FAILURE = 'SUBSCRIPTION_INTERNAL_ERROR';

type ProcessStatus = 'completed' | 'partial' | 'failed' | 'terminal';

export interface DocumentReceptionSyncProcessResult {
  run_id: number;
  status: ProcessStatus;
  received_count: number;
  duplicate_count: number;
  error_count: number;
}

class LostRunLease extends Error {}
class FinishPersistenceFailure extends Error {}

/** Processes durable API-poll and webhook runs without posting fiscal effects. */
@Injectable()
export class DocumentReceptionSyncService {
  constructor(
    private readonly leases: DocumentReceptionSyncLeaseService,
    private readonly subscriptionAccess: SubscriptionAccessService,
    private readonly encryption: EncryptionService,
    private readonly transport: DocumentReceptionHttpService,
    private readonly envelopes: DocumentReceptionEnvelopeService,
    private readonly ingestService: DocumentReceptionIngestService,
  ) {}

  async process(runId: number): Promise<DocumentReceptionSyncProcessResult> {
    const started = await this.leases.start(runId);
    if (!started) return this.emptyResult(runId, 'terminal');

    const totals = { received_count: 0, duplicate_count: 0, error_count: 0 };
    const documentIds: number[] = [];
    const seenDocumentIds = new Set<number>();
    const errorCodes: string[] = [];
    let cursor = started.cursor_before;
    let continueImmediately = false;
    let partial = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let heartbeatFailure: unknown;
    let heartbeatInFlight: Promise<void> | null = null;

    const renewLease = async (): Promise<void> => {
      if (heartbeatFailure) throw new LostRunLease();
      if (heartbeatInFlight) {
        await heartbeatInFlight;
        return;
      }
      heartbeatInFlight = (async () => {
        const owned = await this.leases.heartbeat(started.run_id, started.lease_token);
        if (!owned) throw new LostRunLease();
      })();
      try {
        await heartbeatInFlight;
      } catch (error) {
        heartbeatFailure = error;
        throw error;
      } finally {
        heartbeatInFlight = null;
      }
    };
    const stopHeartbeat = async (): Promise<void> => {
      if (timer) clearInterval(timer);
      timer = undefined;
      if (heartbeatInFlight) {
        try { await heartbeatInFlight; } catch (error) { heartbeatFailure = error; }
      }
    };
    const guardLease = async (): Promise<void> => {
      if (heartbeatFailure) throw new LostRunLease();
      await renewLease();
    };
    timer = setInterval(() => {
      void renewLease().catch((error) => { heartbeatFailure = error; });
    }, HEARTBEAT_INTERVAL_MS);

    try {
      await this.assertSubscription(started);
      if (started.connection.connection_type === 'webhook') {
        await guardLease();
        const envelope = this.envelopes.decode(this.canonicalJsonBuffer(started.input_payload));
        const result = await this.ingestService.ingest(started.context, envelope, 'automated', guardLease);
        this.mergeIngest(totals, documentIds, seenDocumentIds, errorCodes, result);
        cursor = started.cursor_before;
        partial = result.error_count > 0;
      } else {
        const pollResult = await this.processApiPoll(started, guardLease, totals, documentIds, seenDocumentIds, errorCodes);
        cursor = pollResult.cursor;
        continueImmediately = pollResult.continue_immediately;
        partial = pollResult.partial;
      }

      await guardLease();
      await stopHeartbeat();
      if (heartbeatFailure) throw new LostRunLease();
      const status: ProcessStatus = partial ? 'partial' : 'completed';
      const finishInput: FinishDocumentReceptionRunInput = {
        ...totals,
        document_ids: documentIds,
        error_codes: errorCodes,
        next_cursor: partial ? started.cursor_before : cursor,
        failed: false,
        continue_immediately: !partial && continueImmediately,
      };
      let finished: boolean;
      try {
        finished = await this.leases.finish(started.run_id, started.lease_token, finishInput);
      } catch {
        throw new FinishPersistenceFailure();
      }
      if (!finished) throw new LostRunLease();
      return { run_id: started.run_id, status, ...totals };
    } catch (error) {
      await stopHeartbeat();
      if (error instanceof LostRunLease || heartbeatFailure) {
        throw new ConflictException('La ejecución perdió la propiedad de su lease.');
      }
      if (error instanceof FinishPersistenceFailure) {
        throw new ServiceUnavailableException('No fue posible finalizar de forma segura la ejecución de recepción.');
      }
      const code = this.safeErrorCode(error);
      totals.error_count += 1;
      if (!errorCodes.includes(code)) errorCodes.push(code);
      let failed: boolean;
      try {
        failed = await this.leases.finish(started.run_id, started.lease_token, {
          ...totals,
          document_ids: documentIds,
          error_codes: errorCodes,
          next_cursor: started.cursor_before,
          failed: true,
        });
      } catch {
        throw new ServiceUnavailableException('No fue posible finalizar de forma segura la ejecución de recepción.');
      }
      if (!failed) throw new ConflictException('La ejecución perdió la propiedad de su lease.');
      return { run_id: started.run_id, status: 'failed', ...totals };
    } finally {
      if (timer) clearInterval(timer);
    }
  }

  private async assertSubscription(started: StartDocumentReceptionRunResult): Promise<void> {
    let access: Awaited<ReturnType<SubscriptionAccessService['canUseModule']>>;
    try {
      access = await this.subscriptionAccess.canUseModule(started.context.store_id!, 'received_documents');
    } catch {
      throw new ServiceUnavailableException('No fue posible validar el acceso a la recepción de documentos.');
    }
    if (access.reason === INTERNAL_SUBSCRIPTION_FAILURE) {
      throw new ServiceUnavailableException('No fue posible validar el acceso a la recepción de documentos.');
    }
    if (!access.allowed || access.mode === 'block') {
      const entry = Object.values(ErrorCodes).find((candidate) => candidate.code === access.reason) ?? ErrorCodes.SUBSCRIPTION_005;
      throw new VendixHttpException(entry);
    }
  }

  private async processApiPoll(
    started: StartDocumentReceptionRunResult,
    guardLease: () => Promise<void>,
    totals: { received_count: number; duplicate_count: number; error_count: number },
    documentIds: number[],
    seenDocumentIds: Set<number>,
    errorCodes: string[],
  ): Promise<{ cursor: string | null; partial: boolean; continue_immediately: boolean }> {
    const connection = started.connection;
    if (!connection.endpoint || !connection.encrypted_secret) throw new ServiceUnavailableException('La conexión de consulta no está configurada.');
    const secret = this.encryption.decrypt(connection.encrypted_secret);
    const visitedCursors = new Set<string>();
    if (started.cursor_before != null) visitedCursors.add(started.cursor_before);
    let requestCursor = started.cursor_before;
    let lastDurableCursor = started.cursor_before;
    let pageCount = 0;
    let documentCount = 0;

    while (pageCount < MAX_PAGES && documentCount < MAX_DOCUMENTS) {
      await guardLease();
      const bytes = await this.transport.fetch(connection.endpoint, secret, requestCursor ?? undefined);
      const envelope = this.envelopes.decode(bytes);
      pageCount += 1;
      documentCount += envelope.documents.length;
      const result = await this.ingestService.ingest(started.context, envelope, 'api', guardLease);
      this.mergeIngest(totals, documentIds, seenDocumentIds, errorCodes, result);
      if (result.error_count > 0) return { cursor: started.cursor_before, partial: true, continue_immediately: false };

      if (envelope.next_cursor === null) {
        if (envelope.documents.length > 0) {
          totals.error_count += 1;
          this.addErrorCode(errorCodes, ErrorCodes.SYS_VALIDATION_001.code);
          return { cursor: started.cursor_before, partial: true, continue_immediately: false };
        }
        return { cursor: lastDurableCursor, partial: false, continue_immediately: false };
      }
      if (visitedCursors.has(envelope.next_cursor)) {
        totals.error_count += 1;
        this.addErrorCode(errorCodes, ErrorCodes.SYS_VALIDATION_001.code);
        return { cursor: started.cursor_before, partial: true, continue_immediately: false };
      }
      visitedCursors.add(envelope.next_cursor);
      lastDurableCursor = envelope.next_cursor;
      requestCursor = envelope.next_cursor;

      if (pageCount >= MAX_PAGES || documentCount >= MAX_DOCUMENTS) {
        return { cursor: lastDurableCursor, partial: false, continue_immediately: true };
      }
    }
    return { cursor: lastDurableCursor, partial: false, continue_immediately: requestCursor != null };
  }

  private mergeIngest(
    totals: { received_count: number; duplicate_count: number; error_count: number },
    documentIds: number[],
    seenDocumentIds: Set<number>,
    errorCodes: string[],
    result: DocumentReceptionIngestResult,
  ): void {
    totals.received_count += result.received_count;
    totals.duplicate_count += result.duplicate_count;
    totals.error_count += result.error_count;
    for (const id of result.document_ids) {
      if (Number.isSafeInteger(id) && id > 0 && !seenDocumentIds.has(id)) {
        seenDocumentIds.add(id);
        documentIds.push(id);
      }
    }
    for (const code of result.error_codes) this.addErrorCode(errorCodes, this.safeErrorCode(code));
  }

  private addErrorCode(target: string[], code: string): void {
    if (!target.includes(code)) target.push(code);
  }

  private safeErrorCode(error: unknown): string {
    if (typeof error === 'string') {
      return Object.values(ErrorCodes).find((entry) => entry.code === error)?.code ?? ErrorCodes.SYS_INTERNAL_001.code;
    }
    if (error instanceof VendixHttpException) {
      return Object.values(ErrorCodes).find((entry) => entry.code === error.errorCode)?.code ?? ErrorCodes.SYS_INTERNAL_001.code;
    }
    if (error instanceof BadRequestException) return ErrorCodes.SYS_VALIDATION_001.code;
    return ErrorCodes.SYS_INTERNAL_001.code;
  }

  private canonicalJsonBuffer(payload: unknown): Buffer {
    const canonical = (value: any): any => {
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (Array.isArray(value)) return value.map(canonical);
      if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new ServiceUnavailableException('El payload durable del webhook no es válido.');
      }
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    };
    try {
      const text = JSON.stringify(canonical(payload));
      if (typeof text !== 'string') throw new Error('not-json');
      return Buffer.from(text, 'utf8');
    } catch {
      throw new ServiceUnavailableException('El payload durable del webhook no es válido.');
    }
  }

  private emptyResult(runId: number, status: ProcessStatus): DocumentReceptionSyncProcessResult {
    return {
      run_id: runId, status, received_count: 0, duplicate_count: 0, error_count: 0,
    };
  }
}
