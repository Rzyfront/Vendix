import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ErrorCodes } from '../../../common/errors/error-codes';
import { EncryptionService } from '../../../common/services/encryption.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import {
  CreateDocumentReceptionConnectionDto,
  DocumentReceptionConnectionQueryDto,
  UpdateDocumentReceptionConnectionDto,
} from '../dto/document-reception-connection.dto';
import {
  DocumentReceptionConnectionType,
  DocumentReceptionConnectionView,
  DocumentReceptionRunView,
} from '../interfaces/document-reception-connection.interface';
import { DocumentReceptionHttpService } from './document-reception-http.service';

const CONNECTION_TYPES: readonly DocumentReceptionConnectionType[] = ['api_poll', 'webhook'];
const RUN_STATUSES = new Set(['pending', 'queued', 'running', 'completed', 'partial', 'failed', 'cancelled']);
const RUN_TRIGGERS = new Set(['manual', 'scheduler', 'webhook', 'retry']);
const SAFE_COUNT_KEYS = ['received', 'duplicates', 'errors', 'documents', 'pages', 'skipped'] as const;
const MAX_SAFE_IDS = 100;

type ConnectionRecord = NonNullable<Awaited<ReturnType<GlobalPrismaService['document_reception_connections']['findFirst']>>>;
type ReceptionRunRecord = NonNullable<Awaited<ReturnType<GlobalPrismaService['document_reception_runs']['findFirst']>>>;

