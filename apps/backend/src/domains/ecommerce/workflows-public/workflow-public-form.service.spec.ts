import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { VendixHttpException } from '@common/errors';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import {
  buildWorkflowKit,
  publicFormDefinition,
  seedDefinition,
  seedPeople,
} from '../../../testing/workflows/workflow-test-kit';
import { hashPublicToken } from '../../store/workflows/public-link/workflow-public-link.rules';
import { EcommerceWorkflowsPublicController } from './ecommerce-workflows-public.controller';
import { PUBLIC_FORM_MAX_VALUES_BYTES } from './workflow-public-form.service';

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as VendixHttpException).errorCode;
  }
}

describe('WorkflowPublicFormService', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let defId: number;
  let token: string;

  /** A visitor of the store's domain: no user, store resolved from the hostname. */
  const visitor = (store_id = 1) => kit.as({ store_id, user_id: undefined, permissions: [], is_owner: false });
  const body = (extra: Record<string, any> = {}) => ({
    submission_id: randomUUID(),
    values: { asunto: 'Mi moto no enciende', tipo: 'a' },
    contact: { name: 'Carla Pérez', email: 'carla@example.com', phone: '3001234567' },
    accept_privacy: true as const,
    ...extra,
  });
  const instances = () => kit.db.table('workflow_instances');
  const links = () => kit.db.table('workflow_public_links');

  beforeEach(async () => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    kit.db.table('stores').find((s) => s.id === 1)!.name = 'Taller Central';
    defId = seedDefinition(kit.db, publicFormDefinition()).definitionId;
    kit.as({ user_id: 1, permissions: ['store:workflows:design'] });
    token = (await kit.publicLinks.create(defId)).token;
    visitor();
  });
  afterEach(() => jest.restoreAllMocks());

  describe('GET', () => {
    it('devuelve tienda, flujo, campos (sin archivos) y aviso de privacidad', async () => {
      const r = await kit.publicForm.get(token);
      expect(r).toEqual({
        available: true,
        store: { name: 'Taller Central' },
        flow: { name: 'Solicitud de servicio', description: 'Cuéntanos qué necesitas.' },
        privacy_notice: expect.stringContaining('Taller Central'),
        fields: [
          { key: 'asunto', type: 'text', label: 'Asunto', required: true, help: null, options: null, visible_when: null },
          {
            key: 'tipo', type: 'select', label: 'Tipo', required: false, help: null, visible_when: null,
            options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
          },
        ],
      });
    });

    it('404 si el token no existe, es de otra tienda (otro dominio), está inactivo, vencido o el flujo no está activo', async () => {
      expect(await codeOf(kit.publicForm.get('x'.repeat(43)))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
      expect(await codeOf(kit.publicForm.get('corto'))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
      visitor(2);
      expect(await codeOf(kit.publicForm.get(token))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
      visitor(1);
      links()[0].expires_at = new Date(Date.now() - 1000);
      expect(await codeOf(kit.publicForm.get(token))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
      links()[0].expires_at = new Date(Date.now() + 60_000);
      expect(await kit.publicForm.get(token)).toMatchObject({ available: true });
      kit.db.table('workflow_definitions')[0].status = 'archived';
      expect(await codeOf(kit.publicForm.get(token))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
      kit.db.table('workflow_definitions')[0].status = 'active';
      links()[0].is_active = false;
      expect(await codeOf(kit.publicForm.get(token))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
    });

    it('sin tienda resuelta por el dominio responde 404', async () => {
      kit.as({ store_id: undefined });
      expect(await codeOf(kit.publicForm.get(token))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
    });

    it('un archivo obligatorio en el formulario inicial: available=false con motivo y sin campos', async () => {
      const def = publicFormDefinition();
      def.fields[2].required = true;
      kit.db.table('workflow_versions')[0].definition = def;
      const r = await kit.publicForm.get(token);
      expect(r).toMatchObject({ available: false, reason: 'required_file_field', fields: [] });
      expect((r as any).message).toMatch(/archivo/);
      expect(await codeOf(kit.publicForm.submit(token, body()))).toBe('WORKFLOW_PUBLIC_LINK_UNAVAILABLE');
      expect(instances()).toHaveLength(0);
    });
  });

  describe('POST', () => {
    it('inicia como actor public y aterriza en la etapa siguiente con su tarea, expediente y eventos', async () => {
      const r = await kit.publicForm.submit(token, body());
      expect(r).toEqual({ reference: 'FLU-000001' });
      expect(instances()).toHaveLength(1);
      const inst = instances()[0];
      expect(inst).toMatchObject({
        started_by_type: 'public', started_by_id: null, current_stage_key: 'revision', status: 'active',
        title: 'Solicitud de servicio · Carla Pérez', data: { asunto: 'Mi moto no enciende', tipo: 'a' },
      });
      const events = kit.db.table('workflow_instance_events').filter((e) => e.instance_id === inst.id);
      expect(events.map((e) => [e.type, e.actor_type, e.actor_id])).toEqual([
        ['started', 'public', null],
        ['submitted', 'public', null],
      ]);
      expect(events[0].payload).toMatchObject({
        via: 'public_form',
        contact: { name: 'Carla Pérez', email: 'carla@example.com', phone: '3001234567' },
      });
      expect(events[1]).toMatchObject({ from_stage_key: 'formulario', to_stage_key: 'revision' });
      const tasks = kit.db.table('workflow_tasks').filter((t) => t.instance_id === inst.id);
      expect(tasks).toHaveLength(1); // only the review task: the public start form never gets one
      expect(tasks[0]).toMatchObject({ stage_key: 'revision', status: 'open', assignee_role_id: 2 });
      expect(kit.db.table('dossiers')).toHaveLength(1);
      expect(links()[0].last_used_at).toBeInstanceOf(Date);
      expect(kit.db.table('workflow_outbox').some((o) => o.kind === 'notify')).toBe(true);
    });

    it('es idempotente por submission_id; otro submission_id crea otra solicitud', async () => {
      const payload = body();
      const a = await kit.publicForm.submit(token, payload);
      const again = await kit.publicForm.submit(token, { ...payload, values: { asunto: 'cambiado' } });
      expect(again).toEqual(a);
      expect(instances()).toHaveLength(1);
      const other = await kit.publicForm.submit(token, body());
      expect(other.reference).toBe('FLU-000002');
      expect(instances()).toHaveLength(2);
      // the key is sha256(token + submission): a different link never collides
      expect(kit.db.table('workflow_instance_events')[0].idempotency_key).toHaveLength(64);
    });

    it('valida el formulario: errores por campo y nada queda creado', async () => {
      await expect(kit.publicForm.submit(token, body({ values: { tipo: 'a' } }))).rejects.toMatchObject({
        errorCode: 'WORKFLOW_FORM_INVALID',
        response: { details: { errors: [expect.objectContaining({ field: 'asunto' })] } },
      });
      expect(instances()).toHaveLength(0);
      expect(kit.db.table('dossiers')).toHaveLength(0);
      expect(kit.db.table('workflow_outbox')).toHaveLength(0);
    });

    it('ignora valores de campos de archivo (la carga pública está fuera de alcance)', async () => {
      await kit.publicForm.submit(token, body({ values: { asunto: 'x', adjunto: 123 } }));
      expect(instances()[0].data).toEqual({ asunto: 'x' });
    });

    it('exige aceptar la privacidad y limita el tamaño', async () => {
      expect(await codeOf(kit.publicForm.submit(token, body({ accept_privacy: false })))).toBe('WORKFLOW_PUBLIC_CONSENT_REQUIRED');
      const big = { asunto: 'x'.repeat(PUBLIC_FORM_MAX_VALUES_BYTES + 1) };
      expect(await codeOf(kit.publicForm.submit(token, body({ values: big })))).toBe('WORKFLOW_PUBLIC_PAYLOAD_TOO_LARGE');
      expect(instances()).toHaveLength(0);
    });

    it('enlace vencido, revocado, rotado o de otra tienda → 404 sin crear nada', async () => {
      visitor(2);
      expect(await codeOf(kit.publicForm.submit(token, body()))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
      visitor(1);
      kit.as({ user_id: 1, permissions: [] });
      const rotated = (await kit.publicLinks.create(defId)).token;
      visitor();
      expect(await codeOf(kit.publicForm.submit(token, body()))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
      links()[1].expires_at = new Date(Date.now() - 1);
      expect(await codeOf(kit.publicForm.submit(rotated, body()))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
      expect(instances()).toHaveLength(0);
    });

    it('el motor revalida el enlace: sin un enlace activo del flujo no inicia nada', async () => {
      const link = links()[0];
      await expect(
        kit.engine.startPublic({
          linkId: link.id + 99, definitionId: defId, values: { asunto: 'x' }, contact: { name: 'x' }, idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ errorCode: 'WORKFLOW_PUBLIC_NOT_FOUND' });
      link.is_active = false;
      await expect(
        kit.engine.startPublic({
          linkId: link.id, definitionId: defId, values: { asunto: 'x' }, contact: { name: 'x' }, idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ errorCode: 'WORKFLOW_PUBLIC_NOT_FOUND' });
      expect(instances()).toHaveLength(0);
    });

    it('la vía autenticada sigue igual: iniciar con usuario no usa el enlace público', async () => {
      kit.as({ user_id: 4, permissions: [], store_id: 1 });
      const s = await kit.engine.start({ definitionKey: 'pqr', idempotencyKey: 'auth' });
      expect(s.instance).toMatchObject({ started_by_type: 'user', started_by_id: 4, current_stage_key: 'formulario' });
    });
  });

  it('solo se guarda el hash del token', () => {
    expect(links()[0].token_hash).toBe(hashPublicToken(token));
    expect(JSON.stringify(kit.db.tables)).not.toContain(token);
  });

  describe('controlador', () => {
    const C = EcommerceWorkflowsPublicController;
    it('es público, bajo /ecommerce/ (la tienda sale del dominio) y con throttle por IP', () => {
      expect(Reflect.getMetadata('path', C)).toBe('ecommerce/workflows/forms');
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, C)).toBe(true);
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', C.prototype.submit)).toBe(10);
      expect(Reflect.getMetadata('THROTTLER:TTLdefault', C.prototype.submit)).toBe(60_000);
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', C.prototype.get)).toBe(60);
    });
  });
});
