import { VendixHttpException } from '@common/errors';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import {
  buildWorkflowKit,
  seedDefinition,
  purchaseDefinition,
  seedPeople,
  seedWorkGroup,
} from '../../../../testing/workflows/workflow-test-kit';

async function fail(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e as VendixHttpException;
  }
}
const codeOf = async (p: Promise<unknown>) => (await fail(p))?.errorCode;

describe('WorkflowDefinitionsService', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let svc: WorkflowDefinitionsService;

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    seedWorkGroup(kit.db, 'board', [4, 5]);
    svc = new WorkflowDefinitionsService(kit.prisma);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('create', () => {
    it('crea un borrador con esqueleto válido y clave derivada del nombre', async () => {
      const d = await svc.create({ name: 'Aprobación de Compras' });
      expect(d).toMatchObject({
        key: 'aprobacion_de_compras',
        status: 'draft',
        store_id: 1,
        published_version: null,
        has_draft: true,
      });
      expect(d).not.toHaveProperty('draft_definition');
      const draft = await svc.getDraft(d.id);
      expect((draft.definition as any).key).toBe('aprobacion_de_compras');
      expect((draft.definition as any).stages.map((s: any) => s.type)).toEqual(['form', 'end']);
      expect((await svc.validate(d.id)).valid).toBe(true);
    });

    it('clave explícita repetida -> WORKFLOW_KEY_TAKEN; derivada repetida recibe sufijo', async () => {
      await svc.create({ name: 'Compras', key: 'compras' });
      expect(await codeOf(svc.create({ name: 'Otra', key: 'compras' }))).toBe('WORKFLOW_KEY_TAKEN');
      const second = await svc.create({ name: 'Compras' });
      expect(second.key).toBe('compras_2');
    });

    it('rechaza una clave con formato inválido', async () => {
      expect(await codeOf(svc.create({ name: 'X', key: 'Mala Clave' }))).toBe('SYS_VALIDATION_001');
    });

    it('fuerza la clave de la fila dentro de la definición recibida', async () => {
      const d = await svc.create({ name: 'Compras', key: 'compras', definition: { ...purchaseDefinition(), key: 'otra' } });
      expect(((await svc.getDraft(d.id)).definition as any).key).toBe('compras');
    });
  });

  describe('borrador', () => {
    it('guarda con control optimista y avisa el conflicto', async () => {
      const d = await svc.create({ name: 'Compras' });
      const first = await svc.getDraft(d.id);
      const saved = await svc.saveDraft(d.id, {
        definition: { ...(first.definition as object), name: 'Compras 2' },
        expected_draft_updated_at: first.draft_updated_at as any,
      });
      expect(saved.draft_updated_at.getTime()).toBeGreaterThanOrEqual(new Date(first.draft_updated_at as any).getTime());
      // another editor still holds the old timestamp
      kit.db.table('workflow_definitions')[0].draft_updated_at = new Date(Date.now() + 5000);
      const err = await fail(
        svc.saveDraft(d.id, { definition: { a: 1 }, expected_draft_updated_at: new Date(saved.draft_updated_at).toISOString() }),
      );
      expect(err?.errorCode).toBe('WORKFLOW_DRAFT_CONFLICT');
      expect((err!.getResponse() as any).message).toBe('Otro usuario modificó el borrador; recarga para ver sus cambios.');
    });

    it('acepta borradores inválidos pero exige un objeto JSON de hasta 256 KB', async () => {
      const d = await svc.create({ name: 'Compras' });
      await svc.saveDraft(d.id, { definition: { cualquier: 'cosa' } });
      expect((await svc.validate(d.id)).valid).toBe(false);
      expect(await codeOf(svc.saveDraft(d.id, { definition: [] as any }))).toBe('WORKFLOW_DRAFT_INVALID');
      expect(await codeOf(svc.saveDraft(d.id, { definition: { blob: 'x'.repeat(262_200) } }))).toBe('WORKFLOW_DRAFT_INVALID');
    });

    it('la clave guardada en el borrador siempre es la de la fila', async () => {
      const d = await svc.create({ name: 'Compras', key: 'compras' });
      await svc.saveDraft(d.id, { definition: { key: 'hackeada' } });
      expect(((await svc.getDraft(d.id)).definition as any).key).toBe('compras');
    });
  });

  describe('validate', () => {
    it('P3.6: la colección de un flujo sobre registros se valida contra las colecciones activas de la tienda', async () => {
      const def = (collection: string) => ({
        ...purchaseDefinition(),
        subject: { type: 'custom_record', collection },
      });
      kit.db.insert('workflow_collections', {
        store_id: 1,
        organization_id: 1,
        key: 'contratos',
        is_archived: false,
        fields: [{ key: 'vence', type: 'date' }],
      });
      kit.db.insert('workflow_collections', {
        store_id: 1,
        organization_id: 1,
        key: 'viejos',
        is_archived: true,
        fields: [],
      });
      kit.db.insert('workflow_collections', {
        store_id: 2,
        organization_id: 1,
        key: 'ajena',
        is_archived: false,
        fields: [],
      });
      const ok = await svc.create({ name: 'Renovación', key: 'renovacion', definition: def('contratos') as any });
      expect(await svc.validate(ok.id)).toMatchObject({ valid: true, errors: [] });
      for (const missing of ['nope', 'viejos', 'ajena']) {
        const d = await svc.create({ name: `X ${missing}`, key: `x_${missing}`, definition: def(missing) as any });
        const r = await svc.validate(d.id);
        expect(r.valid).toBe(false);
        expect(r.errors.map((e: any) => e.code)).toContain('COLLECTION_UNKNOWN');
      }
    });

    it('P4.1: un requisito de documento emitido acepta solo plantillas publicadas de esta tienda', async () => {
      const withTemplate = (key: string) => {
        const d: any = purchaseDefinition();
        d.stages[0].requirements = [
          { kind: 'issued_document', key: 'contrato', label: 'Contrato', template_key: key },
        ];
        return d;
      };
      const tpl = (store_id: number, key: string, status: string, published_version_id: number | null) =>
        kit.db.insert('document_templates', { store_id, organization_id: 1, key, status, published_version_id });
      tpl(1, 'contrato-laboral', 'published', 10);
      tpl(1, 'borrador', 'draft', null);
      tpl(1, 'archivada', 'archived', 11);
      tpl(2, 'ajena', 'published', 12);

      const ok = await svc.create({ name: 'Con contrato', key: 'con_contrato', definition: withTemplate('contrato-laboral') });
      expect((await svc.validate(ok.id)).errors.map((e: any) => e.code)).not.toContain('TEMPLATE_NOT_PUBLISHED');
      for (const key of ['borrador', 'archivada', 'ajena', 'no-existe']) {
        const d = await svc.create({ name: `T ${key}`, key: `t_${key.replace('-', '_')}`, definition: withTemplate(key) });
        const r = await svc.validate(d.id);
        expect(r.valid).toBe(false);
        expect(r.errors.map((e: any) => e.code)).toContain('TEMPLATE_NOT_PUBLISHED');
      }
    });

    it('P3.2: {{secrets.NAME}} debe nombrar un secreto de esta tienda', async () => {
      const withSecret = (name: string) => {
        const d: any = purchaseDefinition();
        d.fields = [...d.fields, { key: 'crm_id', type: 'text', label: 'ID CRM' }];
        d.stages[0].on_enter = [
          {
            action: 'vendix.http.request',
            map: {
              method: 'POST',
              url: 'https://api.example.com/x',
              headers: `Authorization: Bearer {{secrets.${name}}}`,
            },
            output: { crm_id: 'body.id' },
          },
        ];
        return d;
      };
      kit.db.insert('workflow_secrets', { store_id: 1, organization_id: 1, name: 'CRM_TOKEN', value_enc: 'x' });
      kit.db.insert('workflow_secrets', { store_id: 2, organization_id: 1, name: 'AJENO', value_enc: 'x' });
      const ok = await svc.create({ name: 'Con secreto', key: 'con_secreto', definition: withSecret('CRM_TOKEN') });
      expect((await svc.validate(ok.id)).errors.map((e: any) => e.code)).not.toContain('SECRET_UNKNOWN');
      for (const missing of ['NOPE', 'AJENO']) {
        const d = await svc.create({ name: `S ${missing}`, key: `s_${missing.toLowerCase()}`, definition: withSecret(missing) });
        const r = await svc.validate(d.id);
        expect(r.valid).toBe(false);
        expect(r.errors.map((e: any) => e.code)).toContain('SECRET_UNKNOWN');
      }
    });

    it('usa roles, grupos con miembros disponibles y usuarios de la tienda', async () => {
      const d = await svc.create({ name: 'Compra', key: 'purchase', definition: purchaseDefinition() as any });
      expect(await svc.validate(d.id)).toMatchObject({ valid: true, errors: [] });

      const bad = purchaseDefinition();
      (bad.stages[1] as any).assignee = { kind: 'role', role_key: 'fantasma' };
      (bad.stages[2] as any).assignee = { kind: 'group', group_key: 'vacio', strategy: 'any' };
      const res = await svc.validateDefinition(bad);
      expect(res.errors.map((e) => e.code)).toEqual(expect.arrayContaining(['ROLE_UNKNOWN', 'GROUP_UNKNOWN']));
    });

    it('un grupo sin miembros disponibles no es válido', async () => {
      seedWorkGroup(kit.db, 'vacio', [4], { unavailable: [4] });
      const def = purchaseDefinition();
      (def.stages[2] as any).assignee = { kind: 'group', group_key: 'vacio', strategy: 'any' };
      expect((await svc.validateDefinition(def)).errors.map((e) => e.code)).toContain('GROUP_UNKNOWN');
    });

    it('P2.2: a subflow may only launch a published flow (a draft fails the validation, not the run)', async () => {
      await svc.create({ name: 'Alta de proveedor', key: 'alta' });
      const def = purchaseDefinition();
      const subflow = (key: string) => ({
        key: 'sub',
        name: 'Sub',
        type: 'subflow',
        subflow: { flows: [{ flow_key: key }], wait: false },
        transitions: [{ to: def.stages[1].key, on: 'completed' }],
      });
      (def.stages as any).push(subflow('alta'));
      const draft = await svc.validateDefinition(def);
      expect(draft.errors.find((e) => e.code === 'SUBFLOW_INVALID')?.message).toContain('no está publicado');

      seedDefinition(kit.db, { ...purchaseDefinition(), key: 'alta-publicada' } as any);
      (def.stages as any)[def.stages.length - 1] = subflow('alta-publicada');
      expect((await svc.validateDefinition(def)).errors.map((e) => e.code)).not.toContain('SUBFLOW_INVALID');
    });
  });

  describe('publish', () => {
    async function draftOf(def = purchaseDefinition()) {
      return svc.create({ name: 'Compra', key: 'purchase', definition: def as any });
    }

    it('crea la v1 y deja el flujo activo', async () => {
      const d = await draftOf();
      const r = await svc.publish(d.id, { changelog: 'primera' });
      expect(r.unchanged).toBe(false);
      expect(r.version).toMatchObject({ version: 1, schema_version: 'vendix.workflow/v1', changelog: 'primera' });
      expect(r.version.definition_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.version).not.toHaveProperty('definition');
      const got = await svc.get(d.id);
      expect(got).toMatchObject({ status: 'active', has_unpublished_changes: false });
      expect(got.published_version).toMatchObject({ version: 1 });
      expect(kit.db.table('workflow_versions')[0].definition.key).toBe('purchase');
    });

    it('republicar sin cambios devuelve la versión actual con unchanged', async () => {
      const d = await draftOf();
      await svc.publish(d.id);
      const again = await svc.publish(d.id);
      expect(again.unchanged).toBe(true);
      expect(again.version.version).toBe(1);
      expect(kit.db.table('workflow_versions')).toHaveLength(1);
    });

    it('un cambio real crea la v2 y las versiones se listan sin cuerpo', async () => {
      const d = await draftOf();
      await svc.publish(d.id);
      const next = purchaseDefinition({ name: 'Compra v2' });
      await svc.saveDraft(d.id, { definition: next as any });
      expect((await svc.get(d.id)).has_unpublished_changes).toBe(true);
      const r = await svc.publish(d.id);
      expect(r).toMatchObject({ unchanged: false, version: { version: 2 } });
      const list = await svc.versions(d.id);
      expect(list.map((v: any) => v.version)).toEqual([2, 1]);
      expect(list[0]).not.toHaveProperty('definition');
      expect((await svc.version(d.id, 1)).definition.name).toBe('Compra');
      expect(await codeOf(svc.version(d.id, 9))).toBe('WORKFLOW_VERSION_NOT_FOUND');
    });

    it('un borrador inválido devuelve 422 WORKFLOW_INVALID con los problemas', async () => {
      const d = await svc.create({ name: 'Compra', key: 'purchase' });
      await svc.saveDraft(d.id, { definition: { schema: 'vendix.workflow/v1', name: 'x', fields: [], stages: [] } });
      const err = await fail(svc.publish(d.id));
      expect(err?.errorCode).toBe('WORKFLOW_INVALID');
      expect(err!.getStatus()).toBe(422);
      expect((err!.getResponse() as any).details.errors.length).toBeGreaterThan(0);
      expect(kit.db.table('workflow_versions')).toHaveLength(0);
    });

    it('no publica un flujo archivado', async () => {
      const d = await draftOf();
      await svc.archive(d.id);
      expect(await codeOf(svc.publish(d.id))).toBe('WORKFLOW_NOT_ACTIVE');
    });
  });

  describe('export / import', () => {
    it('exporta el borrador si no hay versión publicada, luego la publicada y una versión pedida', async () => {
      const d = await svc.create({ name: 'Compra', key: 'purchase', definition: purchaseDefinition() as any });
      expect(await svc.export(d.id)).toMatchObject({ source: 'draft', version: null });
      await svc.publish(d.id);
      await svc.saveDraft(d.id, { definition: purchaseDefinition({ name: 'Cambiado' }) as any });
      expect(await svc.export(d.id)).toMatchObject({ source: 'published', version: 1 });
      expect((await svc.export(d.id)).definition).toMatchObject({ name: 'Compra' });
      expect(await svc.export(d.id, { version: 1 })).toMatchObject({ source: 'version', version: 1 });
      expect(await codeOf(svc.export(d.id, { version: 7 }))).toBe('WORKFLOW_VERSION_NOT_FOUND');
    });

    it('importa como borrador, valida solo la forma y reporta lo que falta remapear', async () => {
      const def = purchaseDefinition();
      (def.stages[1] as any).assignee = { kind: 'role', role_key: 'rol_de_otra_tienda' };
      const r = await svc.import({ definition: def as any });
      expect(r.definition).toMatchObject({ status: 'draft', key: 'purchase', name: 'Compra' });
      expect(r.validation.structural.valid).toBe(true);
      expect(r.validation.store.errors.map((e) => e.code)).toContain('ROLE_UNKNOWN');
      // importing the same file again does not collide
      const second = await svc.import({ definition: def as any, name: 'Compra copia' });
      expect(second.definition.key).toBe('purchase_2');
      expect(((await svc.getDraft(second.definition.id)).definition as any).key).toBe('purchase_2');
    });

    it('importa un JSON con estructura mala como borrador y lo informa', async () => {
      const r = await svc.import({ definition: { hola: 1 } });
      expect(r.validation.structural.valid).toBe(false);
      expect(r.definition.status).toBe('draft');
      expect(await codeOf(svc.import({ definition: 'texto' as any }))).toBe('WORKFLOW_DRAFT_INVALID');
    });
  });

  describe('list / archive / aislamiento', () => {
    it('pagina, busca y filtra por estado', async () => {
      for (const n of ['Alfa', 'Beta', 'Gamma', 'Delta']) await svc.create({ name: n });
      const p1 = await svc.list({ page: 1, limit: 3 });
      expect(p1).toMatchObject({ total: 4, page: 1, limit: 3 });
      expect(p1.data).toHaveLength(3);
      expect(p1.data[0]).not.toHaveProperty('draft_definition');
      expect((await svc.list({ page: 2, limit: 3 })).data).toHaveLength(1);
      expect((await svc.list({ search: 'gam' })).data.map((d: any) => d.name)).toEqual(['Gamma']);
      await svc.archive(p1.data[0].id);
      expect((await svc.list({ status: 'archived' })).total).toBe(1);
    });

    it('archivar y desarchivar', async () => {
      const d = await svc.create({ name: 'Compra', key: 'purchase', definition: purchaseDefinition() as any });
      expect((await svc.archive(d.id)).status).toBe('archived');
      expect((await svc.unarchive(d.id)).status).toBe('draft');
      await svc.publish(d.id);
      await svc.archive(d.id);
      expect((await svc.unarchive(d.id)).status).toBe('active');
    });

    it('un id de otra tienda es inexistente en todas las operaciones', async () => {
      const other = kit.db.insert('workflow_definitions', {
        organization_id: 1, store_id: 2, key: 'ajeno', name: 'Ajeno', status: 'draft',
        draft_definition: {}, created_by_user_id: 7,
      });
      for (const call of [
        () => svc.get(other.id),
        () => svc.getDraft(other.id),
        () => svc.saveDraft(other.id, { definition: {} }),
        () => svc.validate(other.id),
        () => svc.publish(other.id),
        () => svc.versions(other.id),
        () => svc.export(other.id),
        () => svc.archive(other.id),
      ]) {
        expect(await codeOf(call())).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
      }
      expect((await svc.list()).total).toBe(0);
      // same key in another store does not collide
      expect((await svc.create({ name: 'Ajeno', key: 'ajeno' })).store_id).toBe(1);
    });
  });

  describe('auditoría de definiciones (P7.2)', () => {
    const rows = (action?: string) =>
      kit.db.table('workflow_audit_log').filter((r) => !action || r.action === action);
    const flow = (name = 'Compra') => svc.create({ name, key: 'purchase', definition: purchaseDefinition() as any });

    it('registra crear, publicar, importar y exportar con su resumen en español y el actor', async () => {
      const d = await flow();
      await svc.publish(d.id, { changelog: 'primera' });
      await svc.import({ definition: purchaseDefinition() as any, name: 'Copia' });
      await svc.export(d.id);
      expect(rows().map((r) => r.action)).toEqual([
        'definition.created',
        'definition.published',
        'definition.imported',
        'definition.exported',
      ]);
      expect(rows('definition.created')[0]).toMatchObject({
        summary: 'Creó el flujo «Compra»',
        actor_id: 1,
        definition_id: d.id,
        category: 'definition',
      });
      expect(rows('definition.published')[0]).toMatchObject({ summary: 'Publicó «Compra» v1' });
      expect(rows('definition.published')[0].details).toMatchObject({ version: 1, changelog: 'primera' });
      expect(rows('definition.imported')[0].summary).toBe('Importó «Copia» como borrador');
      expect(rows('definition.exported')[0].summary).toBe('Exportó «Compra» (v1)');
      expect(await kit.prisma.workflow_audit_log.count({ where: { store_id: 1 } })).toBe(4);
    });

    it('republicar sin cambios no deja un registro nuevo', async () => {
      const d = await flow();
      await svc.publish(d.id);
      await svc.publish(d.id);
      expect(rows('definition.published')).toHaveLength(1);
    });

    it('encender, apagar, archivar y desarchivar quedan registrados', async () => {
      const d = await flow();
      await svc.setEnabled(d.id, false);
      await svc.setEnabled(d.id, true);
      await svc.archive(d.id);
      await svc.unarchive(d.id);
      expect(rows().slice(1).map((r) => [r.action, r.summary])).toEqual([
        ['definition.disabled', 'Apagó «Compra»'],
        ['definition.enabled', 'Encendió «Compra»'],
        ['definition.archived', 'Archivó «Compra»'],
        ['definition.unarchived', 'Desarchivó «Compra»'],
      ]);
    });

    it('el autoguardado registra el borrador una vez por persona y flujo cada 10 minutos', async () => {
      const d = await flow();
      const save = (n: number) =>
        svc.saveDraft(d.id, { definition: purchaseDefinition({ description: `v${n}` }) as any });
      await save(1);
      await save(2);
      expect(rows('definition.draft_saved')).toHaveLength(1);
      expect(rows('definition.draft_saved')[0].summary).toBe('Guardó el borrador de «Compra»');
      // another person is recorded on their own
      kit.as({ user_id: 2 });
      await save(3);
      expect(rows('definition.draft_saved').map((r) => r.actor_id)).toEqual([1, 2]);
      // after the window the same person is recorded again
      kit.as({ user_id: 1 });
      rows('definition.draft_saved')[0].created_at = new Date(Date.now() - 11 * 60_000);
      await save(4);
      expect(rows('definition.draft_saved')).toHaveLength(3);
    });

    it('un guardado en conflicto no deja registro', async () => {
      const d = await flow();
      const before = rows().length;
      await fail(svc.saveDraft(d.id, { definition: {} as any, expected_draft_updated_at: new Date(0) }));
      expect(rows()).toHaveLength(before);
    });

    it('si la auditoría no se puede escribir, el cambio no queda hecho', async () => {
      const d = await flow();
      kit.db.rawHandlers.push((text) => {
        if (text.includes('pg_advisory_xact_lock')) throw new Error('down');
        return undefined;
      });
      expect(await fail(svc.setEnabled(d.id, false))).toBeDefined();
      kit.db.rawHandlers.pop();
      expect((await svc.get(d.id)).is_enabled).toBe(true);
    });
  });
});

