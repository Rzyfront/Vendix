import { VendixHttpException } from '@common/errors';
import { buildWorkflowKit, seedPeople } from '../../../../testing/workflows/workflow-test-kit';
import { DocumentFileProfilesService, normalizeTags } from './document-file-profiles.service';

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof VendixHttpException ? e.errorCode : `OTHER:${(e as Error).message}`;
  }
}

describe('DocumentFileProfilesService (P4.6/P4.4)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let svc: DocumentFileProfilesService;
  let fileId: number;

  const mkFile = (store = 1, over: Record<string, unknown> = {}) =>
    kit.db.insert('stored_files', {
      organization_id: 1, store_id: store, s3_key: `k/${Math.random()}`, original_name: 'a.pdf',
      mime_type: 'application/pdf', size_bytes: 1, sha256: 'd'.repeat(64), uploaded_by_type: 'user', ...over,
    });

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    kit.as({ user_id: 1 });
    svc = new DocumentFileProfilesService(kit.prisma, kit.audit as any);
    fileId = mkFile().id;
  });
  afterEach(() => jest.restoreAllMocks());

  it('normaliza etiquetas: minúsculas, sin duplicados ni vacías, máximo 20', () => {
    expect(normalizeTags([' RUT ', 'rut', 'Cámara  de Comercio', ''])).toEqual(['rut', 'cámara de comercio']);
    expect(normalizeTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(20);
    expect(() => normalizeTags(Array.from({ length: 21 }, (_, i) => `t${i}`))).toThrow(VendixHttpException);
  });

  it('crea el perfil (upsert por archivo) y solo cambia las claves enviadas', async () => {
    const first = await svc.update(fileId, { doc_type: ' Póliza ', tags: ['Seguro', 'seguro'], valid_until: '2027-01-15' });
    expect(first).toEqual({ file_id: fileId, doc_type: 'Póliza', tags: ['seguro'], valid_until: '2027-01-15', legal_hold: false });

    const second = await svc.update(fileId, { tags: ['rut'] });
    expect(second).toMatchObject({ doc_type: 'Póliza', tags: ['rut'], valid_until: '2027-01-15' });
    expect(kit.db.table('document_file_profiles')).toHaveLength(1);

    expect((await svc.update(fileId, { doc_type: null, valid_until: null })).valid_until).toBeNull();
    expect(kit.audit.log).toHaveBeenCalled();
  });

  it('cambiar valid_until limpia expiry_alerted_for; repetir la misma fecha no', async () => {
    await svc.update(fileId, { valid_until: '2027-01-15' });
    const row = kit.db.table('document_file_profiles')[0];
    row.expiry_alerted_for = new Date('2027-01-15T00:00:00Z');
    row.expiry_alerted_at = new Date();

    await svc.update(fileId, { valid_until: '2027-01-15' });
    expect(row.expiry_alerted_for).not.toBeNull();
    await svc.update(fileId, { valid_until: '2027-02-01' });
    expect(row.expiry_alerted_for).toBeNull();
    expect(row.expiry_alerted_at).toBeNull();
  });

  it('rechaza fechas imposibles y etiquetas de más', async () => {
    expect(await codeOf(svc.update(fileId, { valid_until: '2027-02-31' }))).toBe('DOCPROFILE_INVALID');
    expect(await codeOf(svc.update(fileId, { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }))).toBe('DOCPROFILE_INVALID');
  });

  it('marca y quita la retención legal con auditoría', async () => {
    expect((await svc.setLegalHold(fileId, true)).legal_hold).toBe(true);
    expect(kit.audit.log).toHaveBeenLastCalledWith(
      expect.objectContaining({ resourceId: fileId, metadata: { event: 'legal_hold_set' } }),
    );
    expect((await svc.setLegalHold(fileId, false)).legal_hold).toBe(false);
    expect(kit.audit.log).toHaveBeenLastCalledWith(expect.objectContaining({ metadata: { event: 'legal_hold_cleared' } }));
  });

  it('un archivo de otra tienda es 404 y uno purgado responde DOCUMENT_PURGED', async () => {
    const theirs = mkFile(2).id;
    expect(await codeOf(svc.update(theirs, { doc_type: 'x' }))).toBe('DOCUMENT_NOT_FOUND');
    expect(await codeOf(svc.setLegalHold(theirs, true))).toBe('DOCUMENT_NOT_FOUND');
    expect(await codeOf(svc.get(theirs))).toBe('DOCUMENT_NOT_FOUND');
    const purged = mkFile(1, { purged_at: new Date() }).id;
    expect(await codeOf(svc.update(purged, { doc_type: 'x' }))).toBe('DOCUMENT_PURGED');
    expect(kit.db.table('stored_files').find((f) => f.id === theirs)!.legal_hold).toBe(false);
  });
});
