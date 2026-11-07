import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { VendixHttpException } from '@common/errors';
import {
  buildWorkflowKit,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import { CreateRetentionPolicyDto } from './document-retention.dto';
import { DocumentRetentionService, pickPolicy } from './document-retention.service';

const NOW = new Date('2026-11-07T15:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof VendixHttpException ? e.errorCode : `OTHER:${(e as Error).message}`;
  }
}

describe('DocumentRetentionService (P4.4)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let svc: DocumentRetentionService;
  let seq = 0;

  const policy = (over: Record<string, unknown> = {}, store = 1) =>
    kit.db.insert('document_retention_policies', {
      organization_id: 1,
      store_id: store,
      key: `p${++seq}`,
      name: 'Laboral',
      retain_days: 365,
      created_by_user_id: 1,
      ...over,
    });
  /** A closed dossier holding one file; returns both rows. */
  const closedFile = (
    over: { dossier?: Record<string, unknown>; file?: Record<string, unknown>; store?: number; docType?: string } = {},
  ) => {
    const store = over.store ?? 1;
    const n = ++seq;
    const dossier = kit.db.insert('dossiers', {
      organization_id: 1,
      store_id: store,
      reference: `EXP-${String(n).padStart(6, '0')}`,
      title: `Exp ${n}`,
      subject_type: 'employee',
      subject_id: 9,
      closed_at: daysAgo(800),
      ...over.dossier,
    });
    const file = kit.db.insert('stored_files', {
      organization_id: 1,
      store_id: store,
      s3_key: `k/${n}.pdf`,
      original_name: `doc-${n}.pdf`,
      mime_type: 'application/pdf',
      size_bytes: 1000,
      sha256: 'a'.repeat(64),
      uploaded_by_type: 'user',
      ...over.file,
    });
    kit.db.insert('dossier_items', {
      store_id: store,
      dossier_id: dossier.id,
      kind: 'uploaded_file',
      file_id: file.id,
      added_by_type: 'user',
    });
    if (over.docType) {
      kit.db.insert('document_file_profiles', { store_id: store, file_id: file.id, doc_type: over.docType });
    }
    return { dossier, file };
  };
  const fileRow = (id: number) => kit.db.table('stored_files').find((f) => f.id === id)!;

  beforeEach(() => {
    seq = 0;
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    svc = new DocumentRetentionService(kit.prisma, kit.s3 as any, kit.audit as any);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('política aplicable', () => {
    const rows = (list: Array<Partial<Parameters<typeof pickPolicy>[0][number]>>) =>
      list.map((p, i) => ({
        id: i + 1,
        key: `k${i}`,
        name: `P${i + 1}`,
        subject_type: null,
        doc_type: null,
        retain_days: 100,
        is_active: true,
        ...p,
      }));

    it('gana la más específica: sujeto+tipo > una de las dos > ninguna', () => {
      const list = rows([
        { retain_days: 1 },
        { subject_type: 'employee', retain_days: 2 },
        { subject_type: 'employee', doc_type: 'Contrato', retain_days: 3 },
      ]);
      expect(pickPolicy(list, 'employee', 'contrato')?.retain_days).toBe(3);
      expect(pickPolicy(list, 'employee', 'RUT')?.retain_days).toBe(2);
      expect(pickPolicy(list, 'supplier', null)?.retain_days).toBe(1);
    });

    it('ignora las inactivas y devuelve null si ninguna aplica', () => {
      expect(pickPolicy(rows([{ subject_type: 'employee', is_active: false }]), 'employee', null)).toBeNull();
      expect(pickPolicy(rows([{ subject_type: 'supplier' }]), 'employee', null)).toBeNull();
    });

    it('en empate de especificidad prefiere el tipo de archivo', () => {
      const list = rows([
        { subject_type: 'employee', retain_days: 900 },
        { doc_type: 'RUT', retain_days: 10 },
      ]);
      expect(pickPolicy(list, 'employee', 'rut')?.retain_days).toBe(10);
    });
  });

  describe('vista previa', () => {
    it('lista lo que se purgaría con su política y motivo, y no borra nada', async () => {
      policy({ name: 'Laboral', subject_type: 'employee', retain_days: 1095 });
      const { file } = closedFile({ dossier: { closed_at: daysAgo(1200) } });
      const out = await svc.preview(NOW);
      expect(out.totals).toEqual({ files: 1, bytes: 1000, skipped_legal_hold: 0 });
      expect(out.to_purge[0]).toMatchObject({
        file_id: file.id,
        policy_name: 'Laboral',
        reason: 'Política Laboral: 1095 días desde el cierre',
      });
      expect(out.to_purge[0]).not.toHaveProperty('s3_key');
      expect(kit.s3.deleteFile).not.toHaveBeenCalled();
      expect(fileRow(file.id).purged_at).toBeNull();
      expect(kit.db.table('document_purge_runs')).toHaveLength(0);
    });

    it('separa los archivos en retención legal', async () => {
      policy({ retain_days: 30 });
      closedFile({ file: { legal_hold: true } });
      const out = await svc.preview(NOW);
      expect(out.to_purge).toHaveLength(0);
      expect(out.skipped_legal_hold).toHaveLength(1);
      expect(out.totals.skipped_legal_hold).toBe(1);
    });
  });

  describe('qué es candidato', () => {
    it('solo expedientes cerrados y vencidos (cierre + días < hoy)', async () => {
      policy({ retain_days: 800 });
      const due = closedFile({ dossier: { closed_at: daysAgo(801) } });
      closedFile({ dossier: { closed_at: daysAgo(799) } });
      closedFile({ dossier: { closed_at: null } });
      const out = await svc.preview(NOW);
      expect(out.to_purge.map((x) => x.file_id)).toEqual([due.file.id]);
    });

    it('un expediente cuya solicitud terminó cuenta como cerrado desde completed_at', async () => {
      policy({ retain_days: 100 });
      const inst = kit.db.insert('workflow_instances', {
        organization_id: 1,
        store_id: 1,
        reference: 'FLU-000001',
        completed_at: daysAgo(200),
        status: 'completed',
      });
      const open = kit.db.insert('workflow_instances', {
        organization_id: 1,
        store_id: 1,
        reference: 'FLU-000002',
        completed_at: null,
      });
      const done = closedFile({ dossier: { closed_at: null, workflow_instance_id: inst.id } });
      closedFile({ dossier: { closed_at: null, workflow_instance_id: open.id } });
      expect((await svc.preview(NOW)).to_purge.map((x) => x.file_id)).toEqual([done.file.id]);
    });

    it('no toma archivos purgados, borrados ni con retention_until futuro', async () => {
      policy({ retain_days: 10 });
      closedFile({ file: { purged_at: daysAgo(1) } });
      closedFile({ file: { deleted_at: daysAgo(1) } });
      closedFile({ file: { retention_until: new Date(NOW.getTime() + 86_400_000) } });
      const ok = closedFile({ file: { retention_until: daysAgo(1) } });
      expect((await svc.preview(NOW)).to_purge.map((x) => x.file_id)).toEqual([ok.file.id]);
    });

    it('un archivo que también está en un expediente abierto no se purga', async () => {
      policy({ retain_days: 10 });
      const { file } = closedFile();
      const open = kit.db.insert('dossiers', {
        organization_id: 1, store_id: 1, reference: 'EXP-999999', title: 'abierto', closed_at: null,
      });
      kit.db.insert('dossier_items', {
        store_id: 1, dossier_id: open.id, kind: 'uploaded_file', file_id: file.id, added_by_type: 'user',
      });
      expect((await svc.preview(NOW)).to_purge).toHaveLength(0);
    });

    it('usa la política más específica por archivo (tipo del perfil)', async () => {
      policy({ name: 'General', retain_days: 10 });
      policy({ name: 'Contratos', doc_type: 'Contrato', retain_days: 5000 });
      closedFile({ docType: 'Contrato' });
      const plain = closedFile();
      const out = await svc.preview(NOW);
      expect(out.to_purge.map((x) => [x.file_id, x.policy_name])).toEqual([[plain.file.id, 'General']]);
    });

    it('aísla por tienda', async () => {
      policy({ retain_days: 10 });
      closedFile({ store: 2 });
      expect((await svc.preview(NOW)).to_purge).toHaveLength(0);
    });
  });

  describe('ejecución', () => {
    it('borra el objeto, pone purged_at sin borrar la fila y escribe el informe', async () => {
      policy({ name: 'Laboral', retain_days: 365 });
      const { file } = closedFile({ file: { size_bytes: 2048 } });
      kit.as({ user_id: 5 });

      const report = await svc.run('manual', NOW);

      expect(kit.s3.deleteFile).toHaveBeenCalledWith(file.s3_key);
      expect(fileRow(file.id)).toMatchObject({
        purged_at: NOW,
        sha256: 'a'.repeat(64),
        original_name: file.original_name,
        legal_hold: false,
        deleted_at: null,
      });
      expect(report).toMatchObject({
        trigger: 'manual',
        status: 'completed',
        files_purged: 1,
        bytes_purged: 2048,
        skipped_legal_hold: 0,
        started_by_user_id: 5,
      });
      expect(report.finished_at).toBeInstanceOf(Date);
      expect(report.items).toHaveLength(1);
      expect(report.items[0]).toMatchObject({
        file_id: file.id,
        outcome: 'purged',
        sha256: 'a'.repeat(64),
        reason: 'Política Laboral: 365 días desde el cierre',
      });
      expect(kit.audit.log).toHaveBeenCalled();
    });

    it('respeta legal_hold: lo cuenta, lo deja intacto y no borra su objeto', async () => {
      policy({ retain_days: 30 });
      const held = closedFile({ file: { legal_hold: true } });
      const free = closedFile();
      const report = await svc.run('manual', NOW);
      expect(report).toMatchObject({ files_purged: 1, skipped_legal_hold: 1 });
      expect(report.items.map((i) => [i.file_id, i.outcome]).sort()).toEqual(
        [[free.file.id, 'purged'], [held.file.id, 'skipped_legal_hold']].sort(),
      );
      expect(kit.s3.deleteFile).toHaveBeenCalledTimes(1);
      expect(kit.s3.deleteFile).not.toHaveBeenCalledWith(held.file.s3_key);
      expect(fileRow(held.file.id).purged_at).toBeNull();
      // Still downloadable.
      expect((await kit.storedFiles.signedDownloadUrl(held.file.id)).url).toContain(held.file.s3_key);
    });

    it('un archivo purgado responde "Documento purgado por política de retención" al descargar', async () => {
      policy({ retain_days: 30 });
      const { file } = closedFile();
      await svc.run('manual', NOW);
      expect(await codeOf(kit.storedFiles.signedDownloadUrl(file.id))).toBe('DOCUMENT_PURGED');
      expect(await codeOf(kit.storedFiles.findOne(file.id))).toBe('DOCUMENT_PURGED');
    });

    it('la segunda corrida no repite lo purgado', async () => {
      policy({ retain_days: 30 });
      closedFile();
      await svc.run('manual', NOW);
      kit.s3.deleteFile.mockClear();
      const second = await svc.run('manual', new Date(NOW.getTime() + 60_000));
      expect(second.files_purged).toBe(0);
      expect(second.items).toHaveLength(0);
      expect(kit.s3.deleteFile).not.toHaveBeenCalled();
    });

    it('si el objeto no se puede borrar, libera el archivo y marca la corrida parcial', async () => {
      policy({ retain_days: 30 });
      const bad = closedFile();
      const good = closedFile();
      kit.s3.deleteFile.mockImplementationOnce(async () => {
        throw new Error('S3 caído');
      });
      const report = await svc.run('manual', NOW);
      expect(report.status).toBe('partial');
      expect(report.error).toContain('S3 caído');
      expect(fileRow(bad.file.id).purged_at).toBeNull();
      expect(fileRow(good.file.id).purged_at).not.toBeNull();
      expect(report.files_purged).toBe(1);
      // The report lists only what was really deleted.
      expect(report.items.map((i) => [i.file_id, i.outcome])).toEqual([[good.file.id, 'purged']]);
    });

    it('cada archivo reclamado queda en el informe aunque el proceso muera antes de terminar (r1 M6)', async () => {
      policy({ retain_days: 30 });
      const first = closedFile();
      const second = closedFile();
      // The process dies right after deleting the first object.
      kit.s3.deleteFile.mockImplementationOnce(async () => undefined);
      kit.s3.deleteFile.mockImplementationOnce(() => new Promise(() => undefined));
      void svc.run('manual', NOW);
      await new Promise((r) => setTimeout(r, 50));
      const run = kit.db.table('document_purge_runs')[0];
      expect(run.status).toBe('running');
      const items = () => kit.db.table('document_purge_items').map((i) => [i.file_id, i.outcome]);
      expect(items()).toEqual([
        [first.file.id, 'purged'],
        [second.file.id, 'claimed'],
      ]);

      // An hour later the next run finishes the dead one first: the claimed
      // object is deleted again and the old run closes with a full report.
      kit.s3.deleteFile.mockClear();
      const later = new Date(NOW.getTime() + 2 * 3_600_000);
      await svc.run('manual', later);
      expect(kit.s3.deleteFile).toHaveBeenCalledWith(second.file.s3_key);
      const old = await svc.getRun(run.id);
      expect(old).toMatchObject({ status: 'completed', files_purged: 2, bytes_purged: 2000 });
      expect(old.items.map((i) => [i.file_id, i.outcome])).toEqual([
        [first.file.id, 'purged'],
        [second.file.id, 'purged'],
      ]);
      expect(fileRow(second.file.id).purged_at).not.toBeNull();
    });

    it('rechaza una segunda corrida mientras otra sigue en curso', async () => {
      policy({ retain_days: 30 });
      kit.db.insert('document_purge_runs', { organization_id: 1, store_id: 1, trigger: 'manual', started_at: NOW });
      expect(await codeOf(svc.run('manual', NOW))).toBe('DOCRET_RUN_IN_PROGRESS');
    });

    it('no toca otra tienda y el informe solo lista las corridas propias', async () => {
      policy({ retain_days: 30 });
      policy({ retain_days: 30 }, 2);
      const mine = closedFile();
      const theirs = closedFile({ store: 2 });
      const report = await svc.run('manual', NOW);
      expect(fileRow(mine.file.id).purged_at).not.toBeNull();
      expect(fileRow(theirs.file.id).purged_at).toBeNull();

      kit.as({ store_id: 2 });
      expect((await svc.listRuns()).total).toBe(0);
      expect(await codeOf(svc.getRun(report.id))).toBe('DOCRET_RUN_NOT_FOUND');
    });
  });

  describe('informes', () => {
    it('lista las corridas, la más reciente primero, y abre una con sus ítems', async () => {
      policy({ retain_days: 30 });
      closedFile();
      const first = await svc.run('manual', NOW);
      const second = await svc.run('schedule', new Date(NOW.getTime() + 2 * 3_600_000));
      const list = await svc.listRuns();
      expect(list.data.map((r) => r.id)).toEqual([second.id, first.id]);
      expect(list.data[1]).toMatchObject({ trigger: 'manual', files_purged: 1 });
      expect((await svc.getRun(first.id)).items).toHaveLength(1);
    });
  });

  describe('políticas', () => {
    it('crea con clave derivada del nombre, la clave es única por tienda y se edita y borra', async () => {
      const p = await svc.createPolicy({ name: 'Laboral Ñandú', subject_type: 'employee', retain_days: 1095 });
      expect(p).toMatchObject({ key: 'laboral-nandu', subject_type: 'employee', doc_type: null, retain_days: 1095, is_active: true });
      expect(await codeOf(svc.createPolicy({ name: 'otra', key: 'laboral-nandu', retain_days: 5 }))).toBe(
        'DOCRET_POLICY_KEY_TAKEN',
      );
      kit.as({ store_id: 2 });
      await svc.createPolicy({ name: 'x', key: 'laboral-nandu', retain_days: 5 });
      expect(
        kit.db.table('document_retention_policies').filter((r) => r.key === 'laboral-nandu').map((r) => r.store_id),
      ).toEqual([1, 2]);
      expect(await codeOf(svc.updatePolicy(p.id, { retain_days: 9 }))).toBe('DOCRET_POLICY_NOT_FOUND');
      expect(await codeOf(svc.removePolicy(p.id))).toBe('DOCRET_POLICY_NOT_FOUND');

      kit.as({ store_id: 1 });
      expect((await svc.updatePolicy(p.id, { retain_days: 9, is_active: false })).retain_days).toBe(9);
      await svc.removePolicy(p.id);
      expect(await svc.listPolicies()).toHaveLength(0);
    });

    it('retain_days debe ser un entero mayor que 0', async () => {
      const bad = async (v: unknown) =>
        (await validate(plainToInstance(CreateRetentionPolicyDto, { name: 'x', retain_days: v }))).length;
      expect(await bad(0)).toBeGreaterThan(0);
      expect(await bad(-3)).toBeGreaterThan(0);
      expect(await bad(1.5)).toBeGreaterThan(0);
      expect(await bad(30)).toBe(0);
    });
  });
});
