import { VendixHttpException } from 'src/common/errors';

import { RequestContextService } from '../../../../common/context/request-context.service';
import { ProfilesService } from './profiles.service';
import { DIAN_PROFILE_TEMPLATES } from './dian-profile-templates';

/**
 * UNICIDAD DEL NOMBRE — la forma que toma la idempotencia de la creación.
 *
 * En vivo ya está probado que seis POST idénticos en paralelo dejan una sola
 * fila. Lo que el `curl` no puede demostrar es POR QUÉ pasa lo correcto, y ahí
 * están los dos mecanismos que se rompen sin que nada se ponga rojo:
 *
 * 1. **Qué único se violó no se deduce del error, se pregunta a la base.** El
 *    índice de nombre es sobre una EXPRESIÓN (`lower(name)`), que no existe en
 *    el esquema de Prisma: lo que `meta.target` reporte ahí no está garantizado
 *    entre versiones. Si alguien "optimiza" `uniqueConflict` para leer
 *    `meta.target`, el día que el formato cambie el usuario recibirá «otro
 *    perfil quedó como predeterminado» cuando lo que pasó es que el nombre
 *    estaba tomado. Acá se le pasa un `meta.target` que MIENTE y se afirma que
 *    la respuesta sigue siendo la correcta.
 *
 * 2. **La comparación no puede usar `mode: 'insensitive'`.** Prisma lo traduce a
 *    `ILIKE`, e `ILIKE` interpreta `%` y `_` como comodines: un perfil llamado
 *    `"AIU%"` daría por tomado cualquier nombre que empiece por `AIU`.
 */
