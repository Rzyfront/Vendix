import { VendixHttpException } from 'src/common/errors';

import { RequestContextService } from '../../../../common/context/request-context.service';
import { ProfilesService } from './profiles.service';
import { DIAN_PROFILE_TEMPLATES } from './dian-profile-templates';

/**
 * AISLAMIENTO DE TENANT — el spec que la superficie fiscal necesita.
 *
 * Se prueba acá y no con `curl` porque lo que hay que demostrar no es la
 * respuesta, es la CONSULTA: que `store_id` viaja en el `where` de todo lo que
 * corre dentro de la transacción. La prueba en vivo confirma el 404, pero un 404
 * también sale de un id que no existe — no distingue «lo filtré» de «no estaba».
 *
 * El motivo por el que esto merece un spec propio: dentro de `$transaction` el
 * cliente es el BASE, sin extensión de scoping. Si alguien quita el filtro de
 * `assertOwned`, ningún tipo se rompe, ningún test de contrato falla y el
 * `curl` desde una sola tienda sigue verde. Lo único que cambia es que acertar
 * un id ajeno pasa a bastar.
 */
describe('ProfilesService — ancla de tenant', () => {
  const CONFIG = DIAN_PROFILE_TEMPLATES[0].config as unknown as Record<string, unknown>;

  /** Registra cada llamada a un delegado para poder afirmar sobre el `where`. */
  function makeDelegate(result: unknown) {
    return {
      findFirst: jest.fn().mockResolvedValue(result),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(result),
      update: jest.fn().mockResolvedValue(result),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue(result),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
  }

  function makeHarness(opts: { ownedByScope?: boolean } = {}) {
    const owned = opts.ownedByScope !== false;
    const profileRow = {
      id: 7,
      organization_id: 6,
      store_id: 10,
      name: 'Perfil',
      operation_type: '09',
      state: 'active',
      is_default: false,
      current_version: 1,
    };

    // Delegados de DENTRO de la transacción (cliente base, sin scoping).
    const tx = {
      invoice_profiles: makeDelegate(profileRow),
      invoice_profile_versions: makeDelegate({ id: 1, version: 1, config: CONFIG }),
    };
    // `assertOwned` sólo devuelve el perfil si el `where` que salió lleva el
    // `store_id` del ámbito. Así el mock imita a la base en lo único que importa.
    tx.invoice_profiles.findFirst = jest.fn(({ where }: any) =>
      Promise.resolve(owned && where?.store_id === 10 ? profileRow : null),
    );

    // Delegados SCOPEADOS (fuera de la transacción).
    const scoped = {
      invoice_profiles: makeDelegate(profileRow),
      invoice_profile_versions: makeDelegate({ id: 1, version: 1, config: CONFIG }),
      invoices: makeDelegate(null),
    };

    const withoutScope = jest.fn().mockReturnValue({
      $transaction: jest.fn((cb: any) => cb(tx)),
    });

    const prisma = { ...scoped, withoutScope } as any;
    // Doble de la caché del catálogo (C.5): acá sólo importa que no estorbe.
    // `invalidate` se llama tras cada commit y su fallo es best-effort.
    const cache = {
      read: jest.fn().mockResolvedValue(null),
      write: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
    } as any;
    // Doble de la auditoría (C.7). Acá no se afirma sobre ella; su propio spec
    // lo hace. Lo que importa es que ninguna operación dependa de su resultado.
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new ProfilesService(prisma, cache, audit);
    return { service, tx, scoped, withoutScope, prisma };
  }

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 6, store_id: 10, user_id: 162 } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  // ─── El ámbito es obligatorio ─────────────────────────────────────────

  it('sin tienda en el contexto responde 400 STORE_CONTEXT_001, no un 500', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 6 } as any);
    const { service } = makeHarness();

    const error = await service
      .create({ name: 'X', operation_type: '10', config: CONFIG } as any)
      .catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(400);
    expect((error.getResponse() as any).error_code).toBe('STORE_CONTEXT_001');
  });

  it('sin contexto en absoluto tampoco entra a la transacción', async () => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(undefined as any);
    const { service, withoutScope } = makeHarness();

    await expect(
      service.create({ name: 'X', operation_type: '10', config: CONFIG } as any),
    ).rejects.toBeInstanceOf(VendixHttpException);
    expect(withoutScope).not.toHaveBeenCalled();
  });

  // ─── La transacción escribe el ancla a mano ───────────────────────────

  it('create escribe organization_id y store_id del ámbito en la fila', async () => {
    const { service, tx } = makeHarness();

    await service.create({
      name: 'Perfil nuevo',
      operation_type: '10',
      config: CONFIG,
    } as any);

    expect(tx.invoice_profiles.create).toHaveBeenCalledTimes(1);
    const data = tx.invoice_profiles.create.mock.calls[0][0].data;
    expect(data.organization_id).toBe(6);
    expect(data.store_id).toBe(10);
    // El puntero nace en 0 y lo mueve `commitVersion`: nunca apunta a una
    // versión que aún no se escribió.
    expect(data.current_version).toBe(0);
  });

  it('create usa withoutScope().$transaction — no el cliente scopeado', async () => {
    const { service, withoutScope, scoped } = makeHarness();

    await service.create({ name: 'P', operation_type: '10', config: CONFIG } as any);

    expect(withoutScope).toHaveBeenCalledTimes(1);
    expect(scoped.invoice_profiles.create).not.toHaveBeenCalled();
  });

  it('assertOwned filtra por store_id, no sólo por id', async () => {
    const { service, tx } = makeHarness();

    await service.remove(7);

    const where = tx.invoice_profiles.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({ id: 7, store_id: 10 });
  });

  it('un id de otra tienda no borra nada dentro de la transacción', async () => {
    const { service, tx, scoped } = makeHarness({ ownedByScope: false });
    scoped.invoice_profiles.findFirst = jest.fn().mockResolvedValue({ id: 7 });
    scoped.invoices.count = jest.fn().mockResolvedValue(0);

    const error = await service.remove(7).catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(404);
    expect((error.getResponse() as any).error_code).toBe('INVOICING_PROFILE_001');
    // Lo que se prueba de verdad: no llegó a tocar el historial.
    expect(tx.invoice_profile_versions.deleteMany).not.toHaveBeenCalled();
    expect(tx.invoice_profiles.delete).not.toHaveBeenCalled();
  });

  it('el 404 del id ajeno no filtra el store_id en details', async () => {
    const { service, scoped } = makeHarness({ ownedByScope: false });
    scoped.invoice_profiles.findFirst = jest.fn().mockResolvedValue({ id: 7 });
    scoped.invoices.count = jest.fn().mockResolvedValue(0);

    const error = await service.remove(7).catch((e) => e);
    const body = error.getResponse() as any;

    expect(Object.keys(body.details)).toEqual(['profile_id']);
    expect(JSON.stringify(body)).not.toContain('store_id');
  });

  // ─── El listado NO escribe el ancla a mano ────────────────────────────

  it('findAll deja el store_id a la extensión y no lo escribe en el where', async () => {
    const { service, scoped } = makeHarness();

    await service.findAll({ page: 1, limit: 20 } as any);

    const where = scoped.invoice_profiles.findMany.mock.calls[0][0].where;
    // Escribirlo acá colisionaría con `mergeScopedWhere`, que empuja el del
    // ámbito al AND y dejaría un predicado imposible: cero filas sin explicación.
    expect(where).not.toHaveProperty('store_id');
    expect(scoped.invoice_profiles.findMany).toHaveBeenCalledTimes(1);
  });

  it('findAll y count comparten exactamente el mismo where', async () => {
    const { service, scoped } = makeHarness();

    await service.findAll({ page: 2, limit: 5, state: 'active', search: '  AIU ' } as any);

    const findWhere = scoped.invoice_profiles.findMany.mock.calls[0][0].where;
    const countWhere = scoped.invoice_profiles.count.mock.calls[0][0].where;
    // Si divergen, el total pagina sobre una población distinta de la que lista.
    expect(countWhere).toEqual(findWhere);
    expect(findWhere.name).toEqual({ contains: 'AIU', mode: 'insensitive' });
    expect(scoped.invoice_profiles.findMany.mock.calls[0][0].skip).toBe(5);
  });

  // ─── El conteo de facturas también va scopeado ────────────────────────

  it('remove cuenta facturas por el cliente scopeado, no por el base', async () => {
    const { service, scoped, tx } = makeHarness();
    scoped.invoices.count = jest.fn().mockResolvedValue(0);

    await service.remove(7);

    expect(scoped.invoices.count).toHaveBeenCalledWith({ where: { profile_id: 7 } });
    expect(tx.invoice_profiles.delete).toHaveBeenCalled();
  });

  it('con facturas timbradas responde 409 con el conteo y no abre transacción', async () => {
    const { service, scoped, withoutScope } = makeHarness();
    scoped.invoices.count = jest.fn().mockResolvedValue(3);

    const error = await service.remove(7).catch((e) => e);

    expect(error.getStatus()).toBe(409);
    const body = error.getResponse() as any;
    expect(body.error_code).toBe('INVOICING_PROFILE_003');
    expect(body.details).toEqual({ profile_id: 7, invoice_count: 3 });
    expect(body.message).toContain('3 facturas timbradas');
    expect(withoutScope).not.toHaveBeenCalled();
  });

  it('la violación de FK durante el borrado se traduce al mismo 409, no a un 500', async () => {
    const { service, scoped, prisma } = makeHarness();
    // Conteo previo en cero: la factura entra DESPUÉS del conteo, y la base gana.
    scoped.invoices.count = jest
      .fn()
      .mockResolvedValueOnce(0) // comprobación previa
      .mockResolvedValueOnce(1); // reconteo tras el fallo de FK
    prisma.withoutScope = jest.fn().mockReturnValue({
      $transaction: jest.fn().mockRejectedValue(Object.assign(new Error('fk'), { code: 'P2003' })),
    });

    const error = await service.remove(7).catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(409);
    expect((error.getResponse() as any).details).toEqual({
      profile_id: 7,
      invoice_count: 1,
    });
  });

  it('un error que no es de FK sigue subiendo sin disfrazarse de 409', async () => {
    const { service, scoped, prisma } = makeHarness();
    scoped.invoices.count = jest.fn().mockResolvedValue(0);
    const boom = Object.assign(new Error('pool agotado'), { code: 'P2024' });
    prisma.withoutScope = jest.fn().mockReturnValue({
      $transaction: jest.fn().mockRejectedValue(boom),
    });

    await expect(service.remove(7)).rejects.toBe(boom);
  });
});
