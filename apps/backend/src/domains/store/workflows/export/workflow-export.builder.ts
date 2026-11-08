import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'stream';
import { S3Service } from '../../../../common/services/s3.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  verifyAuditChain,
  WorkflowAuditRow,
  WorkflowAuditVerification,
} from '../audit/workflow-audit.service';
import { buildExportReadme } from './workflow-export.readme';
import { ZipWriter } from './zip-archive';

/** Rows read per query; every table is paged by id so memory stays flat. */
export const EXPORT_PAGE_SIZE = 500;
export const EXPORT_MANIFEST_VERSION = 'vendix.workflow-export/v1';

type Row = Record<string, unknown> & { id: number | bigint };
type Select = Record<string, true>;

interface PagedModel {
  findMany(args: {
    where: Record<string, unknown>;
    orderBy: { id: 'asc' };
    take: number;
    select?: Select;
  }): Promise<Row[]>;
}

export interface ExportFileEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface ExportSkippedFile {
  file_id: number;
  name: string;
  /** deleted | purged | unreadable */
  reason: string;
  detail: string;
}

export interface WorkflowExportOutcome {
  counts: Record<string, number>;
  /** Stored files (attachments) that went into the ZIP. */
  fileCount: number;
  skipped: ExportSkippedFile[];
  auditChain: WorkflowAuditVerification;
}

export interface WorkflowExportTarget {
  exportId: number;
  storeId: number;
  storeName: string;
  generatedAt: Date;
}

/**
 * Column lists of the tables that hold secrets: they are PICKED, never
 * stripped, so a column added later cannot leak into an export by default.
 * Secret values (`value_enc`, `secret_enc`), token hashes and OTP hashes have
 * no place in any list below.
 */
const SELECT_SECRETS: Select = {
  id: true,
  store_id: true,
  name: true,
  description: true,
  created_by_user_id: true,
  last_used_at: true,
  created_at: true,
  updated_at: true,
};
const SELECT_WEBHOOKS: Select = {
  id: true,
  store_id: true,
  url: true,
  event_types: true,
  is_active: true,
  description: true,
  created_by_user_id: true,
  created_at: true,
  updated_at: true,
};
const SELECT_INBOUND_HOOKS: Select = {
  id: true,
  store_id: true,
  definition_id: true,
  public_id: true,
  is_active: true,
  rate_limit_per_minute: true,
  last_used_at: true,
  created_at: true,
  updated_at: true,
};
const SELECT_SIGNERS: Select = {
  id: true,
  store_id: true,
  request_id: true,
  order: true,
  name: true,
  document_number: true,
  email: true,
  phone: true,
  role_label: true,
  slot_key: true,
  method: true,
  status: true,
  viewed_at: true,
  signed_at: true,
  signed_ip: true,
  signed_user_agent: true,
  signature_file_id: true,
  declined_reason: true,
  created_at: true,
  updated_at: true,
};
const SELECT_FILE_METADATA: Select = {
  id: true,
  store_id: true,
  original_name: true,
  mime_type: true,
  size_bytes: true,
  sha256: true,
  source: true,
  uploaded_by_type: true,
  uploaded_by_id: true,
  retention_until: true,
  legal_hold: true,
  deleted_at: true,
  purged_at: true,
  created_at: true,
};
const SELECT_FILE_CONTENT: Select = {
  id: true,
  s3_key: true,
  original_name: true,
  sha256: true,
  size_bytes: true,
  deleted_at: true,
  purged_at: true,
};

interface JsonlTable {
  model: string;
  path: string;
  count: string;
  select?: Select;
}

const REQUEST_TABLES: JsonlTable[] = [
  { model: 'workflow_instances', path: 'solicitudes/instancias.jsonl', count: 'instances' },
  { model: 'workflow_instance_events', path: 'solicitudes/eventos.jsonl', count: 'events' },
  { model: 'workflow_tasks', path: 'solicitudes/tareas.jsonl', count: 'tasks' },
  { model: 'workflow_task_votes', path: 'solicitudes/votos.jsonl', count: 'votes' },
  { model: 'workflow_instance_comments', path: 'solicitudes/comentarios.jsonl', count: 'comments' },
  { model: 'workflow_approval_gates', path: 'solicitudes/compuertas-aprobacion.jsonl', count: 'approval_gates' },
];
const DOSSIER_TABLES: JsonlTable[] = [
  { model: 'dossiers', path: 'expedientes/expedientes.jsonl', count: 'dossiers' },
  { model: 'dossier_items', path: 'expedientes/elementos.jsonl', count: 'dossier_items' },
  { model: 'stored_files', path: 'expedientes/archivos.jsonl', count: 'stored_files', select: SELECT_FILE_METADATA },
];
const RECORD_TABLES: JsonlTable[] = [
  { model: 'workflow_collections', path: 'registros/colecciones.jsonl', count: 'collections' },
  { model: 'workflow_records', path: 'registros/registros.jsonl', count: 'records' },
];
const INTEGRATION_TABLES: JsonlTable[] = [
  { model: 'workflow_webhook_endpoints', path: 'integraciones/webhooks.jsonl', count: 'webhooks', select: SELECT_WEBHOOKS },
  { model: 'workflow_inbound_hooks', path: 'integraciones/entradas.jsonl', count: 'inbound_hooks', select: SELECT_INBOUND_HOOKS },
  { model: 'workflow_secrets', path: 'integraciones/secretos.jsonl', count: 'secrets', select: SELECT_SECRETS },
];

