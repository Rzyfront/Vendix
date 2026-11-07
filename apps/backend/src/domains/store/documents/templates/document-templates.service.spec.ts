import { RequestContextService } from '@common/context/request-context.service';
import { DocumentTemplatesService } from './document-templates.service';
import { TemplateDataService } from './template-data.service';

type Row = Record<string, any>;

/** In-memory stand-in for the template tables, scoped by `store_id` like the real service. */
function fakePrisma() {
  const templates: Row[] = [];
  const versions: Row[] = [];
  let tid = 0;
  let vid = 0;
  const match = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);
  const withVersion = (t: Row) => ({ ...t, published_version: versions.find((v) => v.id === t.published_version_id) ?? null });
  const prisma: Row = {
    document_templates: {
      findFirst: jest.fn(async ({ where }: Row) => {
        const t = templates.find((r) => match(r, where));
        return t ? withVersion(t) : null;
      }),
      findMany: jest.fn(async ({ where }: Row) => templates.filter((r) => r.store_id === where.store_id).map(withVersion)),
      create: jest.fn(async ({ data }: Row) => {
        if (templates.some((t) => t.store_id === data.store_id && t.key === data.key)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = { id: ++tid, status: 'draft', published_version_id: null, base_file_id: null, created_at: new Date(), updated_at: new Date(), ...data };
        templates.push(row);
        return withVersion(row);
      }),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const found = templates.filter((r) => match(r, where));
        found.forEach((r) => Object.assign(r, data, { updated_at: new Date() }));
        return { count: found.length };
      }),
    },
    document_template_versions: {
      findFirst: jest.fn(async ({ where, orderBy }: Row) => {
        const rows = versions.filter((r) => match(r, where));
        return (orderBy ? rows.sort((a, b) => b.version - a.version) : rows)[0] ?? null;
      }),
      findMany: jest.fn(async ({ where }: Row) => versions.filter((r) => match(r, where)).sort((a, b) => b.version - a.version)),
      create: jest.fn(async ({ data }: Row) => {
        const row = { id: ++vid, published_at: new Date(), ...data };
        versions.push(row);
        return row;
      }),
    },
    stored_files: { findFirst: jest.fn() },
    stores: { findFirst: jest.fn().mockResolvedValue({ name: 'Tienda Demo', legal_name: null, tax_id: null, tax_id_dv: null, logo_url: null, timezone: 'America/Bogota' }) },
    store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
    withoutScope: () => ({
      addresses: { findFirst: jest.fn().mockResolvedValue(null) },
      users: { findFirst: jest.fn().mockResolvedValue({ first_name: 'Rosa', last_name: 'Gómez', email: null }) },
    }),
  };
  prisma.$transaction = jest.fn(async (fn: (t: unknown) => unknown) => fn(prisma));
  return { prisma, templates, versions };
}

const blocks = (text: string) => ({
  page: { size: 'A4' },
  blocks: [{ type: 'paragraph', text }],
});

function setup(storeId = 7) {
  const fake = fakePrisma();
  const files = { upload: jest.fn().mockResolvedValue({ id: 70, sha256: 'b'.repeat(64) }) };
  const basePages = { rasterize: jest.fn().mockResolvedValue([{ page: 1, width_pt: 300, height_pt: 400, image: Buffer.alloc(1), data_uri: 'data:image/jpeg;base64,AA==' }]) };
  const renderer = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 x')), fileBytes: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 base')) };
  const service = new DocumentTemplatesService(
    fake.prisma as never,
    files as never,
    basePages as never,
    new TemplateDataService(fake.prisma as never),
    renderer as never,
  );
  const run = <T>(fn: () => Promise<T>, store = storeId) =>
    RequestContextService.runIsolated(
      { store_id: store, organization_id: 3, user_id: 9, is_super_admin: false, is_owner: false },
      fn,
    );
  return { service, run, files, basePages, renderer, ...fake };
}

