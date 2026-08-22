import { RequestContextService } from '../../../../common/context/request-context.service';
import { ProfilesService } from './profiles.service';
import { DIAN_PROFILE_TEMPLATES } from './dian-profile-templates';

/**
 * AUDITORÍA DE LAS SIETE ACCIONES — lo que el `curl` no puede fijar.
 *
 * En vivo ya está medido: siete acciones producen siete filas, dos no-ops no
 * producen ninguna, y el diff es mínimo y legible. Lo que un spec añade es la
 * defensa contra los tres cambios que no ponen nada rojo:
 *
 * 1. **Que el `config` se cuele en `audit_logs`.** Basta con que alguien pase la
 *    fila entera en vez de la proyección, o que amplíe `AUDITED_COLUMNS`. La
 *    consecuencia no es un error: es una segunda copia de la configuración
 *    fiscal, con su propia posibilidad de divergir de `invoice_profile_versions`,
 *    que es la fuente. Acá se afirma que ninguna llamada la lleva.
 * 2. **Que se pierda el `storeId`.** `AuditService` resuelve `organization_id`
 *    del contexto solo, pero no el `store_id`: una fila sin él queda escrita y
 *    es invisible para el índice `(store_id, created_at)` con el que se consulta
 *    la auditoría de una tienda.
 * 3. **Que la auditoría pase a poder tumbar la operación.** Es best-effort a
 *    propósito. Un cambio de configuración no puede perderse porque su registro
 *    falló.
 */
