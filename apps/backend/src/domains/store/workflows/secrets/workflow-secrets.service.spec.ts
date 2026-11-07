import { ErrorCodes } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { FakeWorkflowDb } from '../../../../testing/workflows/fake-workflow-prisma';
import { WorkflowSecretsService } from './workflow-secrets.service';

const encryption = {
  encrypt: (v: string) => `enc(${Buffer.from(v).toString('base64')})`,
  decrypt: (v: string) => Buffer.from(v.slice(4, -1), 'base64').toString(),
};

const as = <T>(store_id: number, fn: () => Promise<T>) =>
  RequestContextService.runIsolated(
    {
      store_id,
      organization_id: 1,
      user_id: 7,
      is_super_admin: false,
      is_owner: false,
    },
    fn,
  );

describe('WorkflowSecretsService', () => {
  let db: FakeWorkflowDb;
  let secrets: WorkflowSecretsService;

  beforeEach(() => {
    db = new FakeWorkflowDb();
    secrets = new WorkflowSecretsService(db.asStorePrisma(), encryption as never);
  });

  const publishUsing = (storeId: number, key: string, text: string, status = 'active') => {
    const def = db.insert('workflow_definitions', {
      organization_id: 1,
      store_id: storeId,
      key,
      name: `Flujo ${key}`,
      status,
    });
    const v = db.insert('workflow_versions', {
      store_id: storeId,
      definition_id: def.id,
      version: 1,
      definition: { stages: [{ on_enter: [{ map: { headers: text } }] }] },
    });
    def.published_version_id = v.id;
  };

  it('crea sin devolver el valor, lo guarda cifrado y la lista solo trae nombres', async () => {
    const created = await as(1, () =>
      secrets.create({ name: 'CRM_TOKEN', value: 'tok_abc', description: 'CRM' }),
    );
    expect(created).toMatchObject({ name: 'CRM_TOKEN', description: 'CRM' });
    expect(JSON.stringify(created)).not.toContain('tok_abc');
    expect(JSON.stringify(created)).not.toContain('value_enc');
    expect(db.table('workflow_secrets')[0].value_enc).toBe(encryption.encrypt('tok_abc'));

    const list = await as(1, () => secrets.list());
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toMatch(/tok_abc|enc\(|value/);
  });

  it('un nombre repetido en la tienda responde 409', async () => {
    await as(1, () => secrets.create({ name: 'A', value: 'x' }));
    // The fake has no unique index: emulate the one of the table.
    const spy = jest
      .spyOn(db.asStorePrisma().workflow_secrets, 'create')
      .mockRejectedValue({ code: 'P2002' });
    secrets = new WorkflowSecretsService(
      { workflow_secrets: { create: spy } } as never,
      encryption as never,
    );
    await expect(as(1, () => secrets.create({ name: 'A', value: 'y' }))).rejects.toMatchObject({
      errorCode: ErrorCodes.WORKFLOW_SECRET_DUPLICATE.code,
      response: { error_code: 'WORKFLOW_SECRET_DUPLICATE' },
    });
  });

  it('reemplaza valor y descripción; un id de otra tienda es 404', async () => {
    const mine = await as(1, () => secrets.create({ name: 'A', value: 'old' }));
    const updated = await as(1, () => secrets.replace(mine.id, { value: 'new', description: 'd' }));
    expect(updated).toMatchObject({ name: 'A', description: 'd' });
    expect(db.table('workflow_secrets')[0].value_enc).toBe(encryption.encrypt('new'));
    await expect(as(2, () => secrets.replace(mine.id, { value: 'hack' }))).rejects.toMatchObject({
      errorCode: 'WORKFLOW_SECRET_NOT_FOUND',
    });
    await expect(as(2, () => secrets.remove(mine.id))).rejects.toMatchObject({
      errorCode: 'WORKFLOW_SECRET_NOT_FOUND',
    });
    expect(db.table('workflow_secrets')).toHaveLength(1);
    expect(await as(2, () => secrets.list())).toEqual([]);
  });

  it('borra de verdad si ningún flujo publicado lo usa', async () => {
    const s = await as(1, () => secrets.create({ name: 'FREE', value: 'x' }));
    await as(1, () => secrets.remove(s.id));
    expect(db.table('workflow_secrets')).toHaveLength(0);
  });

  it('no borra un secreto usado por un flujo publicado activo y lista los flujos (409)', async () => {
    const s = await as(1, () => secrets.create({ name: 'CRM_TOKEN', value: 'x' }));
    publishUsing(1, 'crm', 'Authorization: Bearer {{ secrets.CRM_TOKEN }}');
    publishUsing(1, 'otro', 'X: {{secrets.OTHER}}');
    publishUsing(1, 'apagado', 'X: {{secrets.CRM_TOKEN}}', 'archived');
    const e = await as(1, () => secrets.remove(s.id)).catch((x) => x);
    expect(e.errorCode).toBe('WORKFLOW_SECRET_IN_USE');
    expect(e.getStatus()).toBe(409);
    expect(e.response.details.flows).toEqual([{ key: 'crm', name: 'Flujo crm' }]);
    expect(db.table('workflow_secrets')).toHaveLength(1);
  });

  it('resolveMany descifra solo los pedidos de esa tienda y marca last_used_at', async () => {
    await as(1, () => secrets.create({ name: 'A', value: 'va' }));
    await as(1, () => secrets.create({ name: 'B', value: 'vb' }));
    await as(2, () => secrets.create({ name: 'A', value: 'otra-tienda' }));
    const got = await as(1, () => secrets.resolveMany(1, ['A', 'ZZZ']));
    expect([...got.entries()]).toEqual([['A', 'va']]);
    const rows = db.table('workflow_secrets');
    expect(rows.find((r) => r.store_id === 1 && r.name === 'A')!.last_used_at).toBeInstanceOf(Date);
    expect(rows.find((r) => r.store_id === 1 && r.name === 'B')!.last_used_at ?? null).toBeNull();
    expect(rows.find((r) => r.store_id === 2)!.last_used_at ?? null).toBeNull();
  });
});
