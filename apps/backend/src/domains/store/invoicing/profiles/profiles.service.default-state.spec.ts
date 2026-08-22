import { VendixHttpException } from 'src/common/errors';

import { RequestContextService } from '../../../../common/context/request-context.service';
import { ProfilesService } from './profiles.service';
import { DIAN_PROFILE_TEMPLATES } from './dian-profile-templates';

/**
 * PREDETERMINADO Y ESTADO — la carrera, probada sin depender del reloj.
 *
 * Las sondas concurrentes por `curl` demostraron el defecto (1 de 3 rondas
 * devolvió 200 a un cliente cuyo perfil no quedó predeterminado) pero no pueden
 * demostrar el arreglo: dos `curl` «simultáneos` a veces se solapan y a veces se
 * secuencian, y el caso secuencial DEBE devolver dos 200 —la segunda petición
 * leyó el estado nuevo y pidió un traspaso legítimo—. Distinguir uno de otro a
 * posteriori es imposible desde fuera.
 *
 * Acá el solapamiento se construye: la lectura de dentro de la transacción
 * devuelve un predeterminado distinto del que se leyó fuera, que es exactamente
 * lo que ve el perdedor de una carrera real.
 */
describe('ProfilesService — predeterminado y estado', () => {
  const CONFIG = DIAN_PROFILE_TEMPLATES[1].config as unknown as Record<string, unknown>;

  function harness(opts: {
    profile?: Record<string, unknown>;
    /** Predeterminado vigente que ve la lectura de FUERA de la transacción. */
    outsideDefault?: { id: number } | null;
    /** El que ve la lectura de DENTRO. Distinto ⇒ carrera perdida. */
    insideDefault?: { id: number } | null;
    /** Fuerza que el marcado choque con el índice único parcial. */
    uniqueViolationOnMark?: boolean;
  } = {}) {
    const profile = {
      id: 13,
      organization_id: 6,
      store_id: 10,
      name: 'Perfil',
      operation_type: '09',
      state: 'active',
      is_default: false,
      current_version: 1,
      ...(opts.profile ?? {}),
    };

    const updates: any[] = [];
    const tx: any = {
      invoice_profiles: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(
            // `assertOwned` pregunta por id + store_id; la comprobación de la
            // carrera pregunta por `is_default: true`.
            where?.is_default === true
              ? (opts.insideDefault ?? null)
              : where?.store_id === 10 && where?.id === profile.id
                ? profile
                : null,
          ),
        ),
        update: jest.fn((args: any) => {
          updates.push(args);
          if (opts.uniqueViolationOnMark && args.data?.is_default === true) {
            return Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' }));
          }
          return Promise.resolve({ ...profile, ...args.data });
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      invoice_profile_versions: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, version: 1, config: CONFIG }),
      },
    };

    let outsideCalls = 0;
    const scoped: any = {
      invoice_profiles: {
        findFirst: jest.fn(({ where }: any) => {
          if (where?.is_default === true) {
            outsideCalls += 1;
            return Promise.resolve(opts.outsideDefault ?? null);
          }
          return Promise.resolve(where?.id === profile.id ? profile : null);
        }),
      },
      invoice_profile_versions: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, version: 1, config: CONFIG }),
      },
      invoices: { count: jest.fn().mockResolvedValue(0) },
      withoutScope: jest.fn().mockReturnValue({ $transaction: jest.fn((cb: any) => cb(tx)) }),
    };

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
    const service = new ProfilesService(scoped, cache, audit);
    return { service, tx, scoped, updates, outside: () => outsideCalls, profile };
  }

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 6, store_id: 10, user_id: 162 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  // ─── La carrera ────────────────────────────────────────────────────────

  it('si el predeterminado cambió entre las dos lecturas responde 409 y NO escribe', async () => {
    // Fuera se leyó «no hay predeterminado»; dentro ya hay uno: otro ganó.
    const { service, updates } = harness({ outsideDefault: null, insideDefault: { id: 8 } });

    const error = await service.setDefault(13).catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(409);
    const body = error.getResponse() as any;
    expect(body.error_code).toBe('INVOICING_PROFILE_002');
    expect(body.details).toEqual({ profile_id: 13, operation_type: '09' });
    // Lo que prueba que no hubo daño: ninguna escritura salió.
    expect(updates).toHaveLength(0);
  });

  it('la rama simétrica —el rival commitea después— la ataja el índice único y da el MISMO 409', async () => {
    const { service } = harness({
      outsideDefault: null,
      insideDefault: null,
      uniqueViolationOnMark: true,
    });

    const error = await service.setDefault(13).catch((e) => e);

    expect(error.getStatus()).toBe(409);
    expect((error.getResponse() as any).error_code).toBe('INVOICING_PROFILE_002');
  });

  it('un traspaso legítimo desmarca el anterior por id exacto y marca el nuevo', async () => {
    const { service, updates } = harness({
      outsideDefault: { id: 8 },
      insideDefault: { id: 8 },
    });

    await service.setDefault(13);

    expect(updates).toHaveLength(2);
    // Primero el desmarcado, por id CONCRETO — no un `updateMany` a ciegas.
    expect(updates[0].where).toEqual({ id: 8 });
    expect(updates[0].data.is_default).toBe(false);
    expect(updates[1].where).toEqual({ id: 13 });
    expect(updates[1].data.is_default).toBe(true);
  });

  it('sin predeterminado previo marca directo, sin desmarcar nada', async () => {
    const { service, updates } = harness({ outsideDefault: null, insideDefault: null });

    await service.setDefault(13);

    expect(updates).toHaveLength(1);
    expect(updates[0].data.is_default).toBe(true);
  });

  it('la respuesta sale de la transacción, no de una relectura posterior', async () => {
    const { service, scoped } = harness({ outsideDefault: null, insideDefault: null });

    const result: any = await service.setDefault(13);

    expect(result.is_default).toBe(true);
    // Entre el commit y una relectura cabe otro traspaso: si la respuesta
    // viniera de ahí, afirmaría un estado que el servidor ya no sostiene.
    const rereads = scoped.invoice_profiles.findFirst.mock.calls.filter(
      (c: any[]) => c[0]?.where?.id === 13 && c[0]?.where?.is_default === undefined,
    );
    expect(rereads).toHaveLength(1); // sólo la lectura previa
  });

  // ─── Estado ────────────────────────────────────────────────────────────

  it('no se puede predeterminar un perfil inactivo: 409 _007 y sin transacción', async () => {
    const { service, scoped } = harness({ profile: { state: 'inactive' } });

    const error = await service.setDefault(13).catch((e) => e);

    expect(error.getStatus()).toBe(409);
    expect((error.getResponse() as any).error_code).toBe('INVOICING_PROFILE_007');
    expect(scoped.withoutScope).not.toHaveBeenCalled();
  });

  it('predeterminar el que ya lo es es idempotente y no abre transacción', async () => {
    const { service, scoped } = harness({ profile: { is_default: true } });

    await service.setDefault(13);

    expect(scoped.withoutScope).not.toHaveBeenCalled();
  });

  it('activar uno ya activo no escribe', async () => {
    const { service, scoped } = harness({ profile: { state: 'active' } });

    await service.activate(13);

    expect(scoped.withoutScope).not.toHaveBeenCalled();
  });

  it('desactivar el predeterminado arrastra is_default a false', async () => {
    const { service, updates } = harness({
      profile: { state: 'active', is_default: true },
    });

    await service.deactivate(13);

    expect(updates).toHaveLength(1);
    expect(updates[0].data.state).toBe('inactive');
    // Sin esto quedaría un predeterminado que `/catalog` no muestra: el wizard
    // pediría el default y lo encontraría fuera de los elegibles.
    expect(updates[0].data.is_default).toBe(false);
  });

  it('activar NO pone is_default: son dos decisiones', async () => {
    const { service, updates } = harness({ profile: { state: 'inactive', is_default: false } });

    await service.activate(13);

    expect(updates).toHaveLength(1);
    expect(updates[0].data.state).toBe('active');
    expect(updates[0].data).not.toHaveProperty('is_default');
  });

  it('desactivar uno que NO era predeterminado no toca is_default', async () => {
    const { service, updates } = harness({ profile: { state: 'active', is_default: false } });

    await service.deactivate(13);

    expect(updates[0].data).not.toHaveProperty('is_default');
  });

  it('las tres operaciones comprueban el ancla de tenant dentro de la transacción', async () => {
    const { service, tx } = harness({ outsideDefault: null, insideDefault: null });

    await service.setDefault(13);

    const owned = tx.invoice_profiles.findFirst.mock.calls.find(
      (c: any[]) => c[0]?.where?.store_id === 10 && c[0]?.where?.id === 13,
    );
    expect(owned).toBeDefined();
  });
});