/** BigInt ids and `seq` are written as strings, like the audit hash does. */
function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** A file name that is safe as a ZIP entry name (no separators, no dots first). */
export function safeEntryName(name: string): string {
  const cleaned = name
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .replace(/^[.\s]+/, '_')
    .trim()
    .slice(0, 100);
  return cleaned || 'archivo';
}

/**
 * Writes the whole store's Flows data into a ZIP (flujos-adm P7.6). Every query
 * carries the store id and is paged by id; JSONL entries are streamed through
 * the archive and attachments are read from S3 one at a time. The manifest goes
 * last, with the size and sha256 of every other entry.
 */
@Injectable()
export class WorkflowExportBuilder {
  private readonly logger = new Logger(WorkflowExportBuilder.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3: S3Service,
  ) {}

  async build(target: WorkflowExportTarget, zip: ZipWriter): Promise<WorkflowExportOutcome> {
    const run = new ExportRun(target, zip, this.prisma, this.s3, this.logger);
    return run.execute();
  }
}

/** State of one export: the counters, the manifest entries and the skipped files. */
class ExportRun {
  private readonly counts: Record<string, number> = {};
  private readonly files: ExportFileEntry[] = [];
  private readonly skipped: ExportSkippedFile[] = [];
  private readonly documentFileIds = new Set<number>();
  private attachments = 0;
  private auditChain: WorkflowAuditVerification = { valid: true, count: 0, broken_at_seq: null, last_hash: null };

  constructor(
    private readonly target: WorkflowExportTarget,
    private readonly zip: ZipWriter,
    private readonly prisma: StorePrismaService,
    private readonly s3: S3Service,
    private readonly logger: Logger,
  ) {}

  async execute(): Promise<WorkflowExportOutcome> {
    await this.addBuffer('LEEME.txt', buildExportReadme(this.target.storeName, this.target.generatedAt));
    await this.addFlows();
    for (const table of REQUEST_TABLES) await this.addTable(table);
    await this.addDocuments();
    for (const table of DOSSIER_TABLES) await this.addTable(table);
    await this.addStoredFiles();
    for (const table of RECORD_TABLES) await this.addTable(table);
    await this.addAudit();
    for (const table of INTEGRATION_TABLES) await this.addTable(table);

    const manifest = {
      version: EXPORT_MANIFEST_VERSION,
      export_id: this.target.exportId,
      generated_at: this.target.generatedAt.toISOString(),
      store: { id: this.target.storeId, name: this.target.storeName },
      counts: this.counts,
      audit_chain: this.auditChain,
      files: this.files,
      skipped_files: this.skipped,
    };
    await this.zip.add('manifest.json', Buffer.from(`${JSON.stringify(manifest, jsonReplacer, 2)}\n`));
    return {
      counts: this.counts,
      fileCount: this.attachments,
      skipped: this.skipped,
      auditChain: this.auditChain,
    };
  }

  private model(name: string): PagedModel {
    return (this.prisma as unknown as Record<string, PagedModel>)[name];
  }

  private async *rows(
    model: string,
    select?: Select,
    onPage?: (page: Row[]) => void,
  ): AsyncGenerator<Row> {
    let cursor: number | bigint | null = null;
    for (;;) {
      const page: Row[] = await this.model(model).findMany({
        where: { store_id: this.target.storeId, ...(cursor === null ? {} : { id: { gt: cursor } }) },
        orderBy: { id: 'asc' },
        take: EXPORT_PAGE_SIZE,
        ...(select ? { select } : {}),
      });
      onPage?.(page);
      for (const row of page) yield row;
      if (page.length < EXPORT_PAGE_SIZE) return;
      cursor = page[page.length - 1].id;
    }
  }

