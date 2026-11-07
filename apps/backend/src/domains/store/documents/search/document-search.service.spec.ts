import { VendixHttpException } from '@common/errors';
import { buildWorkflowKit, seedPeople } from '../../../../testing/workflows/workflow-test-kit';
import { DocumentSearchService } from './document-search.service';

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof VendixHttpException ? e.errorCode : `OTHER:${(e as Error).message}`;
  }
}

describe('DocumentSearchService (P4.7)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let svc: DocumentSearchService;
  let seq = 0;

  const dossier = (
    subject: { type: string; id: number } | null,
    over: Record<string, unknown> = {},
    store = 1,
  ) => {
    seq++;
    return kit.db.insert('dossiers', {
      organization_id: 1, store_id: store, reference: `EXP-${String(seq).padStart(6, '0')}`,
      title: `Expediente ${seq}`, subject_type: subject?.type ?? null, subject_id: subject?.id ?? null, ...over,
    }) as unknown as { id: number; reference: string };
  };
  /** A file inside a dossier, optionally with a profile. */
  const doc = (
    d: { id: number },
    name: string,
    profile: Record<string, unknown> | null = null,
    over: Record<string, unknown> = {},
    store = 1,
  ) => {
    seq++;
    const f = kit.db.insert('stored_files', {
      organization_id: 1, store_id: store, s3_key: `k/${seq}`, original_name: name,
      mime_type: 'application/pdf', size_bytes: 5, sha256: 'e'.repeat(64), uploaded_by_type: 'user', ...over,
    });
    kit.db.insert('dossier_items', { store_id: store, dossier_id: d.id, kind: 'uploaded_file', file_id: f.id, added_by_type: 'user' });
    if (profile) kit.db.insert('document_file_profiles', { store_id: store, file_id: f.id, ...profile });
    return f;
  };
  const names = (r: { data: Array<{ original_name: string }> }) => r.data.map((x) => x.original_name).sort();

  beforeEach(() => {
    seq = 0;
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    svc = new DocumentSearchService(kit.prisma);
    kit.db.insert('suppliers', { id: 1, organization_id: 1, store_id: null, name: 'Aceros SA' });
    kit.db.insert('suppliers', { id: 2, organization_id: 1, store_id: null, name: 'Bolsas Ltda' });
  });
  afterEach(() => jest.restoreAllMocks());

  describe('búsqueda', () => {
    beforeEach(() => {
      const a = dossier({ type: 'supplier', id: 1 });
      const b = dossier({ type: 'supplier', id: 2 });
      doc(a, 'RUT-aceros.pdf');
      doc(a, 'documento1.pdf', { doc_type: 'RUT', tags: [] });
      doc(b, 'scan-0042.pdf', { doc_type: 'Factura', tags: ['rut'] });
      doc(b, 'scan-0043.pdf', { doc_type: 'Factura', tags: [], extracted_text: 'Registro Único Tributario (RUT) 900.123' });
      doc(b, 'cámara.pdf', { doc_type: 'Cámara de comercio', tags: ['legal'] });
    });

    it('buscar "RUT" trae los de todos los proveedores: por nombre, tipo, etiqueta y texto leído', async () => {
      const out = await svc.search({ q: 'RUT' });
      expect(names(out)).toEqual(['RUT-aceros.pdf', 'documento1.pdf', 'scan-0042.pdf', 'scan-0043.pdf']);
      expect(out.total).toBe(4);
    });

    it('cada resultado trae su expediente, su sujeto y su solicitud', async () => {
      const inst = kit.db.insert('workflow_instances', {
        organization_id: 1, store_id: 1, reference: 'FLU-000001', title: 'Alta de proveedor',
      });
      const d = dossier({ type: 'supplier', id: 2 }, { workflow_instance_id: inst.id, title: 'Alta Bolsas' });
      doc(d, 'contrato.pdf');
      const hit = (await svc.search({ q: 'contrato' })).data[0];
      expect(hit).toMatchObject({
        original_name: 'contrato.pdf',
        dossier: { id: d.id, reference: d.reference, title: 'Alta Bolsas' },
        subject: { type: 'supplier', id: 2, label: 'Bolsas Ltda' },
        request: { id: inst.id, reference: 'FLU-000001', title: 'Alta de proveedor' },
      });
    });

    it('filtra por tipo, etiqueta y sujeto', async () => {
      expect(names(await svc.search({ doc_type: 'factura' }))).toEqual(['scan-0042.pdf', 'scan-0043.pdf']);
      expect(names(await svc.search({ tag: ' LEGAL ' }))).toEqual(['cámara.pdf']);
      expect(names(await svc.search({ subject_type: 'supplier', subject_id: 1 }))).toEqual([
        'RUT-aceros.pdf',
        'documento1.pdf',
      ]);
      expect(names(await svc.search({ q: 'rut', subject_type: 'supplier', subject_id: 2 }))).toEqual([
        'scan-0042.pdf',
        'scan-0043.pdf',
      ]);
    });

    it('no trae borrados, purgados, archivos fuera de un expediente ni de otra tienda', async () => {
      const d = dossier({ type: 'supplier', id: 1 });
      doc(d, 'rut-borrado.pdf', null, { deleted_at: new Date() });
      doc(d, 'rut-purgado.pdf', null, { purged_at: new Date() });
      kit.db.insert('stored_files', {
        organization_id: 1, store_id: 1, s3_key: 'k/huerfano', original_name: 'rut-suelto.pdf',
        mime_type: 'application/pdf', size_bytes: 1, sha256: 'f'.repeat(64), uploaded_by_type: 'user',
      });
      const other = dossier({ type: 'supplier', id: 1 }, {}, 2);
      doc(other, 'rut-ajeno.pdf', null, {}, 2);
      const out = await svc.search({ q: 'rut' });
      expect(out.data.map((x) => x.original_name)).not.toEqual(
        expect.arrayContaining(['rut-borrado.pdf']),
      );
      expect(names(out)).toEqual(['RUT-aceros.pdf', 'documento1.pdf', 'scan-0042.pdf', 'scan-0043.pdf']);
    });

    it('pagina', async () => {
      const first = await svc.search({ limit: 2, page: 1 });
      const third = await svc.search({ limit: 2, page: 3 });
      expect(first.data).toHaveLength(2);
      expect(first.total).toBe(5);
      expect(third.data).toHaveLength(1);
    });

    it('sin coincidencias devuelve una lista vacía', async () => {
      expect(await svc.search({ q: 'zzz-no-existe' })).toMatchObject({ data: [], total: 0 });
    });
  });

  describe('carpetas', () => {
    beforeEach(() => {
      kit.db.insert('workflow_collections', { id: 1, organization_id: 1, store_id: 1, key: 'contratos', name: 'Contratos' });
      kit.db.insert('workflow_records', { id: 7, organization_id: 1, store_id: 1, collection_id: 1, title: 'Contrato Acme' });
      const s1a = dossier({ type: 'supplier', id: 1 });
      const s1b = dossier({ type: 'supplier', id: 1 });
      const s2 = dossier({ type: 'supplier', id: 2 });
      const rec = dossier({ type: 'custom_record', id: 7 });
      dossier(null);
      doc(s1a, 'a.pdf');
      doc(s1a, 'b.pdf');
      doc(s1b, 'c.pdf');
      doc(s2, 'd.pdf');
      doc(s2, 'gone.pdf', null, { purged_at: new Date() });
      doc(rec, 'contrato.pdf');
      // Another store's supplier folder never shows up.
      doc(dossier({ type: 'supplier', id: 1 }, {}, 2), 'ajeno.pdf', null, {}, 2);
    });

    it('agrupa los expedientes por tipo de sujeto con conteos de entidades y archivos vivos', async () => {
      const groups = await svc.folders();
      expect(groups.find((g) => g.subject_type === 'supplier')).toMatchObject({
        entities: 2, dossiers: 3, files: 4,
      });
      expect(groups).toHaveLength(2);
    });

    it('un registro personalizado aparece con el nombre de su colección', async () => {
      const g = (await svc.folders()).find((x) => x.subject_type === 'custom_record')!;
      expect(g).toMatchObject({ collection_key: 'contratos', collection_name: 'Contratos', entities: 1, files: 1 });
      const entities = await svc.folderEntities('custom_record', { collection: 'contratos' });
      expect(entities.data[0]).toMatchObject({ id: 7, label: 'Contrato Acme', collection_name: 'Contratos' });
      expect((await svc.folderEntities('custom_record', { collection: 'otra' })).total).toBe(0);
    });

    it('lista las entidades de un tipo con su nombre y conteos', async () => {
      const out = await svc.folderEntities('supplier');
      expect(out.total).toBe(2);
      const byId = Object.fromEntries(out.data.map((e) => [e.id, e]));
      expect(byId[1]).toMatchObject({ label: 'Aceros SA', dossiers: 2, files: 3 });
      expect(byId[2]).toMatchObject({ label: 'Bolsas Ltda', dossiers: 1, files: 1 });
    });

    it('dentro de la carpeta de una entidad están los archivos de todos sus expedientes', async () => {
      const out = await svc.folderFiles('supplier', 1);
      expect(out.subject).toMatchObject({ type: 'supplier', id: 1, label: 'Aceros SA' });
      expect(out.dossiers).toHaveLength(2);
      expect(names(out)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    });

    it('una entidad sin expedientes en la tienda es 404 (nada de otra tienda)', async () => {
      kit.as({ store_id: 2 });
      expect((await svc.folders()).find((g) => g.subject_type === 'supplier')).toMatchObject({ files: 1 });
      expect(await codeOf(svc.folderFiles('supplier', 2))).toBe('DOCUMENT_NOT_FOUND');
      kit.as({ store_id: 1 });
      expect(await codeOf(svc.folderFiles('employee', 1))).toBe('DOCUMENT_NOT_FOUND');
    });
  });
});
