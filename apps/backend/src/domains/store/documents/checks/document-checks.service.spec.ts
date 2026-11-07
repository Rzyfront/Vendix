import { VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import {
  buildWorkflowKit,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import {
  AI_TIMEOUT_MS,
  buildResult,
  DOCUMENT_EXTRACT_APP_KEY,
  DOCUMENT_EXTRACT_PROMPT_VERSION,
  DocumentChecksService,
} from './document-checks.service';

const PDF = Buffer.from('%PDF-1.4\nfactura');
const pdf = { buffer: PDF, originalname: 'factura.pdf', mimetype: 'application/pdf' };

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof VendixHttpException ? e.errorCode : `OTHER:${(e as Error).message}`;
  }
}

function definition(): WorkflowDefinitionV1 {
  return {
    schema: 'vendix.workflow/v1',
    key: 'facturas',
    name: 'Registrar factura de proveedor',
    fields: [
      { key: 'proveedor', type: 'text', label: 'Proveedor' },
      { key: 'nit', type: 'text', label: 'NIT' },
      { key: 'fecha', type: 'date', label: 'Fecha' },
      { key: 'total', type: 'money', label: 'Total' },
      { key: 'factura', type: 'file', label: 'Factura' },
      { key: 'otro', type: 'text', label: 'No está en la etapa' },
    ],
    stages: [
      {
        key: 'intake',
        name: 'Registro',
        type: 'form',
        start: true,
        assignee: { kind: 'initiator' },
        form: { fields: ['proveedor', 'nit', 'fecha', 'total', 'factura'] },
        transitions: [{ on: 'submit', to: 'done' }],
      },
      { key: 'done', name: 'Fin', type: 'end', outcome: 'completed' },
    ],
  } as unknown as WorkflowDefinitionV1;
}

const aiJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    doc_type: 'factura',
    legibility: 'good',
    matches_request: true,
    mismatch_reasons: [],
    valid_until: null,
    text: 'FACTURA Papelería Andina NIT 900.123.456-7',
    fields: {
      proveedor: { value: 'Papelería Andina', confidence: 0.97, page: 1, region: { x: 0.1, y: 0.05, w: 0.4, h: 0.04 } },
      nit: { value: '900.123.456-7', confidence: 0.93, page: 1, region: { x: 0.1, y: 0.1, w: 0.2, h: 0.03 } },
      fecha: { value: '15/03/2026', confidence: 0.9, page: 1, region: { x: 0.6, y: 0.1, w: 0.2, h: 0.03 } },
      total: { value: '1.234.567,89', confidence: 0.62, page: 2, region: { x: 0.7, y: 0.8, w: 0.2, h: 0.03 } },
      inventado: { value: 'x', confidence: 1, page: 1, region: { x: 0, y: 0, w: 1, h: 1 } },
    },
    ...over,
  });