@Injectable()
export class DocumentReceptionConnectionsService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly receivedDocuments: ReceivedDocumentsService,
    private readonly encryption: EncryptionService,
    private readonly httpTransport: DocumentReceptionHttpService,
  ) {}

  async list(ctx: ReceivedDocumentsContext, query: DocumentReceptionConnectionQueryDto = new DocumentReceptionConnectionQueryDto()) {
    await this.receivedDocuments.assertContext(ctx);
    const { page, limit } = this.page(query.page, query.limit);
    const where = this.connectionWhere(ctx);
    const [rows, total] = await Promise.all([
      this.prisma.document_reception_connections.findMany({
        where,
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.document_reception_connections.count({ where }),
    ]);
    return { data: rows.map((row) => this.toView(row)), total, page, limit };
  }

  async findOne(ctx: ReceivedDocumentsContext, id: number): Promise<DocumentReceptionConnectionView> {
    this.assertPositiveId(id, 'connection_id');
    await this.receivedDocuments.assertContext(ctx);
    const record = await this.findRecord(ctx, id);
    if (!record) throw new NotFoundException('Conexión de recepción no encontrada.');
    return this.toView(record);
  }

  async listRuns(
    ctx: ReceivedDocumentsContext,
    connectionId: number,
    query: DocumentReceptionConnectionQueryDto = new DocumentReceptionConnectionQueryDto(),
  ): Promise<{ data: DocumentReceptionRunView[]; total: number; page: number; limit: number }> {
    this.assertPositiveId(connectionId, 'connection_id');
    await this.receivedDocuments.assertContext(ctx);
    const connection = await this.findRecord(ctx, connectionId);
    if (!connection) throw new NotFoundException('Conexión de recepción no encontrada.');
    const { page, limit } = this.page(query.page, query.limit);
    const connectionWhere = this.connectionWhere(ctx);
    const where = {
      connection_id: connectionId,
      connection: connectionWhere,
    };
    const [rows, total] = await Promise.all([
      this.prisma.document_reception_runs.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.document_reception_runs.count({ where }),
    ]);
    return { data: rows.map((row) => this.toRunView(row)), total, page, limit };
  }

  async create(ctx: ReceivedDocumentsContext, dto: CreateDocumentReceptionConnectionDto): Promise<DocumentReceptionConnectionView> {
    await this.assertConfigurationContext(ctx);
    const name = this.name(dto?.name);
    const type = this.connectionType(dto?.connection_type);
    const enabled = this.boolean(dto?.enabled, false);
    const pollInterval = this.pollInterval(dto?.poll_interval_minutes, 15);
    if (this.isSupplied(dto, 'secret', dto?.secret) && dto.secret == null) {
      throw new BadRequestException('El secreto de conexión no puede ser null.');
    }
    const endpointSupplied = this.isSupplied(dto, 'endpoint', dto?.endpoint);
    if (type === 'webhook' && endpointSupplied) throw new BadRequestException('Los webhooks no admiten un endpoint de polling.');
    const endpoint = this.endpointForCreate(type, dto?.endpoint);
    const secret = this.optionalSecret(dto?.secret);
    if (!secret) throw new BadRequestException('La conexión requiere un secreto de acceso; el token público del webhook no autoriza solicitudes.');
    if (type === 'api_poll' && !endpoint) throw new BadRequestException('La conexión API requiere un endpoint HTTPS público.');

    const now = new Date();
    const encryptedSecret = secret ? this.encryption.encrypt(secret) : null;
    const created = await this.prisma.document_reception_connections.create({
      data: {
        organization_id: ctx.organization_id,
        store_id: ctx.store_id!,
        accounting_entity_id: ctx.accounting_entity_id,
        created_by: ctx.actor_id ?? null,
        public_token: this.newPublicToken(),
        name,
        connection_type: type,
        enabled,
        endpoint,
        encrypted_secret: encryptedSecret,
        poll_interval_minutes: pollInterval,
        cursor: null,
        next_sync_at: type === 'api_poll' && enabled ? now : null,
      },
    });
    return this.toView(created);
  }

  async update(
    ctx: ReceivedDocumentsContext,
    id: number,
    dto: UpdateDocumentReceptionConnectionDto,
  ): Promise<DocumentReceptionConnectionView> {
    this.assertPositiveId(id, 'connection_id');
    this.assertPositiveId(dto?.expected_version, 'expected_version');
    await this.assertConfigurationContext(ctx);
    const existing = await this.findRecord(ctx, id);
    if (!existing) throw new NotFoundException('Conexión de recepción no encontrada.');
    this.assertVersion(existing, dto.expected_version);
    this.assertLeaseEditable(existing);

    const patch: Record<string, unknown> = {};
    if (this.isSupplied(dto, 'name', dto.name)) patch['name'] = this.name(dto.name);
    if (this.isSupplied(dto, 'enabled', dto.enabled)) patch['enabled'] = this.boolean(dto.enabled, existing.enabled);
    if (this.isSupplied(dto, 'poll_interval_minutes', dto.poll_interval_minutes)) patch['poll_interval_minutes'] = this.pollInterval(dto.poll_interval_minutes, existing.poll_interval_minutes);

    const endpointSupplied = this.isSupplied(dto, 'endpoint', dto.endpoint);
    if (endpointSupplied) {
      if (dto.endpoint == null) throw new BadRequestException('El endpoint no puede borrarse; envíe un endpoint HTTPS válido.');
      if (existing.connection_type !== 'api_poll') throw new BadRequestException('Los webhooks no admiten un endpoint de polling.');
      this.httpTransport.validateEndpoint(dto.endpoint);
      patch['endpoint'] = dto.endpoint;
    }

    const secretSupplied = this.isSupplied(dto, 'secret', dto.secret);
    if (secretSupplied) {
      if (dto.secret == null) throw new BadRequestException('Para rotar el secreto envíe un valor no vacío; no se admite borrarlo con null.');
      const secret = this.optionalSecret(dto.secret);
      if (!secret) throw new BadRequestException('El secreto de conexión no puede estar vacío.');
      patch['encrypted_secret'] = this.encryption.encrypt(secret);
    }

    const endpointChanged = endpointSupplied && dto.endpoint !== existing.endpoint;
    const rotateSecret = secretSupplied;
    const resetCursor = endpointChanged || rotateSecret;
    const enabledAfter = (patch['enabled'] as boolean | undefined) ?? existing.enabled;
    if (existing.connection_type === 'api_poll') {
      if (enabledAfter && (!existing.enabled || resetCursor)) patch['next_sync_at'] = new Date();
      else if (!enabledAfter) patch['next_sync_at'] = null;
    } else {
      if (endpointSupplied) throw new BadRequestException('Los webhooks no admiten un endpoint de polling.');
      if (secretSupplied && !this.optionalSecret(dto.secret)) throw new BadRequestException('El secreto de webhook no puede estar vacío.');
      patch['next_sync_at'] = null;
    }
    if (resetCursor) patch['cursor'] = null;
    patch['version'] = { increment: 1 };

    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.document_reception_connections.updateMany({
        where: {
          id,
          ...this.connectionWhere(ctx),
          version: dto.expected_version,
          OR: [
            { lease_token: null },
            { lease_expires_at: { lte: new Date() } },
          ],
        },
        data: patch,
      });
      if (changed.count !== 1) {
        const current = await tx.document_reception_connections.findFirst({ where: { id, ...this.connectionWhere(ctx) } });
        if (!current) throw new NotFoundException('Conexión de recepción no encontrada.');
        this.assertVersion(current, dto.expected_version);
        this.assertLeaseEditable(current);
        throw new ConflictException('La conexión cambió durante la actualización; vuelva a cargarla.');
      }
      const fresh = await tx.document_reception_connections.findFirst({ where: { id, ...this.connectionWhere(ctx) } });
      if (!fresh) throw new NotFoundException('Conexión de recepción no encontrada.');
      return this.toView(fresh);
    });
  }

  private async assertConfigurationContext(ctx: ReceivedDocumentsContext): Promise<void> {
    await this.receivedDocuments.assertContext(ctx);
    this.assertPositiveId(ctx.store_id, 'store_id');
    this.assertPositiveId(ctx.actor_id, 'actor_id');
  }

  private connectionWhere(ctx: ReceivedDocumentsContext) {
    return {
      organization_id: ctx.organization_id,
      accounting_entity_id: ctx.accounting_entity_id,
      ...(ctx.store_id != null ? { store_id: ctx.store_id } : {}),
    };
  }

  private findRecord(ctx: ReceivedDocumentsContext, id: number) {
    return this.prisma.document_reception_connections.findFirst({
      where: { id, ...this.connectionWhere(ctx) },
    });
  }

  private endpointForCreate(type: DocumentReceptionConnectionType, endpoint: string | null | undefined): string | null {
    if (type === 'webhook') {
      if (endpoint != null) throw new BadRequestException('Los webhooks no admiten un endpoint de polling.');
      return null;
    }
    if (typeof endpoint !== 'string' || endpoint.length === 0) throw new BadRequestException('La conexión API requiere un endpoint HTTPS público.');
    this.httpTransport.validateEndpoint(endpoint);
    return endpoint;
  }

  private toView(record: ConnectionRecord): DocumentReceptionConnectionView {
    const view: DocumentReceptionConnectionView = {
      id: record.id,
      version: record.version,
      store_id: record.store_id,
      accounting_entity_id: record.accounting_entity_id,
      name: record.name,
      connection_type: this.connectionType(record.connection_type),
      enabled: record.enabled,
      poll_interval_minutes: record.poll_interval_minutes,
      has_secret: !!record.encrypted_secret,
      next_sync_at: record.next_sync_at,
      last_synced_at: record.last_synced_at,
      ...(this.safeErrorCode(record.last_error) ? { last_error_code: this.safeErrorCode(record.last_error) } : {}),
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
    if (record.connection_type === 'api_poll' && record.endpoint) view.endpoint = record.endpoint;
    if (record.connection_type === 'webhook' && record.public_token) {
      view.public_token = record.public_token;
      view.webhook_path = `/public/received-documents/webhook/${record.public_token}`;
    }
    return view;
  }

  private toRunView(run: ReceptionRunRecord): DocumentReceptionRunView {
    return {
      id: run.id,
      status: RUN_STATUSES.has(run.status) ? run.status : 'unknown',
      trigger: RUN_TRIGGERS.has(run.trigger) ? run.trigger : 'unknown',
      received_count: this.safeCount(run.received_count),
      duplicate_count: this.safeCount(run.duplicate_count),
      error_count: this.safeCount(run.error_count),
      cursor_before_present: run.cursor_before != null,
      cursor_after_present: run.cursor_after != null,
      ...(this.sanitizedSummary(run.summary) ? { summary: this.sanitizedSummary(run.summary) } : {}),
      started_at: run.started_at,
      finished_at: run.finished_at,
      created_at: run.created_at,
    };
  }

  private sanitizedSummary(value: unknown): DocumentReceptionRunView['summary'] | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const raw = value as Record<string, unknown>;
    const safe: NonNullable<DocumentReceptionRunView['summary']> = {};
    if (raw['counts'] && typeof raw['counts'] === 'object' && !Array.isArray(raw['counts'])) {
      const rawCounts = raw['counts'] as Record<string, unknown>;
      const counts: Record<string, number> = {};
      for (const key of SAFE_COUNT_KEYS) {
        const candidate = rawCounts[key];
        if (typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0) counts[key] = candidate;
      }
      if (Object.keys(counts).length) safe.counts = counts;
    }
    const documentIds = raw['document_ids'];
    if (Array.isArray(documentIds)) {
      const ids = documentIds.filter((id): id is number => Number.isSafeInteger(id) && (id as number) > 0).slice(0, MAX_SAFE_IDS);
      if (ids.length) safe.document_ids = ids;
    }
    const codes = raw['error_codes'];
    if (Array.isArray(codes)) {
      const errorCodes = codes.map((code) => this.safeErrorCode(code)).filter((code): code is string => !!code).slice(0, MAX_SAFE_IDS);
      if (errorCodes.length) safe.error_codes = errorCodes;
    }
    return Object.keys(safe).length ? safe : undefined;
  }

  private safeErrorCode(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    return Object.values(ErrorCodes).find((entry) => entry.code === value)?.code;
  }

  private assertLeaseEditable(record: ConnectionRecord): void {
    if (record.lease_token != null && (!record.lease_expires_at || record.lease_expires_at.getTime() > Date.now())) {
      throw new ConflictException('La conexión está siendo procesada y no puede editarse todavía.');
    }
  }

  private assertVersion(record: ConnectionRecord, expected: number): void {
    if (record.version !== expected) throw new ConflictException('La conexión cambió; vuelva a cargarla antes de editar.');
  }

  private connectionType(value: unknown): DocumentReceptionConnectionType {
    if (CONNECTION_TYPES.includes(value as DocumentReceptionConnectionType)) return value as DocumentReceptionConnectionType;
    throw new BadRequestException('El tipo de conexión no es válido.');
  }

  private name(value: unknown): string {
    if (typeof value !== 'string') throw new BadRequestException('El nombre de conexión es obligatorio.');
    const name = value.trim();
    if (!name || name.length > 100) throw new BadRequestException('El nombre de conexión debe tener entre 1 y 100 caracteres.');
    return name;
  }

  private boolean(value: unknown, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') throw new BadRequestException('El estado enabled debe ser booleano.');
    return value;
  }

  private pollInterval(value: unknown, fallback: number): number {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 1440) {
      throw new BadRequestException('El intervalo de consulta debe estar entre 1 y 1440 minutos.');
    }
    return value as number;
  }

  private optionalSecret(value: unknown): string | undefined {
    if (value == null) return undefined;
    if (typeof value !== 'string' || value.length < 1 || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) {
      throw new BadRequestException('El secreto de conexión no es válido.');
    }
    return value;
  }

  private page(page: unknown, limit: unknown): { page: number; limit: number } {
    const safePage = page ?? 1;
    const safeLimit = limit ?? 25;
    if (!Number.isInteger(safePage) || (safePage as number) < 1) throw new BadRequestException('page debe ser entero positivo.');
    if (!Number.isInteger(safeLimit) || (safeLimit as number) < 1 || (safeLimit as number) > 100) throw new BadRequestException('limit debe estar entre 1 y 100.');
    return { page: safePage as number, limit: safeLimit as number };
  }

  private assertPositiveId(value: unknown, field: string): asserts value is number {
    if (!Number.isSafeInteger(value) || (value as number) < 1) throw new BadRequestException(`${field} debe ser un entero positivo.`);
  }

  private hasOwn(value: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  private isSupplied(value: object, key: string, field: unknown): boolean {
    return field !== undefined || (field === null && this.hasOwn(value, key));
  }

  private safeCount(value: number): number {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  private newPublicToken(): string {
    return randomUUID();
  }
}
