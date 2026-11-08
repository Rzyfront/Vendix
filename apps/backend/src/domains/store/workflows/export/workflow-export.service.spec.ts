import AdmZip = require('adm-zip');
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { S3PathHelper } from '../../../../common/helpers/s3-path.helper';
import { S3Service } from '../../../../common/services/s3.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { FakeWorkflowDb } from '../../../../testing/workflows/fake-workflow-prisma';
import { NotificationsService } from '../../notifications/notifications.service';
import { WorkflowAuditService } from '../audit/workflow-audit.service';
import { S3MultipartWritable } from './s3-multipart-writable';
import { WorkflowExportBuilder } from './workflow-export.builder';
import { WorkflowExportCron } from './workflow-export.cron';
import {
  EXPORT_FAILED_MESSAGE,
  EXPORT_INTERRUPTED_MESSAGE,
  EXPORT_READY_TITLE,
  WorkflowExportService,
} from './workflow-export.service';

/** In-memory S3 that keeps what multipart uploads assemble. */
class FakeS3 {
  objects = new Map<string, Buffer>();
  aborted: string[] = [];
  deleted: string[] = [];
  signed: string[] = [];
  unreadable = new Set<string>();
  failOnPart = false;
  private uploads = new Map<string, { key: string; parts: Map<number, Buffer> }>();
  private n = 0;

  async createMultipartUpload(key: string): Promise<string> {
    const id = `up-${++this.n}`;
    this.uploads.set(id, { key, parts: new Map() });
    return id;
  }
  async uploadMultipartPart(_key: string, uploadId: string, part: number, body: Buffer): Promise<string> {
    if (this.failOnPart) throw new Error('S3 down');
    this.uploads.get(uploadId)?.parts.set(part, body);
    return `etag-${part}`;
  }
  async completeMultipartUpload(key: string, uploadId: string, parts: Array<{ partNumber: number }>): Promise<void> {
    const up = this.uploads.get(uploadId);
    if (!up) throw new Error('no such upload');
    this.objects.set(key, Buffer.concat(parts.map((p) => up.parts.get(p.partNumber) as Buffer)));
    this.uploads.delete(uploadId);
  }
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    this.aborted.push(key);
    this.uploads.delete(uploadId);
  }
  async downloadFile(key: string): Promise<Buffer> {
    const body = this.objects.get(key);
    if (!body || this.unreadable.has(key)) throw new Error('NoSuchKey');
    return body;
  }
  async deleteFile(key: string): Promise<void> {
    this.deleted.push(key);
    this.objects.delete(key);
  }
  async getPresignedUrl(key: string, expiresIn: number): Promise<string> {
    this.signed.push(key);
    return `https://s3.test/${key}?expires=${expiresIn}`;
  }
  get pendingUploads(): number {
    return this.uploads.size;
  }
}

const as = <T>(store_id: number, fn: () => Promise<T>, user_id: number | null = 7) =>
  RequestContextService.runIsolated(
    {
      store_id,
      organization_id: 1,
      user_id: user_id ?? undefined,
      email: 'ana@tienda.co',
      is_super_admin: false,
      is_owner: false,
    },
    fn,
  );

function codeOf(error: unknown): string | undefined {
  return error instanceof VendixHttpException ? error.errorCode : undefined;
}