describe('DocumentChecksService · Leer con IA', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let service: DocumentChecksService;
  let ai: { run: jest.Mock; assertVisionModelLinked: jest.Mock };
  let pages: { prepare: jest.Mock };
  let s3: { downloadFile: jest.Mock };
  let instanceId: number;
  let fileId: number;
  const FIELDS = ['proveedor', 'nit', 'fecha', 'total'];
  const read = (over: Partial<{ instance_id: number; field_keys: string[] }> = {}) =>
    service.read(fileId, { instance_id: instanceId, field_keys: FIELDS, ...over });
  const answer = (content: string, usage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 }) =>
    ai.run.mockResolvedValueOnce({ success: true, content, model: 'vision-x', usage });

  beforeEach(async () => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    kit.db.table('stores').forEach((s) => (s.slug = 'tienda'));
    kit.db.insert('organizations', { id: 1, slug: 'acme' });
    seedDefinition(kit.db, definition());
    ai = { run: jest.fn(), assertVisionModelLinked: jest.fn(async () => undefined) };
    pages = {
      prepare: jest.fn(async () => ({
        pages: [
          { page_number: 1, data_uri: 'data:image/jpeg;base64,AAA' },
          { page_number: 2, data_uri: 'data:image/jpeg;base64,BBB' },
        ],
        page_count: 2,
      })),
    };
    s3 = { downloadFile: jest.fn(async () => PDF) };
    service = new DocumentChecksService(
      kit.prisma,
      kit.storedFiles,
      kit.dossiers,
      kit.instances,
      ai as any,
      pages as any,
      s3 as any,
    );
    kit.as({ user_id: 4, permissions: ['store:workflows:task'] });
    instanceId = (await kit.engine.start({ definitionKey: 'facturas' })).instance.id;
    fileId = (await kit.workflowFiles.upload(instanceId, pdf, { field_key: 'factura' })).file_id;
  });
  afterEach(() => jest.restoreAllMocks());

  it('lee con la app de IA, normaliza por tipo y guarda la procedencia', async () => {
    answer(aiJson());
    const check = await read();
    expect(ai.assertVisionModelLinked).toHaveBeenCalledWith(DOCUMENT_EXTRACT_APP_KEY);
    expect(ai.run).toHaveBeenCalledTimes(1);
    expect(ai.run.mock.calls[0][0]).toBe(DOCUMENT_EXTRACT_APP_KEY);
    const message = ai.run.mock.calls[0][2][0];
    expect(message.content.filter((p: any) => p.type === 'image_url')).toHaveLength(2);
    expect(message.content[0].text).toContain('nit (text): NIT');
    expect(message.content[0].text).not.toContain('otro');

    expect(check).toMatchObject({
      status: 'done',
      verdict: 'warn',
      model: 'vision-x',
      tokens_used: 150,
      cached: false,
      file_id: fileId,
      instance_id: instanceId,
    });
    expect(check.result.fields).toEqual({
      proveedor: { value: 'Papelería Andina', confidence: 0.97, page: 1, region: { x: 0.1, y: 0.05, w: 0.4, h: 0.04 } },
      nit: { value: '900123456-7', confidence: 0.93, page: 1, region: { x: 0.1, y: 0.1, w: 0.2, h: 0.03 } },
      fecha: { value: '2026-03-15', confidence: 0.9, page: 1, region: { x: 0.6, y: 0.1, w: 0.2, h: 0.03 } },
      total: { value: 1234567.89, confidence: 0.62, page: 2, region: { x: 0.7, y: 0.8, w: 0.2, h: 0.03 } },
    });
    expect(check.result).not.toHaveProperty('text');
    const row = kit.db.table('document_checks')[0];
    expect(row).toMatchObject({
      store_id: 1,
      file_id: fileId,
      app_key: DOCUMENT_EXTRACT_APP_KEY,
      prompt_version: DOCUMENT_EXTRACT_PROMPT_VERSION,
      status: 'done',
      requested_by_user_id: 4,
    });
    expect(row.input_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.result.text).toContain('FACTURA');
  });

  it('un segundo pedido igual sale del caché y no llama a la IA', async () => {
    answer(aiJson());
    const first = await read();
    const second = await read();
    expect(ai.run).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ id: first.id, cached: true, verdict: 'warn' });
    expect(kit.db.table('document_checks')).toHaveLength(1);
    // Other fields requested → other input hash → a new reading.
    answer(aiJson());
    await read({ field_keys: ['proveedor'] });
    expect(ai.run).toHaveBeenCalledTimes(2);
  });

  it('el mismo archivo en otra solicitud no reutiliza "coincide con la solicitud" (r1 M4)', async () => {
    answer(aiJson());
    const first = await read();
    kit.db.table('workflow_instances').find((i) => i.id === instanceId)!.title = 'Factura de otro proveedor';
    answer(aiJson());
    const again = await read();
    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(again).toMatchObject({ cached: false });
    expect(again.id).not.toBe(first.id);
    expect(ai.run.mock.calls[1][2][0].content[0].text).toContain('Factura de otro proveedor');
  });

  it('el caché es de la tienda: una lectura de otra tienda no cuenta', async () => {
    answer(aiJson());
    const first = await read();
    const mine = kit.db.table('document_checks')[0];
    mine.store_id = 2;
    answer(aiJson());
    const again = await read();
    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(again.id).not.toBe(first.id);
  });

  it('el mismo contenido en otro archivo reutiliza la lectura sin consumir IA', async () => {
    answer(aiJson());
    await read();
    const other = (await kit.workflowFiles.upload(instanceId, pdf, { requirement_key: undefined, field_key: 'factura' })).file_id;
    const copy = await service.read(other, { instance_id: instanceId, field_keys: FIELDS });
    expect(ai.run).toHaveBeenCalledTimes(1);
    expect(copy).toMatchObject({ cached: true, file_id: other });
    expect(kit.db.table('document_checks')).toHaveLength(2);
  });

  it('sin contexto de tienda no se ejecuta ni se llama a la IA', async () => {
    kit.as({ store_id: undefined as unknown as number });
    expect(await codeOf(read())).toBe('DOCUMENT_NOT_FOUND');
    expect(ai.run).not.toHaveBeenCalled();
    expect(kit.db.table('document_checks')).toHaveLength(0);
  });

  describe('veredictos', () => {
    const verdictFor = async (over: Record<string, unknown>) => {
      answer(aiJson(over));
      return (await read({ field_keys: ['proveedor'] })).verdict;
    };
    const good = { proveedor: { value: 'Papelería Andina', confidence: 0.95, page: 1, region: { x: 0, y: 0, w: 1, h: 1 } } };

    it('pass cuando todo está bien', async () => {
      expect(await verdictFor({ fields: good })).toBe('pass');
    });
    it('warn con legibilidad regular', async () => {
      expect(await verdictFor({ fields: good, legibility: 'fair' })).toBe('warn');
    });
    it('warn con un campo de confianza menor a 0,75', async () => {
      expect(
        await verdictFor({ fields: { proveedor: { ...good.proveedor, confidence: 0.74 } } }),
      ).toBe('warn');
    });
    it('needs_review si no coincide con la solicitud o está ilegible', async () => {
      expect(await verdictFor({ fields: good, matches_request: false, mismatch_reasons: ['Es una cédula'] })).toBe('needs_review');
    });
    it('needs_review si la legibilidad es mala (nunca rechaza solo)', async () => {
      expect(await verdictFor({ fields: good, legibility: 'poor' })).toBe('needs_review');
    });
    it('los motivos de no coincidencia viajan en el resultado', async () => {
      answer(aiJson({ matches_request: false, mismatch_reasons: ['Es una cédula'] }));
      const c = await read();
      expect(c.result).toMatchObject({ matches_request: false, mismatch_reasons: ['Es una cédula'], doc_type: 'factura' });
    });
  });

  describe('perfil del archivo', () => {
    it('crea el perfil con tipo, texto y vencimiento detectados', async () => {
      answer(aiJson({ doc_type: 'poliza', valid_until: '31/12/2026' }));
      await read();
      expect(kit.db.table('document_file_profiles')[0]).toMatchObject({
        store_id: 1,
        file_id: fileId,
        doc_type: 'poliza',
        valid_until: new Date('2026-12-31T00:00:00.000Z'),
      });
      expect(kit.db.table('document_file_profiles')[0].extracted_text).toContain('FACTURA');
    });

    it('nunca pisa lo que una persona puso', async () => {
      kit.db.insert('document_file_profiles', {
        store_id: 1,
        file_id: fileId,
        doc_type: 'contrato',
        extracted_text: 'texto manual',
        valid_until: new Date('2030-01-01T00:00:00.000Z'),
        tags: [],
      });
      answer(aiJson({ doc_type: 'poliza', valid_until: '2026-12-31' }));
      await read();
      expect(kit.db.table('document_file_profiles')).toHaveLength(1);
      expect(kit.db.table('document_file_profiles')[0]).toMatchObject({
        doc_type: 'contrato',
        extracted_text: 'texto manual',
        valid_until: new Date('2030-01-01T00:00:00.000Z'),
      });
    });

    it('llena solo lo que está vacío', async () => {
      kit.db.insert('document_file_profiles', { store_id: 1, file_id: fileId, doc_type: 'contrato', tags: [] });
      answer(aiJson({ doc_type: 'poliza' }));
      await read();
      const p = kit.db.table('document_file_profiles')[0];
      expect(p.doc_type).toBe('contrato');
      expect(p.extracted_text).toContain('FACTURA');
    });
  });

  describe('campos pedidos', () => {
    it('solo del formulario de la etapa actual y de tipos legibles', async () => {
      expect(await codeOf(read({ field_keys: ['otro'] }))).toBe('DOCUMENT_CHECK_FIELDS_INVALID');
      expect(await codeOf(read({ field_keys: ['factura'] }))).toBe('DOCUMENT_CHECK_FIELDS_INVALID');
      expect(await codeOf(read({ field_keys: ['no_existe'] }))).toBe('DOCUMENT_CHECK_FIELDS_INVALID');
      expect(ai.run).not.toHaveBeenCalled();
      expect(kit.db.table('document_checks')).toHaveLength(0);
    });

    it('un campo sin valor legible queda en unread_keys, no inventado', async () => {
      answer(aiJson({ fields: { proveedor: { value: null, confidence: 0, page: 1, region: null } } }));
      const c = await read({ field_keys: ['proveedor', 'nit'] });
      expect(c.result.fields).toEqual({});
      expect(c.result.unread_keys).toEqual(['nit', 'proveedor']);
    });
  });

  describe('acceso y aislamiento', () => {
    it('quien no ve la solicitud recibe 404', async () => {
      kit.as({ user_id: 5, permissions: ['store:workflows:task'] });
      expect(await codeOf(read())).toBe('DOCUMENT_NOT_FOUND');
      expect(await codeOf(service.list(fileId))).toBe('DOCUMENT_NOT_FOUND');
      expect(ai.run).not.toHaveBeenCalled();
    });

    it('sin permiso de tarea o gestión no se lee', async () => {
      kit.as({ user_id: 4, permissions: ['store:documents:read'] });
      expect(await codeOf(read())).toBe('DOCUMENT_NOT_FOUND');
    });

    it('con gestión se ve todo; con otra solicitud como instance_id, 404', async () => {
      kit.as({ user_id: 6, permissions: ['store:workflows:manage'] });
      answer(aiJson());
      expect((await read()).status).toBe('done');
      kit.as({ user_id: 4, permissions: ['store:workflows:task'] });
      const other = (await kit.engine.start({ definitionKey: 'facturas' })).instance.id;
      expect(await codeOf(read({ instance_id: other }))).toBe('DOCUMENT_NOT_FOUND');
    });

    it('un archivo de otra tienda es 404', async () => {
      kit.as({ store_id: 2, user_id: 7, permissions: ['store:workflows:manage'] });
      expect(await codeOf(read())).toBe('DOCUMENT_NOT_FOUND');
      expect(await codeOf(service.list(fileId))).toBe('DOCUMENT_NOT_FOUND');
      expect(ai.run).not.toHaveBeenCalled();
    });

    it('la lista del archivo no trae el texto leído y solo las lecturas de la tienda', async () => {
      answer(aiJson());
      await read();
      kit.db.insert('document_checks', {
        store_id: 2, organization_id: 1, file_id: fileId, check_type: 'extract', status: 'done',
        app_key: 'x', prompt_version: 'v1', input_sha256: 'a'.repeat(64), result: {},
      });
      const list = await service.list(fileId);
      expect(list).toHaveLength(1);
      expect(list[0].result).not.toHaveProperty('text');
    });
  });

  describe('errores', () => {
    it('cupo agotado: el error del motor sube tal cual y la lectura queda fallida', async () => {
      ai.run.mockRejectedValueOnce(
        new VendixHttpException({ code: 'SUBSCRIPTION_006', httpStatus: 429, devMessage: 'AI quota exceeded for this billing period' }),
      );
      expect(await codeOf(read())).toBe('SUBSCRIPTION_006');
      expect(kit.db.table('document_checks')[0]).toMatchObject({ status: 'failed' });
      // A failed reading is never served from the cache.
      answer(aiJson());
      expect((await read()).cached).toBe(false);
    });

    it('sin modelo de visión no se crea la lectura', async () => {
      ai.assertVisionModelLinked.mockRejectedValueOnce(
        new VendixHttpException({ code: 'AI_VISION_001', httpStatus: 409, devMessage: 'sin modelo' }),
      );
      expect(await codeOf(read())).toBe('AI_VISION_001');
      expect(kit.db.table('document_checks')).toHaveLength(0);
    });

    it('respuesta de la IA inválida → DOCUMENT_CHECK_AI_FAILED y lectura fallida', async () => {
      answer('no es json');
      expect(await codeOf(read())).toBe('DOCUMENT_CHECK_AI_FAILED');
      expect(kit.db.table('document_checks')[0].status).toBe('failed');
      ai.run.mockResolvedValueOnce({ success: false, error: 'boom' });
      expect(await codeOf(read())).toBe('DOCUMENT_CHECK_AI_FAILED');
    });

    it('tarda demasiado → DOCUMENT_CHECK_AI_TIMEOUT', async () => {
      jest.useFakeTimers();
      try {
        ai.run.mockReturnValueOnce(new Promise(() => undefined));
        const p = codeOf(read());
        await jest.advanceTimersByTimeAsync(AI_TIMEOUT_MS + 10);
        expect(await p).toBe('DOCUMENT_CHECK_AI_TIMEOUT');
      } finally {
        jest.useRealTimers();
      }
    });

    it('archivo que no es imagen ni PDF', async () => {
      kit.db.table('stored_files').find((f) => f.id === fileId)!.mime_type =
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      expect(await codeOf(read())).toBe('DOCUMENT_CHECK_FILE_UNSUPPORTED');
      expect(ai.run).not.toHaveBeenCalled();
    });
  });

  describe('revisión', () => {
    it('marca la lectura como revisada por quien la revisa, una sola vez', async () => {
      answer(aiJson());
      const c = await read();
      kit.as({ user_id: 4 });
      const reviewed = await service.review(c.id);
      expect(reviewed.reviewed_by_user_id).toBe(4);
      expect(reviewed.reviewed_at).toBeInstanceOf(Date);
      kit.as({ user_id: 6, permissions: ['store:workflows:manage'] });
      expect((await service.review(c.id)).reviewed_by_user_id).toBe(4);
    });

    it('lectura inexistente, de otra tienda o de una solicitud que no ves → 404', async () => {
      answer(aiJson());
      const c = await read();
      expect(await codeOf(service.review(9999))).toBe('DOCUMENT_CHECK_NOT_FOUND');
      kit.as({ user_id: 5, permissions: ['store:workflows:task'] });
      expect(await codeOf(service.review(c.id))).toBe('DOCUMENT_CHECK_NOT_FOUND');
      kit.as({ store_id: 2, user_id: 7, permissions: ['store:workflows:manage'] });
      expect(await codeOf(service.review(c.id))).toBe('DOCUMENT_CHECK_NOT_FOUND');
    });
  });
});

describe('buildResult · región de procedencia', () => {
  const field = {
    key: 'total',
    label: 'Total',
    type: 'money',
    def: { key: 'total', label: 'Total', type: 'money' },
  } as unknown as Parameters<typeof buildResult>[1][number];
  const regionFor = (region: unknown) =>
    buildResult(
      {
        doc_type: 'factura',
        legibility: 'good',
        matches_request: true,
        mismatch_reasons: [],
        valid_until: null,
        text: '',
        fields: { total: { value: '100', confidence: 0.9, page: 1, region } },
      },
      [field],
      1,
    ).fields['total']?.region;

  it('keeps a region inside the page', () => {
    expect(regionFor({ x: 0.7, y: 0.8, w: 0.2, h: 0.03 })).toEqual({ x: 0.7, y: 0.8, w: 0.2, h: 0.03 });
  });

  it.each([
    ['sale de la página', { x: 1, y: 1, w: 1, h: 1 }],
    ['en píxeles', { x: 120, y: 340, w: 200, h: 30 }],
    ['sin área', { x: 0.2, y: 0.2, w: 0, h: 0.1 }],
  ])('drops a region that %s', (_label, region) => {
    expect(regionFor(region)).toBeNull();
  });
});