  private async addBuffer(path: string, body: Buffer | string): Promise<void> {
    const buffer = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    await this.zip.add(path, buffer);
    this.files.push({ path, size: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') });
  }

  /** Streams rows as JSON lines, hashing what passes; returns the row count. */
  private async addJsonl(
    path: string,
    source: AsyncIterable<Row>,
    onRow?: (row: Row) => void,
  ): Promise<number> {
    const hash = createHash('sha256');
    let size = 0;
    let rows = 0;
    async function* lines(): AsyncGenerator<Buffer> {
      for await (const row of source) {
        onRow?.(row);
        const line = Buffer.from(`${JSON.stringify(row, jsonReplacer)}\n`, 'utf8');
        hash.update(line);
        size += line.length;
        rows += 1;
        yield line;
      }
    }
    await this.zip.add(path, Readable.from(lines(), { objectMode: false }));
    this.files.push({ path, size, sha256: hash.digest('hex') });
    return rows;
  }

  private async addTable(table: JsonlTable, onRow?: (row: Row) => void): Promise<void> {
    this.counts[table.count] = await this.addJsonl(table.path, this.rows(table.model, table.select), onRow);
  }

  private async addFlows(): Promise<void> {
    const keys = new Map<number, string>();
    await this.addTable(
      { model: 'workflow_definitions', path: 'flujos/definiciones.jsonl', count: 'definitions' },
      (row) => keys.set(Number(row.id), String(row.key)),
    );
    let versions = 0;
    for await (const row of this.rows('workflow_versions')) {
      const key = safeEntryName(keys.get(Number(row.definition_id)) ?? `flujo-${String(row.definition_id)}`);
      await this.addBuffer(
        `flujos/versiones/${key}-v${String(row.version)}.json`,
        `${JSON.stringify(row, jsonReplacer, 2)}\n`,
      );
      versions += 1;
    }
    this.counts.versions = versions;
  }

  private async addDocuments(): Promise<void> {
    const remember = (id: unknown): void => {
      if (typeof id === 'number') this.documentFileIds.add(id);
    };
    const tables: Array<{ table: JsonlTable; onRow?: (row: Row) => void }> = [
      { table: { model: 'document_templates', path: 'documentos/plantillas.jsonl', count: 'templates' } },
      { table: { model: 'document_template_versions', path: 'documentos/plantillas-versiones.jsonl', count: 'template_versions' } },
      {
        table: { model: 'issued_documents', path: 'documentos/emitidos.jsonl', count: 'issued_documents' },
        onRow: (row) => remember(row.file_id),
      },
      {
        table: { model: 'signature_requests', path: 'documentos/solicitudes-firma.jsonl', count: 'signature_requests' },
        onRow: (row) => remember(row.sealed_file_id),
      },
      {
        table: { model: 'signature_signers', path: 'documentos/firmantes.jsonl', count: 'signature_signers', select: SELECT_SIGNERS },
        onRow: (row) => remember(row.signature_file_id),
      },
      { table: { model: 'signature_evidence_events', path: 'documentos/evidencia-firma.jsonl', count: 'signature_evidence' } },
    ];
    for (const { table, onRow } of tables) await this.addTable(table, onRow);
  }

  /** Live attachments, one S3 read at a time. */
  private async addStoredFiles(): Promise<void> {
    for await (const file of this.rows('stored_files', SELECT_FILE_CONTENT)) {
      const id = Number(file.id);
      const name = String(file.original_name);
      if (file.deleted_at) {
        this.skipped.push({ file_id: id, name, reason: 'deleted', detail: 'El archivo fue eliminado en Vendix.' });
        continue;
      }
      if (file.purged_at) {
        this.skipped.push({
          file_id: id,
          name,
          reason: 'purged',
          detail: 'El archivo fue purgado por la política de retención; solo queda su huella en expedientes/archivos.jsonl.',
        });
        continue;
      }
      let body: Buffer;
      try {
        body = await this.s3.downloadFile(String(file.s3_key));
      } catch (e) {
        this.logger.warn(`Export ${this.target.exportId}: file ${id} could not be read: ${(e as Error)?.message}`);
        this.skipped.push({ file_id: id, name, reason: 'unreadable', detail: 'No se pudo leer el archivo del almacenamiento.' });
        continue;
      }
      const folder = this.documentFileIds.has(id) ? 'documentos/archivos' : 'expedientes/archivos';
      const path = `${folder}/${id}-${safeEntryName(name)}`;
      await this.zip.add(path, body);
      this.files.push({ path, size: body.length, sha256: createHash('sha256').update(body).digest('hex') });
      this.attachments += 1;
    }
  }

  /** The audit trail with its hashes, and the chain verified while it streams. */
  private async addAudit(): Promise<void> {
    let cursor = { prev_hash: null as string | null, seq: 0n };
    let broken = false;
    let total = 0;
    const onPage = (page: Row[]): void => {
      total += page.length;
      if (broken || page.length === 0) return;
      const result = verifyAuditChain(page as unknown as WorkflowAuditRow[], cursor);
      if (!result.valid) {
        broken = true;
        this.auditChain = {
          valid: false,
          count: result.count,
          broken_at_seq: result.broken_at_seq,
          last_hash: result.last_hash,
        };
        return;
      }
      cursor = { prev_hash: result.last_hash, seq: result.next_seq };
      this.auditChain = { valid: true, count: result.count, broken_at_seq: null, last_hash: result.last_hash };
    };
    await this.addJsonl('auditoria/audit.jsonl', this.rows('workflow_audit_log', undefined, onPage));
    this.counts.audit = total;
  }
}
