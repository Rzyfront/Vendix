import { VendixHttpException } from '@common/errors';
import {
  buildWorkflowKit,
  seedPeople,
} from '../../../testing/workflows/workflow-test-kit';

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof VendixHttpException ? e.errorCode : `OTHER:${(e as Error).message}`;
  }
}

describe.each([
  ['tx con scope', false],
  ['tx sin scope (solo predicados explícitos)', true],
])('DossiersService · %s', (_label, unscopedTx) => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  const actor = { type: 'user' as const, id: 1 };
  const instanceRef = (id: number, storeId = 1) => ({
    id,
    organization_id: 1,
    store_id: storeId,
    title: `Solicitud ${id}`,
    subject_type: null,
    subject_id: null,
  });
  const file = (storeId = 1, n = Math.random()) =>
    kit.db.insert('stored_files', {
      store_id: storeId,
      organization_id: 1,
      s3_key: `k/${n}`,
      original_name: `f${n}.pdf`,
      mime_type: 'application/pdf',
      size_bytes: 10,
      sha256: 'a'.repeat(64),
    });
  const create = (id: number, storeId = 1) => {
    kit.as({ store_id: storeId });
    return kit.prisma.$transaction((tx: any) => kit.dossiers.createForInstance(tx, instanceRef(id, storeId)));
  };

  beforeEach(() => {
    kit = buildWorkflowKit({ unscopedTx });
    seedPeople(kit.db);
  });
  afterEach(() => jest.restoreAllMocks());

  it('B5: addFileItem rechaza un expediente o un archivo de otra tienda sin escribir nada', async () => {
    const theirs = await create(2, 2);
    const mine = await create(1);
    const fileOther = file(2);
    const fileMine = file(1);
    const base = { stage_key: 'intake', actor, field_key: 'invoice' };
    const before = kit.db.table('dossier_items').length;
    expect(
      await codeOf(
        kit.dossiers.addFileItem(undefined, { ...base, dossier_id: mine.id, file_id: fileOther.id }),
      ),
    ).toBe('DOCUMENT_NOT_FOUND');
    expect(
      await codeOf(
        kit.dossiers.addFileItem(undefined, { ...base, dossier_id: theirs.id, file_id: fileMine.id }),
      ),
    ).toBe('DOCUMENT_NOT_FOUND');
    expect(kit.db.table('dossier_items')).toHaveLength(before);
  });

  it('P4: addDocumentItem archiva el documento emitido y reemplaza el anterior del mismo requisito', async () => {
    const d = await create(1);
    const f1 = file(1);
    const f2 = file(1);
    const add = (fileId: number, docId: number) =>
      kit.prisma.$transaction((tx: any) =>
        kit.dossiers.addDocumentItem(tx, {
          dossier_id: d.id,
          kind: 'issued_document',
          issued_document_id: docId,
          file_id: fileId,
          stage_key: 'contrato',
          requirement_key: 'contrato',
          actor,
        }),
      );
    const first = await add(f1.id, 11);
    const second = await add(f2.id, 12);
    const rows = kit.db.table('dossier_items').filter((i: any) => i.dossier_id === d.id);
    expect(rows.find((i: any) => i.id === first.id)?.status).toBe('superseded');
    expect(second).toMatchObject({
      kind: 'issued_document',
      issued_document_id: 12,
      status: 'received',
      supersedes_id: first.id,
    });
  });

  it('P4: addDocumentItem rechaza un expediente de otra tienda', async () => {
    const theirs = await create(2, 2);
    kit.as({ store_id: 1 });
    const f = file(1);
    expect(
      await codeOf(
        kit.prisma.$transaction((tx: any) =>
          kit.dossiers.addDocumentItem(tx, {
            dossier_id: theirs.id,
            kind: 'issued_document',
            issued_document_id: 1,
            file_id: f.id,
            actor,
          }),
        ),
      ),
    ).toBe('DOCUMENT_NOT_FOUND');
  });

  it('createForInstance: EXP- correlativo por tienda, atado a la instancia', async () => {
    const a = await create(1);
    const b = await create(2);
    const other = await create(3, 2);
    expect([a.reference, b.reference, other.reference]).toEqual([
      'EXP-000001',
      'EXP-000002',
      'EXP-000001',
    ]);
    expect(a).toMatchObject({ workflow_instance_id: 1, title: 'Solicitud 1', store_id: 1 });
  });

  it('una instancia no puede tener dos expedientes', async () => {
    await create(1);
    await expect(create(1)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('cadena de reemplazo por requirement_key: el nuevo deja el anterior en superseded y lo enlaza', async () => {
    const d = await create(1);
    kit.as({ store_id: 1 });
    const f1 = file();
    const f2 = file();
    const f3 = file();
    const base = { dossier_id: d.id, stage_key: 'intake', requirement_key: 'rut', actor };
    const i1 = await kit.dossiers.addFileItem(undefined, { ...base, file_id: f1.id });
    const i2 = await kit.dossiers.addFileItem(undefined, { ...base, file_id: f2.id });
    const i3 = await kit.dossiers.addFileItem(undefined, { ...base, file_id: f3.id });
    const other = await kit.dossiers.addFileItem(undefined, {
      ...base,
      requirement_key: 'cedula',
      file_id: file().id,
    });
    expect(i1).toMatchObject({ status: 'received', supersedes_id: null });
    expect(i2.supersedes_id).toBe(i1.id);
    expect(i3.supersedes_id).toBe(i2.id);
    const rows = kit.db.table('dossier_items');
    expect(rows.find((r) => r.id === i1.id)!.status).toBe('superseded');
    expect(rows.find((r) => r.id === i2.id)!.status).toBe('superseded');
    expect(rows.find((r) => r.id === i3.id)!.status).toBe('received');
    expect(other.supersedes_id).toBeNull();
    expect(rows.find((r) => r.id === other.id)!.status).toBe('received');
  });

  it('cadena por field_key, independiente de la de requisitos', async () => {
    const d = await create(1);
    kit.as({ store_id: 1 });
    const base = { dossier_id: d.id, stage_key: 'intake', actor };
    const r = await kit.dossiers.addFileItem(undefined, { ...base, requirement_key: 'rut', file_id: file().id });
    const a = await kit.dossiers.addFileItem(undefined, { ...base, field_key: 'invoice', file_id: file().id });
    const b = await kit.dossiers.addFileItem(undefined, { ...base, field_key: 'invoice', file_id: file().id });
    expect(b.supersedes_id).toBe(a.id);
    expect(kit.db.table('dossier_items').find((x) => x.id === r.id)!.status).toBe('received');
  });

  it('un expediente rechazado no se reemplaza ni cuenta como activo', async () => {
    const d = await create(1);
    kit.as({ store_id: 1 });
    const base = { dossier_id: d.id, stage_key: 'intake', requirement_key: 'rut', actor };
    const a = await kit.dossiers.addFileItem(undefined, { ...base, file_id: file().id });
    kit.db.table('dossier_items').find((x) => x.id === a.id)!.status = 'rejected';
    expect(await kit.dossiers.hasActiveItem(d.id, 'rut')).toBe(false);
    const b = await kit.dossiers.addFileItem(undefined, { ...base, file_id: file().id });
    expect(b.supersedes_id).toBeNull();
    expect(await kit.dossiers.hasActiveItem(d.id, 'rut')).toBe(true);
  });

  it('get: activos primero y la cadena reemplazada al final; trae metadatos del archivo', async () => {
    const d = await create(1);
    kit.as({ store_id: 1 });
    const base = { dossier_id: d.id, stage_key: 'intake', actor };
    const f1 = file();
    const a = await kit.dossiers.addFileItem(undefined, { ...base, requirement_key: 'rut', file_id: f1.id });
    const b = await kit.dossiers.addFileItem(undefined, { ...base, requirement_key: 'rut', file_id: file().id });
    const c = await kit.dossiers.addFileItem(undefined, { ...base, requirement_key: 'cedula', file_id: file().id });
    const got = await kit.dossiers.get(d.id);
    expect(got.items.map((i: any) => i.id)).toEqual([b.id, c.id, a.id]);
    expect(got.items.map((i: any) => i.status)).toEqual(['received', 'received', 'superseded']);
    expect(got.items[2].file).toEqual({
      id: f1.id,
      original_name: f1.original_name,
      mime_type: 'application/pdf',
      size_bytes: 10,
      sha256: 'a'.repeat(64),
    });
  });

  it('aislamiento: el expediente, sus items y archivos de otra tienda no se ven', async () => {
    const mine = await create(1);
    const foreign = await create(2, 2);
    kit.as({ store_id: 2 });
    await kit.dossiers.addFileItem(undefined, {
      dossier_id: foreign.id,
      stage_key: 's',
      requirement_key: 'rut',
      file_id: file(2).id,
      actor,
    });
    kit.as({ store_id: 1 });
    expect(await codeOf(kit.dossiers.get(foreign.id))).toBe('DOCUMENT_NOT_FOUND');
    expect(await kit.dossiers.getByInstance(2)).toBeNull();
    expect((await kit.dossiers.list()).data.map((d: any) => d.id)).toEqual([mine.id]);
    expect(await kit.dossiers.hasActiveItem(foreign.id, 'rut')).toBe(false);
    expect(await kit.dossiers.instanceIdsOfFile(kit.db.table('dossier_items')[0].file_id)).toEqual([]);
  });

  it('missingFileIds: ajeno a la tienda, de otro expediente o inexistente cuenta como faltante', async () => {
    const d = await create(1);
    const d2 = await create(2);
    kit.as({ store_id: 1 });
    const ok = file();
    const inOther = file();
    const foreign = file(2);
    const base = { stage_key: 's', requirement_key: 'rut', actor };
    await kit.dossiers.addFileItem(undefined, { ...base, dossier_id: d.id, file_id: ok.id });
    await kit.dossiers.addFileItem(undefined, { ...base, dossier_id: d2.id, file_id: inOther.id });
    expect(
      await kit.dossiers.missingFileIds(d.id, [ok.id, inOther.id, foreign.id, 9999]),
    ).toEqual([inOther.id, foreign.id, 9999]);
    expect(await kit.dossiers.missingFileIds(d.id, [])).toEqual([]);
  });

  it('list: pagina y busca por referencia o título', async () => {
    for (let i = 1; i <= 3; i++) await create(i);
    kit.as({ store_id: 1 });
    const page = await kit.dossiers.list({ page: 1, limit: 2 });
    expect(page.total).toBe(3);
    expect(page.data.map((d: any) => d.reference)).toEqual(['EXP-000003', 'EXP-000002']);
    expect((await kit.dossiers.list({ search: 'exp-000001' })).data).toHaveLength(1);
    expect((await kit.dossiers.list({ search: 'Solicitud 2' })).data).toHaveLength(1);
  });

  it('list: items_count cuenta solo los ítems activos (no los reemplazados)', async () => {
    const d = await create(1);
    const empty = await create(2);
    kit.as({ store_id: 1 });
    const base = { dossier_id: d.id, stage_key: 'intake', requirement_key: 'rut', actor };
    await kit.dossiers.addFileItem(undefined, { ...base, file_id: file().id });
    await kit.dossiers.addFileItem(undefined, { ...base, file_id: file().id });
    await kit.dossiers.addFileItem(undefined, {
      ...base,
      requirement_key: 'cedula',
      file_id: file().id,
    });
    const rows = (await kit.dossiers.list()).data as Array<{ id: number; items_count: number }>;
    expect(rows.find((r) => r.id === d.id)?.items_count).toBe(2);
    expect(rows.find((r) => r.id === empty.id)?.items_count).toBe(0);
  });
});