describe('DocumentTemplatesService', () => {
  it('creates a draft with a valid starting body and a key unique per store', async () => {
    const { service, run } = setup();
    const created = await run(() => service.create({ key: 'contrato-laboral', name: 'Contrato laboral', kind: 'blocks' }));
    expect(created).toMatchObject({ key: 'contrato-laboral', status: 'draft', kind: 'blocks', published_version: null });
    expect((created.body as any).blocks[0]).toMatchObject({ type: 'heading', text: 'Contrato laboral' });
    await expect(run(() => service.create({ key: 'contrato-laboral', name: 'Otro', kind: 'blocks' }))).rejects.toMatchObject({
      errorCode: 'DOCTPL_KEY_TAKEN',
    });
    // The same key is free in another store.
    const { service: other, run: runOther } = setup(8);
    await expect(runOther(() => other.create({ key: 'contrato-laboral', name: 'X', kind: 'blocks' }))).resolves.toBeDefined();
  });

  it('rejects an invalid body with a readable message and keeps the draft untouched', async () => {
    const { service, run, templates } = setup();
    const t = await run(() => service.create({ key: 'a1', name: 'A1', kind: 'blocks' }));
    const before = JSON.stringify(templates[0].draft_body);
    await expect(run(() => service.updateDraft(t.id, { body: blocks('{{ fields.x | evil }}') }))).rejects.toMatchObject({
      errorCode: 'DOCTPL_INVALID',
    });
    expect(JSON.stringify(templates[0].draft_body)).toBe(before);
  });

  it('publishes immutable versions: v1 stays the same after v2, with hash and token schema', async () => {
    const { service, run, versions } = setup();
    const t = await run(() => service.create({ key: 'a1', name: 'A1', kind: 'blocks' }));
    await run(() => service.updateDraft(t.id, { body: blocks('Hola {{ fields.nombre }}') }));
    const v1 = await run(() => service.publish(t.id));
    expect(v1).toMatchObject({ created: true, version: 1 });
    const snapshotV1 = JSON.stringify(versions[0]);
    expect(versions[0].token_schema).toEqual([{ path: 'fields.nombre', required: true }]);
    expect(versions[0].body_hash).toMatch(/^[0-9a-f]{64}$/);

    await run(() => service.updateDraft(t.id, { body: blocks('Adiós {{ fields.nombre | upper }}') }));
    const v2 = await run(() => service.publish(t.id));
    expect(v2).toMatchObject({ created: true, version: 2 });
    expect(JSON.stringify(versions[0])).toBe(snapshotV1);
    expect(versions).toHaveLength(2);
    expect((await run(() => service.get(t.id))).published_version).toMatchObject({ version: 2 });
    expect((await run(() => service.versions(t.id))).map((v) => v.version)).toEqual([2, 1]);
  });

  it('publishing without changes creates no new version', async () => {
    const { service, run, versions } = setup();
    const t = await run(() => service.create({ key: 'a1', name: 'A1', kind: 'blocks' }));
    await run(() => service.publish(t.id));
    const again = await run(() => service.publish(t.id));
    expect(again).toMatchObject({ created: false, version: 1 });
    expect(versions).toHaveLength(1);
  });

  it('a publish that read the template before another publish finished creates no duplicate version', async () => {
    const { service, run, versions, prisma, templates } = setup();
    const t = await run(() => service.create({ key: 'a1', name: 'A1', kind: 'blocks' }));
    const stale = { ...templates[0], published_version: null };
    await run(() => service.publish(t.id));
    // The second publisher read the row before the first one committed.
    prisma.document_templates.findFirst.mockResolvedValueOnce(stale);
    const again = await run(() => service.publish(t.id));
    expect(again).toMatchObject({ created: false, version: 1 });
    expect(versions).toHaveLength(1);
  });

  it('a template of another store is a 404 for every operation', async () => {
    const { service, run } = setup();
    const t = await run(() => service.create({ key: 'a1', name: 'A1', kind: 'blocks' }));
    for (const op of [
      () => service.get(t.id),
      () => service.updateDraft(t.id, { name: 'Hack' }),
      () => service.publish(t.id),
      () => service.versions(t.id),
      () => service.preview(t.id),
      () => service.archive(t.id),
    ]) {
      await expect(run(op, 99)).rejects.toMatchObject({ errorCode: 'DOCTPL_NOT_FOUND' });
    }
  });

  it('previews the draft with a real render, example data and the watermark flag', async () => {
    const { service, run, renderer } = setup();
    const t = await run(() => service.create({ key: 'a1', name: 'A1', kind: 'blocks' }));
    await run(() =>
      service.updateDraft(t.id, { body: blocks("{{ fields.salario | money }} {{ fields.inicio | date:'largo' }} {{ store.name }}") }),
    );
    const pdf = await run(() => service.preview(t.id));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const call = renderer.render.mock.calls[0][0];
    expect(call.preview).toBe(true);
    expect(call.scope.values).toMatchObject({ 'fields.salario': 1500000, 'fields.inicio': '2026-01-15', 'store.name': 'Tienda Demo' });
  });

  it('archived templates cannot be edited or published', async () => {
    const { service, run } = setup();
    const t = await run(() => service.create({ key: 'a1', name: 'A1', kind: 'blocks' }));
    await run(() => service.archive(t.id));
    await expect(run(() => service.updateDraft(t.id, { name: 'X' }))).rejects.toMatchObject({ errorCode: 'DOCTPL_ARCHIVED' });
    await expect(run(() => service.publish(t.id))).rejects.toMatchObject({ errorCode: 'DOCTPL_ARCHIVED' });
  });

  describe('base_pdf', () => {
    const baseBody = (page = 1) => ({
      fields: [{ page, x: 10, y: 20, width: 100, height: 14, value: '{{ fields.nit }}' }],
      signature_slots: [{ key: 'firma', role_label: 'Representante', page: 1, x: 10, y: 100, width: 160, height: 50 }],
    });

    it('cannot be published without the base PDF; publishes with it and records the file', async () => {
      const { service, run, versions, prisma } = setup();
      const t = await run(() => service.create({ key: 'rut', name: 'Formato RUT', kind: 'base_pdf' }));
      await run(() => service.updateDraft(t.id, { body: baseBody() }));
      await expect(run(() => service.publish(t.id))).rejects.toMatchObject({ errorCode: 'DOCTPL_BASE_PDF_REQUIRED' });

      const file = { buffer: Buffer.from('%PDF-1.4'), originalname: 'formato.pdf' } as Express.Multer.File;
      const uploaded = await run(() => service.uploadBasePdf(t.id, file));
      expect(uploaded).toMatchObject({ base_file_id: 70, page_count: 1 });
      prisma.stored_files.findFirst.mockResolvedValue({ sha256: 'b'.repeat(64) });
      const v = await run(() => service.publish(t.id));
      expect(v).toMatchObject({ created: true, version: 1 });
      expect(versions[0]).toMatchObject({ kind: 'base_pdf', base_file_id: 70 });
      expect(versions[0].token_schema).toEqual([{ path: 'fields.nit', required: true }]);
    });

    it('rejects fields on a page the base PDF does not have', async () => {
      const { service, run, prisma } = setup();
      const t = await run(() => service.create({ key: 'rut', name: 'Formato RUT', kind: 'base_pdf' }));
      await run(() => service.uploadBasePdf(t.id, { buffer: Buffer.from('%PDF-1.4'), originalname: 'f.pdf' } as Express.Multer.File));
      await run(() => service.updateDraft(t.id, { body: baseBody(3) }));
      prisma.stored_files.findFirst.mockResolvedValue({ sha256: 'b'.repeat(64) });
      await expect(run(() => service.publish(t.id))).rejects.toThrow('La página 3 no existe: el PDF base tiene 1');
    });

    it('only base_pdf templates take a base PDF', async () => {
      const { service, run } = setup();
      const t = await run(() => service.create({ key: 'a1', name: 'A1', kind: 'blocks' }));
      await expect(run(() => service.uploadBasePdf(t.id, { buffer: Buffer.from('%PDF-'), originalname: 'f.pdf' } as Express.Multer.File))).rejects.toMatchObject({ errorCode: 'DOCTPL_INVALID' });
    });
  });
});
