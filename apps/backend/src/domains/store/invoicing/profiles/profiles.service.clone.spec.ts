import { VendixHttpException } from 'src/common/errors';

import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  AIU_BUCKETS,
  AIU_TAXABLE_BUCKETS_BY_BASIS,
  AiuTaxableBasis,
  buildDefaultAiuProfileConfig,
} from './invoice-profile-config.contract';
import { ProfilesService } from './profiles.service';

/**
 * CLONADO — la única ruta capaz de romper el invariante del plan.
 *
 * El plan sostiene que ninguna versión de perfil existente cambia de contenido:
 * cada guardado escribe una fila nueva y el puntero avanza. `clone()` es la
 * excepción que nadie miró, porque hace algo que ninguna otra ruta hace: toma
 * una config HISTÓRICA y la pasa por `normalizeAndAssertProfileConfig`, que es
 * el contrato de HOY.
 *
 * Eso es deliberado y está bien argumentado en el código —un clon no debe nacer
 * con una configuración que hoy sería inválida—, pero tiene una asimetría que
 * conviene tener bajo test antes de que alguien la descubra en producción:
 *
 *   - AÑADIR una clave al allowlist del contrato es seguro. Es lo que se hizo
 *     con `taxable_basis`: las filas viejas no la traen, y su ausencia se
 *     resuelve derivándola del `regime`.
 *   - QUITAR una clave vuelve INCLONABLE a todo perfil que la tenga. `UNKNOWN_KEY`
 *     es bloqueante, así que el 422 nombra un campo que el usuario no puede
 *     corregir: vive en una versión histórica, y las versiones son inmutables
 *     por diseño. La única salida sería una migración de datos.
 *
 * Ninguno de los dos casos falla en tiempo de compilación, y ninguna otra ruta
 * los ejerce. De ahí este archivo.
 */