describe('ProfilesService — auditoría de las 7 acciones', () => {
  const CONFIG = DIAN_PROFILE_TEMPLATES[0].config as unknown as Record<string, unknown>;
  const OP = DIAN_PROFILE_TEMPLATES[0].operation_type;

  function makeHarness(
    overrides: Partial<{
      state: string;
      is_default: boolean;
      current_version: number;
      auditThrows: boolean;
    }> = {},
  ) {
    const row = {
      id: 7,
      organization_id: 6,
      store_id: 10,
      name: 'Perfil',
      operation_type: OP,
      state: overrides.state ?? 'active',
      is_default: overrides.is_default ?? false,
      current_version: overrides.current_version ?? 1,
      cloned_from_profile_id: null,
      cloned_from_version: null,
    };

    const versions = {
      findFirst: jest.fn().mockResolvedValue({ id: 1, version: 1, config: CONFIG }),
      create: jest.fn().mockResolvedValue({ id: 1, version: 1, config: CONFIG }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    };

    // El `update` devuelve la fila con lo que se le pidió cambiar, para que el
    // diff que calcula el servicio sea el real y no uno fijo del mock.
    const applyUpdate = jest.fn(({ data }: any) =>
      Promise.resolve({ ...row, ...data, current_version: data.current_version ?? row.current_version }),
    );

    const profiles = {
      findFirst: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(row),
      update: applyUpdate,
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue(row),
    };

    const tx = { invoice_profiles: profiles, invoice_profile_versions: versions };
    const prisma = {
      invoice_profiles: profiles,
      invoice_profile_versions: versions,
      invoices: { count: jest.fn().mockResolvedValue(0) },
      withoutScope: jest.fn().mockReturnValue({ $transaction: jest.fn((cb: any) => cb(tx)) }),
    } as any;

    const cache = {
      read: jest.fn().mockResolvedValue(null),
      write: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
    } as any;

    const logged: any[] = [];
    const audit = {
      log: jest.fn((data: any) => {
        logged.push(data);
        // `AuditService.log` atrapa su propio error, pero un doble que rechaza
        // prueba lo que pasaría si alguien quitara ese catch.
        return overrides.auditThrows
          ? Promise.reject(new Error('audit_logs no acepta escrituras'))
          : Promise.resolve();
      }),
    } as any;

    return { service: new ProfilesService(prisma, cache, audit), logged, audit, tx, row };
  }

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 6, store_id: 10, user_id: 162 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  // ─── Una fila por acción, con la acción correcta ───────────────────────

  it('create escribe CREATE', async () => {
    const { service, logged } = makeHarness();
    await service.create({ name: 'X', operation_type: OP, config: CONFIG } as any);
    expect(logged.map((l) => l.action)).toEqual(['CREATE']);
    expect(logged[0].resource).toBe('invoice_profiles');
    expect(logged[0].oldValues).toBeUndefined();
  });

  it('update escribe UPDATE con el diff mínimo, no el estado completo', async () => {
    const { service, logged } = makeHarness();
    await service.update(7, { name: 'Nuevo nombre' } as any);

    expect(logged.map((l) => l.action)).toEqual(['UPDATE']);
    // Sólo `name`: incluir lo que no cambió obliga al lector a comparar a mano
    // lo que la fila ya podría decir.
    expect(Object.keys(logged[0].newValues)).toEqual(['name']);
    expect(logged[0].oldValues).toEqual({ name: 'Perfil' });
    expect(logged[0].newValues).toEqual({ name: 'Nuevo nombre' });
  });

  it('un update que no cambia ninguna columna NO escribe fila', async () => {
    const { service, logged } = makeHarness();
    await service.update(7, { name: 'Perfil' } as any);
    expect(logged).toHaveLength(0);
  });

  it('un update de config se marca con config_changed y las dos versiones a comparar', async () => {
    const { service, logged } = makeHarness();
    await service.update(7, { config: CONFIG } as any);

    expect(logged[0].action).toBe('UPDATE');
    expect(logged[0].metadata.config_changed).toBe(true);
    expect(logged[0].metadata.version_from).toBe(1);
    expect(logged[0].metadata.version_to).toBe(2);
  });

  it('clone escribe CLONE —no CREATE— con la procedencia', async () => {
    const { service, logged } = makeHarness();
    await service.clone(7, { name: 'Copia' } as any);

    // Distinguirlo de CREATE es el punto: quien audita necesita separar
    // «alguien configuró esto» de «alguien copió una configuración vigente».
    expect(logged[0].action).toBe('CLONE');
    expect(logged[0].metadata.source_profile_id).toBe(7);
    expect(logged[0].metadata.source_version).toBe(1);
  });

  it('setDefault escribe SET_DEFAULT nombrando el perfil que perdió la marca', async () => {
    const { service, logged, tx } = makeHarness({ is_default: false });
    // El default vigente es otro perfil (el 8).
    tx.invoice_profiles.findFirst = jest.fn(({ where }: any) =>
      Promise.resolve(
        where?.is_default === true
          ? { id: 8 }
          : { id: 7, store_id: 10, operation_type: OP, state: 'active', is_default: false, current_version: 1 },
      ),
    );
    await service.setDefault(7);

    const entry = logged.find((l) => l.action === 'SET_DEFAULT');
    expect(entry).toBeDefined();
    // Una sola fila para el traspaso: dos harían que una decisión se leyera
    // como dos.
    expect(logged).toHaveLength(1);
    expect(entry.oldValues).toEqual({ is_default: false });
    expect(entry.newValues).toEqual({ is_default: true });
  });

  it('deactivate escribe DEACTIVATE y registra el arrastre del predeterminado', async () => {
    const { service, logged } = makeHarness({ state: 'active', is_default: true });
    await service.deactivate(7);

    expect(logged[0].action).toBe('DEACTIVATE');
    expect(logged[0].oldValues).toEqual({ state: 'active', is_default: true });
    expect(logged[0].newValues).toEqual({ state: 'inactive', is_default: false });
    expect(logged[0].metadata.default_dropped).toBe(true);
  });

  it('activate escribe ACTIVATE y NO toca is_default', async () => {
    const { service, logged } = makeHarness({ state: 'inactive' });
    await service.activate(7);

    expect(logged[0].action).toBe('ACTIVATE');
    expect(logged[0].newValues).toEqual({ state: 'active' });
    expect(logged[0].newValues).not.toHaveProperty('is_default');
  });

  it('activar uno ya activo no escribe fila', async () => {
    const { service, logged } = makeHarness({ state: 'active' });
    await service.activate(7);
    expect(logged).toHaveLength(0);
  });

  it('remove escribe DELETE con el estado PREVIO —después del borrado no hay nada que leer', async () => {
    const { service, logged } = makeHarness();
    await service.remove(7);

    expect(logged[0].action).toBe('DELETE');
    expect(logged[0].oldValues.name).toBe('Perfil');
    expect(logged[0].newValues).toBeUndefined();
  });

  // ─── El config no se copia ─────────────────────────────────────────────

  it.each([
    ['create', (s: ProfilesService) => s.create({ name: 'X', operation_type: OP, config: CONFIG } as any)],
    ['update', (s: ProfilesService) => s.update(7, { config: CONFIG } as any)],
    ['clone', (s: ProfilesService) => s.clone(7, { name: 'Copia' } as any)],
    ['remove', (s: ProfilesService) => s.remove(7)],
  ])('%s NUNCA mete el config en la auditoría', async (_label, run) => {
    const { service, logged } = makeHarness();
    await run(service);

    const serialized = JSON.stringify(logged);
    expect(serialized).not.toContain('config_version');
    expect(serialized).not.toContain('"aiu"');
    for (const entry of logged) {
      expect(entry.oldValues ?? {}).not.toHaveProperty('config');
      expect(entry.newValues ?? {}).not.toHaveProperty('config');
    }
  });

  // ─── El tenant ─────────────────────────────────────────────────────────

  it('toda fila lleva storeId, organizationId y userId', async () => {
    const { service, logged } = makeHarness();
    await service.create({ name: 'X', operation_type: OP, config: CONFIG } as any);

    // Sin `storeId` la fila queda escrita y el índice (store_id, created_at)
    // con el que se consulta la auditoría de una tienda no la encuentra.
    expect(logged[0].storeId).toBe(10);
    expect(logged[0].organizationId).toBe(6);
    expect(logged[0].userId).toBe(162);
  });

  it('el resource_id es el perfil, no el usuario ni la versión', async () => {
    const { service, logged } = makeHarness();
    await service.update(7, { name: 'Otro' } as any);
    expect(logged[0].resourceId).toBe(7);
  });

  // ─── Best-effort ───────────────────────────────────────────────────────

  it('si la auditoría falla, la operación NO falla', async () => {
    const { service } = makeHarness({ auditThrows: true });
    // El cambio ya está commiteado cuando se audita: propagar el error
    // devolvería un 500 al usuario por algo que sí se guardó.
    await expect(
      service.create({ name: 'X', operation_type: OP, config: CONFIG } as any),
    ).resolves.toBeDefined();
  });

  it('si la auditoría falla en un borrado, el borrado sigue confirmado', async () => {
    const { service } = makeHarness({ auditThrows: true });
    await expect(service.remove(7)).resolves.toEqual({ deleted: true, id: 7 });
  });
});