describe('ProfilesService — unicidad del nombre por tienda', () => {
  const CONFIG = DIAN_PROFILE_TEMPLATES[0].config as unknown as Record<string, unknown>;
  const OP = DIAN_PROFILE_TEMPLATES[0].operation_type;

  const P2002 = (target?: unknown) =>
    Object.assign(new Error('unique'), { code: 'P2002', meta: { target } });

  /**
   * `existing` es lo que la tienda ya tiene. El harness imita el único
   * comportamiento que importa: `findMany` devuelve esas filas —filtradas por el
   * `where` que el servicio realmente envía— y el `create` puede configurarse
   * para fallar con P2002.
   */
  function makeHarness(
    existing: Array<{ id: number; name: string }>,
    opts: { createThrows?: unknown; foreignClones?: number } = {},
  ) {
    const row = {
      id: 7,
      organization_id: 6,
      store_id: 10,
      name: 'Perfil',
      operation_type: OP,
      state: 'active',
      is_default: false,
      current_version: 1,
    };

    const findManyCalls: any[] = [];
    const listing = jest.fn((args: any) => {
      findManyCalls.push(args);
      const excluded = args?.where?.id?.not;
      return Promise.resolve(
        excluded === undefined ? existing : existing.filter((r) => r.id !== excluded),
      );
    });

    const versions = {
      findFirst: jest.fn().mockResolvedValue({ id: 1, version: 1, config: CONFIG }),
      create: jest.fn().mockResolvedValue({ id: 1, version: 1, config: CONFIG }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    };

    const txUpdateMany: any[] = [];
    const tx = {
      invoice_profiles: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(where?.store_id === 10 || where?.id ? row : null),
        ),
        findMany: listing,
        count: jest.fn().mockResolvedValue(opts.foreignClones ?? 0),
        create: opts.createThrows
          ? jest.fn().mockRejectedValue(opts.createThrows)
          : jest.fn().mockResolvedValue(row),
        update: opts.createThrows
          ? jest.fn().mockRejectedValue(opts.createThrows)
          : jest.fn().mockResolvedValue(row),
        updateMany: jest.fn((args: any) => {
          txUpdateMany.push(args);
          return Promise.resolve({ count: 0 });
        }),
        delete: jest.fn().mockResolvedValue(row),
      },
      invoice_profile_versions: versions,
    };

    const scoped = {
      invoice_profiles: {
        findFirst: jest.fn().mockResolvedValue(row),
        findMany: listing,
        count: jest.fn().mockResolvedValue(0),
      },
      invoice_profile_versions: versions,
      invoices: { count: jest.fn().mockResolvedValue(0) },
    };

    const transaction = jest.fn((cb: any) => cb(tx));
    const prisma = {
      ...scoped,
      withoutScope: jest.fn().mockReturnValue({ $transaction: transaction }),
    } as any;

    const cache = {
      read: jest.fn().mockResolvedValue(null),
      write: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Doble de la auditoría (C.7). Acá no se afirma sobre ella; su propio spec
    // lo hace. Lo que importa es que ninguna operación dependa de su resultado.
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;

    return {
      service: new ProfilesService(prisma, cache, audit, {
        assertAccountsUsable: jest.fn().mockResolvedValue(undefined),
      } as any),
      tx,
      transaction,
      findManyCalls,
      txUpdateMany,
    };
  }

  const create = (service: ProfilesService, name: string) =>
    service.create({ name, operation_type: OP, config: CONFIG } as any);

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 6, store_id: 10, user_id: 162 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  // ─── El precheck ──────────────────────────────────────────────────────

  it('un nombre tomado responde 409 INVOICING_PROFILE_004 SIN abrir transacción', async () => {
    const { service, transaction } = makeHarness([{ id: 42, name: 'AIU obras' }]);

    const error = await create(service, 'AIU obras').catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(409);
    expect((error.getResponse() as any).error_code).toBe('INVOICING_PROFILE_004');
    // Si abriera la transacción, el INSERT fallaría igual por el índice, pero
    // habría consumido una conexión del pool para averiguar lo que ya sabía.
    expect(transaction).not.toHaveBeenCalled();
  });

  it('el 409 lleva el id del perfil existente: es lo que separa el doble clic del choque real', async () => {
    const { service } = makeHarness([{ id: 42, name: 'AIU obras' }]);
    const error = await create(service, 'AIU obras').catch((e) => e);
    expect((error.getResponse() as any).details.existing_profile_id).toBe(42);
  });

  it('el mensaje nombra el perfil EXISTENTE, no lo que el usuario escribió', async () => {
    const { service } = makeHarness([{ id: 42, name: 'AIU Obras' }]);
    const error = await create(service, 'aiu obras').catch((e) => e);

    // Mostrar «aiu obras» mandaría al usuario a buscar en la lista una cadena
    // que no está en pantalla.
    expect(error.message).toContain('AIU Obras');
    expect(error.message).not.toContain('aiu obras');
    expect((error.getResponse() as any).details.attempted_name).toBe('aiu obras');
  });

  it.each([
    ['la caja', 'AIU OBRAS'],
    ['espacios al principio y al final', '  AIU obras  '],
    ['espacios internos dobles', 'AIU  obras'],
    ['un tabulador', 'AIU\tobras'],
    ['un salto de línea pegado desde una hoja de cálculo', 'AIU\nobras'],
  ])('%s no crea un segundo perfil', async (_label, attempt) => {
    const { service, transaction } = makeHarness([{ id: 42, name: 'AIU obras' }]);
    const error = await create(service, attempt).catch((e) => e);
    expect((error.getResponse() as any).error_code).toBe('INVOICING_PROFILE_004');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('un nombre libre sí crea', async () => {
    const { service, transaction } = makeHarness([{ id: 42, name: 'AIU obras' }]);
    await expect(create(service, 'Otro nombre')).resolves.toBeDefined();
    expect(transaction).toHaveBeenCalled();
  });

  // ─── La comparación ───────────────────────────────────────────────────

  it('NO usa mode: insensitive — el where que sale no lo lleva', async () => {
    const { service, findManyCalls } = makeHarness([]);
    await create(service, 'Cualquiera');

    const serialized = JSON.stringify(findManyCalls);
    expect(serialized).not.toContain('insensitive');
    expect(serialized).not.toContain('"contains"');
  });

  it('un nombre existente con % no da por tomado todo lo que empiece igual', async () => {
    // Con `ILIKE` este `create` habría respondido 409: '%' es comodín.
    const { service } = makeHarness([{ id: 42, name: 'AIU%' }]);
    await expect(create(service, 'AIU obras')).resolves.toBeDefined();
  });

  it('un nombre existente con _ tampoco', async () => {
    const { service } = makeHarness([{ id: 42, name: 'AI_' }]);
    await expect(create(service, 'AIU')).resolves.toBeDefined();
  });

  // ─── La carrera: el árbitro es el índice ──────────────────────────────

  it('un P2002 con el nombre ya presente se traduce a 004, no a la carrera de predeterminado', async () => {
    // La carrera real: el precheck vio la tabla sin el nombre —el rival aún no
    // había commiteado— y el INSERT chocó contra el índice. Al volver a
    // preguntar, el nombre ya está, y ese es el hecho que hay que reportar.
    const { service, transaction } = makeHarness([{ id: 99, name: 'AIU obras' }], {
      createThrows: P2002(['id']),
    });
    // El precheck ve el nombre y ni abre la transacción; para ejercitar la rama
    // del índice hay que entrar con un nombre que el precheck deja pasar y que
    // el `create` rechaza.
    const error = await create(service, 'Nombre que el rival acaba de tomar').catch((e) => e);
    expect(transaction).toHaveBeenCalled();
    expect((error.getResponse() as any).error_code).toBe('INVOICING_PROFILE_002');

    // Y con el nombre efectivamente presente, el mismo P2002 da 004.
    const second = makeHarness([{ id: 99, name: 'AIU obras' }], {
      createThrows: P2002(['id']),
    });
    const conflict = await create(second.service, 'AIU obras').catch((e) => e);
    expect((conflict.getResponse() as any).error_code).toBe('INVOICING_PROFILE_004');
  });

  it('un P2002 cuyo meta.target MIENTE igual se resuelve mirando la base', async () => {
    // `meta.target` apunta al índice de predeterminados; el nombre existe. Si la
    // traducción leyera el error en vez de consultar, respondería el 409
    // equivocado y el usuario buscaría un problema que no tiene.
    const { service } = makeHarness([{ id: 99, name: 'AIU obras' }], {
      createThrows: P2002(['store_id', 'operation_type']),
    });
    const error = await create(service, 'AIU obras').catch((e) => e);
    expect((error.getResponse() as any).error_code).toBe('INVOICING_PROFILE_004');
  });

  it('un P2002 SIN nombre coincidente es la carrera de predeterminado (002)', async () => {
    const { service } = makeHarness([], { createThrows: P2002(undefined) });
    const error = await create(service, 'AIU obras').catch((e) => e);
    expect((error.getResponse() as any).error_code).toBe('INVOICING_PROFILE_002');
  });

  it('un error que no es P2002 se re-lanza tal cual', async () => {
    const boom = new Error('la base se cayó');
    const { service } = makeHarness([], { createThrows: boom });
    await expect(create(service, 'AIU obras')).rejects.toBe(boom);
  });

  // ─── Renombrar ────────────────────────────────────────────────────────

  it('renombrar al propio nombre NO es conflicto consigo mismo', async () => {
    const { service } = makeHarness([{ id: 7, name: 'Perfil' }]);
    await expect(service.update(7, { name: 'Perfil' } as any)).resolves.toBeDefined();
  });

  it('renombrar al propio nombre con otra caja tampoco', async () => {
    const { service } = makeHarness([{ id: 7, name: 'Perfil' }]);
    await expect(service.update(7, { name: '  PERFIL  ' } as any)).resolves.toBeDefined();
  });

  it('renombrar al nombre de OTRO perfil responde 004 con el id de ese otro', async () => {
    const { service } = makeHarness([
      { id: 7, name: 'Perfil' },
      { id: 8, name: 'Ocupado' },
    ]);
    const error = await service.update(7, { name: 'Ocupado' } as any).catch((e) => e);
    expect((error.getResponse() as any).error_code).toBe('INVOICING_PROFILE_004');
    expect((error.getResponse() as any).details.existing_profile_id).toBe(8);
  });

  it('la exclusión del propio id viaja en el where, no se filtra después', async () => {
    const { service, findManyCalls } = makeHarness([{ id: 7, name: 'Perfil' }]);
    await service.update(7, { name: 'Nuevo' } as any);
    expect(findManyCalls[0].where).toEqual({ id: { not: 7 } });
  });

  // ─── Clonar ───────────────────────────────────────────────────────────

  it('clonar hacia un nombre tomado responde 004', async () => {
    const { service } = makeHarness([{ id: 42, name: 'Tomado' }]);
    const error = await service.clone(7, { name: 'Tomado' } as any).catch((e) => e);
    expect((error.getResponse() as any).error_code).toBe('INVOICING_PROFILE_004');
  });

  // ─── El borrado y la pareja de procedencia ────────────────────────────

  it('borrar anula la PAREJA de procedencia de los clones antes de borrar', async () => {
    const { service, txUpdateMany } = makeHarness([]);
    await service.remove(7);

    const nulling = txUpdateMany.find(
      (c) => c.where?.cloned_from_profile_id === 7,
    );
    expect(nulling).toBeDefined();
    // Anular sólo `cloned_from_profile_id` —que es lo que hace la FK por sí
    // sola— viola el CHECK `invoice_profiles_clone_pair_complete` y el borrado
    // salía como 500. Medido en vivo antes del arreglo.
    expect(nulling.data.cloned_from_profile_id).toBeNull();
    expect(nulling.data.cloned_from_version).toBeNull();
  });

  it('ese updateMany lleva el store_id: no toca la procedencia de otros tenants', async () => {
    const { service, txUpdateMany } = makeHarness([]);
    await service.remove(7);
    const nulling = txUpdateMany.find((c) => c.where?.cloned_from_profile_id === 7);
    expect(nulling.where.store_id).toBe(10);
  });

  it('si quedan clones FUERA del ámbito responde 409 y no borra', async () => {
    const { service, tx } = makeHarness([], { foreignClones: 2 });
    const error = await service.remove(7).catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(409);
    expect((error.getResponse() as any).details.foreign_clone_count).toBe(2);
    expect(tx.invoice_profiles.delete).not.toHaveBeenCalled();
    expect(tx.invoice_profile_versions.deleteMany).not.toHaveBeenCalled();
  });
});