describe('ProfilesService — clonado contra el contrato vigente', () => {
  /** Config AIU válida bajo la base que se le pida, con la matriz reproyectada. */
  function aiuConfig(basis?: AiuTaxableBasis): Record<string, any> {
    const config: any = JSON.parse(
      JSON.stringify(buildDefaultAiuProfileConfig('Vigilancia sede norte')),
    );
    if (!basis) return config;
    config.aiu.taxable_basis = basis;
    // La base y la matriz son un solo cambio: bajo «subtotal» el costo
    // reembolsable entra a la base, así que dejar `costo.taxable = false` —el
    // valor por omisión— produciría una config que se rechaza a sí misma y el
    // fixture mediría al fixture en vez de al servicio.
    const taxable = AIU_TAXABLE_BUCKETS_BY_BASIS[basis];
    config.taxes.rules = AIU_BUCKETS.map((bucket) => {
      const existing = config.taxes.rules.find((r: any) => r.bucket === bucket);
      const shouldBeTaxable = taxable.includes(bucket);
      return {
        bucket,
        tax_code: existing?.tax_code ?? '01',
        rate: shouldBeTaxable ? (existing?.rate ?? '19.00') : '0.00',
        taxable: shouldBeTaxable,
      };
    });
    return config;
  }

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

  /**
   * @param stored  el `config` que la versión de ORIGEN tiene guardado
   * @param names   perfiles existentes de la tienda, para el choque de nombre
   */
  function makeHarness(stored: Record<string, any>, names: { id: number; name: string }[] = []) {
    const sourceRow = {
      id: 7,
      organization_id: 6,
      store_id: 10,
      name: 'Vigilancia',
      operation_type: '09',
      state: 'active',
      is_default: true,
      current_version: 4,
    };
    const cloneRow = { ...sourceRow, id: 8, name: 'Vigilancia (copia)', state: 'inactive', is_default: false, current_version: 0 };

    const tx = {
      invoice_profiles: makeDelegate(cloneRow),
      invoice_profile_versions: makeDelegate({ id: 90, version: 1, config: stored }),
    };
    tx.invoice_profiles.create = jest.fn().mockResolvedValue(cloneRow);
    tx.invoice_profiles.update = jest.fn().mockResolvedValue({ ...cloneRow, current_version: 1 });

    const scoped = {
      invoice_profiles: makeDelegate(sourceRow),
      invoice_profile_versions: makeDelegate({ config: stored }),
      invoices: makeDelegate(null),
    };
    // `findByName` recorre los perfiles de la tienda con `findMany`; `source` los
    // busca con `findFirst`. Son delegados distintos, así que no se pisan.
    scoped.invoice_profiles.findMany = jest.fn().mockResolvedValue(names);
    // Qué versión se leyó es la afirmación de uno de los casos, así que el mock
    // devuelve el `where` recibido junto al config.
    const versionReads: any[] = [];
    scoped.invoice_profile_versions.findFirst = jest.fn(({ where }: any) => {
      versionReads.push(where);
      return Promise.resolve({ config: stored });
    });

    const withoutScope = jest.fn().mockReturnValue({
      $transaction: jest.fn((cb: any) => cb(tx)),
    });
    const prisma = { ...scoped, withoutScope } as any;
    const cache = {
      read: jest.fn().mockResolvedValue(null),
      write: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
    } as any;
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new ProfilesService(prisma, cache, audit);
    return { service, tx, scoped, withoutScope, versionReads };
  }

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 6, store_id: 10, user_id: 162 } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  // ─── El invariante ────────────────────────────────────────────────────

  it('no reescribe la versión de origen: escribe una fila nueva del perfil nuevo', async () => {
    const { service, tx } = makeHarness(aiuConfig());

    await service.clone(7, { name: 'Vigilancia (copia)' } as any);

    // Lo único que se escribe en `invoice_profile_versions` es un `create`.
    expect(tx.invoice_profile_versions.update).not.toHaveBeenCalled();
    expect(tx.invoice_profile_versions.updateMany).not.toHaveBeenCalled();
    expect(tx.invoice_profile_versions.delete).not.toHaveBeenCalled();
    expect(tx.invoice_profile_versions.create).toHaveBeenCalledTimes(1);

    // Y esa fila nace en la versión 1 del perfil NUEVO, no en la 5 del original.
    const data = tx.invoice_profile_versions.create.mock.calls[0][0].data;
    expect(data.version).toBe(1);
    expect(data.profile_id).toBe(8);
  });

  it('el clon nace inactivo, no predeterminado, y con la procedencia como PAREJA', async () => {
    const { service, tx } = makeHarness(aiuConfig());

    await service.clone(7, { name: 'Vigilancia (copia)' } as any);

    const data = tx.invoice_profiles.create.mock.calls[0][0].data;
    // Si naciera activo entraría al catálogo del wizard en el mismo instante en
    // que se crea, y quien facturara entremedio emitiría con la copia sin revisar.
    expect(data.state).toBe('inactive');
    expect(data.is_default).toBe(false);
    // El puntero nace en 0 y lo mueve `commitVersion`: nunca apunta a una
    // versión que aún no se escribió.
    expect(data.current_version).toBe(0);
    // El CHECK `invoice_profiles_clone_pair_complete` exige que las dos sean
    // NULL o las dos tengan valor. Escribir una sola rompe la inserción.
    expect(data.cloned_from_profile_id).toBe(7);
    expect(data.cloned_from_version).toBe(4);
    // Y el ancla de tenant va a mano, porque dentro de la transacción el cliente
    // es el base y no lleva scoping.
    expect(data.organization_id).toBe(6);
    expect(data.store_id).toBe(10);
  });

  it('con source_version explícito clona ESA versión, no la vigente', async () => {
    const { service, tx, versionReads } = makeHarness(aiuConfig());

    await service.clone(7, { name: 'Copia de la 2', source_version: 2 } as any);

    expect(versionReads).toEqual([{ profile_id: 7, version: 2 }]);
    expect(tx.invoice_profiles.create.mock.calls[0][0].data.cloned_from_version).toBe(2);
  });

  // ─── La asimetría del contrato ────────────────────────────────────────

  it('una config histórica con una clave que el contrato de hoy no conoce deja el clonado en 422 sin crear nada', async () => {
    const stored = aiuConfig();
    // Simula el día en que alguien QUITE una clave del allowlist: la fila
    // guardada la sigue trayendo y `pickKnownKeys` la reporta como UNKNOWN_KEY,
    // que es bloqueante.
    stored.aiu.regimen_heredado_v1 = 'et_462_1';
    const { service, tx, withoutScope } = makeHarness(stored);

    const error = await service.clone(7, { name: 'Copia' } as any).catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(422);
    expect((error.getResponse() as any).error_code).toBe('INVOICING_PROFILE_005');
    // No se entra a la transacción: el clon no nace a medias.
    expect(withoutScope).not.toHaveBeenCalled();
    expect(tx.invoice_profiles.create).not.toHaveBeenCalled();
    // Y el 422 nombra un campo que el usuario NO puede corregir, porque vive en
    // una versión histórica y las versiones son inmutables. Si este test se pone
    // rojo por un cambio de contrato, la salida es una migración de datos, no
    // relajar la guarda.
    // Se afirma el CÓDIGO, no sólo el 422: con `operation_type` incoherente este
    // mismo endpoint también responde 422, y una aseveración que sólo mire el
    // estado pasa por el motivo equivocado. Es el error que esta auditoría vino
    // a corregir, así que no se comete acá.
    const issues = (error.getResponse() as any).details?.issues ?? [];
    const unknown = issues.filter((i: any) => i.code === 'UNKNOWN_KEY');
    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown.some((i: any) => String(i.field).includes('regimen_heredado_v1'))).toBe(true);
  });

  it('una config histórica cuya matriz contradice su base declarada tampoco se clona', async () => {
    const stored = aiuConfig('subtotal');
    // Bajo «subtotal» el costo reembolsable ENTRA en la base. Dejarlo sin gravar
    // es la contradicción que, si se guardara, produciría documentos que
    // INVOICING_AIU_004 corta al emitir con el consecutivo ya asignado.
    const costo = stored.taxes.rules.find((r: any) => r.bucket === 'costo');
    costo.taxable = false;
    const { service, withoutScope } = makeHarness(stored);

    const error = await service.clone(7, { name: 'Copia' } as any).catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(422);
    const issues = (error.getResponse() as any).details?.issues ?? [];
    expect(
      issues.some(
        (i: any) =>
          i.code === 'TAX_MATRIX_CONTRADICTS_REGIME' &&
          String(i.field) === 'taxes.rules.costo.taxable',
      ),
    ).toBe(true);
    expect(withoutScope).not.toHaveBeenCalled();
  });

  it('una config histórica SIN taxable_basis se clona tal cual: el clon no inventa la base', async () => {
    const stored = aiuConfig();
    // Así se ve TODA fila guardada antes de que `taxable_basis` entrara al
    // allowlist: el normalizador la borraba al guardar. Su base se deriva del
    // `regime` al leerla, y el clon debe conservar esa forma en vez de
    // materializar un campo que el original nunca tuvo.
    delete stored.aiu.taxable_basis;
    const { service, tx } = makeHarness(stored);

    await service.clone(7, { name: 'Copia' } as any);

    const committed = tx.invoice_profile_versions.create.mock.calls[0][0].data.config as any;
    expect(committed.aiu.taxable_basis).toBeUndefined();
    expect(committed.aiu.regime).toBe(stored.aiu.regime);
  });

  // ─── El nombre se comprueba ANTES de la transacción ───────────────────

  it('clonar hacia un nombre tomado no entra a la transacción', async () => {
    const { service, withoutScope, tx } = makeHarness(aiuConfig(), [
      { id: 12, name: 'Vigilancia (copia)' },
    ]);

    const error = await service
      .clone(7, { name: 'vigilancia (COPIA)' } as any)
      .catch((e) => e);

    // La comparación es insensible a mayúsculas porque el único de la base es
    // sobre `lower(name)`: dejar pasar la diferencia de caja produciría un 500
    // por violación de índice en vez del 409 que el usuario puede resolver.
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(withoutScope).not.toHaveBeenCalled();
    expect(tx.invoice_profiles.create).not.toHaveBeenCalled();
  });
});