describe('Workflow export (P7.6)', () => {
  let db: FakeWorkflowDb;
  let s3: FakeS3;
  let audit: WorkflowAuditService;
  let notifications: { sendToUser: jest.Mock; createAndBroadcast: jest.Mock };
  let service: WorkflowExportService;

  const build = (auditOverride?: Pick<WorkflowAuditService, 'append' | 'recordNow'>): WorkflowExportService => {
    const prisma = db.asStorePrisma() as StorePrismaService;
    audit = new WorkflowAuditService(prisma);
    return new WorkflowExportService(
      prisma,
      s3 as unknown as S3Service,
      new S3PathHelper(),
      (auditOverride as WorkflowAuditService) ?? audit,
      notifications as unknown as NotificationsService,
      new WorkflowExportBuilder(prisma, s3 as unknown as S3Service),
    );
  };

  const exportsOf = (storeId: number) => db.table('workflow_exports').filter((r) => r.store_id === storeId);
  const auditRows = (storeId: number) => db.table('workflow_audit_log').filter((r) => r.store_id === storeId);

  beforeEach(() => {
    db = new FakeWorkflowDb();
    s3 = new FakeS3();
    notifications = { sendToUser: jest.fn(), createAndBroadcast: jest.fn() };
    db.insert('organizations', { id: 1, slug: 'org' });
    db.insert('stores', { id: 10, name: 'Tienda Diez', slug: 'diez', organization_id: 1 });
    db.insert('stores', { id: 20, name: 'Tienda Veinte', slug: 'veinte', organization_id: 1 });
    service = build();
  });

  describe('request, list and download', () => {
    it('queues an export and records export.requested in the audit trail', async () => {
      const created = await as(10, () => service.request());

      expect(created).toMatchObject({ status: 'pending', file_count: 0, size_bytes: null });
      expect(exportsOf(10)).toHaveLength(1);
      expect(exportsOf(10)[0].requested_by_user_id).toBe(7);
      expect(auditRows(10)).toHaveLength(1);
      expect(auditRows(10)[0]).toMatchObject({ action: 'export.requested', category: 'export', target_id: String(created.id) });
    });

    it('refuses a second export while one is pending or running (409 "Ya hay una exportación en curso.")', async () => {
      await as(10, () => service.request());
      const err = await as(10, () => service.request()).catch((e: unknown) => e);
      expect(codeOf(err)).toBe(ErrorCodes.WORKFLOW_EXPORT_IN_PROGRESS.code);
      expect((err as VendixHttpException).getStatus()).toBe(409);
      expect(ErrorCodes.WORKFLOW_EXPORT_IN_PROGRESS.devMessage).toBe('Ya hay una exportación en curso.');

      exportsOf(10)[0].status = 'running';
      expect(codeOf(await as(10, () => service.request()).catch((e: unknown) => e))).toBe(
        ErrorCodes.WORKFLOW_EXPORT_IN_PROGRESS.code,
      );
      expect(exportsOf(10)).toHaveLength(1);
      // The refused attempts left no audit row behind.
      expect(auditRows(10)).toHaveLength(1);
    });

    it('lets another store export at the same time and after the first finished', async () => {
      await as(10, () => service.request());
      await expect(as(20, () => service.request())).resolves.toMatchObject({ status: 'pending' });
      exportsOf(10)[0].status = 'failed';
      await expect(as(10, () => service.request())).resolves.toMatchObject({ status: 'pending' });
    });

    it('lists the latest 20 exports of the store only, newest first, without the storage key', async () => {
      for (let i = 0; i < 22; i++) db.insert('workflow_exports', { store_id: 10, status: 'failed', file_count: 0, counts: {} });
      db.insert('workflow_exports', { store_id: 20, status: 'ready', s3_key: 'x/other.zip', file_count: 0, counts: {} });

      const list = await as(10, () => service.list());

      expect(list).toHaveLength(20);
      expect(list[0].id).toBeGreaterThan(list[19].id);
      expect(list.every((e) => exportsOf(10).some((r) => r.id === e.id))).toBe(true);
      expect(JSON.stringify(list)).not.toContain('s3_key');
      expect(JSON.stringify(list)).not.toContain('other.zip');
    });

    it('shows a ready export past its expiry as expired', async () => {
      db.insert('workflow_exports', {
        store_id: 10,
        status: 'ready',
        s3_key: 'k.zip',
        size_bytes: 5n,
        file_count: 1,
        counts: {},
        expires_at: new Date(Date.now() - 1000),
      });
      const [item] = await as(10, () => service.list());
      expect(item.status).toBe('expired');
      expect(item.size_bytes).toBe(5);
    });

    it('audits the download before it signs the URL', async () => {
      const row = db.insert('workflow_exports', {
        store_id: 10,
        status: 'ready',
        s3_key: 'org-1/export-1.zip',
        size_bytes: 10n,
        file_count: 2,
        counts: {},
        expires_at: new Date(Date.now() + 86_400_000),
      });
      const order: string[] = [];
      const spy = jest.spyOn(audit, 'recordNow').mockImplementation(async (input) => {
        order.push(`audit:${input.action}`);
        return {} as never;
      });
      s3.getPresignedUrl = async (key: string) => {
        order.push('sign');
        return `https://s3.test/${key}`;
      };

      const result = await as(10, () => service.download(row.id));

      expect(order).toEqual(['audit:export.downloaded', 'sign']);
      expect(result).toMatchObject({ url: 'https://s3.test/org-1/export-1.zip', file_name: `flujos-exportacion-${row.id}.zip` });
      spy.mockRestore();
    });

    it('records export.downloaded in the chain on a real download', async () => {
      const row = db.insert('workflow_exports', {
        store_id: 10, status: 'ready', s3_key: 'a.zip', size_bytes: 1n, file_count: 0, counts: {},
        expires_at: new Date(Date.now() + 86_400_000),
      });
      await as(10, () => service.download(row.id));
      expect(auditRows(10).map((r) => r.action)).toEqual(['export.downloaded']);
    });

    it('is fail-closed: when the audit cannot be written no URL is signed', async () => {
      const row = db.insert('workflow_exports', {
        store_id: 10, status: 'ready', s3_key: 'a.zip', size_bytes: 1n, file_count: 0, counts: {},
        expires_at: new Date(Date.now() + 86_400_000),
      });
      const failing = build({
        append: jest.fn(),
        recordNow: jest.fn().mockRejectedValue(new VendixHttpException(ErrorCodes.WORKFLOW_AUDIT_UNAVAILABLE)),
      });

      const err = await as(10, () => failing.download(row.id)).catch((e: unknown) => e);

      expect(codeOf(err)).toBe(ErrorCodes.WORKFLOW_AUDIT_UNAVAILABLE.code);
      expect(s3.signed).toHaveLength(0);
    });

    it('answers 404 for another store, 409 when not ready and 410 when expired', async () => {
      const foreign = db.insert('workflow_exports', {
        store_id: 20, status: 'ready', s3_key: 'b.zip', size_bytes: 1n, file_count: 0, counts: {},
        expires_at: new Date(Date.now() + 86_400_000),
      });
      const running = db.insert('workflow_exports', { store_id: 10, status: 'running', file_count: 0, counts: {} });
      const failed = db.insert('workflow_exports', { store_id: 10, status: 'failed', file_count: 0, counts: {} });
      const lapsed = db.insert('workflow_exports', {
        store_id: 10, status: 'ready', s3_key: 'c.zip', size_bytes: 1n, file_count: 0, counts: {},
        expires_at: new Date(Date.now() - 1000),
      });
      const expired = db.insert('workflow_exports', { store_id: 10, status: 'expired', file_count: 0, counts: {} });

      const code = async (id: number) => codeOf(await as(10, () => service.download(id)).catch((e: unknown) => e));
      expect(await code(foreign.id)).toBe(ErrorCodes.WORKFLOW_EXPORT_NOT_FOUND.code);
      expect(await code(9999)).toBe(ErrorCodes.WORKFLOW_EXPORT_NOT_FOUND.code);
      expect(await code(running.id)).toBe(ErrorCodes.WORKFLOW_EXPORT_NOT_READY.code);
      expect(await code(failed.id)).toBe(ErrorCodes.WORKFLOW_EXPORT_NOT_READY.code);
      expect(await code(lapsed.id)).toBe(ErrorCodes.WORKFLOW_EXPORT_EXPIRED.code);
      expect(await code(expired.id)).toBe(ErrorCodes.WORKFLOW_EXPORT_EXPIRED.code);
      expect(s3.signed).toHaveLength(0);
      expect(auditRows(10)).toHaveLength(0);
    });
  });

  describe('background build', () => {
    const seedStoreData = (): void => {
      // Store 10: the data that must be exported.
      db.insert('workflow_definitions', { id: 1, store_id: 10, key: 'compras', name: 'Compras', access: { view: { roles: [3] } }, status: 'active' });
      db.insert('workflow_versions', { id: 1, store_id: 10, definition_id: 1, version: 1, definition: { stages: [] }, definition_hash: 'h1' });
      db.insert('workflow_versions', { id: 2, store_id: 10, definition_id: 1, version: 2, definition: { stages: ['a'] }, definition_hash: 'h2' });
      db.insert('workflow_instances', { id: 1, store_id: 10, definition_id: 1, reference: 'FLU-1', title: 'Compra 1', data: { monto: 5 } });
      db.insert('workflow_instance_events', { id: 1, store_id: 10, instance_id: 1, seq: 1, type: 'started', payload: {} });
      db.insert('workflow_tasks', { id: 1, store_id: 10, instance_id: 1, stage_key: 'a' });
      db.insert('workflow_task_votes', { id: 1, store_id: 10, task_id: 1, user_id: 7 });
      db.insert('workflow_instance_comments', { id: 1, store_id: 10, instance_id: 1, body: 'ok' });
      db.insert('workflow_approval_gates', { id: 1, store_id: 10, operation: 'x', entity_id: 1 });
      db.insert('dossiers', { id: 1, store_id: 10, reference: 'EXP-000001', title: 'Exp 1' });
      db.insert('dossier_items', { id: 1, store_id: 10, dossier_id: 1, kind: 'file', file_id: 1 });
      db.insert('workflow_collections', { id: 1, store_id: 10, key: 'proveedores', name: 'Proveedores' });
      db.insert('workflow_records', { id: 1, store_id: 10, collection_id: 1, reference: 'PRO-1', title: 'Acme' });
      db.insert('document_templates', { id: 1, store_id: 10, key: 'carta', name: 'Carta' });
      db.insert('document_template_versions', { id: 1, store_id: 10, template_id: 1, version: 1, body: {} });
      db.insert('issued_documents', { id: 1, store_id: 10, reference: 'DOC-000001', title: 'Carta 1', file_id: 2 });
      db.insert('signature_requests', { id: 1, store_id: 10, issued_document_id: 1, sealed_file_id: null });
      db.insert('signature_signers', {
        id: 1, store_id: 10, request_id: 1, name: 'Luis', token_hash: 'SIGNER-TOKEN-HASH', otp_hash: 'SIGNER-OTP-HASH',
      });
      db.insert('signature_evidence_events', { store_id: 10, request_id: 1, seq: 1, type: 'created', payload: {} });
      db.insert('workflow_webhook_endpoints', {
        id: 1, store_id: 10, url: 'https://erp.example/hook', secret_enc: 'WEBHOOK-SECRET-ENC', event_types: ['instance.completed'],
      });
      db.insert('workflow_inbound_hooks', {
        id: 1, store_id: 10, definition_id: 1, public_id: 'pub-1', secret_enc: 'INBOUND-SECRET-ENC',
      });
      db.insert('workflow_secrets', { id: 1, store_id: 10, name: 'API_ERP', value_enc: 'SECRET-VALUE-ENC', description: 'ERP' });
      // Files of store 10.
      db.insert('stored_files', { id: 1, store_id: 10, s3_key: 'o/s10/soporte.pdf', original_name: 'Soporte ../compra.pdf', mime_type: 'application/pdf', size_bytes: 6, sha256: 'a'.repeat(64) });
      db.insert('stored_files', { id: 2, store_id: 10, s3_key: 'o/s10/carta.pdf', original_name: 'carta.pdf', mime_type: 'application/pdf', size_bytes: 5, sha256: 'b'.repeat(64) });
      db.insert('stored_files', { id: 3, store_id: 10, s3_key: 'o/s10/purgado.pdf', original_name: 'purgado.pdf', mime_type: 'application/pdf', size_bytes: 1, sha256: 'c'.repeat(64), purged_at: new Date() });
      db.insert('stored_files', { id: 4, store_id: 10, s3_key: 'o/s10/borrado.pdf', original_name: 'borrado.pdf', mime_type: 'application/pdf', size_bytes: 1, sha256: 'd'.repeat(64), deleted_at: new Date() });
      db.insert('stored_files', { id: 5, store_id: 10, s3_key: 'o/s10/perdido.pdf', original_name: 'perdido.pdf', mime_type: 'application/pdf', size_bytes: 1, sha256: 'e'.repeat(64) });
      s3.objects.set('o/s10/soporte.pdf', Buffer.from('SOP-10'));
      s3.objects.set('o/s10/carta.pdf', Buffer.from('CARTA'));
      // Store 20: nothing of it may enter store 10's ZIP.
      db.insert('workflow_definitions', { id: 2, store_id: 20, key: 'ajeno', name: 'FLUJO-AJENO', status: 'active' });
      db.insert('workflow_versions', { id: 3, store_id: 20, definition_id: 2, version: 1, definition: {}, definition_hash: 'h3' });
      db.insert('workflow_instances', { id: 2, store_id: 20, definition_id: 2, reference: 'FLU-1', title: 'SOLICITUD-AJENA' });
      db.insert('dossiers', { id: 2, store_id: 20, reference: 'EXP-000001', title: 'EXPEDIENTE-AJENO' });
      db.insert('workflow_secrets', { id: 2, store_id: 20, name: 'SECRETO_AJENO', value_enc: 'x' });
      db.insert('stored_files', { id: 6, store_id: 20, s3_key: 'o/s20/ajeno.pdf', original_name: 'ARCHIVO-AJENO.pdf', mime_type: 'application/pdf', size_bytes: 3, sha256: 'f'.repeat(64) });
      s3.objects.set('o/s20/ajeno.pdf', Buffer.from('AJENO'));
    };

    const entries = (zip: AdmZip): Record<string, string> =>
      Object.fromEntries(zip.getEntries().filter((e) => !e.isDirectory).map((e) => [e.entryName, e.getData().toString('utf8')]));

    const runExport = async (storeId = 10): Promise<{ row: Record<string, any>; zip: AdmZip | null }> => {
      await as(storeId, () => service.request());
      const row = exportsOf(storeId).slice(-1)[0];
      await service.processNext();
      const key = row.s3_key as string | null;
      return { row, zip: key ? new AdmZip(s3.objects.get(key) as Buffer) : null };
    };

    it('claims one pending export atomically, even when two workers race', async () => {
      await as(10, () => service.request());
      const results = await Promise.all([service.processNext(), service.processNext()]);
      expect(results.filter(Boolean).length).toBeGreaterThanOrEqual(1);
      expect(exportsOf(10)[0].status).toBe('ready');
      expect(s3.objects.size).toBe(1);
      await expect(service.processNext()).resolves.toBe(false);
    });

    it('writes the layout of the ZIP and a manifest with every file, size and sha256', async () => {
      seedStoreData();
      await as(10, () => audit.recordNow({ action: 'definition.published', target_type: 'definition', target_id: 1, definition_id: 1, summary: 'Publicó «Compras» v2' }));

      const { row, zip } = await runExport();
      expect(row.status).toBe('ready');
      expect(row.expires_at.getTime() - row.completed_at.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
      expect(row.size_bytes).toBe(BigInt((s3.objects.get(row.s3_key) as Buffer).length));
      expect(row.s3_key).toContain('organizations/org-1/stores/diez-10/workflow-exports/');

      const files = entries(zip as AdmZip);
      expect(Object.keys(files).sort()).toEqual(
        [
          'LEEME.txt',
          'manifest.json',
          'flujos/definiciones.jsonl',
          'flujos/versiones/compras-v1.json',
          'flujos/versiones/compras-v2.json',
          'solicitudes/instancias.jsonl',
          'solicitudes/eventos.jsonl',
          'solicitudes/tareas.jsonl',
          'solicitudes/votos.jsonl',
          'solicitudes/comentarios.jsonl',
          'solicitudes/compuertas-aprobacion.jsonl',
          'expedientes/expedientes.jsonl',
          'expedientes/elementos.jsonl',
          'expedientes/archivos.jsonl',
          'expedientes/archivos/1-Soporte .._compra.pdf',
          'registros/colecciones.jsonl',
          'registros/registros.jsonl',
          'documentos/plantillas.jsonl',
          'documentos/plantillas-versiones.jsonl',
          'documentos/emitidos.jsonl',
          'documentos/solicitudes-firma.jsonl',
          'documentos/firmantes.jsonl',
          'documentos/evidencia-firma.jsonl',
          'documentos/archivos/2-carta.pdf',
          'auditoria/audit.jsonl',
          'integraciones/webhooks.jsonl',
          'integraciones/entradas.jsonl',
          'integraciones/secretos.jsonl',
        ].sort(),
      );
      expect(files['expedientes/archivos/1-Soporte .._compra.pdf']).toBe('SOP-10');
      expect(files['documentos/archivos/2-carta.pdf']).toBe('CARTA');
      expect(files['LEEME.txt']).toContain('Tienda Diez');
      expect(files['LEEME.txt']).toContain('CÓMO VERIFICAR LA AUDITORÍA');
      expect(JSON.parse(files['flujos/definiciones.jsonl'].trim())).toMatchObject({ key: 'compras', access: { view: { roles: [3] } } });

      const manifest = JSON.parse(files['manifest.json']);
      expect(manifest.counts).toMatchObject({
        definitions: 1, versions: 2, instances: 1, events: 1, tasks: 1, votes: 1, comments: 1, approval_gates: 1,
        dossiers: 1, dossier_items: 1, stored_files: 5, collections: 1, records: 1, templates: 1, template_versions: 1,
        issued_documents: 1, signature_requests: 1, signature_signers: 1, signature_evidence: 1, audit: 2,
        webhooks: 1, inbound_hooks: 1, secrets: 1,
      });
      const listed = manifest.files.map((f: { path: string }) => f.path).sort();
      expect(listed).toEqual(Object.keys(files).filter((p) => p !== 'manifest.json').sort());
      for (const f of manifest.files as Array<{ path: string; size: number; sha256: string }>) {
        const data = (zip as AdmZip).getEntry(f.path)?.getData() as Buffer;
        expect(data.length).toBe(f.size);
        expect(require('crypto').createHash('sha256').update(data).digest('hex')).toBe(f.sha256);
      }
      expect(manifest.skipped_files.map((s: { file_id: number; reason: string }) => [s.file_id, s.reason])).toEqual([
        [3, 'purged'],
        [4, 'deleted'],
        [5, 'unreadable'],
      ]);
      expect(row.file_count).toBe(2);
      expect(row.counts).toMatchObject({ definitions: 1, audit: 2 });
    });

    it('carries the audit trail with its hashes and the verified chain', async () => {
      await as(10, () => audit.recordNow({ action: 'secret.created', target_type: 'secret', summary: 'Creó el secreto API_ERP' }));
      await as(20, () => audit.recordNow({ action: 'secret.created', target_type: 'secret', summary: 'Creó el secreto AJENO' }));

      const { zip } = await runExport();
      const files = entries(zip as AdmZip);
      const lines = files['auditoria/audit.jsonl'].trim().split('\n').map((l) => JSON.parse(l));

      expect(lines.map((l) => l.action)).toEqual(['secret.created', 'export.requested']);
      expect(lines[0]).toMatchObject({ seq: '1', prev_hash: null, store_id: 10 });
      expect(lines[1].prev_hash).toBe(lines[0].entry_hash);
      expect(lines.every((l) => /^[0-9a-f]{64}$/.test(l.entry_hash))).toBe(true);
      expect(files['auditoria/audit.jsonl']).not.toContain('AJENO');
      expect(JSON.parse(files['manifest.json']).audit_chain).toEqual({
        valid: true, count: 2, broken_at_seq: null, last_hash: lines[1].entry_hash,
      });
    });

    it('reports a broken audit chain in the manifest instead of hiding it', async () => {
      await as(10, () => audit.recordNow({ action: 'secret.created', target_type: 'secret', summary: 'Creó el secreto A' }));
      await as(10, () => audit.recordNow({ action: 'secret.deleted', target_type: 'secret', summary: 'Borró el secreto A' }));
      auditRows(10)[0].summary = 'Texto alterado';

      const { zip } = await runExport();
      const manifest = JSON.parse(entries(zip as AdmZip)['manifest.json']);
      expect(manifest.audit_chain).toMatchObject({ valid: false, broken_at_seq: '1' });
    });

    it('never puts secret values, token hashes or webhook secrets in any entry', async () => {
      seedStoreData();
      const { zip } = await runExport();
      const files = entries(zip as AdmZip);

      const everything = Object.values(files).join('\n');
      for (const forbidden of [
        'SECRET-VALUE-ENC', 'WEBHOOK-SECRET-ENC', 'INBOUND-SECRET-ENC', 'SIGNER-TOKEN-HASH', 'SIGNER-OTP-HASH',
        'value_enc', 'secret_enc', 'token_hash', 'otp_hash', 's3_key', 'o/s10/',
      ]) {
        expect(everything).not.toContain(forbidden);
      }
      expect(JSON.parse(files['integraciones/secretos.jsonl'].trim())).toMatchObject({ name: 'API_ERP' });
      expect(JSON.parse(files['integraciones/webhooks.jsonl'].trim())).toMatchObject({ url: 'https://erp.example/hook' });
      expect(JSON.parse(files['integraciones/entradas.jsonl'].trim())).toMatchObject({ public_id: 'pub-1' });
      expect(JSON.parse(files['documentos/firmantes.jsonl'].trim())).toMatchObject({ name: 'Luis' });
    });

    it("never includes another store's rows or files", async () => {
      seedStoreData();
      const { zip } = await runExport();
      const files = entries(zip as AdmZip);
      const everything = Object.keys(files).join('\n') + Object.values(files).join('\n');

      for (const foreign of ['FLUJO-AJENO', 'SOLICITUD-AJENA', 'EXPEDIENTE-AJENO', 'SECRETO_AJENO', 'ARCHIVO-AJENO', 'AJENO']) {
        expect(everything).not.toContain(foreign);
      }
      expect(JSON.parse(files['manifest.json']).counts).toMatchObject({ definitions: 1, instances: 1, secrets: 1, stored_files: 5 });
    });

    it('pages every table by 500 rows', async () => {
      for (let i = 1; i <= 1203; i++) {
        db.insert('workflow_instances', { id: i, store_id: 10, definition_id: 1, reference: `FLU-${i}`, title: `S${i}` });
      }
      const { zip } = await runExport();
      const files = entries(zip as AdmZip);
      const ids = files['solicitudes/instancias.jsonl'].trim().split('\n').map((l) => JSON.parse(l).id);
      expect(ids).toEqual(Array.from({ length: 1203 }, (_, i) => i + 1));
      expect(JSON.parse(files['manifest.json']).counts.instances).toBe(1203);
    });

    it('notifies the requester that the export is ready', async () => {
      await runExport();
      expect(notifications.sendToUser).toHaveBeenCalledWith(
        10, 7, 'workflow_task', EXPORT_READY_TITLE, expect.any(String), expect.objectContaining({ kind: 'workflow_export' }),
      );
      expect(EXPORT_READY_TITLE).toBe('Tu exportación de Flujos está lista');
    });

    it('a failed build leaves status failed, a Spanish error and no object or open upload', async () => {
      seedStoreData();
      s3.failOnPart = true;
      const { row } = await runExport();

      expect(row.status).toBe('failed');
      expect(row.error).toBe(EXPORT_FAILED_MESSAGE);
      expect(row.s3_key ?? null).toBeNull();
      expect(s3.objects.has('o/s10/soporte.pdf')).toBe(true);
      expect([...s3.objects.keys()].filter((k) => k.includes('workflow-exports'))).toHaveLength(0);
      expect(s3.pendingUploads).toBe(0);
      expect(notifications.sendToUser).not.toHaveBeenCalled();
      // A failed export does not block the next request.
      await expect(as(10, () => service.request())).resolves.toMatchObject({ status: 'pending' });
    });

    it('a data error mid-build also ends failed and aborts the upload', async () => {
      seedStoreData();
      const prisma = db.asStorePrisma() as StorePrismaService;
      const broken = new WorkflowExportBuilder(prisma, s3 as unknown as S3Service);
      jest.spyOn(broken, 'build').mockRejectedValue(new Error('boom'));
      const failing = new WorkflowExportService(
        prisma, s3 as unknown as S3Service, new S3PathHelper(), audit, notifications as unknown as NotificationsService, broken,
      );
      await as(10, () => failing.request());
      await failing.processNext();
      expect(exportsOf(10)[0]).toMatchObject({ status: 'failed', error: EXPORT_FAILED_MESSAGE });
      expect([...s3.objects.keys()].filter((k) => k.includes('workflow-exports'))).toHaveLength(0);
      expect(s3.pendingUploads).toBe(0);
    });
  });

  describe('multipart sink', () => {
    it('uploads parts of the configured size and joins them into one object', async () => {
      const sink = new S3MultipartWritable(s3 as unknown as S3Service, 'k/big.bin', 'application/zip', 4);
      const parts: Buffer[] = [];
      const original = s3.uploadMultipartPart.bind(s3);
      s3.uploadMultipartPart = async (key, id, n, body) => {
        parts.push(body);
        return original(key, id, n, body);
      };
      sink.write(Buffer.from('abcdefghij'));
      sink.write(Buffer.from('kl'));
      await new Promise<void>((resolve, reject) => sink.end((e?: Error | null) => (e ? reject(e) : resolve())));

      expect(s3.objects.get('k/big.bin')?.toString()).toBe('abcdefghijkl');
      expect(parts.length).toBeGreaterThan(1);
      expect(sink.total).toBe(12);
    });
  });

  describe('expiry and stale runs', () => {
    it('deletes the object of a ready export past expires_at and marks it expired', async () => {
      s3.objects.set('old.zip', Buffer.from('x'));
      s3.objects.set('fresh.zip', Buffer.from('y'));
      const old = db.insert('workflow_exports', {
        store_id: 10, status: 'ready', s3_key: 'old.zip', size_bytes: 1n, file_count: 0, counts: {},
        expires_at: new Date(Date.now() - 1000),
      });
      const fresh = db.insert('workflow_exports', {
        store_id: 10, status: 'ready', s3_key: 'fresh.zip', size_bytes: 1n, file_count: 0, counts: {},
        expires_at: new Date(Date.now() + 86_400_000),
      });

      await expect(service.expireDue(new Date())).resolves.toBe(1);

      expect(old).toMatchObject({ status: 'expired', s3_key: null });
      expect(fresh.status).toBe('ready');
      expect(s3.objects.has('old.zip')).toBe(false);
      expect(s3.objects.has('fresh.zip')).toBe(true);
    });

    it('keeps the export ready when the object could not be deleted, to retry later', async () => {
      const row = db.insert('workflow_exports', {
        store_id: 10, status: 'ready', s3_key: 'old.zip', size_bytes: 1n, file_count: 0, counts: {},
        expires_at: new Date(Date.now() - 1000),
      });
      s3.deleteFile = async () => {
        throw new Error('S3 down');
      };
      await expect(service.expireDue(new Date())).resolves.toBe(0);
      expect(row.status).toBe('ready');
    });

    it('marks a running export whose process died as failed', async () => {
      const stale = db.insert('workflow_exports', { store_id: 10, status: 'running', started_at: new Date(Date.now() - 3 * 3_600_000), file_count: 0, counts: {} });
      const live = db.insert('workflow_exports', { store_id: 20, status: 'running', started_at: new Date(), file_count: 0, counts: {} });

      await expect(service.failStale(new Date())).resolves.toBe(1);

      expect(stale).toMatchObject({ status: 'failed', error: EXPORT_INTERRUPTED_MESSAGE });
      expect(live.status).toBe('running');
    });
  });

  describe('cron', () => {
    const redisWith = (claimed: boolean) => ({
      set: jest.fn().mockResolvedValue(claimed ? 'OK' : null),
      expire: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(1),
    });

    it('processes one export under the Redis lock and releases it', async () => {
      const redis = redisWith(true);
      const cron = new WorkflowExportCron(service, redis as never);
      const next = jest.spyOn(service, 'processNext').mockResolvedValue(true);
      await cron.process();
      expect(next).toHaveBeenCalledTimes(1);
      expect(redis.eval).toHaveBeenCalledTimes(1);
    });

    it('does nothing when another instance holds the lock', async () => {
      const redis = redisWith(false);
      const cron = new WorkflowExportCron(service, redis as never);
      const next = jest.spyOn(service, 'processNext').mockResolvedValue(true);
      await cron.process();
      expect(next).not.toHaveBeenCalled();
    });
  });
});
